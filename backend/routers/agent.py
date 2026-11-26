"""Agent 路由（V1.0.1 连通性探测 + V1.0.3 问答入口 + V1.0.5.2 模型注册表 + V1.0.6 多轮记忆 +
V1.0.6.1 双重事实核查观测）。

- `GET  /api/agent/models`：V1.0.5.2 新增，返回主模型 / 备用模型注册表（前端切换窗口数据源）；
- `GET  /api/agent/ping_llm`：TC-10 连通性探测（不进入问答链路）；
- `POST /api/agent/ask`：V1.0.3 问答入口，交给 `AgentOrchestrator` 执行
  「规划 → 工具 → 证据级校验 → 文本级 FactCheck → 回答」，返回冻结的 `AnswerEnvelope`；
  V1.0.5.2 支持可选 `model_id` 请求级模型选择；
  V1.0.6：按 `session_id` 从 `SessionStore` 读取最近 N 轮历史 + 会话实体记忆注入上下文，
  回答成功后把「用户问题 + 服务端回答 + 本轮实体状态」写回会话库（前端刷新后可恢复）；
  V1.0.6.1：`trace.fact_check` 下发文本级事实核查状态（passed / fallback / server_fallback /
  skipped），并随会话快照持久化，前端刷新后仍可展示「双重事实核查通过 / 已回退服务端实证」。

安全：
- 密钥只经环境变量 / `.env` 注入，本接口不回显、不落日志；
- `ENABLE_LLM_PROBE=0` 可关闭连通性探测（公网分享时建议关闭）；
- 问答循环有最大轮次（默认 6），工具参数经严格 Pydantic 白名单校验，
  模型 evidence / citation 不可核验时强制降级 `insufficient`；模型 `markdown` 未通过
  文本级事实核查时退回重写，连续不通过则回退服务端事实实证正文（未核验文本永不展示）；
- `model_id` 必须在模型注册表白名单内，未知模型返回 400 `INVALID_REQUEST`；
- 会话历史只作为**数据**注入，不改变 System Prompt 的指令优先级；
  问答失败（503/504/502）时不写入会话库，避免污染下一轮上下文。
"""

from __future__ import annotations

import logging
import os
import uuid
from collections.abc import Iterator
from typing import Annotated, Any

from fastapi import APIRouter, Depends, Query
from fastapi.responses import StreamingResponse

from agent.intent import infer_actions_for_question
from agent.orchestrator import AgentOrchestrator
from agent.schemas import AgentResult
from agent.session_memory import SessionContext
from agent.tools.base import format_disambiguator, format_year
from contracts.models import (
    AgentResponse,
    Answer,
    AnswerEnvelope,
    AskRequest,
    Entity,
    ErrorCode,
    ErrorEnvelope,
    FactCheckTrace,
    ModelOptionResponse,
    ModelsResponse,
    PingLLMResponse,
    StreamAskRequest,
    ToolTrace,
    Trace,
)
from errors import ApiError
from llm_client import (
    DEFAULT_PING_MESSAGE,
    LLMClient,
    LLMConfigError,
    LLMTimeoutError,
    LLMUpstreamError,
    list_model_options,
)
from llm_stream import StreamChatClient, build_direct_chat_messages, sse_event
from routers.deps import (
    get_llm_client,
    get_session_store,
    get_store,
    get_stream_chat_client,
)
from session_store import (
    ENTITY_MEMORY_MAX_EVENTS,
    ENTITY_MEMORY_MAX_PERSONS,
    SessionStore,
)
from snapshot_store import SnapshotStore
from text_hygiene import sanitize_model_answer

logger = logging.getLogger("histolink.agent")

router = APIRouter(tags=["agent"])

_ERROR_RESPONSES = {
    400: {"model": ErrorEnvelope},
    502: {"model": ErrorEnvelope},
    503: {"model": ErrorEnvelope},
    504: {"model": ErrorEnvelope},
}


