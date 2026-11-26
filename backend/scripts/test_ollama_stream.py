#!/usr/bin/env python
"""本地 Ollama 流式问答全链路测试脚本（V1.0.6.2）。

用法（仓库根目录，使用 backend/.venv）::

    # 1) 最常用：读取 backend/.env，连本地 Ollama，问一句默认问题
    backend\\.venv\\Scripts\\python.exe backend\\scripts\\test_ollama_stream.py

    # 2) 自定义问题 / 模型
    backend\\.venv\\Scripts\\python.exe backend\\scripts\\test_ollama_stream.py ^
        --question "用一句话介绍玄武门之变" ^
        --model hf.co/mradermacher/XiaoHong-v1-GGUF:Q4_K_M

    # 3) 打开思考模式，观察 思考标签过滤 / reasoning 丢弃行为
    backend\\.venv\\Scripts\\python.exe backend\\scripts\\test_ollama_stream.py --think

    # 4) 机器可读输出（CI / 巡检）
    backend\\.venv\\Scripts\\python.exe backend\\scripts\\test_ollama_stream.py --json

脚本做四件事：
1. **配置自检**：打印脱敏后的 base_url / 模型名 / 思考开关 / 超时（不打印 API Key）；
2. **连通性检查**：用 OpenAI SDK `models.list()` 确认 Ollama 在线且模型已 pull；
3. **过滤器单测**：用合成 chunk 验证 ThinkTagFilter（含标签被 chunk 切断、未闭合等边界）；
4. **真实流式问答**：stream=True 逐字接收，断言最终回答里没有任何思考标签 / 思考正文，
   并报告首字延迟、总耗时、token 用量、被过滤字符数。

退出码：0=全部通过；1=存在失败；2=环境不可用（Ollama 未启动 / 模型缺失 / 配置错误）。
"""

from __future__ import annotations

import argparse
import json
import sys
import time
from dataclasses import replace
from pathlib import Path
from typing import Any

BACKEND_DIR = Path(__file__).resolve().parents[1]
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

from llm_client import LLMConfigError, LLMTimeoutError, LLMUpstreamError
from llm_stream import (
    StreamChatClient,
    StreamSettings,
    load_stream_settings,
)
from log_safety import mask_secret, sanitize_log_text
from think_filter import ThinkTagFilter, strip_think_tags

#: 标签字面量由片段拼接，避免被部分工具链当成隐藏推理标记。
_OPEN = "<" + "think" + ">"
_CLOSE = "<" + "/" + "think" + ">"
_OPEN_LONG = "<" + "thinking" + ">"
_CLOSE_LONG = "<" + "/" + "thinking" + ">"
_TAG_MARKERS = ("<" + "think", "think" + ">", "<" + "thinking")

DEFAULT_QUESTION = "用一句话介绍三国时期的赤壁之战。"


def _setup_console() -> None:
    """Windows 控制台默认 GBK，强制 UTF-8，避免中文 / emoji 输出乱码或报错。"""

    for stream in (sys.stdout, sys.stderr):
        reconfigure = getattr(stream, "reconfigure", None)
        if callable(reconfigure):
            try:
                reconfigure(encoding="utf-8")
            except Exception:  # noqa: BLE001, S110 - 极端环境（不支持 reconfigure 的流）忽略
                pass


def _print_header(title: str) -> None:
    print(f"\n=== {title} ===", flush=True)


def _masked_settings(settings: StreamSettings) -> dict[str, Any]:
    """可安全打印 / 落日志的配置摘要（密钥脱敏）。"""

    return {
        "base_url": settings.base_url,
        "model": settings.model,
        "fallback_model": settings.fallback_model,
        "api_key": mask_secret(settings.api_key),
        "reasoning_effort": settings.reasoning_effort,
        "timeout_seconds": settings.timeout_seconds,
        "max_tokens": settings.max_tokens,
        "system_prompt_chars": len(settings.system_prompt),
    }


# ---------------------------------------------------------------------------
# 1) ThinkTagFilter 合成用例（不依赖网络）
# ---------------------------------------------------------------------------


