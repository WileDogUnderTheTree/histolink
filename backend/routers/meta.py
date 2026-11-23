"""`GET /api/meta`（V1.0.1 / TC-06）：快照版本 / counts / 能力清单。"""

from __future__ import annotations

from fastapi import APIRouter, Depends

from contracts.models import ErrorEnvelope, MetaResponse
from routers.deps import get_store
from snapshot_store import SnapshotStore

router = APIRouter(tags=["meta"])


@router.get(
    "/api/meta",
    response_model=MetaResponse,
    responses={503: {"model": ErrorEnvelope}},
)
def get_meta(store: SnapshotStore = Depends(get_store)) -> MetaResponse:
    """返回快照版本、数据统计与 V1.0 动作能力（只读，无数据库）。"""

    return store.get_meta()