@router.get("/api/agent/models", response_model=ModelsResponse)
def list_models() -> ModelsResponse:
    """V1.0.5.2：模型注册表（主模型 / 备用降级模型），供前端切换窗口渲染。

    只读取环境变量 / `.env` 中的模型名，不要求配置 API key，也不发起任何模型调用；
    因此前端首屏即可渲染切换按钮，即使后端尚未配置密钥（真正问答仍会返回 503）。
    """

    options = list_model_options()
    default_model_id = next(option.id for option in options if option.role == "primary")
    return ModelsResponse(
        default_model_id=default_model_id,
        models=[
            ModelOptionResponse(
                id=option.id,
                name=option.name,
                role=option.role,
                description=option.description,
            )
            for option in options
        ],
    )


@router.get(
    "/api/agent/ping_llm",
    response_model=PingLLMResponse,
    responses={
        502: {"model": ErrorEnvelope},
        503: {"model": ErrorEnvelope},
        504: {"model": ErrorEnvelope},
    },
)
def ping_llm(
    client: Annotated[LLMClient, Depends(get_llm_client)],
    message: str = Query(default=DEFAULT_PING_MESSAGE, min_length=1, max_length=200),
) -> PingLLMResponse:
    """发送测试语句给模型，返回真实回复、模型名与耗时。"""

    if os.environ.get("ENABLE_LLM_PROBE", "1").strip() in {"0", "false", "False"}:
        raise ApiError(
            status_code=404,
            code=ErrorCode.ROUTE_NOT_FOUND,
            message="LLM 探测端点已关闭（ENABLE_LLM_PROBE=0）",
        )

    try:
        result = client.ping(message)
    except LLMConfigError as exc:
        raise ApiError(
            status_code=503,
            code=ErrorCode.LLM_NOT_CONFIGURED,
            message=str(exc),
            retryable=False,
        ) from exc
    except LLMTimeoutError as exc:
        raise ApiError(
            status_code=504,
            code=ErrorCode.LLM_TIMEOUT,
            message=str(exc),
            retryable=True,
            details={"model": client.settings.model},
        ) from exc
    except LLMUpstreamError as exc:
        raise ApiError(
            status_code=502,
            code=ErrorCode.LLM_UPSTREAM_ERROR,
            message=str(exc),
            retryable=exc.retryable,
            details={
                "model": client.settings.model,
                **(
                    {"upstream_status": exc.upstream_status}
                    if exc.upstream_status is not None
                    else {}
                ),
            },
        ) from exc

    return PingLLMResponse(
        message=message,
        reply=result.reply,
        model=result.model,
        latency_ms=result.latency_ms,
        usage=result.usage,
    )


@router.post(
    "/api/agent/ask",
    response_model=AgentResponse,
    responses=_ERROR_RESPONSES,
)
def ask(
    body: AskRequest,
    store: Annotated[SnapshotStore, Depends(get_store)],
    client: Annotated[LLMClient, Depends(get_llm_client)],
    session_store: Annotated[SessionStore, Depends(get_session_store)],
) -> AnswerEnvelope:
    """V1.0.3 问答：规划器 + 工具 + 证据校验，返回 `AnswerEnvelope`。

    V1.0.5.2：请求可选 `model_id`（主模型 / 备用模型）。未知模型一律 400，不进入问答链路，
    避免把任意模型名透传给上游。

    V1.0.6 多轮记忆：
    1. 按 `session_id` 取 / 建服务端会话；空会话首次请求把客户端 `history` 迁移进来
       （V1.0.5.4 → V1.0.6 平滑升级，已有服务端历史时以服务端为准，不重复）；
    2. 从 SessionStore 取最近 N 轮历史 + 实体记忆，构造 `SessionContext`，
       由 Orchestrator 注入本轮 messages（并做代词解析）；
    3. 回答成功后追加「用户问题 + 服务端回答 + 本轮实体状态」；问答失败不写库。
    """

    if body.model_id is not None:
        _validate_requested_model(body.model_id)

    # ---- V1.0.6：会话历史上下文（首次请求不落库，回答成功后再创建会话） ----
    # 1) 本轮开始前不主动创建空会话：问答失败（503/504/502）不会在侧边栏留下空记录；
    # 2) 客户端 history 只在服务端会话为空时迁移一次（V1.0.5.4 → V1.0.6 平滑升级）；
    # 3) 已存在会话时以服务端历史为准，忽略客户端重复 history。
    session_id = body.session_id
    existing = session_store.get(session_id)
    if (existing is None or not existing.turns) and body.history:
        migrated = session_store.bootstrap_history(
            session_id,
            [turn.model_dump() for turn in body.history],
            question=body.question,
        )
        if migrated:
            logger.info(
                "首次请求迁移客户端历史：session=%s，%d 条", session_id, migrated
            )
    session_context = SessionContext.from_store(session_store, session_id)

    try:
        result = AgentOrchestrator(store, client).run(
            body, session_context=session_context
        )
    except LLMConfigError as exc:
        raise ApiError(
            status_code=503,
            code=ErrorCode.LLM_NOT_CONFIGURED,
            message=str(exc),
            retryable=False,
        ) from exc
    except LLMTimeoutError as exc:
        raise ApiError(
            status_code=504,
            code=ErrorCode.LLM_TIMEOUT,
            message=str(exc),
            retryable=True,
            details={"model": client.settings.model},
        ) from exc
    except LLMUpstreamError as exc:
        raise ApiError(
            status_code=502,
            code=ErrorCode.LLM_UPSTREAM_ERROR,
            message=str(exc),
            retryable=exc.retryable,
            details={
                "model": client.settings.model,
                **(
                    {"upstream_status": exc.upstream_status}
                    if exc.upstream_status is not None
                    else {}
                ),
            },
        ) from exc
    except Exception as exc:  # pragma: no cover - 兜底：任何未预期异常都转安全信封
        logger.exception("Agent 问答链路未预期异常")
        raise ApiError(
            status_code=500,
            code=ErrorCode.INTERNAL,
            message="服务内部错误",
            retryable=True,
        ) from exc

    envelope = build_answer_envelope(result, body, store)
    _persist_exchange(session_store, session_id, body.question, envelope, result)
    return envelope


