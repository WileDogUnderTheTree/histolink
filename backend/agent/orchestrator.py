"""Agent Orchestrator（V1.0.3 核心循环 / V1.0.5 RAG 混合路由）。

流程（**硬上限 6 个工具轮 + 至多 1 次只收尾调用**，防死循环）：
1. 组装 System Prompt（工具目录由 ToolRegistry 生成 + RAG 向量库状态）+ 历史 + 当前问题/页面上下文；
2. 调 Qwen（`enable_thinking=False` + JSON 模式），拿到一个**完整且唯一**的 JSON 对象；
3. 解析为 `tool_call`：白名单 + 严格参数校验 → 执行工具 → 把统一信封回传模型；
   V1.0.5.1 增加受限的 `tool_batch`：同一轮最多并行执行 2–4 个**彼此独立的只读工具**，
   用于对比任务「双方图谱 / 双方 RAG」并行检索；总工具调用数仍有独立硬上限；
   - V1.0.5：图谱工具（search_events / get_event / get_person…）先给「基础事实」，
     模型再调 `search_historical_text`（query = 用户问题 + 图谱实体/年份）取「史料细节」；
4. 解析为 `final`：交给 `EvidenceValidator` 核对 evidence / citation / UI 动作，
   并由服务端用工具真实数据重写 grounded 正文（V1.0.5 按 ① 图谱事实 / ② RAG 史料分节，
   RAG 与图谱年份冲突时标注「史料记载有异」，传说 chunk 句首加 `[传说]`）；
5. 证据不可核验 → 强制降级 `insufficient`；轮次预算耗尽时额外做**一次**「只收尾」调用
   （不允许执行工具），收尾仍失败 / JSON 始终非法 → 兜底 `insufficient`。

LLM 429/502/504/超时由 `LLMClient.chat()` 内部先自动降级到备用轻量模型重试一次；
两次都失败才上抛，由 API 层映射成 502/503/504 envelope（`trace.model_used` 记录最终模型）。
"""

from __future__ import annotations

import json
import re
import time
from collections.abc import Mapping
from concurrent.futures import ThreadPoolExecutor
from typing import Any

from pydantic import ValidationError

from agent.prompts import (
    build_finalize_message,
    build_repair_message,
    build_system_prompt,
    build_tool_result_message,
    build_user_message,
)
from agent.schemas import (
    AgentResult,
    FinalAnswer,
    FinalStep,
    ToolCallRecord,
    ToolBatchStep,
    ToolCallStep,
)
from agent.tool_registry import ToolRegistry
from agent.tools import Toolkit
from agent.validator import EvidenceValidator, ObservedEvidence
from contracts.action_types import V1_AVAILABLE_ACTIONS
from contracts.models import AskRequest
from llm_client import LLMChatResult, LLMClient
from snapshot_store import SnapshotStore

#: 最大模型轮次：对比任务需要「双方图谱 → 双方 RAG → 回答」，
#: 从原来的 4 轮放宽到 6 轮；仍是硬上限，外部不允许配置更高。
MAX_ITERATIONS = 6
DEFAULT_MAX_STEPS = MAX_ITERATIONS
MAX_STEPS_HARD_LIMIT = MAX_ITERATIONS
#: 工具调用总数仍有独立硬上限；批量调用只用于彼此独立的只读查询。
MAX_TOOL_CALLS = 10
#: 轮次预算耗尽后，额外允许**一次**「只收尾」的模型调用（V1.0.5.1）：
#: 该调用不允许执行任何工具，只把已获得的工具结果整理成 final，避免
#: 「最后一步正好用完轮次、来不及 final」被误判为 insufficient。
#: 证据校验仍由 EvidenceValidator 按原规则执行，不降低 grounded 门槛。
MAX_FINALIZE_ROUNDS = 1
#: 收尾轮可以因「模型 JSON 格式错误」重试的次数（每次仍不允许调用工具）。
MAX_FINALIZE_RETRIES = 1
#: 规划 / 回答都用 temperature=0，追求稳定与可复现。
AGENT_TEMPERATURE = 0.0
#: 可见输出上限（关闭思考后 2048 足够中文 150–400 字回答 + JSON 结构）。
AGENT_MAX_TOKENS = 2048

_JSON_FENCE_RE = re.compile(r"^```(?:json)?\s*(.*?)\s*```$", re.DOTALL | re.IGNORECASE)

_FALLBACK_MARKDOWN = (
    "资料不足：本次查询没有形成可核验的最终回答（模型输出不符合协议或超过最大工具轮次）。"
    "你可以换一种问法，或指定具体人物 / 时期后再试。"
)


class AgentProtocolError(ValueError):
    """模型输出不是合法的 JSON / 不符合两态协议。"""


