"""`GET /api/agent/ping_llm` 端点测试（V1.0.1 / TC-10，离线 MockTransport）。

覆盖：成功返回、模型名/耗时/用量、错误 envelope（配置缺失 / 上游 401 / 超时）、
探测开关、响应符合契约 JSON Schema。
"""

from __future__ import annotations

import json
from collections.abc import Callable, Iterator
from typing import Any

import httpx
import jsonschema
import pytest
from fastapi.testclient import TestClient

from llm_client import LLMClient, LLMSettings
from routers.deps import get_llm_client

API_KEY = "sk-test-secret-value"
SETTINGS = LLMSettings(
    api_key=API_KEY,
    base_url="https://example.test/v1",
    model="Qwen/Qwen3-8B",
    timeout_seconds=5.0,
)
PING_ENV_NAMES = (
    "MODELSCOPE_API_KEY",
    "MODELSCOPE_KEY",
    "LLM_API_KEY",
    "OPENAI_API_KEY",
    "MODELSCOPE_BASE_URL",
    "MODELSCOPE_URL",
    "LLM_BASE_URL",
    "OPENAI_BASE_URL",
    "MODELSCOPE_MODEL",
    "LLM_MODEL",
    "OPENAI_MODEL",
)


def _override_client(client: TestClient, handler: Callable[[httpx.Request], httpx.Response]) -> None:
    app = client.app
    app.dependency_overrides[get_llm_client] = lambda: LLMClient(
        SETTINGS, transport=httpx.MockTransport(handler)
    )


@pytest.fixture
def llm_override(client: TestClient) -> Iterator[Callable[[Callable[[httpx.Request], httpx.Response]], None]]:
    def install(handler: Callable[[httpx.Request], httpx.Response]) -> None:
        _override_client(client, handler)

    yield install
    client.app.dependency_overrides.clear()


def _success_handler(request: httpx.Request) -> httpx.Response:
    assert request.url.path.endswith("/chat/completions")
    payload = json.loads(request.content)
    assert payload["messages"][0]["content"] == "请回复 OK"
    return httpx.Response(
        200,
        json={
            "model": "Qwen/Qwen3-8B",
            "choices": [{"message": {"content": "OK"}}],
            "usage": {"prompt_tokens": 12, "completion_tokens": 2, "total_tokens": 14},
        },
    )


def _validate_against_contract(instance: Any, model: str, spec: dict[str, Any]) -> None:
    validator = jsonschema.Draft202012Validator({**spec, "$ref": f"#/components/schemas/{model}"})
    validator.validate(instance)


def test_ping_llm_success(
    client: TestClient,
    llm_override,
    openapi_spec: dict[str, Any],
) -> None:
    llm_override(_success_handler)
    response = client.get("/api/agent/ping_llm")
    assert response.status_code == 200
    payload = response.json()
    assert payload["ok"] is True
    assert payload["reply"] == "OK"
    assert payload["message"] == "请回复 OK"
    assert payload["model"] == "Qwen/Qwen3-8B"
    assert isinstance(payload["latency_ms"], int)
    assert payload["usage"]["total_tokens"] == 14
    _validate_against_contract(payload, "PingLLMResponse", openapi_spec)


def test_ping_llm_custom_message(client: TestClient, llm_override) -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        assert json.loads(request.content)["messages"][0]["content"] == "你好"
        return httpx.Response(200, json={"choices": [{"message": {"content": "OK"}}]})

    llm_override(handler)
    response = client.get("/api/agent/ping_llm", params={"message": "你好"})
    assert response.status_code == 200
    assert response.json()["message"] == "你好"


def test_ping_llm_not_configured(
    client: TestClient,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    # 环境隔离：删除所有别名环境变量，并让 load_settings 不再读取 .env 文件。
    for name in PING_ENV_NAMES:
        monkeypatch.delenv(name, raising=False)
    import llm_client

    monkeypatch.setattr(llm_client, "_dotenv_loaded", True)
    client.app.dependency_overrides.pop(get_llm_client, None)

    response = client.get("/api/agent/ping_llm")
    assert response.status_code == 503
    payload = response.json()
    assert payload["ok"] is False
    assert payload["error"]["code"] == "LLM_NOT_CONFIGURED"
    assert "MODELSCOPE_API_KEY" in payload["error"]["message"]


def test_ping_llm_upstream_error_redacts_key(client: TestClient, llm_override) -> None:
    def handler(_request: httpx.Request) -> httpx.Response:
        return httpx.Response(401, text=f"unauthorized: {API_KEY}")

    llm_override(handler)
    response = client.get("/api/agent/ping_llm")
    assert response.status_code == 502
    payload = response.json()
    assert payload["error"]["code"] == "LLM_UPSTREAM_ERROR"
    assert payload["error"]["details"]["upstream_status"] == 401
    assert payload["error"]["retryable"] is False
    assert API_KEY not in response.text


def test_ping_llm_timeout(client: TestClient, llm_override) -> None:
    def handler(_request: httpx.Request) -> httpx.Response:
        raise httpx.TimeoutException("timed out")

    llm_override(handler)
    response = client.get("/api/agent/ping_llm")
    assert response.status_code == 504
    payload = response.json()
    assert payload["error"]["code"] == "LLM_TIMEOUT"
    assert payload["error"]["retryable"] is True


def test_ping_llm_can_be_disabled(
    client: TestClient,
    llm_override,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    llm_override(_success_handler)
    monkeypatch.setenv("ENABLE_LLM_PROBE", "0")
    response = client.get("/api/agent/ping_llm")
    assert response.status_code == 404
    assert response.json()["error"]["code"] == "ROUTE_NOT_FOUND"


def test_openapi_contains_ping_llm(openapi_spec: dict[str, Any]) -> None:
    assert "/api/agent/ping_llm" in openapi_spec["paths"]
    assert "PingLLMResponse" in openapi_spec["components"]["schemas"]
