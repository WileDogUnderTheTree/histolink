"""LLM chat() 单测（V1.0.3）：enable_thinking=False + JSON 模式 + 参数校验。

V1.0.5 高可用补丁追加：主模型 429 / 502 / 504 / 超时 → 自动切换备用模型重试一次，
`model_used` 记录最终模型；备用模型也失败时才上抛。

全部离线（httpx.MockTransport），不访问网络。
"""

from __future__ import annotations

import json
import logging

import httpx
import pytest

from llm_client import (
    LLMClient,
    LLMConfigError,
    LLMSettings,
    LLMTimeoutError,
    LLMUpstreamError,
)

API_KEY = "sk-test-secret-value"
PRIMARY_MODEL = "Qwen/Qwen3.5-35B-A3B"
FALLBACK_MODEL = "Qwen/Qwen3.5-8B-Instruct"
SETTINGS = LLMSettings(
    api_key=API_KEY,
    base_url="https://example.test/v1",
    model=PRIMARY_MODEL,
    timeout_seconds=5.0,
    fallback_model=FALLBACK_MODEL,
)
MESSAGES = [
    {"role": "system", "content": "system prompt"},
    {"role": "user", "content": "赤壁之战发生在哪一年？"},
]


def make_client(handler) -> LLMClient:
    return LLMClient(SETTINGS, transport=httpx.MockTransport(handler))


def test_chat_sends_enable_thinking_false_and_json_mode() -> None:
    captured: dict[str, object] = {}

    def handler(request: httpx.Request) -> httpx.Response:
        payload = json.loads(request.content)
        captured.update(payload)
        assert request.headers["authorization"] == f"Bearer {API_KEY}"
        assert payload["messages"] == MESSAGES
        assert payload["stream"] is False
        assert payload["enable_thinking"] is False
        assert payload["response_format"] == {"type": "json_object"}
        assert payload["temperature"] == 0.0
        assert payload["max_tokens"] == 2048
        return httpx.Response(
            200,
            json={
                "model": "Qwen/Qwen3.5-35B-A3B",
                "choices": [{"message": {"role": "assistant", "content": '{"action":"final"}'}}],
                "usage": {"prompt_tokens": 20, "completion_tokens": 8, "total_tokens": 28},
            },
        )

    result = make_client(handler).chat(
        MESSAGES, response_format={"type": "json_object"}
    )
    assert result.content == '{"action":"final"}'
    assert result.model == "Qwen/Qwen3.5-35B-A3B"
    assert result.model_used == PRIMARY_MODEL
    assert result.latency_ms >= 0
    assert result.usage == {"prompt_tokens": 20, "completion_tokens": 8, "total_tokens": 28}
    assert captured["enable_thinking"] is False


def test_chat_enable_thinking_can_be_enabled() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        payload = json.loads(request.content)
        assert payload["enable_thinking"] is True
        return httpx.Response(200, json={"choices": [{"message": {"content": "OK"}}]})

    assert make_client(handler).chat(MESSAGES, enable_thinking=True).content == "OK"


def test_chat_supports_custom_timeout() -> None:
    seen: dict[str, object] = {}

    def handler(request: httpx.Request) -> httpx.Response:
        seen["timeout"] = request.extensions.get("timeout")
        return httpx.Response(200, json={"choices": [{"message": {"content": "OK"}}]})

    make_client(handler).chat(MESSAGES, timeout_seconds=12.0)
    assert seen["timeout"]


@pytest.mark.parametrize(
    "messages",
    [
        [],
        [{"role": "user", "content": "  "}],
        [{"role": "tool", "content": "x"}],
        [{"role": "user", "content": 123}],  # type: ignore[list-item]
    ],
)
def test_chat_rejects_invalid_messages(messages) -> None:
    with pytest.raises(LLMConfigError):
        make_client(lambda _request: httpx.Response(200)).chat(messages)


def test_chat_rejects_too_many_messages() -> None:
    messages = [{"role": "user", "content": "x"} for _ in range(41)]
    with pytest.raises(LLMConfigError):
        make_client(lambda _request: httpx.Response(200)).chat(messages)


def test_chat_rejects_overlong_message() -> None:
    with pytest.raises(LLMConfigError):
        make_client(lambda _request: httpx.Response(200)).chat(
            [{"role": "user", "content": "x" * 20001}]
        )


@pytest.mark.parametrize(
    ("kwargs", "match"),
    [
        ({"temperature": 3.0}, "temperature"),
        ({"max_tokens": 0}, "max_tokens"),
        ({"max_tokens": 9000}, "max_tokens"),
        ({"response_format": {"type": "text"}}, "response_format"),
        ({"enable_thinking": "no"}, "enable_thinking"),
        ({"timeout_seconds": 0}, "timeout_seconds"),
    ],
)
def test_chat_rejects_invalid_options(kwargs: dict, match: str) -> None:
    with pytest.raises(LLMConfigError, match=match):
        make_client(lambda _request: httpx.Response(200)).chat(MESSAGES, **kwargs)


def test_chat_timeout() -> None:
    def handler(_request: httpx.Request) -> httpx.Response:
        raise httpx.TimeoutException("timed out")

    with pytest.raises(LLMTimeoutError, match="超时"):
        make_client(handler).chat(MESSAGES)


def test_chat_upstream_error_redacts_key() -> None:
    def handler(_request: httpx.Request) -> httpx.Response:
        return httpx.Response(401, text=f"invalid token: {API_KEY}")

    with pytest.raises(LLMUpstreamError) as exc_info:
        make_client(handler).chat(MESSAGES)
    assert exc_info.value.upstream_status == 401
    assert API_KEY not in str(exc_info.value)


