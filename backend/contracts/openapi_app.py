"""仅用于导出 OpenAPI 的桩应用（V1.0.1 / TC-04；V1.0.6 会话管理）。

**这不是运行中的应用**：
- 只声明路由与 Pydantic 响应模型，用于生成 `contracts/api-v1.openapi.json`；
- 真正实现快照加载与只读查询的是 `backend/main.py`（TC-06，V1.0.1 后续卡）；
- 桩路由被调用时统一返回 501，避免误把桩当实现。
"""

from __future__ import annotations

from fastapi import FastAPI, HTTPException, Path, Query

from contracts.models import (
    API_VERSION,
    AgentResponse,
    AskRequest,
    ErrorEnvelope,
    EventResponse,
    EventSearchResponse,
    HealthResponse,
    MetaResponse,
    ModelsResponse,
    PersonCandidatesResponse,
    PersonResponse,
    PingLLMResponse,
    SessionCreateRequest,
    SessionDeleteResponse,
    SessionDetailResponse,
    SessionListResponse,
    SessionMutationResponse,
    SessionPatchRequest,
    StreamAskRequest,
)

app = FastAPI(
    title="史脉 HistoLink API",
    version=API_VERSION,
    description="V1.0 契约（Q1–Q6 落地）：问/答/错误/澄清、动作信封、只读数据接口。",
)


def _not_implemented() -> None:
    raise HTTPException(status_code=501, detail="V1.0.1 只冻结契约，接口实现见 TC-06。")


@app.get("/api/health", response_model=HealthResponse, tags=["meta"])
def health() -> HealthResponse:
    _not_implemented()
    raise AssertionError("unreachable")


@app.get("/api/meta", response_model=MetaResponse, tags=["meta"])
def meta() -> MetaResponse:
    _not_implemented()
    raise AssertionError("unreachable")


@app.get(
    "/api/entities/person/{person_id}",
    response_model=PersonResponse,
    responses={404: {"model": ErrorEnvelope}, 503: {"model": ErrorEnvelope}},
    tags=["entities"],
)
def get_person(person_id: str = Path(min_length=1, max_length=128)) -> PersonResponse:
    _not_implemented()
    raise AssertionError("unreachable")


@app.get(
    "/api/entities/event/{event_id}",
    response_model=EventResponse,
    responses={404: {"model": ErrorEnvelope}, 503: {"model": ErrorEnvelope}},
    tags=["entities"],
)
def get_event(event_id: str = Path(min_length=1, max_length=128)) -> EventResponse:
    _not_implemented()
    raise AssertionError("unreachable")


@app.get(
    "/api/entities/persons",
    response_model=PersonCandidatesResponse,
    responses={503: {"model": ErrorEnvelope}},
    tags=["entities"],
)
def find_persons(
    name: str = Query(min_length=1, max_length=100),
    era_id: str | None = Query(default=None, max_length=64),
    limit: int = Query(default=20, ge=1, le=50),
) -> PersonCandidatesResponse:
    _not_implemented()
    raise AssertionError("unreachable")


@app.get(
    "/api/search/events",
    response_model=EventSearchResponse,
    responses={503: {"model": ErrorEnvelope}},
    tags=["search"],
)
def search_events(
    q: str = Query(min_length=1, max_length=200),
    limit: int = Query(default=20, ge=1, le=50),
) -> EventSearchResponse:
    _not_implemented()
    raise AssertionError("unreachable")


@app.get(
    "/api/agent/models",
    response_model=ModelsResponse,
    tags=["agent"],
)
def list_models() -> ModelsResponse:
    """V1.0.5.2：模型注册表（主模型 / 备用降级模型）。"""

    _not_implemented()
    raise AssertionError("unreachable")


@app.get(
    "/api/agent/ping_llm",
    response_model=PingLLMResponse,
    responses={
        502: {"model": ErrorEnvelope},
        503: {"model": ErrorEnvelope},
        504: {"model": ErrorEnvelope},
    },
    tags=["agent"],
)
def ping_llm(
    message: str = Query(default="请回复 OK", min_length=1, max_length=200),
) -> PingLLMResponse:
    _not_implemented()
    raise AssertionError("unreachable")


@app.post(
    "/api/agent/ask",
    response_model=AgentResponse,
    responses={400: {"model": ErrorEnvelope}, 503: {"model": ErrorEnvelope}},
    tags=["agent"],
)
def ask(body: AskRequest) -> AgentResponse:
    _not_implemented()
    raise AssertionError("unreachable")


# ---------------------------------------------------------------------------
# V1.0.6.2 本地模型流式直答（SSE；响应不是 JSON，契约只冻结请求体与错误信封）
# ---------------------------------------------------------------------------


@app.post(
    "/api/agent/chat_stream",
    responses={
        200: {"content": {"text/event-stream": {"schema": {"type": "string"}}}},
        400: {"model": ErrorEnvelope},
        503: {"model": ErrorEnvelope},
    },
    tags=["agent"],
)
def chat_stream(body: StreamAskRequest) -> None:
    """流式直答：`data: {...}` SSE 事件（start → delta* → done / error）。"""

    _not_implemented()
    raise AssertionError("unreachable")


# ---------------------------------------------------------------------------
# V1.0.6 会话管理（多轮记忆 / 前端历史记录真实持久化）
# ---------------------------------------------------------------------------


_SESSION_NOT_FOUND = {404: {"model": ErrorEnvelope}}


@app.get("/api/sessions", response_model=SessionListResponse, tags=["sessions"])
def list_sessions() -> SessionListResponse:
    """会话列表（置顶优先，其余按最后消息时间倒序）。"""

    _not_implemented()
    raise AssertionError("unreachable")


@app.post("/api/sessions", response_model=SessionDetailResponse, tags=["sessions"])
def create_session(body: SessionCreateRequest) -> SessionDetailResponse:
    """新建会话（session_id 可由前端生成，刷新后保持稳定）。"""

    _not_implemented()
    raise AssertionError("unreachable")


@app.get(
    "/api/sessions/{session_id}",
    response_model=SessionDetailResponse,
    responses=_SESSION_NOT_FOUND,
    tags=["sessions"],
)
def get_session(
    session_id: str = Path(min_length=1, max_length=128),
) -> SessionDetailResponse:
    """会话详情（含全部轮次与实体记忆）。"""

    _not_implemented()
    raise AssertionError("unreachable")


@app.patch(
    "/api/sessions/{session_id}",
    response_model=SessionMutationResponse,
    responses=_SESSION_NOT_FOUND,
    tags=["sessions"],
)
def patch_session(
    body: SessionPatchRequest,
    session_id: str = Path(min_length=1, max_length=128),
) -> SessionMutationResponse:
    """重命名 / 置顶会话。"""

    _not_implemented()
    raise AssertionError("unreachable")


@app.delete(
    "/api/sessions/{session_id}",
    response_model=SessionDeleteResponse,
    responses=_SESSION_NOT_FOUND,
    tags=["sessions"],
)
def delete_session(
    session_id: str = Path(min_length=1, max_length=128),
) -> SessionDeleteResponse:
    """删除会话。"""

    _not_implemented()
    raise AssertionError("unreachable")
