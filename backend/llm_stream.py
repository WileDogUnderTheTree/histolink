"""本地 Ollama 流式问答客户端（V1.0.6.2 · OpenAI SDK + stream=True + 思考过程过滤 +
重复循环治理）。

职责
----
- 用 **官方 OpenAI SDK** 连接任意 OpenAI 兼容服务（默认本地 Ollama：
  ``base_url=http://localhost:11434/v1``，``api_key=ollama``）；
- `stream=True` 逐 token 拉取，**只把最终答案**交给调用方：
  * ``delta.reasoning`` / ``delta.reasoning_content``（Ollama / DeepSeek 等扩展字段）
    整段丢弃，只统计字符数；
  * ``content`` 里的 ``thinking`` 标签交给 `think_filter.ThinkTagFilter`
    做流式安全过滤（标签被 chunk 切断也不会漏字）；
- **V1.0.6.2 专项修复（痛点 2）**：本地小模型（XiaoHong-v1 / 8B）会陷入
  「结论 → 依据一/二/三 → 结论 → 依据一/二/三」的循环复述。
  * 默认温度从 `0.7` 降到 `LLM_STREAM_TEMPERATURE=0.3`（可用环境变量覆盖），降低抽样抖动；
  * 生成过程中用 `text_hygiene.find_repetition_cut()` 识别整句复述 / 小节重开并**立即停止**，
    截断到第一次循环开始处（`finish_reason="repetition"`）；
  * 结束时对完整答案做 `sanitize_model_answer()`（重复行 / 重复句只保留第一次）；
  * 注入历史前对 assistant 消息同样做重复治理，避免循环跨轮传染；
- 把配置错误 / 连接失败 / 超时 / 上游 HTTP 错误统一映射成 `llm_client` 的
  ``LLMConfigError`` / ``LLMTimeoutError`` / ``LLMUpstreamError``，
  便于路由层复用与 `/api/agent/ask` 一致的错误语义。

为什么默认关闭思考（``LLM_REASONING_EFFORT=none``）
--------------------------------------------------
Ollama 的 Qwen3 模板会在 assistant 轮开头自动写入 ``think``，而 XiaoHong-v1 这类
微调模型并不会输出 ```` 收尾标签；此时 Ollama 的 OpenAI 兼容层会把**全部内容**
放进 ``reasoning``，``content`` 为空——前端流式拿到的是空回答。因此本模块在
``base_url`` 指向本机回环地址时默认发送 ``reasoning_effort="none"`` 关闭思考，
让最终答案进入 ``content``。需要验证 思考标签过滤 时，可显式把
``reasoning_effort`` 设为 None（测试脚本 ``--think`` 参数即为此场景）。

「深度思考」开关（V1.0.6.2）
----------------------------
`StreamChatClient.stream(..., enable_thinking=True)` 用于用户主动开启深度思考：
不再发送「关闭思考」参数，改为显式 ``enable_thinking=True``，并在 Prompt 中要求
「先内部推理、再只输出最终答案」；思考正文仍由本模块过滤（只统计字符数），
前端只看到最终答案。`XiaoHong-v1` 这类不完全支持思考标签的本地模型，开启后若
只产出 reasoning（无最终答案），路由层会自动回退到关闭思考重试一次，保证仍有回答。

本模块不依赖 FastAPI，可被 `backend/scripts/test_ollama_stream.py` 单独调用。
"""

from __future__ import annotations

import logging
import os
import time
from collections.abc import Iterator, Mapping
from dataclasses import dataclass
from typing import Any, Final

import httpx

from llm_client import (
    LLMConfigError,
    LLMSettings,
    LLMTimeoutError,
    LLMUpstreamError,
    _first_non_empty,
    _load_env_files,
    load_llm_settings,
    resolve_reasoning_effort,
)
from text_hygiene import find_repetition_cut, sanitize_model_answer
from think_filter import ThinkTagFilter

logger = logging.getLogger("histolink.llm.stream")

