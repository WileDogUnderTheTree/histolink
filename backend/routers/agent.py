"""Agent 路由（V1.0.1 连通性探测 + V1.0.3 问答入口 + V1.0.5.2 模型注册表）。

- `GET  /api/agent/models`：V1.0.5.2 新增，返回主模型 / 备用模型注册表（前端切换窗口数据源）；
- `GET  /api/agent/ping_llm`：TC-10 连通性探测（不进入问答链路）；
- `POST /api/agent/ask`：V1.0.3 问答入口，交给 `AgentOrchestrator` 执行
  「规划 → 工具 → 证据校验 → 回答」，返回冻结的 `AnswerEnvelope`；
  V1.0.5.2 支持可选 `model_id` 请求级模型选择。

安全：
- 密钥只经环境变量 / `.env` 注入，本接口不回显、不落日志；
- `ENABLE_LLM_PROBE=0` 可关闭连通性探测（公网分享时建议关闭）；
- 问答循环有最大轮次（默认 6），工具参数经严格 Pydantic 白名单校验，
  模型 evidence / citation 不可核验时强制降级 `insufficient`；
- `model_id` 必须在模型注册表白名单内，未知模型返回 400 `INVALID_REQUEST`。
"""

from __future__ import annotations

import logging
import os
import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, Query

from agent.orchestrator import AgentOrchestrator
from agent.schemas import AgentResult
from agent.tools.base import format_disambiguator, format_year
from contracts.models import (
    AgentResponse,
    Answer,
    AnswerEnvelope,
    AskRequest,
    Entity,
    ErrorCode,
    ErrorEnvelope,
    ModelOptionResponse,
    ModelsResponse,
    PingLLMResponse,
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
from routers.deps import get_llm_client, get_store
from snapshot_store import SnapshotStore

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
    default_model_id = next(
        option.id for option in options if option.role == "primary"
    )
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
    responses={502: {"model": ErrorEnvelope}, 503: {"model": ErrorEnvelope}, 504: {"model": ErrorEnvelope}},
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
) -> AnswerEnvelope:
    """V1.0.3 问答：规划器 + 工具 + 证据校验，返回 `AnswerEnvelope`。

    V1.0.5.2：请求可选 `model_id`（主模型 / 备用模型）。未知模型一律 400，不进入问答链路，
    避免把任意模型名透传给上游。
    """

    if body.model_id is not None:
        allowed_models = {option.id for option in list_model_options()}
        if body.model_id not in allowed_models:
            raise ApiError(
                status_code=400,
                code=ErrorCode.INVALID_REQUEST,
                message=f"未知模型：{body.model_id}（可选：{'、'.join(sorted(allowed_models))}）",
                retryable=False,
            )

    try:
        result = AgentOrchestrator(store, client).run(body)
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

    return build_answer_envelope(result, body, store)


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
            ToolTrace(name=record.name, args=record.arguments, hits=record.hits, ms=record.ms)
            for record in result.tools
        ],
        model=result.model,
        model_used=result.model_used,
        model_requested=result.model_requested,
        sources=result.source_coverage,
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
                    disambiguator=f"{event['dynasty']}·{format_year(event['year'])}"[:100],
                )
            )
        elif kind == "relation":
            entities.append(Entity(kind="relation", title=evidence.entity_id[:300]))
        if len(entities) >= 20:
            break
    return entities


__all__ = ["build_answer_envelope", "router"]
