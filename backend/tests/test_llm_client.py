"""LLM Client 单测（V1.0.1 / TC-10，全部离线，使用 httpx.MockTransport）。

覆盖：环境变量解析 / 别名 / 默认值、成功响应、超时、上游 401/429/5xx、
非法 JSON、缺少 content、错误信息脱敏、完整 endpoint 写法。
"""

from __future__ import annotations

import json

import httpx
import pytest

from llm_client import (
    DEFAULT_BASE_URL,
    DEFAULT_FALLBACK_MODEL,
    DEFAULT_MODEL,
    LLMClient,
    LLMConfigError,
    LLMSettings,
    LLMTimeoutError,
    LLMUpstreamError,
    load_llm_settings,
)

API_KEY = "sk-test-secret-value"

SETTINGS = LLMSettings(
    api_key=API_KEY,
    base_url="https://example.test/v1",
    model="Qwen/Qwen3.5-35B-A3B",
    timeout_seconds=5.0,
)


def make_client(handler) -> LLMClient:
    return LLMClient(SETTINGS, transport=httpx.MockTransport(handler))


def ok_handler(request: httpx.Request) -> httpx.Response:
    assert str(request.url) == "https://example.test/v1/chat/completions"
    assert request.headers["authorization"] == f"Bearer {API_KEY}"
    payload = json.loads(request.content)
    assert payload["model"] == "Qwen/Qwen3.5-35B-A3B"
    assert payload["messages"][0]["content"] == "请回复 OK"
    assert payload["stream"] is False
    return httpx.Response(
        200,
        json={
            "model": "Qwen/Qwen3.5-35B-A3B",
            "choices": [{"message": {"role": "assistant", "content": "OK"}}],
            "usage": {"prompt_tokens": 12, "completion_tokens": 2, "total_tokens": 14},
        },
    )


# ---------------------------------------------------------------------------
# 配置解析
# ---------------------------------------------------------------------------


def test_settings_defaults() -> None:
    settings = load_llm_settings({"MODELSCOPE_API_KEY": API_KEY}, load_env_file=False)
    assert settings.api_key == API_KEY
    assert settings.base_url == DEFAULT_BASE_URL
    assert settings.model == DEFAULT_MODEL
    assert settings.fallback_model == DEFAULT_FALLBACK_MODEL
    assert settings.timeout_seconds == 30.0


def test_settings_fallback_model_override() -> None:
    """V1.0.5：MODELSCOPE_FALLBACK_MODEL 可覆盖默认备用模型。"""

    settings = load_llm_settings(
        {
            "MODELSCOPE_API_KEY": API_KEY,
            "MODELSCOPE_MODEL": "Qwen/Qwen3.5-35B-A3B",
            "MODELSCOPE_FALLBACK_MODEL": "Qwen/Qwen2.5-7B-Instruct",
        },
        load_env_file=False,
    )
    assert settings.fallback_model == "Qwen/Qwen2.5-7B-Instruct"


def test_settings_disables_fallback_when_same_as_primary() -> None:
    """主备同名时没有可切换的模型，fallback_model 归一为 None（避免重复打限流模型）。"""

    settings = load_llm_settings(
        {
            "MODELSCOPE_API_KEY": API_KEY,
            "MODELSCOPE_MODEL": "Qwen/Qwen3.5-8B-Instruct",
            "MODELSCOPE_FALLBACK_MODEL": "Qwen/Qwen3.5-8B-Instruct",
        },
        load_env_file=False,
    )
    assert settings.fallback_model is None


def test_settings_alias_names() -> None:
    settings = load_llm_settings(
        {
            "LLM_API_KEY": API_KEY,
            "OPENAI_BASE_URL": "http://localhost:9000/v1",
            "OPENAI_MODEL": "qwen3-test",
            "LLM_TIMEOUT_SECONDS": "12",
        },
        load_env_file=False,
    )
    assert settings.api_key == API_KEY
    assert settings.base_url == "http://localhost:9000/v1"
    assert settings.model == "qwen3-test"
    assert settings.timeout_seconds == 12.0