# ---------------------------------------------------------------------------
# V1.0.6.2 本地模型流式直答（SSE）
# ---------------------------------------------------------------------------

#: 流式响应头：禁止中间层缓存 / 缓冲，保证 token 逐个到达浏览器。
_STREAM_HEADERS = {
    "Cache-Control": "no-cache, no-transform",
    "Connection": "keep-alive",
    "X-Accel-Buffering": "no",
}
#: 写入会话库的正文上限（避免极端长回答把单条消息撑爆）。
_STREAM_PERSIST_MAX_CHARS = 20000


def _stream_chat_enabled() -> bool:
    """`ENABLE_STREAM_CHAT=0` 时关闭流式直答端点（公网分享时可关闭）。"""

    raw = os.environ.get("ENABLE_STREAM_CHAT", "1").strip().lower()
    return raw not in {"0", "false", "no", "off", "disabled"}


def _validate_requested_model(model_id: str | None) -> None:
    """请求级模型选择白名单校验（未知模型 400，不把任意模型名透传给上游）。"""

    if model_id is None:
        return
    allowed_models = {option.id for option in list_model_options()}
    if model_id not in allowed_models:
        raise ApiError(
            status_code=400,
            code=ErrorCode.INVALID_REQUEST,
            message=f"未知模型：{model_id}（可选：{'、'.join(sorted(allowed_models))}）",
            retryable=False,
        )


def _persist_stream_exchange(
    session_store: SessionStore,
    session_id: str,
    question: str,
    answer: str,
) -> None:
    """把流式直答的一轮问答写回会话库（失败只记日志，不影响已经下发的回答）。

    以 ``answer_payload=None`` 持久化：直答模式没有图谱证据 / 引用，前端恢复会话时
    按「普通 Markdown 消息」渲染，不冒充「已核验」结构化回答。
    """

    text = (answer or "").strip()
    if not text:
        return
    try:
        session_store.append_exchange(
            session_id,
            question=question,
            answer_markdown=text[:_STREAM_PERSIST_MAX_CHARS],
            answer_payload=None,
            entity_memory=None,
        )
    except Exception:  # pragma: no cover - 存储异常不得把已完成的回答变成错误
        logger.exception("流式直答会话持久化失败：session=%s", session_id)