def run_filter_self_test() -> tuple[bool, list[str]]:
    """用合成 chunk 验证过滤器；返回 (是否通过, 失败说明列表)。"""

    failures: list[str] = []

    def check(name: str, actual: str, expected: str) -> None:
        if actual != expected:
            failures.append(f"{name}: expected={expected!r} actual={actual!r}")

    def feed_all(chunks: list[str]) -> tuple[str, ThinkTagFilter]:
        tag_filter = ThinkTagFilter()
        visible = "".join(tag_filter.feed(chunk) for chunk in chunks)
        visible += tag_filter.flush()
        return visible, tag_filter

    check(
        "完整思考块被删除",
        strip_think_tags(f"前言 {_OPEN}思考过程{_CLOSE} 最终答案"),
        "前言  最终答案",
    )
    check(
        "多段思考块被删除",
        strip_think_tags(f"{_OPEN}甲{_CLOSE}答案一{_OPEN_LONG}乙{_CLOSE_LONG}答案二"),
        "答案一答案二",
    )
    check("未闭合思考块后续内容丢弃", strip_think_tags(f"答案{_OPEN}想不完"), "答案")
    visible, tag_filter = feed_all(["答案前", "<thi", "nk>思考", "</thi", "nk>答案后"])
    check("跨 chunk 切断的标签", visible, "答案前答案后")
    if tag_filter.filtered_chars <= 0:
        failures.append("跨 chunk 用例：filtered_chars 应大于 0")
    visible, tag_filter = feed_all(["1 <", " 2 成立"])
    check("普通小于号不被误吞", visible, "1 < 2 成立")
    if tag_filter.filtered_chars != 0:
        failures.append("普通小于号用例：filtered_chars 应为 0")
    return (not failures, failures)


# ---------------------------------------------------------------------------
# 2) 真实流式问答
# ---------------------------------------------------------------------------


def run_stream_test(
    client: StreamChatClient,
    settings: StreamSettings,
    question: str,
) -> tuple[bool, dict[str, Any]]:
    """真实调用 stream=True；断言最终答案不含思考标签，返回 (是否通过, 指标)。"""

    messages = [
        {"role": "system", "content": settings.system_prompt},
        {"role": "user", "content": question},
    ]
    started = time.perf_counter()
    chunks: list[str] = []
    done_event = None
    first_chunk_at: float | None = None
    print("模型输出：", end="", flush=True)
    try:
        for event in client.stream(messages):
            if event.type == "delta":
                if first_chunk_at is None:
                    first_chunk_at = time.perf_counter() - started
                chunks.append(event.text)
                print(event.text, end="", flush=True)
            elif event.type == "done":
                done_event = event
    except LLMTimeoutError as exc:
        print(f"\n[超时] {exc}")
        return False, {"error": "timeout", "message": str(exc)}
    except LLMUpstreamError as exc:
        print(f"\n[上游错误] {exc}")
        return False, {"error": "upstream", "message": str(exc)}
    print(flush=True)

    if done_event is None:
        return False, {"error": "no_done_event"}

    answer = done_event.answer
    streamed = "".join(chunks).strip()
    metrics: dict[str, Any] = {
        "answer": answer,
        "streamed_matches_done": streamed == answer.strip(),
        "answer_chars": len(answer),
        "reasoning_chars": done_event.reasoning_chars,
        "filtered_chars": done_event.filtered_chars,
        "latency_ms": done_event.latency_ms,
        "first_token_ms": done_event.first_token_ms,
        "first_chunk_ms": int(first_chunk_at * 1000)
        if first_chunk_at is not None
        else None,
        "usage": done_event.usage,
        "finish_reason": done_event.finish_reason,
        "wall_ms": int((time.perf_counter() - started) * 1000),
    }

    ok = True
    if not answer.strip():
        ok = False
        metrics["failure"] = "最终答案为空"
    leaked = [marker for marker in _TAG_MARKERS if marker in answer]
    if leaked:
        ok = False
        metrics["failure"] = f"最终答案泄漏思考标签：{leaked}"
    if not strip_think_tags(answer).strip():
        ok = False
        metrics["failure"] = "最终答案经 strip_think_tags 清洗后为空（疑似只有思考块）"
    if not metrics["streamed_matches_done"]:
        ok = False
        metrics["failure"] = "流式增量拼接结果与 done.answer 不一致"
    metrics["ok"] = ok
    return ok, metrics


