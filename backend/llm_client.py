"""LLM Client（V1.0.1 / TC-10 连通性探测；V1.0.5 高可用降级补丁）。

职责：
- 从环境变量 / `backend/.env` 读取 ModelScope（OpenAI 兼容）推理服务的 key、base URL、
  主模型名与备用模型名（`MODELSCOPE_FALLBACK_MODEL`）；
- 提供一个最小的同步 `ping()`：发送一句测试话（默认「请回复 OK」），返回模型真实回复与耗时；
- 提供 Agent 循环使用的 `chat()`：**主模型优先，遇到 429 / 502 / 504 / 超时自动降级到备用
  （轻量）模型重试一次**，并在结果里用 `model_used` 标明最终完成回答的模型；
- 统一把配置错误 / 超时 / 上游 HTTP 错误映射成可被 `errors.ApiError` 消费的异常。

安全约定：
- **密钥只经环境变量 / `.env` 传入**，不写日志、不入库、不出现在响应里；
- 响应只返回模型名、回复、耗时与 token 用量；base URL 仅用于构造请求；
- 上游错误信息会截断并做一次 key 脱敏，避免反向代理回显请求头；
- **禁止自动跟随重定向**（P1-5）：任何 3xx 都按上游错误处理，防止 Authorization 头被带到
  非预期主机。

本模块不依赖 FastAPI，可被 `backend/scripts/spike_llm.py` 单独调用。
应用入口是 `routers/agent.py` 的 `GET /api/agent/ping_llm`。
"""

from __future__ import annotations

import logging
import os
import time
from collections.abc import Mapping
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import httpx

logger = logging.getLogger("histolink.llm")

BACKEND_DIR = Path(__file__).resolve().parent
PROJECT_ROOT = BACKEND_DIR.parent

#: ModelScope 推理服务默认地址（OpenAI 兼容，实际请求 <base>/chat/completions）。
DEFAULT_BASE_URL = "https://api-inference.modelscope.cn/v1"
#: 默认模型（TC-10 实测可用：Qwen/Qwen3.5-35B-A3B）。
DEFAULT_MODEL = "Qwen/Qwen3.5-35B-A3B"
#: 默认备用模型（V1.0.5 高可用补丁）：主模型被限流 / 网关错误 / 超时时自动降级重试。
DEFAULT_FALLBACK_MODEL = "Qwen/Qwen3.5-8B-Instruct"
#: 触发「切换备用模型重试」的上游 HTTP 状态码：429 限流、502/504 网关错误。
#: 其余 4xx（鉴权 / 参数错误）与 500/503 不降级：换模型也不会好，直接按原错误抛给 API 层。
FALLBACK_UPSTREAM_STATUSES = frozenset({429, 502, 504})
DEFAULT_TIMEOUT_SECONDS = 30.0
DEFAULT_PING_MESSAGE = "请回复 OK"
MAX_REPLY_LENGTH = 2000
MAX_ERROR_EXCERPT = 200
#: Agent 对话（chat）参数上限。
MAX_CHAT_MESSAGES = 40
MAX_CHAT_MESSAGE_CHARS = 20000
MAX_CHAT_TOKENS = 8192
MAX_CHAT_CONTENT_CHARS = 40000

#: 环境变量别名（按顺序取第一个非空值）；主推 MODELSCOPE_*，兼容常见 LLM_* / OPENAI_*。
_API_KEY_ENV_NAMES = ("MODELSCOPE_API_KEY", "MODELSCOPE_KEY", "LLM_API_KEY", "OPENAI_API_KEY")
_BASE_URL_ENV_NAMES = ("MODELSCOPE_BASE_URL", "MODELSCOPE_URL", "LLM_BASE_URL", "OPENAI_BASE_URL")
_MODEL_ENV_NAMES = ("MODELSCOPE_MODEL", "LLM_MODEL", "OPENAI_MODEL")
_FALLBACK_MODEL_ENV_NAMES = ("MODELSCOPE_FALLBACK_MODEL", "LLM_FALLBACK_MODEL")
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
    """一次调用所需的配置（不可变，避免请求间串改）。

    `fallback_model` 为 V1.0.5 高可用补丁新增：主模型失败时自动切换的备用（轻量）模型；
    为 `None` 表示不降级（例如主备配置成同一个模型名，重试没有意义）。
    """

    api_key: str
    base_url: str
    model: str
    timeout_seconds: float
    fallback_model: str | None = None

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