def parse_model_step(content: str) -> ToolCallStep | ToolBatchStep | FinalStep:
    """把模型文本解析成单工具、批量工具或最终回答；失败抛 `AgentProtocolError`。"""

    data = _extract_json_object(content)
    action = data.get("action")
    try:
        if action == "tool_call":
            return ToolCallStep.model_validate(data)
        if action == "tool_batch":
            return ToolBatchStep.model_validate(data)
        if action == "final":
            return FinalStep.model_validate(data)
    except ValidationError as exc:
        raise AgentProtocolError(_format_validation_error(exc)) from exc
    raise AgentProtocolError("缺少 action 字段（必须是 tool_call、tool_batch 或 final）")


def _extract_json_object(content: str) -> dict[str, Any]:
    """解析模型输出：**整个响应必须恰好是一个 JSON 对象**（P1-4）。

    - 容忍整体被 ```json ... ``` 包裹（设计文档既有约定）；
    - 不再用「首个 `{` 到最后一个 `}`」截取，避免接受「解释文字 + JSON + 额外文字」；
    - JSON 前后有任何其它文字都视为协议错误，交给修复轮重试。
    """

    text = (content or "").strip()
    if not text:
        raise AgentProtocolError("模型返回空内容")
    fence = _JSON_FENCE_RE.match(text)
    if fence:
        text = fence.group(1).strip()
    if not text.startswith("{") or not text.endswith("}"):
        raise AgentProtocolError(
            "模型返回必须是完整且唯一的 JSON 对象（JSON 前后不得有任何文字或代码块标记）"
        )
    try:
        payload = json.loads(text)
    except json.JSONDecodeError as exc:
        raise AgentProtocolError(f"JSON 解析失败：{exc.msg}") from exc
    if not isinstance(payload, dict):
        raise AgentProtocolError("模型返回的 JSON 顶层必须是对象")
    return payload


def _format_validation_error(error: ValidationError) -> str:
    parts = []
    for item in error.errors():
        location = ".".join(str(part) for part in item.get("loc") or ()) or "root"
        parts.append(f"{location}: {item.get('msg', '不符合协议')}")
    return "；".join(parts)[:500]


def _merge_usage(total: dict[str, int] | None, usage: Mapping[str, int] | None) -> dict[str, int] | None:
    if not usage:
        return total
    merged = dict(total or {})
    for key, value in usage.items():
        if isinstance(value, int) and value >= 0:
            merged[key] = merged.get(key, 0) + value
    return merged or None


