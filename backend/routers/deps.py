"""只读 API 公共依赖（V1.0.1 / TC-06；TC-10 增加 LLM 客户端）。"""

from __future__ import annotations

from fastapi import Request

from contracts.models import ErrorCode
from errors import ApiError
from llm_client import LLMClient, LLMConfigError
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


def get_llm_client() -> LLMClient:
    """按请求构造 LLM 客户端（无连接池，配置每次从环境读取）。

    配置缺失统一映射为 503 `LLM_NOT_CONFIGURED`；不读取快照，因此快照故障不影响探测端点。
    """

    try:
        return LLMClient.from_env()
    except LLMConfigError as exc:
        raise ApiError(
            status_code=503,
            code=ErrorCode.LLM_NOT_CONFIGURED,
            message=str(exc),
            retryable=False,
        ) from exc