__all__ = [
    "DEFAULT_STREAM_MAX_TOKENS",
    "DEFAULT_STREAM_SYSTEM_PROMPT",
    "DEFAULT_STREAM_TEMPERATURE",
    "DEFAULT_STREAM_THINKING_PROMPT",
    "DEFAULT_STREAM_TIMEOUT_SECONDS",
    "StreamChatClient",
    "StreamEvent",
    "StreamSettings",
    "build_direct_chat_messages",
    "load_stream_settings",
    "sse_event",
]

#: 流式请求默认超时（秒）；本地 8B 首字通常 1–3s、整段 10–60s，留足余量。
DEFAULT_STREAM_TIMEOUT_SECONDS: Final[float] = 300.0
#: 流式请求默认最大输出 token。
DEFAULT_STREAM_MAX_TOKENS: Final[int] = 2048
#: V1.0.6.2：流式直答默认温度。旧的 0.7 会让本地 8B 模型频繁陷入重复循环；
#: 降到 0.3 明显收敛，仍保留少量变化避免答案过于模板化（可用 LLM_STREAM_TEMPERATURE 覆盖）。
DEFAULT_STREAM_TEMPERATURE: Final[float] = 0.3
#: 可直接问答的最小 System Prompt（证据问答链路仍走 /api/agent/ask 的完整 Prompt）。
DEFAULT_STREAM_SYSTEM_PROMPT: Final[str] = (
    "你是「史脉」的历史问答助手，熟悉中国历史。请严格遵守：\n"
    "1. 先给直接结论，再补充 1–3 条关键依据（时间、人物、事件）；\n"
    "2. **只写一遍答案**：同一个事实 / 同一条依据 / 同一句结论只允许出现一次；\n"
    "   禁止先列一遍依据、再换措辞把同样内容重写一遍，禁止输出多个版本；\n"
    "   **写完最后一条依据立即结束**：不要再写总结段 / 复述段 / 「综上」段落；\n"
    "3. 用简体中文 Markdown 回答，不要输出 JSON，不要输出思考过程；\n"
    "4. 不确定的内容直说不确定，不要编造具体年份、人名或引文；\n"
    "5. 与历史无关的问题礼貌说明超出范围。"
)
#: V1.0.6.2「深度思考」开启时追加的 System Prompt 约束（Prompt 级深度思考）。
#:
#: 服务端会过滤思考正文，因此这里明确要求「先在心里推理、再只输出最终答案」：
#: 对支持 reasoning 的模型是补充约束，对不支持的上游则等价于要求先想清楚再作答。
DEFAULT_STREAM_THINKING_PROMPT: Final[str] = (
    "\n\n【深度思考模式（本轮已开启）】\n"
    "回答前先在心里完成完整推理：核对时间与朝代、人物身份与关系、事件因果与易混点，"
    "再给出最终答案。\n"
    "推理过程只在内部进行：只输出最终结论与关键依据，不要输出思考过程、草稿、"
    "「我们先分析」之类的独白；结论只写一遍，写完立即结束。"
)
#: 环境变量名。
_STREAM_TIMEOUT_ENV_NAMES: Final[tuple[str, ...]] = ("LLM_STREAM_TIMEOUT_SECONDS",)
_STREAM_MAX_TOKENS_ENV_NAMES: Final[tuple[str, ...]] = ("LLM_STREAM_MAX_TOKENS",)
_STREAM_TEMPERATURE_ENV_NAMES: Final[tuple[str, ...]] = ("LLM_STREAM_TEMPERATURE",)
_REASONING_EFFORT_ENV_NAMES: Final[tuple[str, ...]] = ("LLM_REASONING_EFFORT",)
_SYSTEM_PROMPT_ENV_NAMES: Final[tuple[str, ...]] = ("LLM_STREAM_SYSTEM_PROMPT",)
#: 显式「不发送 reasoning_effort 参数」的取值（关闭思考请用 ``none``）。
#: 单轮消息上限（与 llm_client.MAX_CHAT_MESSAGES 保持同量级）。
_MAX_DIRECT_MESSAGES: Final[int] = 24
_MAX_MESSAGE_CHARS: Final[int] = 8000