class AgentOrchestrator:
    """规划器 + 执行器；不依赖 FastAPI，可直接单测。"""

    def __init__(
        self,
        store: SnapshotStore,
        llm_client: LLMClient,
        *,
        max_steps: int = DEFAULT_MAX_STEPS,
        registry: ToolRegistry | None = None,
        validator: EvidenceValidator | None = None,
    ) -> None:
        if max_steps < 1 or max_steps > MAX_STEPS_HARD_LIMIT:
            raise ValueError(
                f"max_steps 必须在 1..{MAX_STEPS_HARD_LIMIT} 之间"
                f"（设计规定问答链路最多 {MAX_STEPS_HARD_LIMIT} 轮，硬上限不允许放开）"
            )
        self._store = store
        self._llm = llm_client
        self._max_steps = max_steps
        self._registry = registry or ToolRegistry(Toolkit(store))
        self._validator = validator or EvidenceValidator()

    @property
    def max_steps(self) -> int:
        return self._max_steps

    @property
    def registry(self) -> ToolRegistry:
        return self._registry

    def run(self, request: AskRequest) -> AgentResult:
        started = time.perf_counter()
        messages = self._initial_messages(request)
        observed = ObservedEvidence()
        records: list[ToolCallRecord] = []
        usage: dict[str, int] | None = None
        model_name: str | None = None
        #: V1.0.5 高可用补丁：最终完成回答的模型（主模型被限流时由备用模型接管）。
        model_used: str | None = None
        last_error: str | None = None

        for step in range(1, self._max_steps + 1):
            chat = self._chat(messages)
            usage = _merge_usage(usage, chat.usage)
            model_name = chat.model or model_name
            model_used = chat.model_used or chat.model or model_used
            messages.append({"role": "assistant", "content": chat.content})

            try:
                parsed = parse_model_step(chat.content)
            except AgentProtocolError as exc:
                last_error = str(exc)
                if step == self._max_steps:
                    break
                messages.append({"role": "user", "content": build_repair_message(last_error)})
                continue

            if isinstance(parsed, (ToolCallStep, ToolBatchStep)):
                tool_started = time.perf_counter()
                if isinstance(parsed, ToolCallStep):
                    calls = [(parsed.tool, parsed.arguments)]
                else:
                    calls = [(call.tool, call.arguments) for call in parsed.calls]
                if len(records) + len(calls) > MAX_TOOL_CALLS:
                    last_error = f"工具调用总数超过安全上限（{MAX_TOOL_CALLS}）"
                    if step == self._max_steps:
                        break
                    messages.append({"role": "user", "content": build_repair_message(last_error)})
                    continue

                tool_results = self._execute_tool_calls(calls)
                tool_ms = int((time.perf_counter() - tool_started) * 1000)
                result_messages: list[tuple[str, dict[str, Any], dict[str, Any]]] = []
                for (tool_name, arguments), tool_result in zip(calls, tool_results, strict=True):
                    observed.absorb(tool_result)
                    records.append(_record_from_result(tool_name, arguments, tool_result, tool_ms))
                    result_messages.append((tool_name, arguments, tool_result))
                messages.append(
                    {
                        "role": "user",
                        "content": build_tool_result_message(result_messages),
                    }
                )
                continue

            outcome = self._validator.validate(parsed.answer, observed)
            if outcome.downgraded and outcome.reason and step < self._max_steps:
                # 证据校验修复轮（V1.0.5.1）：只重写 final，不执行新工具；
                # 仍要求重新提交的 final 通过原校验，因此不降低任何证据门槛。
                last_error = outcome.reason
                messages.append(
                    {
                        "role": "user",
                        "content": build_repair_message(
                            f"你的 final 未通过证据校验：{outcome.reason}。"
                            "请重新输出合法 final：claims 里的每个 citation 必须对应 evidence 中"
                            "同一实体（RAG 必须是同一个 chunk_id），不要引用没有 evidence 的 citation；"
                            "拿不准时把 claims 减少到只引用最核心的 1 条。"
                        ),
                    }
                )
                continue

            return AgentResult(
                question=request.question,
                answer=outcome.answer,
                citations=outcome.citations,
                tools=records,
                model=model_name,
                model_used=model_used,
                latency_ms=_elapsed_ms(started),
                steps=step,
                downgraded=outcome.downgraded,
                downgrade_reason=outcome.reason,
                usage=usage,
            )

        return self._finalize(
            request=request,
            messages=messages,
            observed=observed,
            records=records,
            model_name=model_name,
            model_used=model_used,
            usage=usage,
            started=started,
            last_error=last_error,
        )

    # ------------------------------------------------------------------
    # 内部
    # ------------------------------------------------------------------
    def _chat(self, messages: list[dict[str, str]]) -> LLMChatResult:
        return self._llm.chat(
            messages,
            temperature=AGENT_TEMPERATURE,
            max_tokens=AGENT_MAX_TOKENS,
            response_format={"type": "json_object"},
            enable_thinking=False,
        )

    def _finalize(
        self,
        *,
        request: AskRequest,
        messages: list[dict[str, str]],
        observed: ObservedEvidence,
        records: list[ToolCallRecord],
        model_name: str | None,
        model_used: str | None,
        usage: dict[str, int] | None,
        started: float,
        last_error: str | None,
    ) -> AgentResult:
        """轮次预算耗尽后的「只收尾」调用（V1.0.5.1）。

        - 最多 ``MAX_FINALIZE_ROUNDS + MAX_FINALIZE_RETRIES`` 次，且**不执行任何工具**，
          不会形成新的循环（收尾轮返回 tool_call / tool_batch 会直接终止）；
        - JSON 协议错误允许按 ``MAX_FINALIZE_RETRIES`` 再要求模型重发一次合法 final；
        - 成功解析 final 后仍交给 ``EvidenceValidator`` 原规则校验（不降低证据要求）。
        """

        max_attempts = MAX_FINALIZE_ROUNDS + MAX_FINALIZE_RETRIES
        if max_attempts < 1:  # pragma: no cover - 常量保护
            return self._fallback(
                request=request,
                records=records,
                model_name=model_name,
                model_used=model_used,
                usage=usage,
                started=started,
                reason=last_error
                or f"超过最大工具调用轮次（{self._max_steps}），模型未给出最终回答",
            )

        rounds = self._max_steps
        finalize_messages: list[dict[str, str]] = [
            *messages,
            {"role": "user", "content": build_finalize_message(self._max_steps)},
        ]
        failure_reason = last_error or "模型未给出最终回答"

        for _attempt in range(max_attempts):
            rounds += 1
            chat = self._chat(finalize_messages)
            usage = _merge_usage(usage, chat.usage)
            model_name = chat.model or model_name
            model_used = chat.model_used or chat.model or model_used

            try:
                parsed = parse_model_step(chat.content)
            except AgentProtocolError as exc:
                failure_reason = f"收尾轮仍未输出合法 final：{exc}"[:300]
                if _attempt + 1 >= max_attempts:
                    break
                finalize_messages = [
                    *finalize_messages,
                    {"role": "assistant", "content": chat.content},
                    {
                        "role": "user",
                        "content": build_repair_message(
                            f"{failure_reason}。注意：claims 最多 3 条，每条必须是 "
                            '{"id":"c1","citation_ids":["<工具结果里的 citation id>"]} 对象；'
                            "不要输出解释文字或 markdown。"
                        ),
                    },
                ]
                continue

            if not isinstance(parsed, FinalStep):
                action = getattr(parsed, "action", "unknown")
                failure_reason = f"收尾轮仍尝试调用工具（{action}），已终止，避免无限循环"
                break

            outcome = self._validator.validate(parsed.answer, observed)
            return AgentResult(
                question=request.question,
                answer=outcome.answer,
                citations=outcome.citations,
                tools=records,
                model=model_name,
                model_used=model_used,
                latency_ms=_elapsed_ms(started),
                steps=rounds,
                downgraded=outcome.downgraded,
                downgrade_reason=outcome.reason,
                usage=usage,
            )

        return self._fallback(
            request=request,
            records=records,
            model_name=model_name,
            model_used=model_used,
            usage=usage,
            started=started,
            steps=rounds,
            reason=failure_reason,
        )

    def _execute_tool_calls(
        self, calls: list[tuple[str, dict[str, Any]]]
    ) -> list[dict[str, Any]]:
        """并行执行同一批只读工具，并按模型给出的顺序返回结果。"""
        if len(calls) == 1:
            tool, arguments = calls[0]
            return [self._registry.execute(tool, arguments)]
        with ThreadPoolExecutor(max_workers=len(calls), thread_name_prefix="agent-tool") as pool:
            futures = [pool.submit(self._registry.execute, tool, arguments) for tool, arguments in calls]
            return [future.result() for future in futures]

    def _initial_messages(self, request: AskRequest) -> list[dict[str, str]]:
        from rag.store import rag_status_text

        system_prompt = build_system_prompt(
            self._registry.tool_catalog_json(),
            [action.value for action in V1_AVAILABLE_ACTIONS],
            rag_status=rag_status_text(),
        )
        messages: list[dict[str, str]] = [{"role": "system", "content": system_prompt}]
        for turn in request.history:
            messages.append({"role": turn.role, "content": turn.content})
        messages.append({"role": "user", "content": build_user_message(request)})
        return messages

    def _fallback(
        self,
        *,
        request: AskRequest,
        records: list[ToolCallRecord],
        model_name: str | None,
        model_used: str | None,
        usage: dict[str, int] | None,
        started: float,
        reason: str,
        steps: int | None = None,
    ) -> AgentResult:
        answer = FinalAnswer(
            mode="insufficient",
            markdown=_FALLBACK_MARKDOWN,
            certainty="low",
            claims=[],
            evidence=[],
            related_event_ids=[],
            missing=[reason[:300]],
            reason_code=None,
            ui_actions=[],
        )
        return AgentResult(
            question=request.question,
            answer=answer,
            citations=[],
            tools=records,
            model=model_name,
            model_used=model_used,
            latency_ms=_elapsed_ms(started),
            steps=self._max_steps if steps is None else steps,
            downgraded=True,
            downgrade_reason=reason,
            usage=usage,
        )


