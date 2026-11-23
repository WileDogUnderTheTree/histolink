"""`GET /api/agent/ping_llm`（V1.0.1 / TC-10）：模型连通性探测。

不是问答接口：只发送一句固定测试话（默认「请回复 OK」），把模型真实回复返回给调用方，
用于验证 `.env` 中的 ModelScope key / base URL / 模型名是否可用。

安全：
- 密钥只经环境变量 / `.env` 注入，本接口不回显、不落日志；
- 可用 `ENABLE_LLM_PROBE=0` 关闭本端点（公网分享时建议关闭，避免他人消耗额度）。
"""

from __future__ import annotations

import os

from fastapi import APIRouter, Depends, Query

from contracts.models import ErrorCode, ErrorEnvelope, PingLLMResponse
from errors import ApiError
from llm_client import (
    DEFAULT_PING_MESSAGE,
    LLMClient,
    LLMConfigError,
    LLMTimeoutError,
    LLMUpstreamError,
)
from routers.deps import get_llm_client

router = APIRouter(tags=["agent"])

_ERROR_RESPONSES = {
    502: {"model": ErrorEnvelope},
    503: {"model": ErrorEnvelope},
    504: {"model": ErrorEnvelope},
}


@router.get(
    "/api/agent/ping_llm",
    response_model=PingLLMResponse,
    responses=_ERROR_RESPONSES,
)
def ping_llm(
    message: str = Query(default=DEFAULT_PING_MESSAGE, min_length=1, max_length=200),
    client: LLMClient = Depends(get_llm_client),
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
                **({"upstream_status": exc.upstream_status} if exc.upstream_status is not None else {}),
            },
        ) from exc

    return PingLLMResponse(
        message=message,
        reply=result.reply,
        model=result.model,
        latency_ms=result.latency_ms,
        usage=result.usage,
    )
