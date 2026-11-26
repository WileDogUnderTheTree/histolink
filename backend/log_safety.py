"""日志脱敏（V1.0.6.2 · 用户隐私保护）。

职责
----
- `mask_secret`：配置自检 / 测试脚本里展示密钥时只保留首尾各 2 位；
- `sanitize_log_text`：把日志文本里的 API Key / Bearer token / （可选）邮箱、手机号、
  身份证号替换成掩码；
- `RedactingFormatter`：包装任意 `logging.Formatter`，在**最终格式化输出**（含异常
  traceback）上统一脱敏，避免异常信息里意外带出上游回显的密钥或用户数据；
- `install_log_redaction`：幂等地给 root / uvicorn / 业务 logger 的 handler 套上脱敏
  Formatter。`main.py` 启动时调用一次即可。

环境变量
--------
- `LOG_REDACTION`：``0`` / ``false`` 关闭（默认开启）；
- `LOG_REDACT_PII`：``1`` 时额外脱敏邮箱 / 手机号 / 身份证号（默认关闭；
  开启后排查问题会丢失部分上下文，按需开启）。

设计说明
--------
- 只作用于**日志**，不改变 API 响应 / 会话存储里的正文（回答内容需要原样展示）；
- 用 Formatter 而不是 `logging.Filter`：Filter 看不到 traceback 的格式化结果，
  也容易遗漏 `record.args` 的延迟格式化；包装 Formatter 是覆盖面最稳的一层；
- 幂等：重复调用不会重复包装（`_histolink_redacting` 标记）。
"""

from __future__ import annotations

import logging
import os
import re
from typing import Final

__all__ = [
    "RedactingFormatter",
    "install_log_redaction",
    "mask_secret",
    "redaction_enabled",
    "sanitize_log_text",
]

#: 固定脱敏规则：常见密钥形态 / 请求头 / query 参数。顺序靠前的先替换。
_SECRET_PATTERNS: Final[tuple[re.Pattern[str], ...]] = (
    # sk-xxx（OpenAI / ModelScope 等常见前缀）
    re.compile(r"\bsk-[A-Za-z0-9][A-Za-z0-9_\-]{4,}"),
    # ms-xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx（ModelScope key）
    re.compile(
        r"\bms-[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-"
        r"[0-9a-fA-F]{4}-[0-9a-fA-F]{12}\b"
    ),
    # Bearer <token>
    re.compile(r"(?i)\b(bearer)\s+[A-Za-z0-9._\-]{6,}"),
    # api_key=xxx / token: xxx / password="xxx"
    re.compile(
        r"(?i)\b(api[_-]?key|token|secret|password)\b(\s*[:=]\s*)"
        r"(['\"]?)([^\s'\",;]{4,})"
    ),
    # query 参数 ?api_key=xxx&token=xxx
    re.compile(r"(?i)([?&](?:api[_-]?key|token|key|access_token)=)([^&\s]+)"),
)

#: 可选 PII 规则（LOG_REDACT_PII=1 时启用）：邮箱 / 中国大陆手机号 / 18 位身份证号。
_PII_PATTERNS: Final[tuple[re.Pattern[str], ...]] = (
    re.compile(r"\b[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}\b"),
    re.compile(r"(?<!\d)1[3-9]\d{9}(?!\d)"),
    re.compile(r"(?<!\d)\d{17}[\dXx](?!\d)"),
)

#: 掩码占位符（日志里一眼能看出「这里被脱敏了」）。
_MASK: Final[str] = "***"


def _env_enabled(*names: str, default: bool) -> bool:
    for name in names:
        raw = os.environ.get(name)
        if raw is None:
            continue
        return raw.strip().lower() not in {"0", "false", "no", "off", ""}
    return default


def redaction_enabled() -> bool:
    """当前是否启用日志脱敏（`LOG_REDACTION`，默认开启）。"""

    return _env_enabled("LOG_REDACTION", default=True)


def pii_redaction_enabled() -> bool:
    """是否额外启用 PII 脱敏（`LOG_REDACT_PII`，默认关闭）。"""

    return _env_enabled("LOG_REDACT_PII", default=False)


def mask_secret(value: str, *, keep: int = 2) -> str:
    """密钥展示用掩码：只保留首尾各 ``keep`` 位；过短则全部打码。"""

    if not isinstance(value, str) or not value:
        return ""
    if len(value) <= keep * 2 + 2:
        return _MASK
    return f"{value[:keep]}{_MASK}{value[-keep:]}"


def _mask_token(match: re.Match[str]) -> str:
    """保持「前缀+分隔符」，只把值打码，便于日志定位是哪类配置问题。"""

    if match.re.groups >= 4:
        prefix = "".join(group or "" for group in match.groups()[:3])
        return f"{prefix}{_MASK}"
    if match.re.groups >= 2:
        return f"{match.group(1)}{_MASK}"
    return _MASK


def sanitize_log_text(text: str) -> str:
    """把一段日志文本里的敏感信息替换为掩码；非字符串原样返回空串。"""

    if not isinstance(text, str) or not text:
        return text
    cleaned = text
    for pattern in _SECRET_PATTERNS:
        cleaned = pattern.sub(_mask_token, cleaned)
    if pii_redaction_enabled():
        for pattern in _PII_PATTERNS:
            cleaned = pattern.sub(_MASK, cleaned)
    return cleaned


class RedactingFormatter(logging.Formatter):
    """在最终日志输出（含异常 traceback）上做脱敏的 Formatter 包装。"""

    def __init__(self, inner: logging.Formatter | None = None) -> None:
        super().__init__()
        self._inner = inner

    def format(self, record: logging.LogRecord) -> str:
        text = (
            self._inner.format(record)
            if self._inner is not None
            else super().format(record)
        )
        return sanitize_log_text(text)

    def formatException(self, ei) -> str:  # type: ignore[no-untyped-def]
        return sanitize_log_text(super().formatException(ei))


#: 默认需要包裹的 logger 名：root + uvicorn 三件套 + 业务 logger 前缀。
_DEFAULT_LOGGER_NAMES: Final[tuple[str, ...]] = (
    "",
    "uvicorn",
    "uvicorn.error",
    "uvicorn.access",
    "histolink",
)


def install_log_redaction(
    logger_names: tuple[str, ...] = _DEFAULT_LOGGER_NAMES,
) -> int:
    """给目标的 handler 套上脱敏 Formatter（幂等）；返回本次新包装的 handler 数。

    - `LOG_REDACTION=0` 时直接返回 0，不做任何修改；
    - 只处理**当前已存在**的 handler；uvicorn 在导入 app 之前就配置好 logging，
      所以 `main.py` 模块级调用可以覆盖到访问日志。
    """

    if not redaction_enabled():
        return 0
    installed = 0
    for name in logger_names:
        logger = logging.getLogger(name)
        for handler in list(logger.handlers):
            if getattr(handler, "_histolink_redacting", False):
                continue
            handler.setFormatter(RedactingFormatter(handler.formatter))
            handler._histolink_redacting = True  # type: ignore[attr-defined]
            installed += 1
    return installed