def _record_from_result(
    tool_name: str, arguments: dict[str, Any], result: dict[str, Any], elapsed_ms: int
) -> ToolCallRecord:
    ok = bool(result.get("ok"))
    hits: int | None = None
    meta = result.get("meta") or {}
    if isinstance(meta, dict) and isinstance(meta.get("returned"), int):
        hits = meta["returned"]
    elif isinstance(result.get("items"), list):
        hits = len(result["items"])
    error = result.get("error") or {}
    error_code = error.get("code") if isinstance(error, dict) else None
    return ToolCallRecord(
        name=tool_name[:100],
        arguments=arguments,
        ok=ok,
        hits=hits,
        ms=elapsed_ms,
        error_code=error_code[:64] if isinstance(error_code, str) else None,
    )


def _elapsed_ms(started: float) -> int:
    return int((time.perf_counter() - started) * 1000)


__all__ = [
    "AGENT_MAX_TOKENS",
    "AGENT_TEMPERATURE",
    "DEFAULT_MAX_STEPS",
    "MAX_FINALIZE_RETRIES",
    "MAX_FINALIZE_ROUNDS",
    "MAX_ITERATIONS",
    "MAX_STEPS_HARD_LIMIT",
    "MAX_TOOL_CALLS",
    "AgentOrchestrator",
    "AgentProtocolError",
    "parse_model_step",
]
