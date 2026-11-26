"""Agent Orchestrator（V1.0.3 核心循环 / V1.0.5 RAG 混合路由 / V1.0.5.2 双数据源 + 模型选择 /
V1.0.6 多轮记忆 / V1.0.6.1 markdown 生成权解绑 + 双重事实核查）。

流程（**硬上限 6 个工具轮 + 至多 1 次只收尾调用**，防死循环）：
1. 组装 System Prompt（工具目录由 ToolRegistry 生成 + RAG 向量库状态 + Few-Shot 优秀回答示例）
   + 历史 + 当前问题/页面上下文；
2. 调 Qwen（`enable_thinking=False` + JSON 模式），拿到一个**完整且唯一**的 JSON 对象；
3. 解析为 `tool_call` / `tool_batch`：白名单 + 严格参数校验 → 执行工具 → 把统一信封回传模型；
4. 解析为 `final`：
   - **第一重 · 证据级核查**（`EvidenceValidator`）：evidence / citation 真实、绑定、双源覆盖；
   - **第二重 · 文本级核查**（V1.0.6.1 `agent.factcheck`）：模型 `answer.markdown` 中的
     年份 / 人物 / 书名 / 引文必须能在本轮工具结果中核验，且必须包含「史料实证 + 史令分析」两节；
   - 通过 → 采用模型正文作为 `FinalAnswer.markdown`（用户可见正文的生成权归模型）；
   - 不通过 → 把问题清单发回模型只重写正文（最多 `MAX_FACT_CHECK_REPAIRS` 次）；
   - 仍不通过 / 模型没写 markdown → 回退服务端用工具原文拼装的「事实实证」正文（安全兜底，
     未核验文本永不展示）；
5. 证据不可核验 / 双源覆盖不足 → 强制降级 `insufficient`；轮次预算耗尽时额外做**一次**「只收尾」
   调用（不允许执行工具），收尾仍失败 / JSON 始终非法 → 兜底 `insufficient`；
6. V1.0.6.1 已废除 V1.0.5.4 的「二次归纳」独立调用：💡 史令分析已并入模型 `markdown` 的
   「史令分析」节，不再额外调用模型、也不再产出 `comparison_analysis`。

LLM 429/502/504/超时由 `LLMClient.chat()` 内部先自动降级到另一款模型重试一次；
两次都失败才上抛，由 API 层映射成 502/503/504 envelope（`trace.model_used` 记录最终模型）。
"""

from __future__ import annotations

import json
import logging
import re
import time
from collections.abc import Mapping
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass
from typing import Any

from pydantic import ValidationError

from agent.comparison import (
    collect_rescue_entities,
    find_comparison_subjects,
)
from agent.factcheck import (
    build_fact_check_facts,
    check_markdown,
    clean_markdown,
    server_fallback_trace,
)
from agent.intent import infer_actions_for_question, infer_actions_from_evidence
from agent.prompts import (
    build_fact_check_repair_message,
    build_finalize_message,
    build_repair_message,
    build_system_prompt,
    build_tool_result_message,
    build_user_message,
)
from agent.schemas import (
    AgentResult,
    Evidence,
    FinalAnswer,
    FinalStep,
    ModelAnswer,
    ToolBatchStep,
    ToolCallRecord,
    ToolCallStep,
    UIAction,
)
from agent.session_memory import SessionContext, build_session_memory_block
from agent.tool_registry import ToolRegistry
from agent.tools import Toolkit
from agent.validator import (
    SOURCE_GRAPH,
    SOURCE_TIMELINE,
    EvidenceValidator,
    ObservedEntity,
    ObservedEvidence,
    ValidationOutcome,
    detect_comparison_intent,
    source_coverage,
)
from contracts.action_types import V1_AVAILABLE_ACTIONS
from contracts.models import AskRequest
from llm_client import LLMChatResult, LLMClient
from snapshot_store import SnapshotStore
from text_hygiene import sanitize_model_answer