@router.post(
    "/api/agent/chat_stream",
    responses={
        400: {"model": ErrorEnvelope},
        503: {"model": ErrorEnvelope},
        504: {"model": ErrorEnvelope},
    },
)
def chat_stream(
    body: StreamAskRequest,
    session_store: Annotated[SessionStore, Depends(get_session_store)],
    client: Annotated[StreamChatClient, Depends(get_stream_chat_client)],
    store: Annotated[SnapshotStore, Depends(get_store)],
) -> StreamingResponse:
    """V1.0.6.2 本地模型流式直答（`text/event-stream`）。

    与 `/api/agent/ask` 的区别：
    - 不跑「规划 → 工具 → 证据校验」链路，直接把会话历史 + 问题交给模型；
    - **流式下发**：SSE 事件 `start → delta* → done`；思考过程（`delta.reasoning` 与
      ``thinking`` 标签）在服务端过滤，前端只会收到最终答案；
    - **V1.0.6.2 专项修复（痛点 1）**：直答链路不跑工具，模型不可能自己产出 `ui_actions`。
      `done` 事件由服务端用**确定性意图后置推断**（`agent.intent.infer_actions_for_question`，
      基于快照事件标题 / 人物正名·别名）补上 `ui_actions`，前端据此自动展开右侧史引面板；
    - **V1.0.6.2 专项修复（痛点 2）**：生成期由 `llm_stream` 检测循环复述并截断，
      最终答案再经 `text_hygiene.sanitize_model_answer` 去重后才下发 / 落库；
    - **V1.0.6.2「深度思考」开关**：`enable_thinking=false`（默认）沿用关闭思考的快速直答；
      为 true 时请求上游开启思考、Prompt 追加「先推理再给结论」，思考正文仍被过滤；
      若本地模型只产出思考没有最终答案，自动关闭思考重试一次（`done.thinking_fallback=true`）；
    - 成功后把本轮问答写入会话库（`answer_payload=None`，刷新后仍可看到对话）。

    事件格式（每帧 `data: {...}\\n\\n`）：

    - ``{"type":"start","request_id","session_id","model"}``
    - ``{"type":"delta","text":"增量"}``
    - ``{"type":"done","answer":"完整答案","model","latency_ms","first_token_ms",
      "reasoning_chars","filtered_chars","deduped_chars","repetition_stopped",
      "ui_actions":[...],"usage","finish_reason"}``
    - ``{"type":"error","code","message","retryable"}``

    注意：错误发生在**响应开始之后**时只能以 `error` 事件下发（HTTP 状态仍是 200）；
    参数 / 模型白名单 / 配置类错误在响应开始前按统一错误信封返回。
    """

    if not _stream_chat_enabled():
        raise ApiError(
            status_code=404,
            code=ErrorCode.ROUTE_NOT_FOUND,
            message="流式直答端点已关闭（ENABLE_STREAM_CHAT=0）",
        )
    _validate_requested_model(body.model_id)

    session_id = (body.session_id or f"session_{uuid.uuid4().hex}").strip()
    existing = session_store.get(session_id)
    if (existing is None or not existing.turns) and body.history:
        session_store.bootstrap_history(
            session_id,
            [turn.model_dump() for turn in body.history],
            question=body.question,
        )
    history = session_store.history_turns(session_id, max_messages=12)
    if not history and body.history:
        history = [turn.model_dump() for turn in body.history]

    messages = build_direct_chat_messages(
        history,
        body.question,
        system_prompt=client.settings.system_prompt,
        enable_thinking=body.enable_thinking,
    )
    request_id = f"req_{uuid.uuid4().hex}"
    model = body.model_id or client.settings.model
    question = body.question
    # V1.0.6.2 专项修复（痛点 1 · 意图后置推断）：
    # 直答链路不跑工具、模型不会输出 ui_actions，这里用快照做确定性实体匹配
    # （事件标题 / 人物正名·别名 → 深链接 ID），随 done 事件下发，前端自动展开史引。
    try:
        inferred_actions = infer_actions_for_question(store, question)
    except Exception:  # pragma: no cover - 推断失败绝不能影响直答本身
        logger.exception("直答意图后置推断失败（不影响回答）")
        inferred_actions = []
    ui_actions_payload = [
        action.model_dump(mode="json") for action in inferred_actions[:3]
    ]

    def _event_source() -> Iterator[str]:
        yield sse_event(
            {
                "type": "start",
                "request_id": request_id,
                "session_id": session_id,
                "model": model,
                # V1.0.6.2「深度思考」开关：前端据 aria-checked 已自知，这里回显便于观测。
                "enable_thinking": body.enable_thinking,
            }
        )

        def _stream_once(thinking: bool) -> Iterator[Any]:
            return client.stream(messages, model=model, enable_thinking=thinking)

        def _is_thinking_only_failure(exc: LLMUpstreamError) -> bool:
            """深度思考开启后模型只输出思考、没有最终答案（本地小模型常见）。"""

            message = str(exc)
            return "只输出了思考内容" in message or "空回答" in message

        #: 是否因「只输出思考」自动回退到关闭思考重试（回退成功时为 True）。
        thinking_fallback = False
        emitted_delta = False
        stream_events = _stream_once(body.enable_thinking)
        try:
            while True:
                try:
                    for event in stream_events:
                        if event.type == "delta":
                            emitted_delta = True
                            yield sse_event(event.to_dict())
                            continue
                        # done：补上请求级元数据、推断出的 UI 动作与重复治理结果；
                        # 思考内容只上报字符数（V1.0.6.2 深度思考同样不上屏）。
                        payload = event.to_dict()
                        payload["request_id"] = request_id
                        payload["session_id"] = session_id
                        payload["ui_actions"] = ui_actions_payload
                        payload["enable_thinking"] = body.enable_thinking
                        payload["thinking_fallback"] = thinking_fallback
                        # V1.0.6.2（痛点 2）：落库 / 下发前再做一次确定性去重（注入的客户端也覆盖到）。
                        answer_text, deduped = sanitize_model_answer(
                            event.answer, drop_restated_tail=True
                        )
                        payload["answer"] = answer_text
                        if deduped and not payload.get("deduped_chars"):
                            payload["deduped_chars"] = deduped
                        _persist_stream_exchange(
                            session_store, session_id, question, answer_text
                        )
                        yield sse_event(payload)
                    break
                except LLMUpstreamError as exc:
                    # V1.0.6.2 深度思考兜底：本地模型开启思考后可能只有 reasoning、
                    # 没有任何 content（XiaoHong-v1 不输出思考收尾标签）。
                    # 此时还没有向浏览器下发任何 delta，可安全地关闭思考重试一次，
                    # 保证用户至少拿到一份最终答案；回退标记随 done 事件上报。
                    if (
                        body.enable_thinking
                        and not thinking_fallback
                        and not emitted_delta
                        and _is_thinking_only_failure(exc)
                    ):
                        logger.warning(
                            "深度思考只产出思考内容，自动回退到关闭思考重试：session=%s",
                            session_id,
                        )
                        thinking_fallback = True
                        stream_events = _stream_once(False)
                        continue
                    raise
        except LLMTimeoutError as exc:
            yield sse_event(
                {
                    "type": "error",
                    "request_id": request_id,
                    "code": ErrorCode.LLM_TIMEOUT.value,
                    "message": str(exc),
                    "retryable": True,
                }
            )
        except LLMUpstreamError as exc:
            yield sse_event(
                {
                    "type": "error",
                    "request_id": request_id,
                    "code": ErrorCode.LLM_UPSTREAM_ERROR.value,
                    "message": str(exc),
                    "retryable": exc.retryable,
                }
            )
        except LLMConfigError as exc:
            yield sse_event(
                {
                    "type": "error",
                    "request_id": request_id,
                    "code": ErrorCode.LLM_NOT_CONFIGURED.value,
                    "message": str(exc),
                    "retryable": False,
                }
            )
        except Exception:  # pragma: no cover - 兜底：响应已开始，只能以 error 事件收尾
            logger.exception("流式直答未预期异常：session=%s", session_id)
            yield sse_event(
                {
                    "type": "error",
                    "request_id": request_id,
                    "code": ErrorCode.INTERNAL.value,
                    "message": "流式生成失败，请稍后重试",
                    "retryable": True,
                }
            )

    return StreamingResponse(
        _event_source(),
        media_type="text/event-stream",
        headers=_STREAM_HEADERS,
    )


