"""会话管理路由（V1.0.6：前端历史记录真实持久化 + 多轮记忆）。

接口（V1.0 内**只增不改**，与 `contracts/api-v1.openapi.json` 同步）：

- `GET    /api/sessions`              会话列表（置顶优先，其余按最后消息时间倒序）；
- `POST   /api/sessions`              新建会话（`session_id` 可由前端生成，刷新后 id 稳定）；
- `GET    /api/sessions/{session_id}` 会话详情（含全部轮次 + 实体记忆，前端恢复聊天记录）；
- `PATCH  /api/sessions/{session_id}` 重命名 / 置顶（至少提供一个字段）；
- `DELETE /api/sessions/{session_id}` 删除会话（含全部轮次，不可恢复）。

写入边界（`main.py` 的只读闸门）：
- 本文件是 `/api` 下**唯一新增的写入口**；其余 `/api/*` 写方法仍统一 405；
- 请求体经 `contracts.models` 的严格 Pydantic 校验（`extra="forbid"`），未知字段 400；
- 会话不存在统一 404 `SESSION_NOT_FOUND`，不泄露服务端内部状态。
"""

from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Depends, Path

from contracts.models import (
    ErrorCode,
    ErrorEnvelope,
    SessionCreateRequest,
    SessionDeleteResponse,
    SessionDetail,
    SessionDetailResponse,
    SessionListResponse,
    SessionMutationResponse,
    SessionPatchRequest,
    SessionSummary,
)
from errors import ApiError
from routers.deps import get_session_store
from session_store import MAX_LIST_SESSIONS, SessionRecord, SessionStore

router = APIRouter(tags=["sessions"])

_NOT_FOUND_RESPONSES = {404: {"model": ErrorEnvelope}}


def _summary(record: SessionRecord) -> SessionSummary:
    return SessionSummary(**record.summary_dict())


def _detail(record: SessionRecord) -> SessionDetail:
    return SessionDetail(**record.detail_dict())


def _not_found(session_id: str) -> ApiError:
    return ApiError(
        status_code=404,
        code=ErrorCode.SESSION_NOT_FOUND,
        message=f"会话不存在：{session_id}",
        retryable=False,
        details={"session_id": session_id},
    )


@router.get("/api/sessions", response_model=SessionListResponse)
def list_sessions(
    store: Annotated[SessionStore, Depends(get_session_store)],
) -> SessionListResponse:
    """真实历史会话列表（侧边栏数据源）。"""

    records = store.list_sessions(limit=MAX_LIST_SESSIONS)
    return SessionListResponse(sessions=[_summary(record) for record in records])


@router.post("/api/sessions", response_model=SessionDetailResponse)
def create_session(
    body: SessionCreateRequest,
    store: Annotated[SessionStore, Depends(get_session_store)],
) -> SessionDetailResponse:
    """新建会话；传已存在的 `session_id` 时幂等返回该会话。"""

    record = store.create(session_id=body.session_id, title=body.title)
    return SessionDetailResponse(session=_detail(record))


@router.get(
    "/api/sessions/{session_id}",
    response_model=SessionDetailResponse,
    responses=_NOT_FOUND_RESPONSES,
)
def get_session(
    session_id: Annotated[str, Path(min_length=1, max_length=128)],
    store: Annotated[SessionStore, Depends(get_session_store)],
) -> SessionDetailResponse:
    """会话详情：前端刷新页面 / 点击历史记录时据此恢复完整聊天记录。"""

    record = store.get(session_id)
    if record is None:
        raise _not_found(session_id)
    return SessionDetailResponse(session=_detail(record))


@router.patch(
    "/api/sessions/{session_id}",
    response_model=SessionMutationResponse,
    responses=_NOT_FOUND_RESPONSES,
)
def patch_session(
    body: SessionPatchRequest,
    session_id: Annotated[str, Path(min_length=1, max_length=128)],
    store: Annotated[SessionStore, Depends(get_session_store)],
) -> SessionMutationResponse:
    """重命名 / 置顶会话；两个字段可同时提交。"""

    record = store.get(session_id)
    if record is None:
        raise _not_found(session_id)
    if body.title is not None:
        record = store.rename(session_id, body.title)
    if body.pinned is not None:
        record = store.set_pinned(session_id, body.pinned)
    if record is None:  # pragma: no cover - 并发删除后的保护分支
        raise _not_found(session_id)
    return SessionMutationResponse(session=_summary(record))


@router.delete(
    "/api/sessions/{session_id}",
    response_model=SessionDeleteResponse,
    responses=_NOT_FOUND_RESPONSES,
)
def delete_session(
    session_id: Annotated[str, Path(min_length=1, max_length=128)],
    store: Annotated[SessionStore, Depends(get_session_store)],
) -> SessionDeleteResponse:
    """删除会话（连同全部轮次）。"""

    if not store.delete(session_id):
        raise _not_found(session_id)
    return SessionDeleteResponse(session_id=session_id)


__all__ = ["router"]