logger = logging.getLogger("histolink.agent")

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
#: V1.0.6.1：文本级事实核查不通过时，允许把问题清单发回模型重写正文的次数（每次消耗 1 个轮次）。
#: 连续不通过后回退服务端事实实证正文，避免无限重写 / 幻觉文本上屏。
MAX_FACT_CHECK_REPAIRS = 2
#: 规划 / 回答都用 temperature=0，追求稳定与可复现。
AGENT_TEMPERATURE = 0.0
#: 可见输出上限（关闭思考后 4096 足够：中文 300–1200 字两节正文 + thought + JSON 结构）。
#: V1.0.6.1 从 2048 提升到 4096：模型现在要写完整「史料实证 + 史令分析」，2048 容易截断。
AGENT_MAX_TOKENS = 4096
#: 单条消息进入 LLM 前的安全字符上限（V1.0.5.4 修复）：
#: 必须小于 `llm_client.MAX_CHAT_MESSAGE_CHARS = 20000`，否则消息组装偶发超限会抛
#: LLMConfigError，被 API 层映射成 503（用户侧表现为冷启动 / 对比问答异常报错）。
MAX_PROMPT_MESSAGE_CHARS = 19000
#: 安全截断后缀：超长消息截断后仍告知模型「内容被截断」，而不是静默丢数据。
_PROMPT_TRUNCATED_SUFFIX = "\n…（消息过长，已截断）"

_JSON_FENCE_RE = re.compile(r"^```(?:json)?\s*(.*?)\s*```$", re.DOTALL | re.IGNORECASE)

_FALLBACK_MARKDOWN = (
    "资料不足：本次查询没有形成可核验的最终回答（模型输出不符合协议或超过最大工具轮次）。"
    "你可以换一种问法，或指定具体人物 / 时期后再试。"
)


class AgentProtocolError(ValueError):
    """模型输出不是合法的 JSON / 不符合两态协议。"""


@dataclass(frozen=True)
class _MarkdownDecision:
    """V1.0.6.1 文本级事实核查的决策结果。

    - ``answer`` 非空：可以直接采用（模型正文通过核查 / 回退服务端事实实证正文）；
    - ``answer`` 为空：核查不通过且还有重写机会，调用方应把问题清单发回模型；
    - ``trace``：写进 `AgentResult.fact_check`（映射到 API `trace.fact_check`）。
    """

    answer: FinalAnswer | None
    trace: dict[str, Any]
    downgraded: bool = False
    downgrade_reason: str | None = None


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
    raise AgentProtocolError(
        "缺少 action 字段（必须是 tool_call、tool_batch 或 final）"
    )


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