def run_thinking_mode_probe(
    settings: StreamSettings,
    question: str,
) -> tuple[bool, dict[str, Any]]:
    """思考模式探针：验证 reasoning 字段丢弃 + content 标签过滤。

    XiaoHong-v1 不会输出思考标签的收尾部分，Ollama 会把它全部归入 ``reasoning``，
    此时 content 为空——这属于**已知模型行为**，脚本给出说明但不算失败；
    若模型最终给出 content，则复用过滤器断言其不含思考标签。

    注意：本探针使用独立的「不发送 reasoning_effort」客户端，不会影响主流程的
    「关闭思考」配置。
    """

    think_settings = replace(settings, reasoning_effort=None)
    think_client = StreamChatClient(think_settings)
    messages = [
        {"role": "system", "content": think_settings.system_prompt},
        {"role": "user", "content": question},
    ]
    try:
        events = list(think_client.stream(messages))
    except LLMUpstreamError as exc:
        message = str(exc)
        if "LLM_REASONING_EFFORT" in message or "思考内容" in message:
            return True, {
                "ok": True,
                "known_behavior": (
                    "该模型开启了思考但没有输出最终答案：Ollama 把全部内容放进 reasoning。"
                    " 这是 XiaoHong-v1 的已知行为，请在 .env 设置 LLM_REASONING_EFFORT=none。"
                ),
            }
        return False, {"ok": False, "error": message}
    finally:
        think_client.close()
    deltas = "".join(event.text for event in events if event.type == "delta")
    done = next((event for event in events if event.type == "done"), None)
    if done is None:
        return False, {"ok": False, "error": "没有 done 事件"}
    leaked = [marker for marker in _TAG_MARKERS if marker in done.answer]
    ok = done.answer.strip() != "" and not leaked
    return ok, {
        "ok": ok,
        "answer": done.answer,
        "streamed_chars": len(deltas),
        "reasoning_chars": done.reasoning_chars,
        "filtered_chars": done.filtered_chars,
        "known_behavior": (
            "思考已由服务端丢弃（reasoning_chars > 0），只下发最终答案"
            if done.reasoning_chars
            else "本轮模型未输出 reasoning"
        ),
    }


# ---------------------------------------------------------------------------
# main
# ---------------------------------------------------------------------------


def _build_settings(args: argparse.Namespace) -> StreamSettings:
    settings = load_stream_settings()
    overrides: dict[str, Any] = {}
    if args.base_url:
        overrides["base_url"] = args.base_url.rstrip("/")
    if args.api_key:
        overrides["api_key"] = args.api_key
    if args.model:
        overrides["model"] = args.model
    if args.timeout:
        overrides["timeout_seconds"] = float(args.timeout)
    if args.max_tokens:
        overrides["max_tokens"] = int(args.max_tokens)
    effective = replace(settings, **overrides)
    if not effective.api_key:
        raise LLMConfigError(
            "缺少模型密钥：请在 backend/.env 写入 MODELSCOPE_API_KEY（本地填 ollama 即可）"
        )
    return effective