def _persist_exchange(
    session_store: SessionStore,
    session_id: str,
    question: str,
    envelope: AnswerEnvelope,
    result: AgentResult,
) -> None:
    """把成功的一轮问答写回 SessionStore（失败只记日志，不影响本次回答返回）。"""

    try:
        session_store.append_exchange(
            session_id,
            question=question,
            answer_markdown=envelope.answer.markdown if envelope.answer else "",
            answer_payload=build_session_answer_payload(envelope),
            entity_memory=merge_answer_entity_memory(envelope, result.entity_memory),
        )
    except Exception:  # pragma: no cover - 存储异常不得把已完成的回答变成 500
        logger.exception("会话持久化失败，本轮回答仍正常返回：session=%s", session_id)


def build_session_answer_payload(envelope: AnswerEnvelope) -> dict[str, Any]:
    """把 `AnswerEnvelope` 转成会话库里的 assistant 结构化快照（snake_case）。

    前端 `session-client` 会把它映射成 `AgentAnswerView`（刷新后恢复引用 / 联动按钮 /
    对比分析块等富文本内容）；只保留有上限的字段，避免单条消息过大。
    """

    trace = envelope.trace
    return {
        "answer": envelope.answer.model_dump(mode="json") if envelope.answer else None,
        "citations": [item.model_dump(mode="json") for item in envelope.citations[:20]],
        "entities": [item.model_dump(mode="json") for item in envelope.entities],
        "ui_actions": [
            item.model_dump(mode="json") for item in envelope.ui_actions[:20]
        ],
        "trace": (
            {
                "model_used": trace.model_used,
                "model_requested": trace.model_requested,
                "sources": trace.sources,
                # V1.0.6.1：文本级事实核查状态（刷新后仍能展示「双重核查通过 / 已回退服务端实证」）。
                "fact_check": (
                    trace.fact_check.model_dump(mode="json")
                    if trace.fact_check is not None
                    else None
                ),
            }
            if trace is not None
            else None
        ),
        "request_id": envelope.request_id,
        "snapshot_version": envelope.snapshot.version,
    }


