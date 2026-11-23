"""统一错误 envelope（V1.0.1 / TC-06）。

只读 API 的错误一律走 `contracts.models.ErrorEnvelope`：
`{ok:false, request_id, error:{code,message,retryable,details?}}`。
覆盖 400 / 404 / 405 / 503 / 500，避免 FastAPI 默认的 `{"detail": ...}` 破坏契约。
"""

from __future__ import annotations

import logging
import uuid
from typing import Any

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from starlette.exceptions import HTTPException as StarletteHTTPException

from contracts.models import ErrorCode, ErrorEnvelope, ErrorInfo

logger = logging.getLogger("histolink.errors")


class ApiError(Exception):
    """业务错误：由路由/依赖主动抛出，带冻结错误码。"""

    def __init__(
        self,
        status_code: int,
        code: ErrorCode,
        message: str,
        *,
        retryable: bool = False,
        details: dict[str, Any] | None = None,
        headers: dict[str, str] | None = None,
    ) -> None:
        super().__init__(message)
        self.status_code = status_code
        self.code = code
        self.message = message
        self.retryable = retryable
        self.details = details
        self.headers = headers


def _request_id() -> str:
    return f"req_{uuid.uuid4().hex}"


def _envelope(
    *,
    status_code: int,
    code: ErrorCode,
    message: str,
    retryable: bool = False,
    details: dict[str, Any] | None = None,
    headers: dict[str, str] | None = None,
) -> JSONResponse:
    envelope = ErrorEnvelope(
        request_id=_request_id(),
        error=ErrorInfo(
            code=code,
            message=message,
            retryable=retryable,
            details=details,
        ),
    )
    return JSONResponse(
        status_code=status_code,
        content=envelope.model_dump(mode="json"),
        headers=headers,
    )


def read_only_violation_response() -> JSONResponse:
    """V1.0.1 没有任何写接口：对 /api 的写方法统一返回 405 envelope。"""

    return _envelope(
        status_code=405,
        code=ErrorCode.METHOD_NOT_ALLOWED,
        message="该接口不支持此 HTTP 方法（只读 API 无写接口）",
        headers={"Allow": "GET"},
    )


def install_error_handlers(app: FastAPI) -> None:
    """注册统一错误处理（幂等，可重复调用）。"""

    @app.exception_handler(ApiError)
    async def _handle_api_error(_request: Request, exc: ApiError) -> JSONResponse:
        return _envelope(
            status_code=exc.status_code,
            code=exc.code,
            message=exc.message,
            retryable=exc.retryable,
            details=exc.details,
            headers=exc.headers,
        )

    @app.exception_handler(RequestValidationError)
    async def _handle_validation_error(_request: Request, exc: RequestValidationError) -> JSONResponse:
        return _envelope(
            status_code=400,
            code=ErrorCode.INVALID_REQUEST,
            message="请求参数不合法",
            details={"errors": exc.errors()},
        )

    @app.exception_handler(StarletteHTTPException)
    async def _handle_http_error(_request: Request, exc: StarletteHTTPException) -> JSONResponse:
        if exc.status_code == 405:
            code = ErrorCode.METHOD_NOT_ALLOWED
            message = "该接口不支持此 HTTP 方法（只读 API 无写接口）"
        elif exc.status_code == 404:
            code = ErrorCode.ROUTE_NOT_FOUND
            message = "接口路径不存在"
        else:
            code = ErrorCode.INTERNAL
            message = "请求失败"
        return _envelope(
            status_code=exc.status_code,
            code=code,
            message=message,
            headers=dict(exc.headers or {}),
        )

    @app.exception_handler(Exception)
    async def _handle_unexpected(_request: Request, exc: Exception) -> JSONResponse:
        logger.exception("未捕获异常：%s", exc)
        return _envelope(
            status_code=500,
            code=ErrorCode.INTERNAL,
            message="服务内部错误",
            retryable=True,
        )