@dataclass(frozen=True)
class StreamSettings:
    """流式直答配置（不可变）。

    - ``reasoning_effort``：``None`` 表示不发送该参数（交给上游，Ollama 会开思考）；
      ``"none"`` 表示让模型把最终答案写进 ``content``（推荐，见模块 docstring）；
    - ``system_prompt``：直答模式的系统提示词（与证据问答链路解耦）。
    """

    api_key: str
    base_url: str
    model: str
    fallback_model: str | None
    timeout_seconds: float
    max_tokens: int
    reasoning_effort: str | None
    system_prompt: str
    #: V1.0.6.2：采样温度（默认 0.3；越高越容易重复循环）。
    temperature: float = DEFAULT_STREAM_TEMPERATURE

    @property
    def masked_key(self) -> str:
        """日志 / 测试脚本展示用：密钥只保留首尾各 2 位。"""

        key = self.api_key or ""
        if len(key) <= 6:
            return "***"
        return f"{key[:2]}***{key[-2:]}"


@dataclass(frozen=True)
class StreamEvent:
    """流式事件：`delta` 是可直接发给前端的正文增量，`done` 是最终结果。"""

    type: str  # "delta" | "done"
    text: str = ""
    answer: str = ""
    model: str = ""
    latency_ms: int = 0
    first_token_ms: int | None = None
    usage: dict[str, int] | None = None
    reasoning_chars: int = 0
    filtered_chars: int = 0
    finish_reason: str | None = None
    #: V1.0.6.2：重复治理删除的字符数（只上报数量，便于观测 / 验收）。
    deduped_chars: int = 0
    #: V1.0.6.2：是否因检测到循环复述而提前停止生成。
    repetition_stopped: bool = False

    def to_dict(self) -> dict[str, Any]:
        """转成 SSE data 的 JSON 结构（字段按需裁剪，不含任何思考正文）。"""

        if self.type == "delta":
            return {"type": "delta", "text": self.text}
        payload: dict[str, Any] = {
            "type": "done",
            "answer": self.answer,
            "model": self.model,
            "latency_ms": self.latency_ms,
            "reasoning_chars": self.reasoning_chars,
            "filtered_chars": self.filtered_chars,
            # V1.0.6.2 重复治理观测：前端可忽略，验收脚本 / 测试据此断言。
            "deduped_chars": self.deduped_chars,
            "repetition_stopped": self.repetition_stopped,
        }
        if self.first_token_ms is not None:
            payload["first_token_ms"] = self.first_token_ms
        if self.usage is not None:
            payload["usage"] = self.usage
        if self.finish_reason is not None:
            payload["finish_reason"] = self.finish_reason
        return payload


def _parse_float(raw: str, *, name: str, minimum: float, maximum: float) -> float:
    try:
        value = float(raw)
    except (TypeError, ValueError) as exc:
        raise LLMConfigError(f"{name} 必须是数字，当前值：{raw!r}") from exc
    if not minimum <= value <= maximum:
        raise LLMConfigError(
            f"{name} 必须在 {minimum:g}–{maximum:g} 之间，当前值：{value:g}"
        )
    return value


def _parse_int(raw: str, *, name: str, minimum: int, maximum: int) -> int:
    try:
        value = int(raw)
    except (TypeError, ValueError) as exc:
        raise LLMConfigError(f"{name} 必须是整数，当前值：{raw!r}") from exc
    if not minimum <= value <= maximum:
        raise LLMConfigError(f"{name} 必须在 {minimum}–{maximum} 之间，当前值：{value}")
    return value


