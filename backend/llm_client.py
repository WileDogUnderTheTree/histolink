"""LLM Client（V1.0.1 / TC-10 连通性探测）。

职责：
- 从环境变量 / `backend/.env` 读取 ModelScope（OpenAI 兼容）推理服务的 key、base URL、模型名；
- 提供一个最小的同步 `ping()`：发送一句测试话（默认「请回复 OK」），返回模型真实回复与耗时；
- 统一把配置错误 / 超时 / 上游 HTTP 错误映射成可被 `errors.ApiError` 消费的异常。

安全约定：
- **密钥只经环境变量 / `.env` 传入**，不写日志、不入库、不出现在响应里；
- 响应只返回模型名、回复、耗时与 token 用量；base URL 仅用于构造请求；
- 上游错误信息会截断并做一次 key 脱敏，避免反向代理回显请求头。

本模块不依赖 FastAPI，可被 `backend/scripts/spike_llm.py` 单独调用。
应用入口是 `routers/agent.py` 的 `GET /api/agent/ping_llm`。
"""

from __future__ import annotations

import os
import time
from collections.abc import Mapping
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import httpx

BACKEND_DIR = Path(__file__).resolve().parent
PROJECT_ROOT = BACKEND_DIR.parent

#: ModelScope 推理服务默认地址（OpenAI 兼容，实际请求 <base>/chat/completions）。
DEFAULT_BASE_URL = "https://api-inference.modelscope.cn/v1"
#: 默认模型（TC-10 暂用 Qwen3-8B）。
DEFAULT_MODEL = "Qwen/Qwen3-8B"
DEFAULT_TIMEOUT_SECONDS = 30.0
DEFAULT_PING_MESSAGE = "请回复 OK"
MAX_REPLY_LENGTH = 2000
MAX_ERROR_EXCERPT = 200

#: 环境变量别名（按顺序取第一个非空值）；主推 MODELSCOPE_*，兼容常见 LLM_* / OPENAI_*。
_API_KEY_ENV_NAMES = ("MODELSCOPE_API_KEY", "MODELSCOPE_KEY", "LLM_API_KEY", "OPENAI_API_KEY")
_BASE_URL_ENV_NAMES = ("MODELSCOPE_BASE_URL", "MODELSCOPE_URL", "LLM_BASE_URL", "OPENAI_BASE_URL")
_MODEL_ENV_NAMES = ("MODELSCOPE_MODEL", "LLM_MODEL", "OPENAI_MODEL")
_TIMEOUT_ENV_NAMES = ("LLM_TIMEOUT_SECONDS", "MODELSCOPE_TIMEOUT_SECONDS")


class LLMConfigError(RuntimeError):
    """配置缺失或非法；映射为 503 `LLM_NOT_CONFIGURED`。"""


class LLMTimeoutError(RuntimeError):
    """调用超时；映射为 504 `LLM_TIMEOUT`。"""


class LLMUpstreamError(RuntimeError):
    """上游返回错误（鉴权、限流、5xx、响应格式异常等）；映射为 502 `LLM_UPSTREAM_ERROR`。"""

    def __init__(
        self,
        message: str,
        *,
        upstream_status: int | None = None,
        retryable: bool = False,
    ) -> None:
        super().__init__(message)
        self.upstream_status = upstream_status
        self.retryable = retryable


@dataclass(frozen=True)
class LLMSettings:
    """一次调用所需的配置（不可变，避免请求间串改）。"""

    api_key: str
    base_url: str
    model: str
    timeout_seconds: float

    @property
    def chat_completions_url(self) -> str:
        base = self.base_url.rstrip("/")
        # 允许直接填完整 endpoint（某些网关这样给出），否则补 OpenAI 兼容路径。
        if base.endswith("/chat/completions"):
            return base
        return f"{base}/chat/completions"

    @property
    def masked_key(self) -> str:
        """日志 / 调试用：只保留首尾各 2 位。"""

        key = self.api_key
        if len(key) <= 6:
            return "***"
        return f"{key[:2]}***{key[-2:]}"


@dataclass(frozen=True)
class LLMPingResult:
    reply: str
    model: str
    latency_ms: int
    usage: dict[str, int] | None = None


_dotenv_loaded = False


def _load_env_files() -> None:
    """加载 `backend/.env` 与仓库根 `.env`（不覆盖进程已有环境变量）。"""

    global _dotenv_loaded
    if _dotenv_loaded:
        return
    _dotenv_loaded = True

    try:
        from dotenv import load_dotenv
    except ImportError:  # pragma: no cover - 依赖缺失时退回纯环境变量
        return

    for candidate in (BACKEND_DIR / ".env", PROJECT_ROOT / ".env"):
        if candidate.is_file():
            load_dotenv(candidate, override=False, encoding="utf-8")


def _first_non_empty(source: Mapping[str, str], names: tuple[str, ...]) -> str | None:
    for name in names:
        value = source.get(name)
        if value is None:
            continue
        cleaned = value.strip()
        if cleaned:
            return cleaned
    return None


