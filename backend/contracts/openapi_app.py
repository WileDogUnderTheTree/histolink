"""仅用于导出 OpenAPI 的桩应用（V1.0.1 / TC-04）。

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
    PersonCandidatesResponse,
    PersonResponse,
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


@app.post(
    "/api/agent/ask",
    response_model=AgentResponse,
    responses={400: {"model": ErrorEnvelope}, 503: {"model": ErrorEnvelope}},
    tags=["agent"],
)
def ask(body: AskRequest) -> AgentResponse:
    _not_implemented()
    raise AssertionError("unreachable")