def load_stream_settings(
    env: Mapping[str, str] | None = None,
    *,
    load_env_file: bool = True,
) -> StreamSettings:
    """读取流式直答配置（复用 llm_client 的 key / base_url / 主模型解析规则）。"""

    if load_env_file:
        _load_env_files()
    source: Mapping[str, str] = os.environ if env is None else env
    base: LLMSettings = load_llm_settings(source, load_env_file=False)

    raw_timeout = _first_non_empty(source, _STREAM_TIMEOUT_ENV_NAMES) or str(
        DEFAULT_STREAM_TIMEOUT_SECONDS
    )
    timeout_seconds = _parse_float(
        raw_timeout, name="LLM_STREAM_TIMEOUT_SECONDS", minimum=10.0, maximum=900.0
    )
    raw_max_tokens = _first_non_empty(source, _STREAM_MAX_TOKENS_ENV_NAMES) or str(
        DEFAULT_STREAM_MAX_TOKENS
    )
    max_tokens = _parse_int(
        raw_max_tokens, name="LLM_STREAM_MAX_TOKENS", minimum=64, maximum=8192
    )
    raw_temperature = _first_non_empty(source, _STREAM_TEMPERATURE_ENV_NAMES) or str(
        DEFAULT_STREAM_TEMPERATURE
    )
    temperature = _parse_float(
        raw_temperature, name="LLM_STREAM_TEMPERATURE", minimum=0.0, maximum=1.5
    )
    raw_effort = _first_non_empty(source, _REASONING_EFFORT_ENV_NAMES)
    reasoning_effort = resolve_reasoning_effort(raw_effort, base.base_url)
    system_prompt = (
        _first_non_empty(source, _SYSTEM_PROMPT_ENV_NAMES)
        or DEFAULT_STREAM_SYSTEM_PROMPT
    )

    return StreamSettings(
        api_key=base.api_key,
        base_url=base.base_url,
        model=base.model,
        fallback_model=base.fallback_model,
        timeout_seconds=timeout_seconds,
        max_tokens=max_tokens,
        reasoning_effort=reasoning_effort,
        system_prompt=system_prompt,
        temperature=temperature,
    )


def build_direct_chat_messages(
    history: list[Mapping[str, Any]] | tuple[Mapping[str, Any], ...] | None,
    question: str,
    *,
    system_prompt: str | None = None,
    enable_thinking: bool = False,
) -> list[dict[str, str]]:
    """把「会话历史 + 本轮问题」组装成直答 messages（带长度与条数上限）。

    - 只接受 user / assistant 角色，system 由本服务统一注入，忽略历史里的 system；
    - 历史从旧到新保留，超过上限时保留最近的若干条；
    - 本轮问题始终排在最后；
    - V1.0.6.2「深度思考」开启时追加 `DEFAULT_STREAM_THINKING_PROMPT`（Prompt 级推理约束）。
    """

    text = (question or "").strip()
    if not text:
        raise LLMConfigError("问题不能为空")
    base_prompt = system_prompt or DEFAULT_STREAM_SYSTEM_PROMPT
    if enable_thinking:
        base_prompt = f"{base_prompt}{DEFAULT_STREAM_THINKING_PROMPT}"
    messages: list[dict[str, str]] = [{"role": "system", "content": base_prompt}]
    normalized: list[dict[str, str]] = []
    for item in history or ():
        if not isinstance(item, Mapping):
            continue
        role = item.get("role")
        content = item.get("content")
        if role not in {"user", "assistant"}:
            continue
        if not isinstance(content, str) or not content.strip():
            continue
        content_text = content.strip()
        if role == "assistant":
            # V1.0.6.2：历史里的循环回答先做重复治理再注入，避免模型模仿上一轮的重复结构。
            content_text, _removed = sanitize_model_answer(
                content_text, drop_restated_tail=True
            )
            content_text = content_text.strip()
            if not content_text:
                continue
        normalized.append({"role": role, "content": content_text[:_MAX_MESSAGE_CHARS]})
    # 留一条位置给本轮问题；历史取最近 N 条。
    messages.extend(normalized[-max(0, _MAX_DIRECT_MESSAGES - 2) :])
    messages.append({"role": "user", "content": text[:_MAX_MESSAGE_CHARS]})
    return messages


def _build_openai_client(settings: StreamSettings) -> Any:
    """构造 OpenAI SDK 客户端（禁用重定向 / 不走系统代理，避免本地流量被劫持）。"""

    try:
        from openai import OpenAI
    except ImportError as exc:  # pragma: no cover - 依赖缺失时给出明确修复提示
        raise LLMConfigError(
            "缺少 openai 依赖：请在 backend 目录执行 "
            ".\\.venv\\Scripts\\python -m pip install -r requirements.txt"
        ) from exc

    timeout = httpx.Timeout(
        settings.timeout_seconds,
        connect=min(10.0, settings.timeout_seconds),
        read=settings.timeout_seconds,
    )
    http_client = httpx.Client(
        timeout=timeout,
        trust_env=False,  # 本地 Ollama 不应经过企业 / 系统代理
        follow_redirects=False,  # P1-5：禁止把 Authorization 头带到非预期主机
    )
    return OpenAI(
        api_key=settings.api_key or "ollama",
        base_url=settings.base_url.rstrip("/"),
        timeout=timeout,
        max_retries=0,
        http_client=http_client,
    )


