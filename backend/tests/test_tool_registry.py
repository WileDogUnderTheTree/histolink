"""工具注册表测试（V1.0.3）：白名单 + 严格 Pydantic 参数校验。"""

from __future__ import annotations

import json
from typing import Any

import pytest

from agent.tool_registry import (
    InvalidToolArguments,
    ToolRegistry,
    UnknownToolError,
)
from agent.tools import TOOL_NAMES

XIXIA09 = "xixia-09"


@pytest.fixture(scope="module")
def registry(toolkit: Any) -> ToolRegistry:
    return ToolRegistry(toolkit)


def test_registry_matches_tool_whitelist(registry: ToolRegistry) -> None:
    assert set(registry.tool_names) == set(TOOL_NAMES)
    assert len(registry.tool_names) == 9


def test_tool_catalog_is_json_and_complete(registry: ToolRegistry) -> None:
    catalog = json.loads(registry.tool_catalog_json())
    assert {item["name"] for item in catalog} == set(TOOL_NAMES)
    for item in catalog:
        assert item["description"]
        parameters = item["parameters"]
        assert parameters["type"] == "object"
        assert parameters["additionalProperties"] is False


def test_validate_arguments_returns_kwargs(registry: ToolRegistry) -> None:
    kwargs = registry.validate_arguments("get_event", {"event_id": XIXIA09})
    assert kwargs == {"event_id": XIXIA09}


def test_validate_nested_year_range(registry: ToolRegistry) -> None:
    kwargs = registry.validate_arguments(
        "search_events",
        {"q": "安史", "year_range": {"start": 750, "end": 760}, "importance_min": 2},
    )
    assert kwargs["year_range"] == {"start": 750, "end": 760}
    assert kwargs["importance_min"] == 2
    assert kwargs["limit"] == 20


def test_validate_rejects_unknown_tool(registry: ToolRegistry) -> None:
    with pytest.raises(UnknownToolError):
        registry.validate_arguments("rm_rf", {})


def test_validate_rejects_extra_argument(registry: ToolRegistry) -> None:
    with pytest.raises(InvalidToolArguments, match="debug"):
        registry.validate_arguments("get_event", {"event_id": XIXIA09, "debug": True})


def test_validate_rejects_wrong_types_strictly(registry: ToolRegistry) -> None:
    # strict=True：字符串 "20" 不会被静默转换成整数。
    with pytest.raises(InvalidToolArguments):
        registry.validate_arguments("get_person_events", {"person_id": "p-liangtaihou-xixia-0d0f", "limit": "20"})
    with pytest.raises(InvalidToolArguments):
        registry.validate_arguments("timeline_span", {"start_year": "-260", "end_year": -221})


def test_validate_rejects_out_of_range_limit(registry: ToolRegistry) -> None:
    with pytest.raises(InvalidToolArguments):
        registry.validate_arguments("search_events", {"q": "赤壁", "limit": 81})


def test_validate_enforces_era_scope_exclusive(registry: ToolRegistry) -> None:
    with pytest.raises(InvalidToolArguments):
        registry.validate_arguments("get_era_graph", {"era_id": "xixia", "scope_id": "songliaojinxia"})
    with pytest.raises(InvalidToolArguments):
        registry.validate_arguments("get_era_graph", {})


def test_validate_enforces_relation_two_people(registry: ToolRegistry) -> None:
    person_id = "p-liangtaihou-xixia-0d0f"
    with pytest.raises(InvalidToolArguments):
        registry.validate_arguments(
            "get_relation", {"person_id_a": person_id, "person_id_b": person_id}
        )


def test_validate_enforces_rag_top_k_limit(registry: ToolRegistry) -> None:
    """V1.0.5：RAG 工具 top_k 严格 1..3（Token 控制是产品硬约束）。"""

    kwargs = registry.validate_arguments(
        "search_historical_text", {"query": "商鞅变法 秦孝公 前356年"}
    )
    assert kwargs == {"query": "商鞅变法 秦孝公 前356年", "top_k": 3}
    with pytest.raises(InvalidToolArguments):
        registry.validate_arguments("search_historical_text", {"query": "赤壁", "top_k": 4})
    with pytest.raises(InvalidToolArguments):
        registry.validate_arguments("search_historical_text", {"query": ""})


def test_execute_valid_call(registry: ToolRegistry) -> None:
    result = registry.execute("get_event", {"event_id": XIXIA09})
    assert result["ok"] is True
    assert result["tool"] == "get_event"
    assert result["data"]["event_id"] == XIXIA09


def test_execute_invalid_arguments_returns_failure_envelope(registry: ToolRegistry) -> None:
    result = registry.execute("get_event", {"event_id": "Bad Event ID"})
    assert result["ok"] is False
    assert result["error"]["code"] == "INVALID_REQUEST"
    assert result["data"] is None
    assert result["items"] == []


def test_execute_unknown_tool_returns_failure_envelope(registry: ToolRegistry) -> None:
    result = registry.execute("rm_rf", {})
    assert result["ok"] is False
    assert result["tool"] == "rm_rf"
    assert result["error"]["code"] == "INVALID_REQUEST"
    assert "未知工具" in result["error"]["message"]


def test_execute_internal_exception_returns_safe_envelope(
    registry: ToolRegistry, toolkit: Any, monkeypatch: pytest.MonkeyPatch
) -> None:
    """P1-3：工具内部 KeyError / ValueError 不得逃逸成未预期的 500。"""

    def boom(*_args: Any, **_kwargs: Any) -> dict[str, Any]:
        raise KeyError("snapshot index missing")

    monkeypatch.setattr(toolkit, "call", boom)
    result = registry.execute("get_event", {"event_id": XIXIA09})

    assert result["ok"] is False
    assert result["tool"] == "get_event"
    assert result["error"]["code"] == "INTERNAL"
    assert result["items"] == []
    assert result["citations"] == []
    # 异常细节不进入失败信封。
    assert "snapshot index missing" not in result["error"]["message"]
