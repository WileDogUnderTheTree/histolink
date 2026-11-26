"""V1.0.5.2 模型注册表 / 请求级模型选择 API 单测（全部离线）。"""

from __future__ import annotations

from typing import Any

import jsonschema
import pytest
from agent_testkit import FakeLLM, final_step, grounded_answer, tool_call_step
from fastapi.testclient import TestClient

from llm_client import (
    DEFAULT_FALLBACK_MODEL,
    DEFAULT_MODEL,
    list_model_options,
    load_llm_settings,
    model_display_name,
    resolve_model_pair,
)
from routers.deps import get_llm_client

CHIBI_CITATION = "cite-handong-chibi-0"
ASK_BODY = {
    "question": "赤壁之战发生在哪一年？",
    "session_id": "test-session",
    "context": {"route": "/timeline"},
}


@pytest.fixture
def override_llm(client: TestClient):
    def _install(fake: FakeLLM) -> FakeLLM:
        client.app.dependency_overrides[get_llm_client] = lambda: fake
        return fake

    yield _install
    client.app.dependency_overrides.pop(get_llm_client, None)


def test_list_model_options_returns_primary_and_fallback() -> None:
    options = list_model_options(
        {
            "MODELSCOPE_MODEL": DEFAULT_MODEL,
            "MODELSCOPE_FALLBACK_MODEL": DEFAULT_FALLBACK_MODEL,
        },
        load_env_file=False,
    )
    assert [option.id for option in options] == [DEFAULT_MODEL, DEFAULT_FALLBACK_MODEL]
    assert [option.role for option in options] == ["primary", "fallback"]
    assert options[0].id == "Qwen/Qwen3.5-35B-A3B"
    assert options[1].id == "Qwen/Qwen3.5-8B-Instruct"


def test_list_model_options_merges_same_model() -> None:
    options = list_model_options(
        {"MODELSCOPE_MODEL": DEFAULT_MODEL, "MODELSCOPE_FALLBACK_MODEL": DEFAULT_MODEL},
        load_env_file=False,
    )
    assert len(options) == 1
    assert options[0].role == "primary"


# ---------------------------------------------------------------------------
# V1.0.6.2：模型切换窗口展示名（id 保持真实模型名，name 短而通俗）
# ---------------------------------------------------------------------------


def test_model_display_name_shortens_hf_gguf_models() -> None:
    assert (
        model_display_name("hf.co/mradermacher/XiaoHong-v1-GGUF:Q4_K_M")
        == "XiaoHong-v1"
    )
    assert model_display_name("hf.co/foo/Bar-7B-GGUF:Q5_K_M") == "Bar-7B"
    # 非 GGUF 的云端模型名保持原样（避免误伤 Qwen/... 命名）。
    assert model_display_name("Qwen/Qwen3.5-35B-A3B") == "Qwen/Qwen3.5-35B-A3B"


def test_list_model_options_uses_display_name_env_override() -> None:
    model_id = "hf.co/mradermacher/XiaoHong-v1-GGUF:Q4_K_M"
    options = list_model_options(
        {
            "MODELSCOPE_MODEL": model_id,
            "MODELSCOPE_FALLBACK_MODEL": model_id,
            "LLM_MODEL_DISPLAY_NAME": "XiaoHong-v1",
        },
        load_env_file=False,
    )
    assert len(options) == 1
    # id 用于请求上游，必须保持真实模型名。
    assert options[0].id == model_id
    assert options[0].name == "XiaoHong-v1"
    assert options[0].role == "primary"


def test_list_model_options_auto_shortens_hf_gguf_without_override() -> None:
    model_id = "hf.co/mradermacher/XiaoHong-v1-GGUF:Q4_K_M"
    options = list_model_options(
        {"MODELSCOPE_MODEL": model_id, "MODELSCOPE_FALLBACK_MODEL": model_id},
        load_env_file=False,
    )
    assert options[0].id == model_id
    assert options[0].name == "XiaoHong-v1"


def test_resolve_model_pair_bidirectional() -> None:
    settings = load_llm_settings(
        {
            "MODELSCOPE_API_KEY": "sk-test",
            "MODELSCOPE_MODEL": DEFAULT_MODEL,
            "MODELSCOPE_FALLBACK_MODEL": DEFAULT_FALLBACK_MODEL,
        },
        load_env_file=False,
    )
    assert resolve_model_pair(settings) == (DEFAULT_MODEL, DEFAULT_FALLBACK_MODEL)
    assert resolve_model_pair(settings, DEFAULT_MODEL) == (
        DEFAULT_MODEL,
        DEFAULT_FALLBACK_MODEL,
    )
    # 手动选择备用模型时，主模型成为自动降级目标（双向降级）。
    assert resolve_model_pair(settings, DEFAULT_FALLBACK_MODEL) == (
        DEFAULT_FALLBACK_MODEL,
        DEFAULT_MODEL,
    )


def test_models_endpoint_returns_registry(
    client: TestClient, openapi_spec: dict[str, Any]
) -> None:
    response = client.get("/api/agent/models")
    assert response.status_code == 200
    payload = response.json()

    assert payload["ok"] is True
    assert payload["default_model_id"] == DEFAULT_MODEL
    assert [model["id"] for model in payload["models"][:2]] == [
        DEFAULT_MODEL,
        DEFAULT_FALLBACK_MODEL,
    ]
    assert payload["models"][0]["role"] == "primary"
    jsonschema.Draft202012Validator(
        {**openapi_spec, "$ref": "#/components/schemas/ModelsResponse"}
    ).validate(payload)


def test_ask_with_model_id_reports_requested_model(
    client: TestClient, override_llm
) -> None:
    fake = override_llm(
        FakeLLM(
            [
                tool_call_step("get_event", {"event_id": "handong-chibi"}),
                final_step(grounded_answer(citation_ids=[CHIBI_CITATION])),
            ]
        )
    )
    body = {**ASK_BODY, "model_id": DEFAULT_FALLBACK_MODEL}
    response = client.post("/api/agent/ask", json=body)

    assert response.status_code == 200
    payload = response.json()
    assert payload["trace"]["model_requested"] == DEFAULT_FALLBACK_MODEL
    # 请求级模型选择被透传到 LLM 客户端。
    assert fake.calls[0]["model_id"] == DEFAULT_FALLBACK_MODEL
    # grounded 事件回答：时间轴源覆盖、关系图源未覆盖（只增可选字段）。
    assert payload["trace"]["sources"] == {"timeline": True, "graph": False}


def test_ask_rejects_unknown_model_id(client: TestClient, override_llm) -> None:
    override_llm(FakeLLM([]))
    body = {**ASK_BODY, "model_id": "Qwen/Not-A-Real-Model"}
    response = client.post("/api/agent/ask", json=body)

    assert response.status_code == 400
    payload = response.json()
    assert payload["ok"] is False
    assert payload["error"]["code"] == "INVALID_REQUEST"
    assert "未知模型" in payload["error"]["message"]