def _parse_usage(payload: Any) -> dict[str, int] | None:
    """把 SDK / 上游的 usage 对象转成 ``{prompt_tokens, ...}``；无有效字段返回 None。"""

    if payload is None:
        return None
    usage: dict[str, int] = {}
    for key in ("prompt_tokens", "completion_tokens", "total_tokens"):
        value = getattr(payload, key, None)
        if value is None and isinstance(payload, Mapping):
            value = payload.get(key)
        if isinstance(value, int) and value >= 0:
            usage[key] = value
    return usage or None


_REASONING_FIELDS: Final[tuple[str, ...]] = (
    "reasoning",
    "reasoning_content",
    "thinking",
)


def _delta_reasoning_text(delta: Any) -> str:
    """取 delta 里的思考字段（Ollama ``reasoning`` / DeepSeek ``reasoning_content`` 等）。"""

    parts: list[str] = []
    for name in _REASONING_FIELDS:
        value = getattr(delta, name, None)
        if isinstance(value, str) and value:
            parts.append(value)
    extra = getattr(delta, "model_extra", None)
    if isinstance(extra, Mapping):
        for name in _REASONING_FIELDS:
            value = extra.get(name)
            if isinstance(value, str) and value and value not in parts:
                parts.append(value)
    return "".join(parts)


_MAX_ERROR_EXCERPT: Final[int] = 200


def _safe_excerpt(text: str, *, secret: str) -> str:
    """截断错误文本并脱敏（避免上游回显 key）。"""

    compact = " ".join((text or "").split())
    if secret:
        compact = compact.replace(secret, "***")
    return compact[:_MAX_ERROR_EXCERPT]


def _map_sdk_error(exc: Exception, settings: StreamSettings) -> Exception:
    """把 OpenAI SDK / httpx 异常映射成项目内统一的 LLM* 异常。"""

    excerpt = _safe_excerpt(str(exc), secret=settings.api_key)
    try:
        import openai
    except ImportError:  # pragma: no cover - 理论上走不到（构造客户端时已校验）
        return LLMUpstreamError(
            f"模型调用失败：{type(exc).__name__}（{excerpt}）", retryable=True
        )

    if isinstance(exc, openai.APITimeoutError):
        return LLMTimeoutError(
            f"本地模型推理超时（>{settings.timeout_seconds:.0f}s），"
            "可调大 LLM_STREAM_TIMEOUT_SECONDS 后重试。"
        )
    if isinstance(exc, openai.APIConnectionError):
        return LLMUpstreamError(
            f"无法连接模型服务 {settings.base_url}（{excerpt}）。"
            "请确认 Ollama 已启动（终端执行 ollama serve）且 MODELSCOPE_BASE_URL 正确。",
            retryable=True,
        )
    if isinstance(exc, openai.APIStatusError):
        status = getattr(exc, "status_code", None)
        hint = ""
        if status == 404:
            hint = "（模型名可能不存在：请对照 ollama list 检查 MODELSCOPE_MODEL）"
        elif status in {401, 403}:
            hint = "（鉴权失败：本地 Ollama 的 api_key 可任意填写，请检查 BASE_URL 是否指向 /v1）"
        elif status == 429:
            hint = "（请求过多：本地并发受限，稍后重试）"
        retryable = status == 429 or (isinstance(status, int) and status >= 500)
        return LLMUpstreamError(
            f"上游返回 HTTP {status}：{excerpt}{hint}",
            upstream_status=status if isinstance(status, int) else None,
            retryable=retryable,
        )
    return LLMUpstreamError(
        f"模型调用失败：{type(exc).__name__}（{excerpt}）", retryable=True
    )