def test_chat_missing_content_raises() -> None:
    def handler(_request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, json={"choices": [{"message": {"role": "assistant"}}]})

    with pytest.raises(LLMUpstreamError, match="content"):
        make_client(handler).chat(MESSAGES)


def test_chat_does_not_follow_redirects() -> None:
    """P1-5：禁止自动跟随 3xx，避免 Authorization 头被带到非预期主机。"""

    seen: list[str] = []

    def handler(request: httpx.Request) -> httpx.Response:
        seen.append(str(request.url))
        return httpx.Response(
            302,
            headers={"Location": "https://evil.test/steal"},
            text="redirecting",
        )

    with pytest.raises(LLMUpstreamError) as exc_info:
        make_client(handler).chat(MESSAGES)

    assert exc_info.value.upstream_status == 302
    assert "重定向" in str(exc_info.value)
    # 只发出一次请求，没有跟随到 Location。
    assert seen == ["https://example.test/v1/chat/completions"]


# ---------------------------------------------------------------------------
# V1.0.5 高可用补丁：自动降级到备用模型
# ---------------------------------------------------------------------------


def _fallback_success(model: str = FALLBACK_MODEL, content: str = '{"action":"final"}') -> httpx.Response:
    return httpx.Response(
        200,
        json={"model": model, "choices": [{"message": {"content": content}}]},
    )


@pytest.mark.parametrize("status", [429, 502, 504])
def test_chat_falls_back_on_transient_upstream_status(status: int, caplog) -> None:
    """429 限流 / 502、504 网关错误：首次请求用主模型，自动重试换成备用模型。"""

    models: list[str] = []

    def handler(request: httpx.Request) -> httpx.Response:
        models.append(json.loads(request.content)["model"])
        if len(models) == 1:
            return httpx.Response(status, text="overloaded", request=request)
        return _fallback_success()

    with caplog.at_level(logging.WARNING, logger="histolink.llm"):
        result = make_client(handler).chat(
            MESSAGES, response_format={"type": "json_object"}
        )

    assert models == [PRIMARY_MODEL, FALLBACK_MODEL]
    assert result.model_used == FALLBACK_MODEL
    assert result.model == FALLBACK_MODEL
    assert result.content == '{"action":"final"}'
    assert any(
        "降级" in record.message or "备用模型" in record.message
        for record in caplog.records
    )


def test_chat_falls_back_on_timeout(caplog) -> None:
    models: list[str] = []

    def handler(request: httpx.Request) -> httpx.Response:
        models.append(json.loads(request.content)["model"])
        if len(models) == 1:
            raise httpx.TimeoutException("timed out")
        return _fallback_success()

    with caplog.at_level(logging.WARNING, logger="histolink.llm"):
        result = make_client(handler).chat(MESSAGES)

    assert models == [PRIMARY_MODEL, FALLBACK_MODEL]
    assert result.model_used == FALLBACK_MODEL
    assert any("超时" in record.message for record in caplog.records)


@pytest.mark.parametrize("status", [400, 401, 500, 503])
def test_chat_does_not_fall_back_on_non_transient_errors(status: int) -> None:
    """鉴权 / 参数错误 / 500 / 503 不降级：换模型也不会修好，保持原有错误语义。"""

    models: list[str] = []

    def handler(request: httpx.Request) -> httpx.Response:
        models.append(json.loads(request.content)["model"])
        return httpx.Response(status, text="boom", request=request)

    with pytest.raises(LLMUpstreamError) as exc_info:
        make_client(handler).chat(MESSAGES)

    assert models == [PRIMARY_MODEL]
    assert exc_info.value.upstream_status == status


def test_chat_raises_when_fallback_also_fails(caplog) -> None:
    """备用模型也失败 → 抛出 LLM_UPSTREAM_ERROR，并带上降级上下文（只重试一次）。"""

    models: list[str] = []

    def handler(request: httpx.Request) -> httpx.Response:
        models.append(json.loads(request.content)["model"])
        status = 429 if len(models) == 1 else 502
        return httpx.Response(status, text="overloaded", request=request)

    with (
        caplog.at_level(logging.WARNING, logger="histolink.llm"),
        pytest.raises(LLMUpstreamError) as exc_info,
    ):
        make_client(handler).chat(MESSAGES)
    assert models == [PRIMARY_MODEL, FALLBACK_MODEL]
    error = exc_info.value
    assert error.upstream_status == 502
    assert FALLBACK_MODEL in str(error)
    assert "仍失败" in str(error)
    assert len(caplog.records) >= 2


def test_chat_raises_timeout_when_fallback_also_times_out() -> None:
    def handler(_request: httpx.Request) -> httpx.Response:
        raise httpx.TimeoutException("timed out")

    with pytest.raises(LLMTimeoutError) as exc_info:
        make_client(handler).chat(MESSAGES)

    assert FALLBACK_MODEL in str(exc_info.value)
    assert "仍失败" in str(exc_info.value)


def test_chat_without_fallback_model_reraises_primary_error() -> None:
    """未配置备用模型（fallback_model=None）时保持 V1.0.3 行为：不重试、原样上抛。"""

    settings = LLMSettings(
        api_key=API_KEY,
        base_url="https://example.test/v1",
        model=PRIMARY_MODEL,
        timeout_seconds=5.0,
    )
    models: list[str] = []

    def handler(request: httpx.Request) -> httpx.Response:
        models.append(json.loads(request.content)["model"])
        return httpx.Response(429, text="busy", request=request)

    with pytest.raises(LLMUpstreamError) as exc_info:
        LLMClient(settings, transport=httpx.MockTransport(handler)).chat(MESSAGES)

    assert models == [PRIMARY_MODEL]
    assert exc_info.value.upstream_status == 429
    assert "备用模型" not in str(exc_info.value)