@dataclass(frozen=True)
class LLMChatResult:
    """一次 chat completion 的原始回复（V1.0.3 Agent 循环使用）。

    - `model`：沿用上游响应里的 `model` 字段（没有则回填实际请求的模型名）；
    - `model_used`：V1.0.5 高可用补丁新增，**实际发起并通过请求的模型名**（主模型或备用模型），
      用于 `trace.model_used` 与前端「已切换轻量模型」提示。
    """

    content: str
    model: str
    latency_ms: int
    usage: dict[str, int] | None = None
    model_used: str | None = None


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

    # V1.0.5 高可用补丁：备用模型默认 Qwen/Qwen3.5-8B-Instruct（轻量、额度更宽松）。
    fallback_model: str | None = (
        _first_non_empty(source, _FALLBACK_MODEL_ENV_NAMES) or DEFAULT_FALLBACK_MODEL
    )
    if fallback_model == model:
        # 主备同名：没有可切换的模型，禁用降级，避免对同一个已限流模型重复请求。
        fallback_model = None

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
        fallback_model=fallback_model,
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
    def from_env(cls) -> LLMClient:
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
        data, latency_ms = self._post_chat(payload)
        reply = _extract_content(data).strip()
        if len(reply) > MAX_REPLY_LENGTH:
            reply = reply[:MAX_REPLY_LENGTH] + "…"
        return LLMPingResult(
            reply=reply,
            model=_extract_model(data, settings.model),
            latency_ms=latency_ms,
            usage=_parse_usage(data.get("usage")),
        )

    def chat(
        self,
        messages: list[dict[str, str]],
        *,
        temperature: float = 0.0,
        max_tokens: int = 2048,
        response_format: dict[str, Any] | None = None,
        enable_thinking: bool = False,
        timeout_seconds: float | None = None,
    ) -> LLMChatResult:
        """OpenAI 兼容 chat completion（V1.0.3 Agent 使用；V1.0.5 高可用降级）。

        - 默认 **`enable_thinking=False`**：spike 实测思考模式会消耗大量 reasoning tokens
          且 `max_tokens` 不约束它们，必须显式关闭以追求极速响应；
        - `response_format={"type":"json_object"}` 由 Orchestrator 按需传入；
        - **自动降级**：主模型（`settings.model`）遇到 HTTP 429 / 502 / 504 或超时（含连接超时）
          时记录 warning，并自动用备用模型（`settings.fallback_model`）重试**一次**；
          备用模型仍失败则抛出带「已降级重试」上下文的 `LLM_TIMEOUT` / `LLM_UPSTREAM_ERROR`；
        - 其它错误（401、400、302、500/503 等）不降级：换模型也不会修好，按原错误上抛；
        - 超时 / 上游错误沿用与 `ping()` 相同的异常映射；
        - 结果里的 `model_used` 标明最终完成本次回答的模型（主模型或备用模型）。
        """

        normalized = _normalize_messages(messages)
        if not 0.0 <= temperature <= 2.0:
            raise LLMConfigError("temperature 必须在 0–2 之间")
        if not 1 <= max_tokens <= MAX_CHAT_TOKENS:
            raise LLMConfigError(f"max_tokens 必须在 1–{MAX_CHAT_TOKENS} 之间")
        if not isinstance(enable_thinking, bool):
            raise LLMConfigError("enable_thinking 必须是布尔值")
        if response_format is not None and (
            not isinstance(response_format, dict)
            or response_format.get("type") != "json_object"
        ):
            raise LLMConfigError('response_format 目前只支持 {"type": "json_object"}')
        if timeout_seconds is not None and not 1.0 <= timeout_seconds <= 300.0:
            raise LLMConfigError("timeout_seconds 必须在 1–300 秒之间")

        settings = self._settings
        payload: dict[str, Any] = {
            "model": settings.model,
            "messages": normalized,
            "temperature": temperature,
            "max_tokens": max_tokens,
            "stream": False,
            # spike 结论：顶层 enable_thinking 才生效；不要放进 extra_body。
            "enable_thinking": enable_thinking,
        }
        if response_format is not None:
            payload["response_format"] = response_format

        data, latency_ms, model_used = self._post_chat_with_fallback(
            payload, timeout_seconds=timeout_seconds
        )
        content = _extract_content(data)
        if len(content) > MAX_CHAT_CONTENT_CHARS:
            content = content[:MAX_CHAT_CONTENT_CHARS] + "…"
        return LLMChatResult(
            content=content,
            model=_extract_model(data, model_used),
            latency_ms=latency_ms,
            usage=_parse_usage(data.get("usage")),
            model_used=model_used,
        )

    def _post_chat_with_fallback(
        self, payload: dict[str, Any], *, timeout_seconds: float | None = None
    ) -> tuple[dict[str, Any], int, str]:
        """主模型优先；命中降级条件时切备用模型重试一次。返回 (data, latency_ms, model_used)。"""

        settings = self._settings
        primary = settings.model
        try:
            data, latency_ms = self._post_chat(payload, timeout_seconds=timeout_seconds)
            return data, latency_ms, primary
        except (LLMTimeoutError, LLMUpstreamError) as exc:
            fallback = settings.fallback_model
            if fallback is None or not _should_fallback(exc):
                raise
            # 注意：except 块结束后 `exc` 会被删除，先把脱敏摘要存下来。
            primary_error_text = _safe_excerpt(str(exc), secret=settings.api_key)

        logger.warning(
            "主模型 %s 调用失败（%s），自动切换备用模型 %s 重试一次",
            primary,
            primary_error_text,
            fallback,
        )
        fallback_payload = {**payload, "model": fallback}
        try:
            data, latency_ms = self._post_chat(
                fallback_payload, timeout_seconds=timeout_seconds
            )
        except (LLMTimeoutError, LLMUpstreamError) as fallback_exc:
            logger.warning(
                "备用模型 %s 重试仍失败（%s）",
                fallback,
                _safe_excerpt(str(fallback_exc), secret=settings.api_key),
            )
            raise _decorate_fallback_error(
                fallback_exc, primary=primary, fallback=fallback
            ) from fallback_exc
        logger.info("备用模型 %s 已接管本次回答（主模型降级）", fallback)
        return data, latency_ms, fallback

    # ------------------------------------------------------------------
    # HTTP 公共路径
    # ------------------------------------------------------------------
    def _post_chat(
        self, payload: dict[str, Any], *, timeout_seconds: float | None = None
    ) -> tuple[dict[str, Any], int]:
        settings = self._settings
        timeout = timeout_seconds if timeout_seconds is not None else settings.timeout_seconds
        headers = {
            "Authorization": f"Bearer {settings.api_key}",
            "Content-Type": "application/json",
        }

        started = time.perf_counter()
        try:
            with httpx.Client(
                timeout=httpx.Timeout(timeout),
                transport=self._transport,
                # P1-5：禁止自动跟随重定向。模型服务被错误配置 / 劫持时，
                # 跟随 3xx 会把 Authorization 头带到攻击者指定的地址。
                follow_redirects=False,
            ) as client:
                response = client.post(
                    settings.chat_completions_url, headers=headers, json=payload
                )
        except httpx.TimeoutException as exc:
            raise LLMTimeoutError(
                f"模型服务超时（>{timeout:.0f}s），可调大 LLM_TIMEOUT_SECONDS 后重试。"
            ) from exc
        except httpx.HTTPError as exc:
            raise LLMUpstreamError(
                f"无法连接模型服务：{type(exc).__name__}（{_safe_excerpt(str(exc), secret=settings.api_key)}）",
                retryable=True,
            ) from exc
        latency_ms = int((time.perf_counter() - started) * 1000)

        if 300 <= response.status_code < 400:
            raise LLMUpstreamError(
                "模型服务返回重定向 HTTP "
                f"{response.status_code}（出于安全已禁用自动跟随，请检查 MODELSCOPE_BASE_URL）",
                upstream_status=response.status_code,
                retryable=False,
            )
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
        return data, latency_ms


