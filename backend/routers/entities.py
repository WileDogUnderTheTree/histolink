"""只读实体接口（V1.0.1 / TC-06）：

- `GET /api/entities/person/{person_id}`
- `GET /api/entities/event/{event_id}`
- `GET /api/entities/persons?name=&era_id=&limit=`

person_id 是唯一主键；姓名只用于候选查询，同名时必须返回全部候选（Q5）。
"""

from __future__ import annotations

from fastapi import APIRouter, Depends, Path, Query

from contracts.models import (
    ErrorCode,
    ErrorEnvelope,
    EventResponse,
    PersonCandidatesResponse,
    PersonResponse,
)
from errors import ApiError
from routers.deps import get_store
from snapshot_store import PERSON_CANDIDATE_LIMIT, SnapshotStore

router = APIRouter(tags=["entities"])

_ERROR_RESPONSES = {
    404: {"model": ErrorEnvelope},
    503: {"model": ErrorEnvelope},
}


@router.get(
    "/api/entities/person/{person_id}",
    response_model=PersonResponse,
    responses=_ERROR_RESPONSES,
)
def get_person(
    person_id: str = Path(min_length=1, max_length=128),
    store: SnapshotStore = Depends(get_store),
) -> PersonResponse:
    """按稳定 person_id 查询人物主数据 + 事件摘要（上限 50 条）。"""

    response = store.get_person(person_id)
    if response is None:
        raise ApiError(
            status_code=404,
            code=ErrorCode.ENTITY_NOT_FOUND,
            message=f"人物不存在：{person_id}",
            details={"person_id": person_id},
        )
    return response


@router.get(
    "/api/entities/event/{event_id}",
    response_model=EventResponse,
    responses=_ERROR_RESPONSES,
)
def get_event(
    event_id: str = Path(min_length=1, max_length=128),
    store: SnapshotStore = Depends(get_store),
) -> EventResponse:
    """按稳定 event_id 查询事件 + 参与者 person_id + 结构化引用。"""

    response = store.get_event(event_id)
    if response is None:
        raise ApiError(
            status_code=404,
            code=ErrorCode.ENTITY_NOT_FOUND,
            message=f"事件不存在：{event_id}",
            details={"event_id": event_id},
        )
    return response


@router.get(
    "/api/entities/persons",
    response_model=PersonCandidatesResponse,
    responses={503: {"model": ErrorEnvelope}},
)
def find_persons(
    name: str = Query(min_length=1, max_length=100),
    era_id: str | None = Query(default=None, max_length=64),
    limit: int = Query(default=PERSON_CANDIDATE_LIMIT, ge=1, le=50),
    store: SnapshotStore = Depends(get_store),
) -> PersonCandidatesResponse:
    """姓名 → 候选列表（带消歧副标题）；`era_id` 可按分期收敛。"""

    return store.find_persons(name, era_id=era_id, limit=limit)
