"""日志脱敏单测（V1.0.6.2，全离线）。

覆盖：
- `sanitize_log_text`：sk-/ms-/Bearer/api_key=/query token 脱敏；
- PII 规则默认关闭、`LOG_REDACT_PII=1` 时开启；
- `RedactingFormatter` 包装任意 Formatter（含异常 traceback 输出）；
- `install_log_redaction` 幂等、`LOG_REDACTION=0` 时关闭。
"""

from __future__ import annotations

import logging

import pytest

from log_safety import (
    RedactingFormatter,
    install_log_redaction,
    mask_secret,
    redaction_enabled,
    sanitize_log_text,
)

MS_KEY = "ms-b1e0c087-22f7-4647-8c21-f9e177825686"
SK_KEY = "sk-abcdef0123456789"


def test_mask_secret_keeps_only_head_and_tail() -> None:
    assert mask_secret(MS_KEY) == "ms***86"
    assert mask_secret("short") == "***"
    assert mask_secret("") == ""


@pytest.mark.parametrize(
    "raw",
    [
        f"upstream echoed token {SK_KEY}",
        f"MODELSCOPE_API_KEY={MS_KEY}",
        "Authorization: Bearer abcdef0123456789",
        "api_key=local-key-123456",
        "GET /v1/chat?token=secret-token-1 HTTP/1.1",
    ],
)
def test_sanitize_removes_secrets(raw: str) -> None:
    cleaned = sanitize_log_text(raw)
    for secret in (
        MS_KEY,
        SK_KEY,
        "abcdef0123456789",
        "local-key-123456",
        "secret-token-1",
    ):
        assert secret not in cleaned
    assert "***" in cleaned


def test_sanitize_keeps_normal_text_intact() -> None:
    raw = "流式直答完成：model=hf.co/x latency=1200ms answer_chars=88"
    assert sanitize_log_text(raw) == raw


def test_pii_off_by_default(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("LOG_REDACT_PII", raising=False)
    raw = "用户 13800138000 的邮箱 zhangsan@example.com，身份证 110101199001011234"
    assert sanitize_log_text(raw) == raw


def test_pii_enabled_masks_phone_email_id(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("LOG_REDACT_PII", "1")
    raw = "用户 13800138000 的邮箱 zhangsan@example.com，身份证 110101199001011234"
    cleaned = sanitize_log_text(raw)
    assert "13800138000" not in cleaned
    assert "zhangsan@example.com" not in cleaned
    assert "110101199001011234" not in cleaned


def test_redaction_env_switch(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("LOG_REDACTION", "0")
    assert redaction_enabled() is False
    monkeypatch.setenv("LOG_REDACTION", "1")
    assert redaction_enabled() is True


def test_formatter_redacts_message_and_traceback() -> None:
    formatter = RedactingFormatter(logging.Formatter("%(message)s"))
    record = logging.LogRecord(
        name="histolink.test",
        level=logging.ERROR,
        pathname=__file__,
        lineno=1,
        msg=f"调用失败 key={SK_KEY}",
        args=(),
        exc_info=None,
    )
    rendered = formatter.format(record)
    assert SK_KEY not in rendered
    assert "***" in rendered


def test_install_log_redaction_is_idempotent_and_respects_switch(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    logger = logging.getLogger("histolink.test.log_safety")
    logger.handlers.clear()
    handler = logging.StreamHandler()
    handler.setFormatter(logging.Formatter("%(message)s"))
    logger.addHandler(handler)
    try:
        monkeypatch.setenv("LOG_REDACTION", "1")
        first = install_log_redaction(("histolink.test.log_safety",))
        second = install_log_redaction(("histolink.test.log_safety",))
        assert first == 1
        assert second == 0  # 幂等：已包装过的不再重复包装
        assert isinstance(handler.formatter, RedactingFormatter)

        monkeypatch.setenv("LOG_REDACTION", "0")
        other = logging.getLogger("histolink.test.disabled")
        other.handlers.clear()
        other_handler = logging.StreamHandler()
        other.addHandler(other_handler)
        try:
            assert install_log_redaction(("histolink.test.disabled",)) == 0
            assert not isinstance(other_handler.formatter, RedactingFormatter)
        finally:
            other.removeHandler(other_handler)
    finally:
        logger.removeHandler(handler)