def main(argv: list[str]) -> int:
    _setup_console()
    parser = argparse.ArgumentParser(
        description="本地 Ollama 流式问答全链路测试（V1.0.6.2）"
    )
    parser.add_argument("--question", default=DEFAULT_QUESTION, help="测试问题")
    parser.add_argument(
        "--base-url",
        default="",
        help="覆盖 MODELSCOPE_BASE_URL（如 http://localhost:11434/v1）",
    )
    parser.add_argument(
        "--api-key",
        default="",
        help="覆盖 MODELSCOPE_API_KEY（本地随便填，例如 ollama）",
    )
    parser.add_argument("--model", default="", help="覆盖 MODELSCOPE_MODEL")
    parser.add_argument("--timeout", type=float, default=0, help="覆盖流式超时（秒）")
    parser.add_argument("--max-tokens", type=int, default=0, help="覆盖最大输出 token")
    parser.add_argument(
        "--think", action="store_true", help="打开思考模式，验证 reasoning / 标签过滤"
    )
    parser.add_argument("--json", action="store_true", help="输出机器可读 JSON 摘要")
    args = parser.parse_args(argv)

    report: dict[str, Any] = {"ok": False, "steps": {}}

    # ---- 1) 配置 ----
    try:
        settings = _build_settings(args)
    except LLMConfigError as exc:
        print(f"[配置错误] {exc}")
        report["steps"]["config"] = {"ok": False, "error": str(exc)}
        if args.json:
            print(json.dumps(report, ensure_ascii=False, indent=2))
        return 2

    print("史脉 · 本地 Ollama 流式问答测试（V1.0.6.2）")
    print(f"配置：{json.dumps(_masked_settings(settings), ensure_ascii=False)}")
    print(
        f"日志脱敏示例：{sanitize_log_text('Authorization: Bearer sk-demo-123456 -> masked')}"
    )
    report["steps"]["config"] = {"ok": True, **_masked_settings(settings)}

    # ---- 2) 过滤器合成用例 ----
    _print_header("ThinkTagFilter 合成用例（离线）")
    filter_ok, filter_failures = run_filter_self_test()
    report["steps"]["filter"] = {"ok": filter_ok, "failures": filter_failures}
    if filter_ok:
        print("✓ 全部通过：跨 chunk 标签、未闭合思考块、普通小于号等边界均符合预期")
    else:
        for failure in filter_failures:
            print(f"✗ {failure}")

    # ---- 3) 连通性 / 模型列表 ----
    _print_header("Ollama 连通性检查（OpenAI SDK models.list）")
    client = StreamChatClient(settings)
    try:
        model_ids = client.list_models()
        print(f"✓ 上游可用模型（{len(model_ids)}）：{', '.join(model_ids) or '（空）'}")
        model_present = settings.model in model_ids
        report["steps"]["connectivity"] = {
            "ok": True,
            "models": model_ids,
            "model_present": model_present,
        }
        if not model_present:
            print(
                f"✗ 模型 {settings.model} 不在可用列表中："
                "请先 ollama pull（或检查 MODELSCOPE_MODEL 拼写）"
            )
            report["steps"]["connectivity"]["ok"] = False
    except (LLMTimeoutError, LLMUpstreamError, LLMConfigError) as exc:
        print(f"✗ 连接失败：{exc}")
        report["steps"]["connectivity"] = {"ok": False, "error": str(exc)}
        if args.json:
            print(json.dumps(report, ensure_ascii=False, indent=2))
        return 2

    # ---- 4) 真实流式问答 ----
    _print_header("真实流式问答（stream=True，思考内容服务端过滤）")
    print(f"问题：{args.question}")
    stream_ok, metrics = run_stream_test(client, settings, args.question)
    report["steps"]["stream"] = metrics
    if stream_ok:
        print(
            f"✓ 通过：首字 {metrics.get('first_token_ms')}ms / 总耗时 "
            f"{metrics.get('latency_ms')}ms / 回答 {metrics.get('answer_chars')} 字"
            f" / 过滤思考 {metrics.get('reasoning_chars')} 字"
            f" / 过滤标签 {metrics.get('filtered_chars')} 字"
        )
    else:
        print(f"✗ 失败：{metrics.get('failure') or metrics.get('error')}")

    # ---- 5) 思考模式探针（可选）----
    think_ok: bool | None = None
    if args.think:
        _print_header("思考模式探针（--think）")
        think_ok, think_metrics = run_thinking_mode_probe(settings, args.question)
        report["steps"]["thinking"] = think_metrics
        if think_ok:
            print(f"✓ {think_metrics.get('known_behavior')}")
        else:
            print(f"✗ {think_metrics.get('error')}")

    # ---- 汇总 ----
    client.close()
    all_ok = (
        filter_ok and stream_ok and report["steps"]["connectivity"].get("ok", False)
    )
    if think_ok is False:
        all_ok = False
    report["ok"] = bool(all_ok)
    _print_header("测试结果")
    print("✓ 全部通过" if all_ok else "✗ 存在失败项")
    if not all_ok:
        print(
            "排查提示：确认 ollama serve 在运行、模型已 pull、backend/.env 的 BASE_URL / MODEL 一致；"
            "模型只输出思考时把 LLM_REASONING_EFFORT 设为 none。"
        )
    if args.json:
        print(json.dumps(report, ensure_ascii=False, indent=2))
    return 0 if all_ok else 1


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
