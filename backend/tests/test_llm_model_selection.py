"""V1.0.5.2 请求级模型选择 + 双向自动降级的 LLMClient 单测（httpx.MockTransport，离线）。"""

from __future__ import annotations

import json

import httpx
import pytest

from llm_client import (
    DEFAULT_FALLBACK_MODEL,
    DEFAULT_MODEL,
    LLMClient,
    LLMConfigError,
    LLMSettings,
    LLMUpstreamError,
)

API_KEY = "sk-test-secret-value"
SETTINGS = LLMSettings(
    api_key=API_KEY,
    base_url="https://example.test/v1",
    model=DEFAULT_MODEL,
    timeout_seconds=5.0,
    fallback_model=DEFAULT_FALLBACK_MODEL,
)
MESSAGES = [
    {"role": "system", "content": "system prompt"},
    {"role": "user", "content": "赤壁之战发生在哪一年？"},
]


def _ok_response(model: str) -> httpx.Response:
    return httpx.Response(
        200,
        json={
            "model": model,
            "choices": [
                {"message": {"role": "assistant", "content": '{"action":"final"}'}}
            ],
        },
    )


def test_chat_uses_manually_selected_fallback_model() -> None:
    """手动选择备用模型：请求体 model 为备用模型，model_used 也是备用模型。"""

    models: list[str] = []

    def handler(request: httpx.Request) -> httpx.Response:
        models.append(json.loads(request.content)["model"])
        return _ok_response(DEFAULT_FALLBACK_MODEL)

    result = LLMClient(SETTINGS, transport=httpx.MockTransport(handler)).chat(
        MESSAGES, model_id=DEFAULT_FALLBACK_MODEL
    )

    assert models == [DEFAULT_FALLBACK_MODEL]
    assert result.model_used == DEFAULT_FALLBACK_MODEL


def test_selected_fallback_model_degrades_to_primary() -> None:
    """手动选择备用模型后仍自动降级：备用模型 429 → 自动切回主模型。"""

    models: list[str] = []

    def handler(request: httpx.Request) -> httpx.Response:
        models.append(json.loads(request.content)["model"])
        if len(models) == 1:
            return httpx.Response(429, text="overloaded", request=request)
        return _ok_response(DEFAULT_MODEL)

    result = LLMClient(SETTINGS, transport=httpx.MockTransport(handler)).chat(
        MESSAGES, model_id=DEFAULT_FALLBACK_MODEL
    )

    assert models == [DEFAULT_FALLBACK_MODEL, DEFAULT_MODEL]
    assert result.model_used == DEFAULT_MODEL


def test_chat_unknown_model_id_raises_config_error() -> None:
    def handler(request: httpx.Request) -> httpx.Response:  # pragma: no cover
        return _ok_response(DEFAULT_MODEL)

    client = LLMClient(SETTINGS, transport=httpx.MockTransport(handler))
    with pytest.raises(LLMConfigError, match="未知模型"):
        client.chat(MESSAGES, model_id="Qwen/Not-A-Real-Model")


def test_selected_invalid_model_degrades_to_other_model() -> None:
    """手动所选模型在上游不可用（400 Invalid model id）→ 自动降级到另一款模型。"""

    models: list[str] = []

    def handler(request: httpx.Request) -> httpx.Response:
        models.append(json.loads(request.content)["model"])
        if len(models) == 1:
            return httpx.Response(
                400,
                json={"error": {"message": "Invalid model id"}},
                request=request,
            )
        return _ok_response(DEFAULT_MODEL)

    result = LLMClient(SETTINGS, transport=httpx.MockTransport(handler)).chat(
        MESSAGES, model_id=DEFAULT_FALLBACK_MODEL
    )

    assert models == [DEFAULT_FALLBACK_MODEL, DEFAULT_MODEL]
    assert result.model_used == DEFAULT_MODEL


def test_default_path_does_not_fall_back_on_400() -> None:
    """默认主模型路径保持严格：400 参数错误不降级（避免掩盖真实请求问题）。"""

    models: list[str] = []

    def handler(request: httpx.Request) -> httpx.Response:
        models.append(json.loads(request.content)["model"])
        return httpx.Response(
            400, json={"error": {"message": "bad request"}}, request=request
        )

    client = LLMClient(SETTINGS, transport=httpx.MockTransport(handler))
    with pytest.raises(LLMUpstreamError):
        client.chat(MESSAGES)
    assert models == [DEFAULT_MODEL]