def merge_answer_entity_memory(
    envelope: AnswerEnvelope,
    orchestrator_memory: dict[str, Any] | None,
) -> dict[str, Any]:
    """合并「最终回答 evidence 实体」与「本轮全部工具实体」→ 会话实体状态。

    回答 evidence 里的实体与当前问题最相关（且顺序就是模型引用顺序），排在最前面；
    再由 Orchestrator 从本轮工具结果提取的全量实体补齐（提供正名 + 更多人物 ID）。
    """

    person_ids: list[str] = []
    person_names: dict[str, str] = {}

    for entity in envelope.entities:
        person_id = entity.person_id
        if entity.kind != "person" or not isinstance(person_id, str) or not person_id:
            continue
        if person_id in person_ids:
            continue
        person_ids.append(person_id)
        if entity.name:
            person_names[person_id] = entity.name

    memory = orchestrator_memory if isinstance(orchestrator_memory, dict) else {}
    names = memory.get("person_names")
    if isinstance(names, dict):
        for person_id, name in names.items():
            if (
                isinstance(person_id, str)
                and person_id
                and isinstance(name, str)
                and name
                and person_id not in person_names
            ):
                person_names[person_id] = name
    for person_id in memory.get("person_ids") or []:
        if isinstance(person_id, str) and person_id and person_id not in person_ids:
            person_ids.append(person_id)

    event_ids: list[str] = []
    for entity in envelope.entities:
        event_id = entity.event_id
        # V1.0.6.1 顺手清理（V1.0.7 待办第 2 项）：合并嵌套 if，语义不变。
        if (
            entity.kind == "event"
            and isinstance(event_id, str)
            and event_id
            and event_id not in event_ids
        ):
            event_ids.append(event_id)
    for event_id in memory.get("event_ids") or []:
        if isinstance(event_id, str) and event_id and event_id not in event_ids:
            event_ids.append(event_id)

    return {
        "person_ids": person_ids[:ENTITY_MEMORY_MAX_PERSONS],
        "person_names": {
            person_id: person_names[person_id]
            for person_id in person_ids[:ENTITY_MEMORY_MAX_PERSONS]
            if person_id in person_names
        },
        "event_ids": event_ids[:ENTITY_MEMORY_MAX_EVENTS],
    }


