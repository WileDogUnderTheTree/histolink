"""只读 API 公共依赖（V1.0.1 / TC-06）。"""

from __future__ import annotations

from fastapi import Request

from contracts.models import ErrorCode
from errors import ApiError
from snapshot_store import SnapshotStore


def get_store(request: Request) -> SnapshotStore:
    """从 `app.state` 取启动时加载的快照；未加载返回 503。"""

    store = getattr(request.app.state, "store", None)
    if store is None:
        raise ApiError(
            status_code=503,
            code=ErrorCode.SNAPSHOT_NOT_LOADED,
            message="数据快照尚未加载，请稍后重试或检查服务启动日志",
            retryable=True,
        )
    return store