class StreamChatClient:
    """OpenAI SDK 流式客户端；``client`` 参数仅用于测试（注入假客户端）。"""

    def __init__(self, settings: StreamSettings, *, client: Any | None = None) -> None:
        self._settings = settings
        self._client = client if client is not None else _build_openai_client(settings)
        self._closed = False

    @classmethod
    def from_env(cls) -> StreamChatClient:
        return cls(load_stream_settings())

    @property
    def settings(self) -> StreamSettings:
        return self._settings

    def list_models(self) -> list[str]:
        """列出上游可用模型 id（连通性自检用；失败抛统一 LLM* 异常）。"""

        try:
            payload = self._client.models.list()
        except Exception as exc:
            raise _map_sdk_error(exc, self._settings) from exc
        models: list[str] = []
        for item in getattr(payload, "data", None) or ():
            model_id = getattr(item, "id", None)
            if isinstance(model_id, str) and model_id:
                models.append(model_id)
        return models

    def close(self) -> None:
        """释放底层 httpx 连接池（测试 / 脚本退出时调用，可选）。"""

        if self._closed:
            return
        self._closed = True
        http_client = getattr(self._client, "_client", None)
        close = getattr(http_client, "close", None)
        if callable(close):
            try:
                close()
            except Exception:  # pragma: no cover - 关闭失败不影响主流程
                logger.debug("关闭 OpenAI 客户端连接池失败", exc_info=True)

    def stream(
        self,
        messages: list[dict[str, str]],
        *,
        model: str | None = None,
        enable_thinking: bool = False,
    ) -> Iterator[StreamEvent]:
        """流式请求模型：逐段 yield ``delta``，最后 yield 一个 ``done``。

        ``enable_thinking``（V1.0.6.2「深度思考」开关）：
        - **默认 False**：沿用关闭思考的参数（本机 Ollama 发 ``reasoning_effort="none"``），
          最终答案直接进 ``content``，速度最快；
        - **True**：不再发送关闭思考的参数，并显式声明 ``enable_thinking=True``
          （OpenAI 兼容方言；Ollama / ModelScope 等对未知字段安全忽略），
          让上游先推理再输出最终答案；思考正文仍由本模块过滤，不会下发。

        异常语义与 `/api/agent/ask` 保持一致：超时 → `LLMTimeoutError`，
        连接失败 / 上游错误 → `LLMUpstreamError`，配置问题 → `LLMConfigError`。
        """

        settings = self._settings
        chosen_model = model or settings.model
        started = time.perf_counter()
        first_token_ms: int | None = None
        answer_parts: list[str] = []
        raw_answer = ""
        reasoning_chars = 0
        filtered = ThinkTagFilter()
        usage: dict[str, int] | None = None
        finish_reason: str | None = None
        started_output = False
        #: V1.0.6.2：是否检测到循环复述并提前停止生成。
        repetition_stopped = False

        kwargs: dict[str, Any] = {
            "model": chosen_model,
            "messages": messages,
            "stream": True,
            # V1.0.6.2：默认 0.3（旧 0.7 会让本地 8B 模型频繁重复循环）。
            "temperature": settings.temperature,
            "max_tokens": settings.max_tokens,
        }
        if enable_thinking:
            # 深度思考：撤销「关闭思考」参数，显式打开思考；思考正文由 ThinkTagFilter /
            # reasoning 字段丢弃，只把最终答案下发前端。
            kwargs["extra_body"] = {"enable_thinking": True}
            if settings.reasoning_effort not in (None, "none"):
                kwargs["reasoning_effort"] = settings.reasoning_effort
        elif settings.reasoning_effort is not None:
            # Ollama 的 OpenAI 兼容层把 reasoning_effort="none" 映射为关闭思考。
            kwargs["reasoning_effort"] = settings.reasoning_effort

        stream = None
        try:
            stream = self._client.chat.completions.create(**kwargs)
            for chunk in stream:
                chunk_usage = _parse_usage(getattr(chunk, "usage", None))
                if chunk_usage is not None:
                    usage = chunk_usage
                for choice in getattr(chunk, "choices", None) or ():
                    delta = getattr(choice, "delta", None)
                    if delta is None:
                        continue
                    reasoning_chars += len(_delta_reasoning_text(delta))
                    content = getattr(delta, "content", None)
                    if not isinstance(content, str) or not content:
                        continue
                    visible = filtered.feed(content)
                    if not started_output:
                        # 模型正文可能以换行 / 空格开头（尤其关闭思考后），先裁掉开头空白。
                        visible = visible.lstrip()
                    if not visible:
                        continue
                    started_output = True
                    if first_token_ms is None:
                        first_token_ms = int((time.perf_counter() - started) * 1000)
                    answer_parts.append(visible)
                    raw_answer += visible
                    yield StreamEvent(type="delta", text=visible)
                    finish_reason = (
                        getattr(choice, "finish_reason", None) or finish_reason
                    )
                    # V1.0.6.2（痛点 2）：生成期识别循环复述（整句复述 / 依据小节重开），
                    # 立即停止生成并把答案截断到第一次循环开始处，避免同一事实继续被复述。
                    repetition_cut = find_repetition_cut(raw_answer)
                    if repetition_cut is not None:
                        raw_answer = raw_answer[:repetition_cut].rstrip()
                        repetition_stopped = True
                        finish_reason = "repetition"
                        logger.info(
                            "流式生成检测到循环复述，已提前停止：保留 %d 字（截断 %d 字）",
                            len(raw_answer),
                            len("".join(answer_parts)) - len(raw_answer),
                        )
                        break
                if repetition_stopped:
                    break
        except GeneratorExit:
            # 前端断开：安静关闭上游流，不记错误。
            logger.info("流式直答被客户端中断（已接收 %d 字）", len(raw_answer))
            raise
        except Exception as exc:
            mapped = _map_sdk_error(exc, settings)
            logger.warning(
                "流式直答失败：model=%s err=%s",
                chosen_model,
                _safe_excerpt(str(mapped), secret=settings.api_key),
            )
            raise mapped from exc
        finally:
            close = getattr(stream, "close", None)
            if callable(close):
                try:
                    close()
                except Exception:  # pragma: no cover - 关闭失败不影响结果
                    logger.debug("关闭上游流失败", exc_info=True)

        if not repetition_stopped:
            tail = filtered.flush()
            if tail:
                if not started_output:
                    tail = tail.lstrip()
                if tail:
                    started_output = True
                    if first_token_ms is None:
                        first_token_ms = int((time.perf_counter() - started) * 1000)
                    answer_parts.append(tail)
                    raw_answer += tail
                    yield StreamEvent(type="delta", text=tail)

        # V1.0.6.2（痛点 2）：最终答案再做一次确定性重复治理（重复行 / 重复句只留一次）。
        sanitized, deduped_chars = sanitize_model_answer(
            raw_answer, drop_restated_tail=True
        )
        answer = sanitized.strip()
        latency_ms = int((time.perf_counter() - started) * 1000)
        if not answer:
            if reasoning_chars:
                raise LLMUpstreamError(
                    "模型只输出了思考内容（reasoning），没有最终答案。"
                    "请把 LLM_REASONING_EFFORT 设为 none 后重试。",
                    retryable=False,
                )
            raise LLMUpstreamError("模型没有返回任何内容（空回答）", retryable=False)

        logger.info(
            "流式直答完成：model=%s latency=%dms first_token=%sms answer_chars=%d "
            "reasoning_chars=%d filtered_chars=%d deduped_chars=%d repetition=%s finish=%s",
            chosen_model,
            latency_ms,
            first_token_ms if first_token_ms is not None else -1,
            len(answer),
            reasoning_chars,
            filtered.filtered_chars,
            deduped_chars,
            repetition_stopped,
            finish_reason,
        )
        yield StreamEvent(
            type="done",
            answer=answer,
            model=chosen_model,
            latency_ms=latency_ms,
            first_token_ms=first_token_ms,
            usage=usage,
            reasoning_chars=reasoning_chars,
            filtered_chars=filtered.filtered_chars,
            finish_reason=finish_reason,
            deduped_chars=deduped_chars,
            repetition_stopped=repetition_stopped,
        )


def sse_event(payload: Mapping[str, Any]) -> str:
    """把事件 dict 编码成 SSE 帧（``data: {...}\\n\\n``）。

    只使用 data 行、不依赖 event 名，前端解析最简单；``ensure_ascii=False``
    保证中文按 UTF-8 原样下发。
    """

    import json

    return (
        "data: "
        + json.dumps(dict(payload), ensure_ascii=False, separators=(",", ":"))
        + "\n\n"
    )