def _merge_usage(
    total: dict[str, int] | None, usage: Mapping[str, int] | None
) -> dict[str, int] | None:
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

    def run(
        self,
        request: AskRequest,
        *,
        session_context: SessionContext | None = None,
    ) -> AgentResult:
        """执行一次问答。

        ``session_context``（V1.0.6）由 API 路由从 `SessionStore` 读取：
        - 非空时用它的 `history` 作为多轮历史（服务端权威），并把实体记忆 / 代词解析
          注入本轮 user message；
        - 为空时退回 `request.history`（保持 V1.0.5.4 及更早的直接调用方式与测试语义）。
        """

        started = time.perf_counter()
        messages = self._initial_messages(request, session_context)
        observed = ObservedEvidence()
        records: list[ToolCallRecord] = []
        usage: dict[str, int] | None = None
        model_name: str | None = None
        #: V1.0.5 高可用补丁：最终完成回答的模型（主模型被限流时由备用模型接管）。
        model_used: str | None = None
        last_error: str | None = None
        #: V1.0.6.1：本轮已消耗的「文本级事实核查重写」次数（硬上限 `MAX_FACT_CHECK_REPAIRS`）。
        fact_check_repairs = 0

        for step in range(1, self._max_steps + 1):
            chat = self._chat(messages, request.model_id)
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
                messages.append(
                    {"role": "user", "content": build_repair_message(last_error)}
                )
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
                    messages.append(
                        {"role": "user", "content": build_repair_message(last_error)}
                    )
                    continue

                tool_results = self._execute_tool_calls(calls)
                tool_ms = int((time.perf_counter() - tool_started) * 1000)
                result_messages: list[tuple[str, dict[str, Any], dict[str, Any]]] = []
                for (tool_name, arguments), tool_result in zip(
                    calls, tool_results, strict=True
                ):
                    observed.absorb(tool_result)
                    records.append(
                        _record_from_result(tool_name, arguments, tool_result, tool_ms)
                    )
                    result_messages.append((tool_name, arguments, tool_result))
                messages.append(
                    {
                        "role": "user",
                        "content": build_tool_result_message(result_messages),
                    }
                )
                continue

            outcome = self._validator.validate(
                parsed.answer, observed, question=request.question
            )
            # V1.0.5.4 修复二：对比类问题在返回 insufficient / 降级之前，先做「图谱兜底」——
            # 只要本轮图谱返回了 A / B 的实体数据，就由服务端用真实事实重新合成 grounded 正文，
            # 绝不允许在 A/B 实体已查到时直接判定资料不足。
            if outcome.answer.mode == "insufficient":
                rescued = self._try_comparison_rescue(
                    request=request,
                    observed=observed,
                    records=records,
                    usage=usage,
                    model_name=model_name,
                    model_used=model_used,
                    started=started,
                    steps=step,
                )
                if rescued is not None:
                    return rescued

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

            # ---- V1.0.6.1 第二重核查：文本级事实核查（markdown） ----
            if outcome.answer.mode == "grounded":
                decision = self._decide_markdown(
                    parsed.answer,
                    outcome,
                    observed,
                    repair_available=(
                        fact_check_repairs < MAX_FACT_CHECK_REPAIRS
                        and step < self._max_steps
                    ),
                )
                if decision.answer is None:
                    # 还有重写机会：把问题清单发回模型，只重写正文（允许先补工具调用）。
                    fact_check_repairs += 1
                    last_error = "markdown 未通过文本级事实核查"
                    messages.append(
                        {
                            "role": "user",
                            "content": build_fact_check_repair_message(
                                decision.trace.get("issues") or [],
                                attempt=fact_check_repairs,
                            ),
                        }
                    )
                    continue
                return AgentResult(
                    question=request.question,
                    answer=decision.answer.model_copy(
                        update={
                            "ui_actions": self._pair_ui_actions(
                                request.question, list(decision.answer.ui_actions)
                            )
                        }
                    ),
                    citations=outcome.citations,
                    tools=records,
                    model=model_name,
                    model_used=model_used,
                    model_requested=request.model_id,
                    source_coverage=outcome.source_coverage,
                    latency_ms=_elapsed_ms(started),
                    steps=step,
                    downgraded=outcome.downgraded or decision.downgraded,
                    downgrade_reason=decision.downgrade_reason or outcome.reason,
                    usage=usage,
                    fact_check=decision.trace,
                    entity_memory=_extract_entity_memory(self._store, observed),
                )

            return AgentResult(
                question=request.question,
                answer=outcome.answer,
                citations=outcome.citations,
                tools=records,
                model=model_name,
                model_used=model_used,
                model_requested=request.model_id,
                source_coverage=outcome.source_coverage,
                latency_ms=_elapsed_ms(started),
                steps=step,
                downgraded=outcome.downgraded,
                downgrade_reason=outcome.reason,
                usage=usage,
                fact_check={"status": "skipped", "issues": [], "warnings": []},
                entity_memory=_extract_entity_memory(self._store, observed),
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
    def _chat(
        self, messages: list[dict[str, str]], model_id: str | None = None
    ) -> LLMChatResult:
        return self._llm.chat(
            _shrink_messages(messages),
            temperature=AGENT_TEMPERATURE,
            max_tokens=AGENT_MAX_TOKENS,
            response_format={"type": "json_object"},
            enable_thinking=False,
            model_id=model_id,
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
                observed=observed,
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
            chat = self._chat(finalize_messages, request.model_id)
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
                failure_reason = (
                    f"收尾轮仍尝试调用工具（{action}），已终止，避免无限循环"
                )
                break

            outcome = self._validator.validate(
                parsed.answer, observed, question=request.question
            )
            # V1.0.5.4 修复二：收尾轮同样先尝试对比兜底，再决定是否返回 insufficient。
            if outcome.answer.mode == "insufficient":
                rescued = self._try_comparison_rescue(
                    request=request,
                    observed=observed,
                    records=records,
                    usage=usage,
                    model_name=model_name,
                    model_used=model_used,
                    started=started,
                    steps=rounds,
                )
                if rescued is not None:
                    return rescued

            # ---- V1.0.6.1 文本级事实核查（收尾轮同样必须过第二重核查） ----
            if outcome.answer.mode == "grounded":
                decision = self._decide_markdown(
                    parsed.answer,
                    outcome,
                    observed,
                    repair_available=_attempt + 1 < max_attempts,
                )
                if decision.answer is None:
                    failure_reason = "收尾轮 markdown 未通过文本级事实核查"
                    finalize_messages = [
                        *finalize_messages,
                        {"role": "assistant", "content": chat.content},
                        {
                            "role": "user",
                            "content": build_fact_check_repair_message(
                                decision.trace.get("issues") or [], attempt=2
                            ),
                        },
                    ]
                    continue
                return AgentResult(
                    question=request.question,
                    answer=decision.answer.model_copy(
                        update={
                            "ui_actions": self._pair_ui_actions(
                                request.question, list(decision.answer.ui_actions)
                            )
                        }
                    ),
                    citations=outcome.citations,
                    tools=records,
                    model=model_name,
                    model_used=model_used,
                    model_requested=request.model_id,
                    source_coverage=outcome.source_coverage,
                    latency_ms=_elapsed_ms(started),
                    steps=rounds,
                    downgraded=outcome.downgraded or decision.downgraded,
                    downgrade_reason=decision.downgrade_reason or outcome.reason,
                    usage=usage,
                    fact_check=decision.trace,
                    entity_memory=_extract_entity_memory(self._store, observed),
                )

            return AgentResult(
                question=request.question,
                answer=outcome.answer,
                citations=outcome.citations,
                tools=records,
                model=model_name,
                model_used=model_used,
                model_requested=request.model_id,
                source_coverage=outcome.source_coverage,
                latency_ms=_elapsed_ms(started),
                steps=rounds,
                downgraded=outcome.downgraded,
                downgrade_reason=outcome.reason,
                usage=usage,
                fact_check={"status": "skipped", "issues": [], "warnings": []},
                entity_memory=_extract_entity_memory(self._store, observed),
            )

        # V1.0.5.4 修复二：即使收尾轮始终没有给出合法 final，对比类问题只要图谱已返回
        # A/B 实体，也不允许直接兜底判 insufficient；用真实事实做最后一次二次归纳尝试。
        rescued = self._try_comparison_rescue(
            request=request,
            observed=observed,
            records=records,
            usage=usage,
            model_name=model_name,
            model_used=model_used,
            started=started,
            steps=rounds,
        )
        if rescued is not None:
            return rescued
        return self._fallback(
            request=request,
            records=records,
            observed=observed,
            model_name=model_name,
            model_used=model_used,
            usage=usage,
            started=started,
            steps=rounds,
            reason=failure_reason,
        )

    # ------------------------------------------------------------------
    # V1.0.6.1 文本级事实核查（markdown）
    # ------------------------------------------------------------------
    def _decide_markdown(
        self,
        model_answer: ModelAnswer,
        outcome: ValidationOutcome,
        observed: ObservedEvidence,
        *,
        repair_available: bool,
    ) -> _MarkdownDecision:
        """对模型 `markdown` 做文本级事实核查，并决定「采用 / 重写 / 回退服务端正文」。

        三种出口：

        1. **通过**：沿用 `EvidenceValidator` 已核验的 claims / citations / certainty，
           只把正文替换为清洗后的模型正文（`fact_check.status = "passed"`）；
        2. **不通过且还有重写机会**：返回 `answer=None`，调用方把问题清单发回模型；
        3. **不通过且无重写机会 / 模型没写正文**：回退服务端用工具原文拼装的事实实证正文
           （`status = "fallback"` / `"server_fallback"`），并标记 `downgraded=True`，
           保证未核验文本永不展示给用户。

        模型正文在核查前一律先过 `clean_markdown`（去控制字符 / 剥代码围栏 /
        还原字面量换行 / 中和越狱标记）——核查与展示使用同一份清洗后文本。
        """

        model_markdown = clean_markdown(model_answer.markdown)
        if not model_markdown:
            # 旧协议 / 离线脚本 / 模型漏字段：服务端事实实证正文（V1.0.6 既有行为，安全兜底）。
            logger.info(
                "模型未提供 markdown，回退服务端事实实证正文（V1.0.6.1 安全兜底）"
            )
            return _MarkdownDecision(
                answer=outcome.answer,
                trace=server_fallback_trace(
                    "模型未提供 markdown，已回退服务端事实实证正文",
                    status="server_fallback",
                ),
            )

        # ---- V1.0.6.2 专项修复（痛点 2）：单正文来源 + 重复治理 ----
        # 本地小模型会循环复述（同一事实 2–4 遍），先把重复段落折叠；删除比例过高则判定为
        # 循环复述 → **丢弃模型正文**、改用服务端事实实证正文，绝不把两份正文拼进同一气泡。
        adoption = self._validator.adopt_model_body(
            model_markdown, outcome.answer.markdown
        )
        if adoption.repetitive:
            logger.info(
                "模型正文存在循环复述，已丢弃并回退服务端事实实证正文（删除 %d 字）",
                adoption.removed_chars,
            )
            trace = server_fallback_trace(
                "模型正文存在重复段落/循环复述，已丢弃并回退服务端事实实证正文",
                status="fallback",
            )
            if adoption.removed_chars:
                trace["warnings"] = [f"重复内容治理删除 {adoption.removed_chars} 字"]
            return _MarkdownDecision(
                answer=outcome.answer.model_copy(
                    update={"markdown": adoption.markdown}
                ),
                trace=trace,
                downgraded=True,
                downgrade_reason="模型正文存在重复段落，已回退服务端事实实证正文",
            )
        if adoption.removed_chars:
            logger.info("模型正文重复段落已折叠：删除 %d 字", adoption.removed_chars)
        model_markdown = adoption.markdown

        facts = build_fact_check_facts(observed, outcome.evidence_entities, self._store)
        if facts is None:
            logger.info("本轮证据无法构建核查事实块，回退服务端事实实证正文")
            return _MarkdownDecision(
                answer=outcome.answer,
                trace=server_fallback_trace(
                    "本轮证据无法构建核查事实块，已回退服务端事实实证正文",
                    status="skipped",
                ),
            )

        report = check_markdown(model_markdown, facts)
        if report.passed:
            logger.info(
                "markdown 已通过文本级事实核查（年份 %d / 人物 %d / 书名 %d / 引文 %d）",
                report.checked_years,
                report.checked_persons,
                report.checked_books,
                report.checked_quotes,
            )
            return _MarkdownDecision(
                answer=outcome.answer.model_copy(update={"markdown": model_markdown}),
                trace=report.to_trace("passed"),
            )

        logger.info(
            "markdown 未通过文本级事实核查：%s",
            "；".join(report.blocking_messages()[:3]),
        )
        if repair_available:
            return _MarkdownDecision(answer=None, trace=report.to_trace("failed"))

        # 连续重写仍不通过 → 回退服务端事实实证正文（不展示未核验文本）。
        trace = report.to_trace("fallback")
        return _MarkdownDecision(
            answer=outcome.answer,
            trace=trace,
            downgraded=True,
            downgrade_reason="markdown 未通过文本级事实核查，已回退服务端事实实证正文",
        )

    # ------------------------------------------------------------------
    # V1.0.6.3 双图联动：同一次提问同时下发时间轴 + 人物图动作
    # ------------------------------------------------------------------
    def _pair_ui_actions(
        self, question: str, actions: list[UIAction]
    ) -> list[UIAction]:
        """保证「一句提问同时命中时间轴与人物图谱」时两类联动动作都在 `ui_actions` 里。

        背景（V1.0.6.3）：云端模型往往只输出问题焦点一侧的动作（例如事件题只给
        `timeline.focus_event`），前端于是只能渲染一个按钮；本地小模型则经常整段省略。
        本方法在**模型已给出部分合法动作**时，用快照做确定性补齐：

        - 已有时间轴动作、缺人物图动作 → 从问题命中的事件补 `graph.focus_person`；
        - 已有人物图动作、缺时间轴动作 → 从问题命中的人物补 `timeline.focus_event`；
        - 两侧都有 / 问题没有其他可匹配实体 → 原样返回，绝不伪造联动目标。

        只补「缺的那一侧」，不覆盖模型给出的动作，也不超过契约上限 3 条。
        """

        if not actions:
            # 模型完全没给动作时由 `EvidenceValidator` 的意图后置推断负责（同一对补齐逻辑），
            # 这里不重复造动作，避免把「无实体命中」的问题也弹史引。
            return actions

        def surfaces(items: list[UIAction]) -> set[str]:
            result: set[str] = set()
            for item in items:
                value = item.type.value
                if value.startswith("timeline."):
                    result.add("timeline")
                elif value.startswith("graph."):
                    result.add("graph")
            return result

        present = surfaces(actions)
        if {"timeline", "graph"} <= present:
            return actions

        merged = list(actions)
        seen = {
            (item.type.value, tuple(sorted(item.payload.items()))) for item in merged
        }
        try:
            candidates = infer_actions_for_question(self._store, question)
        except Exception:  # pragma: no cover - 推断失败绝不能影响已完成的回答
            logger.exception("双图联动动作补齐失败（不影响回答）")
            return actions

        for candidate in candidates:
            surface = (
                "timeline" if candidate.type.value.startswith("timeline.") else "graph"
            )
            if surface in present:
                continue
            key = (candidate.type.value, tuple(sorted(candidate.payload.items())))
            if key in seen:
                continue
            seen.add(key)
            merged.append(candidate)
            present.add(surface)
            if len(merged) >= 3:
                break
        return merged

    def _try_comparison_rescue(
        self,
        *,
        request: AskRequest,
        observed: ObservedEvidence,
        records: list[ToolCallRecord],
        usage: dict[str, int] | None,
        model_name: str | None,
        model_used: str | None,
        started: float,
        steps: int,
    ) -> AgentResult | None:
        """对比类问题的「图谱兜底」（V1.0.5.4 修复二）。

        仅当以下条件**全部满足**时接管回答：
        1. 问题命中对比 / 总结归纳意图（`detect_comparison_intent`）；
        2. 本轮图谱事实里能找到 A / B 双方实体（`find_comparison_subjects`）；
        3. 这些真实事实能合成一份服务端可核验的 grounded 正文。

        接管后：
        - 正文 / claims / citations 全部由服务端用本轮工具真实返回重写（不信任模型文本）；
        - V1.0.6.1 起不再单独做二次归纳（史令分析已并入模型正文）；兜底正文是
          「事实实证 + 事实罗列」，并在 `trace.fact_check` 标记 `status=server_fallback`；
        - 只有 A / B 图谱实体都没查到时才返回 None，让原 insufficient 逻辑生效。
        """

        if not detect_comparison_intent(request.question):
            return None
        subjects = find_comparison_subjects(request.question, observed, self._store)
        if subjects is None:
            logger.info("对比兜底跳过：本轮图谱事实未找到 A/B 双方实体")
            return None
        rescue_entities = collect_rescue_entities(observed, subjects, self._store)
        if not rescue_entities:
            logger.info("对比兜底跳过：A/B 主体存在但没有可核验的 citation 绑定实体")
            return None
        composed = self._validator.compose_rescue_grounded(
            observed, rescue_entities, request.question
        )
        if composed is None:
            logger.info(
                "对比兜底跳过：本轮真实事实无法合成可核验正文（主体 %s）",
                "、".join(subjects.matched_names),
            )
            return None
        claims, citations, markdown, focus = composed
        # V1.0.6.2 专项修复（痛点 1）：兜底路径的模型没有机会给 UI 动作，由服务端推断。
        inferred_actions = infer_actions_from_evidence(
            request.question, rescue_entities, focus
        )
        # V1.0.6.3 双图联动：命中事件 + 人物两侧时，同时下发时间轴与人物图动作。
        inferred_actions = self._pair_ui_actions(request.question, inferred_actions)
        # 契约 `Answer.markdown` 上限 10000 字：兜底正文由多条真实事实拼成，做一次安全裁剪，
        # 避免极端长事件描述把 Pydantic 校验撑爆（用户侧表现为 500）。
        if len(markdown) > 9800:
            markdown = markdown[:9800].rstrip() + "\n…（正文过长，已截断）"

        answer = FinalAnswer(
            mode="grounded",
            markdown=markdown,
            certainty=self._validator.grounded_certainty(rescue_entities, observed),
            claims=claims,
            evidence=_evidence_from_entities(rescue_entities),
            related_event_ids=_rescue_related_event_ids(rescue_entities, observed),
            missing=[],
            reason_code=None,
            ui_actions=inferred_actions,
            comparison_analysis=None,
        )
        logger.info(
            "对比兜底成功：用本轮真实图谱事实合成 grounded 事实实证正文（主体 %s）",
            "、".join(subjects.matched_names) or "A/B",
        )
        return AgentResult(
            question=request.question,
            answer=answer,
            citations=citations,
            tools=records,
            model=model_name,
            model_used=model_used,
            model_requested=request.model_id,
            source_coverage=source_coverage(rescue_entities),
            latency_ms=_elapsed_ms(started),
            steps=steps,
            downgraded=False,
            downgrade_reason=None,
            usage=usage,
            fact_check=server_fallback_trace(
                "对比兜底：模型未给出可核验正文，使用服务端事实实证正文",
                status="server_fallback",
            ),
            entity_memory=_extract_entity_memory(self._store, observed),
        )

    def _execute_tool_calls(
        self, calls: list[tuple[str, dict[str, Any]]]
    ) -> list[dict[str, Any]]:
        """并行执行同一批只读工具，并按模型给出的顺序返回结果。"""
        if len(calls) == 1:
            tool, arguments = calls[0]
            return [self._registry.execute(tool, arguments)]
        with ThreadPoolExecutor(
            max_workers=len(calls), thread_name_prefix="agent-tool"
        ) as pool:
            futures = [
                pool.submit(self._registry.execute, tool, arguments)
                for tool, arguments in calls
            ]
            return [future.result() for future in futures]

    def _initial_messages(
        self,
        request: AskRequest,
        session_context: SessionContext | None = None,
    ) -> list[dict[str, str]]:
        """组装首轮 messages（V1.0.6：服务端会话历史 + 会话实体记忆）。

        历史来源优先级：
        1. `session_context.history`（服务端 `SessionStore`，权威，已按最近 N 轮截断）；
        2. 否则退回 `request.history`（客户端兜底 / 直接调用 Orchestrator 的旧语义）。

        实体记忆块只在本轮有会话实体状态时注入 user message；没有记忆时消息结构与
        V1.0.5.4 完全一致（保持既有直调测试稳定）。
        """

        from rag.store import rag_status_text

        system_prompt = build_system_prompt(
            self._registry.tool_catalog_json(),
            [action.value for action in V1_AVAILABLE_ACTIONS],
            rag_status=rag_status_text(),
        )
        messages: list[dict[str, str]] = [{"role": "system", "content": system_prompt}]

        history: list[dict[str, str]] = []
        if session_context is not None and session_context.history:
            history = _sanitize_history_turns(
                dict(turn) for turn in session_context.history
            )
        else:
            history = _sanitize_history_turns(
                {"role": turn.role, "content": turn.content} for turn in request.history
            )
        messages.extend(history)

        memory_block = (
            build_session_memory_block(request.question, session_context.entity_memory)
            if session_context is not None
            else None
        )
        messages.append(
            {
                "role": "user",
                "content": build_user_message(
                    request, entity_memory_block=memory_block
                ),
            }
        )
        return messages

    def _fallback(
        self,
        *,
        request: AskRequest,
        records: list[ToolCallRecord],
        observed: ObservedEvidence,
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
            model_requested=request.model_id,
            source_coverage={SOURCE_TIMELINE: False, SOURCE_GRAPH: False},
            latency_ms=_elapsed_ms(started),
            steps=self._max_steps if steps is None else steps,
            downgraded=True,
            downgrade_reason=reason,
            usage=usage,
            fact_check={"status": "skipped", "issues": [reason[:300]], "warnings": []},
            entity_memory=_extract_entity_memory(self._store, observed),
        )


def _extract_entity_memory(
    store: SnapshotStore, observed: ObservedEvidence
) -> dict[str, Any]:
    """从本轮真实工具结果提取「会话实体状态」（V1.0.6 多轮记忆）。

    - 人物：按工具结果出现顺序记录 person_id + 正名（正名优先取工具详情里的
      `display_name`，否则回查快照人物主数据）；这些 ID 会进入 SessionStore，
      供下一轮「他们 / 这两人 / 双方」代词解析；
    - 事件：记录本轮出现过的事件 ID（最多 8 个）；
    - 只收录**结构化的真实工具结果**（`ObservedEvidence` 已过滤失败信封 / 伪造历史），
      因此不会把用户输入里的任意文本写进会话实体状态。
    """

    persons_by_id = getattr(store, "persons_by_id", None)
    persons_lookup = persons_by_id if isinstance(persons_by_id, Mapping) else {}

    person_ids: list[str] = []
    person_names: dict[str, str] = {}
    for entity in observed.entities.values():
        if entity.kind != "person" or entity.entity_id in person_ids:
            continue
        name = ""
        detail = entity.detail
        if isinstance(detail, Mapping):
            display = detail.get("display_name")
            if isinstance(display, str) and display.strip():
                name = display.strip()
        if not name:
            person = persons_lookup.get(entity.entity_id)
            if isinstance(person, Mapping):
                display = person.get("display_name")
                if isinstance(display, str) and display.strip():
                    name = display.strip()
        if not name:
            continue
        person_ids.append(entity.entity_id)
        person_names[entity.entity_id] = name
        if len(person_ids) >= 8:
            break

    event_ids: list[str] = []
    for entity in observed.entities.values():
        if entity.kind != "event" or entity.entity_id in event_ids:
            continue
        event_ids.append(entity.entity_id)
        if len(event_ids) >= 8:
            break

    return {
        "person_ids": person_ids,
        "person_names": person_names,
        "event_ids": event_ids,
    }


def _sanitize_history_turns(
    turns: Any,
) -> list[dict[str, str]]:
    """V1.0.6.2：历史里的 assistant 正文先做重复治理再注入模型（防循环逐轮放大）。

    旧会话可能已经存下「同一事实三遍」的循环回答；若原样注入历史，小模型会模仿这种
    重复结构并逐轮放大。这里只对 assistant 正文做确定性去重，user 消息原样保留。
    """

    sanitized: list[dict[str, str]] = []
    for turn in turns:
        message = dict(turn)
        content = message.get("content")
        if message.get("role") == "assistant" and isinstance(content, str):
            cleaned, removed = sanitize_model_answer(content)
            if removed:
                logger.info("会话历史中的重复段落已折叠：删除 %d 字", removed)
            message["content"] = cleaned
        sanitized.append(message)
    return sanitized


def _shrink_messages(messages: list[dict[str, str]]) -> list[dict[str, str]]:
    """把任意单条消息裁剪到安全长度（V1.0.5.4 修复）。

    LLMClient 对单条消息有硬上限（`MAX_CHAT_MESSAGE_CHARS = 20000`），超过会抛
    `LLMConfigError` → API 层映射成 503，用户侧表现为「冷启动 / 对比问答异常报错」。
    工具结果消息已在 `build_tool_result_message` 内按预算截断；这里是最后一道防线，
    保证**任何**历史 / 工具 / 系统消息都不会因长度触发配置错误。
    """

    shrunk: list[dict[str, str]] = []
    for message in messages:
        content = message.get("content")
        # System Prompt 完全由服务端生成（不含用户 / 工具数据），不裁剪，避免截断规则说明；
        # 只对可能承载工具结果 / 长历史的消息做安全裁剪。
        if (
            message.get("role") != "system"
            and isinstance(content, str)
            and len(content) > MAX_PROMPT_MESSAGE_CHARS
        ):
            content = content[:MAX_PROMPT_MESSAGE_CHARS] + _PROMPT_TRUNCATED_SUFFIX
        shrunk.append({**message, "content": content})
    return shrunk


def _evidence_from_entities(entities: list[ObservedEntity]) -> list[Evidence]:
    """把兜底实体转换成最终回答的 evidence 列表（服务端已核验，无需模型再提交）。"""

    return [
        Evidence(entity_type=entity.kind, entity_id=entity.entity_id)
        for entity in entities[:50]
    ]


def _rescue_related_event_ids(
    entities: list[ObservedEntity], observed: ObservedEvidence, *, limit: int = 5
) -> list[str]:
    """从兜底实体关联事件里挑出本轮真实返回、事实可用的事件 ID（最多 5 个）。"""

    related: list[str] = []
    seen: set[str] = set()
    for entity in entities:
        for event_id in sorted(entity.related_event_ids):
            if event_id in seen or len(related) >= limit:
                continue
            event_entity = observed.entities.get(("event", event_id))
            if event_entity is None or not event_entity.fact_usable:
                continue
            seen.add(event_id)
            related.append(event_id)
    return related


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
    "MAX_FACT_CHECK_REPAIRS",
    "MAX_FINALIZE_RETRIES",
    "MAX_FINALIZE_ROUNDS",
    "MAX_ITERATIONS",
    "MAX_STEPS_HARD_LIMIT",
    "MAX_TOOL_CALLS",
    "AgentOrchestrator",
    "AgentProtocolError",
    "parse_model_step",
]