def test_settings_ignores_blank_values() -> None:
    settings = load_llm_settings(
        {"MODELSCOPE_API_KEY": "  ", "LLM_API_KEY": API_KEY},
        load_env_file=False,
    )
    assert settings.api_key == API_KEY


def test_settings_missing_key_has_actionable_message() -> None:
    with pytest.raises(LLMConfigError, match="MODELSCOPE_API_KEY"):
        load_llm_settings({}, load_env_file=False)


def test_settings_rejects_invalid_base_url() -> None:
    with pytest.raises(LLMConfigError, match="http"):
        load_llm_settings({"MODELSCOPE_API_KEY": API_KEY, "MODELSCOPE_BASE_URL": "api.modelscope.cn"}, load_env_file=False)


@pytest.mark.parametrize("raw_timeout", ["abc", "0", "999"])
def test_settings_rejects_invalid_timeout(raw_timeout: str) -> None:
    with pytest.raises(LLMConfigError, match="LLM_TIMEOUT_SECONDS"):
        load_llm_settings(
            {"MODELSCOPE_API_KEY": API_KEY, "LLM_TIMEOUT_SECONDS": raw_timeout},
            load_env_file=False,
        )


def test_settings_masked_key() -> None:
    assert SETTINGS.masked_key == "sk***ue"
    assert LLMSettings(api_key="short", base_url="http://x", model="m", timeout_seconds=1).masked_key == "***"


def test_full_endpoint_is_not_double_appended() -> None:
    settings = LLMSettings(
        api_key=API_KEY,
        base_url="https://example.test/v1/chat/completions",
        model="m",
        timeout_seconds=5,
    )
    assert settings.chat_completions_url == "https://example.test/v1/chat/completions"


# ---------------------------------------------------------------------------
# ping
# ---------------------------------------------------------------------------


def test_ping_success() -> None:
    result = make_client(ok_handler).ping()
    assert result.reply == "OK"
    assert result.model == "Qwen/Qwen3.5-35B-A3B"
    assert result.latency_ms >= 0
    assert result.usage == {"prompt_tokens": 12, "completion_tokens": 2, "total_tokens": 14}


def test_ping_custom_message() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        payload = json.loads(request.content)
        assert payload["messages"][0]["content"] == "ping"
        return httpx.Response(200, json={"choices": [{"message": {"content": "OK"}}]})

    assert make_client(handler).ping("ping").reply == "OK"


def test_ping_rejects_empty_message() -> None:
    with pytest.raises(LLMConfigError):
        make_client(ok_handler).ping("   ")


def test_ping_timeout() -> None:
    def handler(_request: httpx.Request) -> httpx.Response:
        raise httpx.TimeoutException("timed out")

    with pytest.raises(LLMTimeoutError, match="超时"):
        make_client(handler).ping()


def test_ping_upstream_401_redacts_key() -> None:
    def handler(_request: httpx.Request) -> httpx.Response:
        return httpx.Response(401, text=f"invalid token: {API_KEY}")

    with pytest.raises(LLMUpstreamError) as exc_info:
        make_client(handler).ping()
    error = exc_info.value
    assert error.upstream_status == 401
    assert error.retryable is False
    assert API_KEY not in str(error)


@pytest.mark.parametrize("status", [429, 500, 503])
def test_ping_upstream_retryable(status: int) -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(status, text="busy", request=request)

    with pytest.raises(LLMUpstreamError) as exc_info:
        make_client(handler).ping()
    assert exc_info.value.retryable is True
    assert exc_info.value.upstream_status == status


def test_ping_invalid_json() -> None:
    def handler(_request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, text="not-json")

    with pytest.raises(LLMUpstreamError, match="JSON"):
        make_client(handler).ping()


def test_ping_missing_content() -> None:
    def handler(_request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, json={"choices": [{"message": {"role": "assistant"}}]})

    with pytest.raises(LLMUpstreamError, match="content"):
        make_client(handler).ping()