def load_llm_settings(
    env: Mapping[str, str] | None = None,
    *,
    load_env_file: bool = True,
) -> LLMSettings:
    """读取并校验 LLM 配置；缺失时抛出带修复提示的 `LLMConfigError`。"""

    if load_env_file:
        _load_env_files()
    source: Mapping[str, str] = os.environ if env is None else env

    api_key = _first_non_empty(source, _API_KEY_ENV_NAMES)
    if api_key is None:
        raise LLMConfigError(
            "未配置模型密钥：请在 backend/.env 写入 MODELSCOPE_API_KEY（或设置同名环境变量）后重启服务。"
            " 可参考 backend/.env.example。"
        )

    base_url = _first_non_empty(source, _BASE_URL_ENV_NAMES) or DEFAULT_BASE_URL
    if not base_url.startswith(("http://", "https://")):
        raise LLMConfigError(f"MODELSCOPE_BASE_URL 必须以 http(s):// 开头，当前值不合法：{base_url!r}")

    model = _first_non_empty(source, _MODEL_ENV_NAMES) or DEFAULT_MODEL

    raw_timeout = _first_non_empty(source, _TIMEOUT_ENV_NAMES) or str(DEFAULT_TIMEOUT_SECONDS)
    try:
        timeout_seconds = float(raw_timeout)
    except ValueError as exc:
        raise LLMConfigError(f"LLM_TIMEOUT_SECONDS 必须是数字，当前值：{raw_timeout!r}") from exc
    if not 1.0 <= timeout_seconds <= 300.0:
        raise LLMConfigError(f"LLM_TIMEOUT_SECONDS 必须在 1–300 秒之间，当前值：{timeout_seconds}")

    return LLMSettings(
        api_key=api_key,
        base_url=base_url,
        model=model,
        timeout_seconds=timeout_seconds,
    )


def _safe_excerpt(text: str, *, secret: str) -> str:
    """截断上游错误文本并脱敏，避免把 key 回显到响应/日志。"""

    compact = " ".join((text or "").split())
    if secret:
        compact = compact.replace(secret, "***")
    return compact[:MAX_ERROR_EXCERPT]


def _parse_usage(payload: Any) -> dict[str, int] | None:
    if not isinstance(payload, dict):
        return None
    usage: dict[str, int] = {}
    for key in ("prompt_tokens", "completion_tokens", "total_tokens"):
        value = payload.get(key)
        if isinstance(value, int) and value >= 0:
            usage[key] = value
    return usage or None


class LLMClient:
    """最小 OpenAI 兼容客户端；`transport` 仅用于测试（httpx.MockTransport）。"""

    def __init__(
        self,
        settings: LLMSettings,
        *,
        transport: httpx.BaseTransport | None = None,
    ) -> None:
        self._settings = settings
        self._transport = transport

    @classmethod
    def from_env(cls) -> "LLMClient":
        return cls(load_llm_settings())

    @property
    def settings(self) -> LLMSettings:
        return self._settings

    def ping(self, message: str = DEFAULT_PING_MESSAGE) -> LLMPingResult:
        """发送测试语句并返回模型回复；网络/上游错误统一转成 LLM* 异常。"""

        text = message.strip()
        if not text:
            raise LLMConfigError("测试语句不能为空")
        if len(text) > 200:
            raise LLMConfigError("测试语句长度不能超过 200 字")

        settings = self._settings
        payload: dict[str, Any] = {
            "model": settings.model,
            "messages": [{"role": "user", "content": text}],
            "temperature": 0.0,
            "max_tokens": 64,
            "stream": False,
        }
        headers = {
            "Authorization": f"Bearer {settings.api_key}",
            "Content-Type": "application/json",
        }

        started = time.perf_counter()
        try:
            with httpx.Client(
                timeout=httpx.Timeout(settings.timeout_seconds),
                transport=self._transport,
                follow_redirects=True,
            ) as client:
                response = client.post(settings.chat_completions_url, headers=headers, json=payload)
        except httpx.TimeoutException as exc:
            raise LLMTimeoutError(
                f"模型服务超时（>{settings.timeout_seconds:.0f}s），可调大 LLM_TIMEOUT_SECONDS 后重试。"
            ) from exc
        except httpx.HTTPError as exc:
            raise LLMUpstreamError(
                f"无法连接模型服务：{type(exc).__name__}（{_safe_excerpt(str(exc), secret=settings.api_key)}）",
                retryable=True,
            ) from exc
        latency_ms = int((time.perf_counter() - started) * 1000)

        if response.status_code >= 400:
            retryable = response.status_code == 429 or response.status_code >= 500
            excerpt = _safe_excerpt(response.text, secret=settings.api_key)
            raise LLMUpstreamError(
                f"上游返回 HTTP {response.status_code}：{excerpt or '（无响应体）'}",
                upstream_status=response.status_code,
                retryable=retryable,
            )

        try:
            data = response.json()
        except ValueError as exc:
            raise LLMUpstreamError("上游返回的不是合法 JSON", retryable=False) from exc
        if not isinstance(data, dict):
            raise LLMUpstreamError("上游返回 JSON 结构异常（期望对象）", retryable=False)

        choices = data.get("choices")
        content: Any = None
        if isinstance(choices, list) and choices:
            first_choice = choices[0]
            if isinstance(first_choice, dict):
                message_payload = first_choice.get("message")
                if isinstance(message_payload, dict):
                    content = message_payload.get("content")
        if not isinstance(content, str) or not content.strip():
            raise LLMUpstreamError("上游返回缺少 choices[0].message.content", retryable=False)

        reply = content.strip()
        if len(reply) > MAX_REPLY_LENGTH:
            reply = reply[:MAX_REPLY_LENGTH] + "…"

        model = data.get("model")
        return LLMPingResult(
            reply=reply,
            model=str(model) if isinstance(model, str) and model else settings.model,
            latency_ms=latency_ms,
            usage=_parse_usage(data.get("usage")),
        )
