"""LLM chat() 单测（V1.0.3）：enable_thinking=False + JSON 模式 + 参数校验。

全部离线（httpx.MockTransport），不访问网络。
"""

from __future__ import annotations

import json

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
SETTINGS = LLMSettings(
    api_key=API_KEY,
    base_url="https://example.test/v1",
    model="Qwen/Qwen3.5-35B-A3B",
    timeout_seconds=5.0,
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