def build_answer_envelope(
    result: AgentResult, request: AskRequest, store: SnapshotStore
) -> AnswerEnvelope:
    """把内部 `AgentResult` 转换成冻结的 API `AnswerEnvelope`。"""

    answer = result.answer
    contract_answer = Answer(
        markdown=answer.markdown,
        mode=answer.mode,
        claims=answer.claims,
        certainty=answer.certainty,
        missing=answer.missing,
        reason_code=answer.reason_code,
        related_event_ids=answer.related_event_ids,
        # V1.0.5.4 新增可选字段：二次归纳的对比分析（仅 grounded 对比 / 总结类问题可能非空）。
        comparison_analysis=(
            {"text": answer.comparison_analysis.text}
            if answer.comparison_analysis is not None
            else None
        ),
    )
    trace = Trace(
        tools=[
            ToolTrace(
                name=record.name, args=record.arguments, hits=record.hits, ms=record.ms
            )
            for record in result.tools
        ],
        model=result.model,
        model_used=result.model_used,
        model_requested=result.model_requested,
        sources=result.source_coverage,
        # V1.0.6.1：文本级事实核查观测（只增可选字段）。
        fact_check=_fact_check_trace(result.fact_check),
        latency_ms=result.latency_ms,
    )
    return AnswerEnvelope(
        request_id=f"req_{uuid.uuid4().hex}",
        snapshot=store.snapshot_meta,
        answer=contract_answer,
        citations=result.citations,
        entities=_entities_from_evidence(store, result),
        ui_actions=answer.ui_actions[:20],
        trace=trace,
    )


def _fact_check_trace(payload: dict[str, Any] | None) -> FactCheckTrace | None:
    """把 Orchestrator 的 `AgentResult.fact_check` 转成契约 `FactCheckTrace`（V1.0.6.1）。

    只读取白名单字段；未知状态一律按 `skipped` 处理，避免内部观测值破坏契约。
    """

    if not isinstance(payload, dict):
        return None
    allowed_status = {"passed", "failed", "fallback", "server_fallback", "skipped"}
    status = payload.get("status")
    if status not in allowed_status:
        status = "skipped"
    counters = {}
    for key in (
        "checked_years",
        "checked_persons",
        "checked_books",
        "checked_quotes",
        "checked_numbers",
    ):
        value = payload.get(key)
        counters[key] = value if isinstance(value, int) and value >= 0 else 0
    return FactCheckTrace(
        status=status,  # type: ignore[arg-type]
        issues=[item for item in payload.get("issues") or [] if isinstance(item, str)][
            :10
        ],
        warnings=[
            item for item in payload.get("warnings") or [] if isinstance(item, str)
        ][:10],
        **counters,
    )


def _entities_from_evidence(store: SnapshotStore, result: AgentResult) -> list[Entity]:
    """把 evidence 映射成 API 的 `entities[]`；不认识的实体静默跳过。"""

    entities: list[Entity] = []
    seen: set[tuple[str, str]] = set()
    for evidence in result.answer.evidence:
        key = (evidence.entity_type, evidence.entity_id)
        if key in seen:
            continue
        seen.add(key)
        kind = evidence.entity_type
        if kind == "person":
            person = store.persons_by_id.get(evidence.entity_id)
            if person is None:
                continue
            entities.append(
                Entity(
                    kind="person",
                    person_id=person["person_id"],
                    name=person["display_name"],
                    disambiguator=format_disambiguator(person)[:100],
                    era_ids=list(person.get("era_ids") or [])[:10],
                )
            )
        elif kind == "event":
            event = store.events_by_id.get(evidence.entity_id)
            if event is None:
                continue
            entities.append(
                Entity(
                    kind="event",
                    event_id=event["event_id"],
                    title=event["title"][:300],
                    disambiguator=f"{event['dynasty']}·{format_year(event['year'])}"[
                        :100
                    ],
                )
            )
        elif kind == "relation":
            entities.append(Entity(kind="relation", title=evidence.entity_id[:300]))
        if len(entities) >= 20:
            break
    return entities


__all__ = ["build_answer_envelope", "router"]