def _should_fallback(exc: LLMTimeoutError | LLMUpstreamError) -> bool:
    """判断异常是否属于「换备用模型可能成功」的瞬时故障。"""

    if isinstance(exc, LLMTimeoutError):
        return True
    return exc.upstream_status in FALLBACK_UPSTREAM_STATUSES


def _decorate_fallback_error(
    exc: LLMTimeoutError | LLMUpstreamError, *, primary: str, fallback: str
) -> LLMTimeoutError | LLMUpstreamError:
    """给「备用模型也失败」的异常补上降级上下文，便于 API 层 / 日志定位。"""

    message = (
        f"{exc}（主模型 {primary} 失败后已自动降级到备用模型 {fallback} 重试，仍失败）"
    )
    if isinstance(exc, LLMTimeoutError):
        return LLMTimeoutError(message)
    return LLMUpstreamError(
        message, upstream_status=exc.upstream_status, retryable=exc.retryable
    )


def _extract_content(data: Mapping[str, Any]) -> str:
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
    return content


def _extract_model(data: Mapping[str, Any], fallback: str) -> str:
    model = data.get("model")
    return str(model) if isinstance(model, str) and model else fallback


def _normalize_messages(messages: Any) -> list[dict[str, str]]:
    if not isinstance(messages, (list, tuple)) or not messages:
        raise LLMConfigError("messages 不能为空")
    if len(messages) > MAX_CHAT_MESSAGES:
        raise LLMConfigError(f"messages 最多 {MAX_CHAT_MESSAGES} 条")
    normalized: list[dict[str, str]] = []
    for index, message in enumerate(messages):
        if not isinstance(message, Mapping):
            raise LLMConfigError(f"messages[{index}] 必须是对象")
        role = message.get("role")
        content = message.get("content")
        if role not in {"system", "user", "assistant"}:
            raise LLMConfigError(f"messages[{index}].role 必须是 system/user/assistant")
        if not isinstance(content, str) or not content.strip():
            raise LLMConfigError(f"messages[{index}].content 不能为空")
        if len(content) > MAX_CHAT_MESSAGE_CHARS:
            raise LLMConfigError(f"messages[{index}].content 超过 {MAX_CHAT_MESSAGE_CHARS} 字")
        normalized.append({"role": role, "content": content})
    return normalized
