"""统一返回信封 / 工具注册表测试（V1.0.2；V1.0.5 追加 RAG 工具）。

覆盖：
- 9 个工具（V1.0.5 起含 search_historical_text）都返回统一字段
  （items / citations / truncated / snapshot_version）；
- `data` 全部符合冻结的 `contracts/tools-v1.schema.json` 出参；
- 注册表与契约工具名一致，未知工具返回 INVALID_REQUEST；
- `ToolResult` 新增字段保持向后兼容（V1.0 只增可选字段）。

注：`search_historical_text` 依赖本地向量库，单独在 `test_tools_rag.py` 用 fake store 覆盖；
这里只校验注册表名与契约一致，不触发真实 chromadb 加载。
"""

from __future__ import annotations

from collections.abc import Callable
from typing import Any

import pytest
from pydantic import ValidationError

from agent.tools import TOOL_FUNCTIONS, TOOL_NAMES, call_tool
from contracts.models import ErrorCode, ToolError, ToolResult

TOOL_CALLS: list[tuple[str, dict[str, Any]]] = [
    ("resolve_entity", {"query": "梁太后"}),
    ("search_events", {"q": "赤壁"}),
    ("get_event", {"event_id": "xixia-09"}),
    ("get_person", {"person_id": "p-liangtaihou-xixia-0d0f"}),
    ("get_person_events", {"person_id": "p-lishimin-7efd", "limit": 3}),
    (
        "get_relation",
        {"person_id_a": "p-dingruchang-4ff9", "person_id_b": "p-yidongyouheng-37bf"},
    ),
    ("get_era_graph", {"era_id": "xixia", "limit": 5}),
    ("timeline_span", {"start_year": -260, "end_year": -221, "limit": 3}),
]


def test_registry_matches_frozen_contract(
    tool_contracts: dict[str, dict[str, Any]],
) -> None:
    assert len(TOOL_NAMES) == 9
    assert "search_historical_text" in TOOL_NAMES
    assert set(TOOL_NAMES) == set(TOOL_FUNCTIONS) == set(tool_contracts)


@pytest.mark.parametrize(("tool_name", "arguments"), TOOL_CALLS)
def test_every_tool_returns_unified_envelope(
    toolkit: Any,
    assert_tool_contract: Callable[[dict[str, Any], str], None],
    tool_name: str,
    arguments: dict[str, Any],
) -> None:
    result = toolkit.call(tool_name, **arguments)
    assert_tool_contract(result, tool_name)

    assert result["ok"] is True
    assert len(result["items"]) <= 80
    assert len(result["citations"]) <= 50
    assert result["data"] is not None
    assert result["error"] is None
    assert isinstance(result["meta"], dict)

    citation_ids = [citation["id"] for citation in result["citations"]]
    assert len(citation_ids) == len(set(citation_ids)), "引用 id 必须唯一"
    for citation in result["citations"]:
        assert citation["attribution"]
        assert citation["license"] == "CC BY-NC-SA 4.0"


def test_unknown_tool_returns_invalid_request(tool_context: Any) -> None:
    result = call_tool(tool_context, "open_sesame")

    # 未知工具没有契约 output，但仍必须返回统一信封（失败变体）。
    assert set(result) == {
        "ok",
        "tool",
        "data",
        "error",
        "meta",
        "items",
        "citations",
        "truncated",
        "snapshot_version",
    }
    assert result["tool"] == "open_sesame"
    assert result["ok"] is False
    assert result["data"] is None
    assert result["items"] == []
    assert result["citations"] == []
    assert result["truncated"] is False
    assert result["snapshot_version"] == tool_context.snapshot_version
    assert result["error"]["code"] == "INVALID_REQUEST"
    assert "未知工具" in result["error"]["message"]


def test_tool_failure_keeps_unified_fields(
    tool_context: Any, assert_tool_contract: Callable[[dict[str, Any], str], None]
) -> None:
    result = call_tool(tool_context, "get_event", event_id="no-such-event")
    assert_tool_contract(result, "get_event")

    assert result["ok"] is False
    assert result["error"]["code"] == "ENTITY_NOT_FOUND"
    assert result["items"] == []
    assert result["citations"] == []
    assert result["truncated"] is False
    assert result["snapshot_version"] == tool_context.snapshot_version


def test_toolkit_snapshot_version(toolkit: Any, snapshot_store: Any) -> None:
    assert toolkit.snapshot_version == snapshot_store.meta["snapshot_version"]
    assert toolkit.call("get_event", event_id="xixia-09")["snapshot_version"] == (
        toolkit.snapshot_version
    )


def test_tool_result_new_fields_are_optional() -> None:
    """V1.0.1 调用方只传旧字段也必须可用（只增可选字段，不破坏兼容）。"""

    legacy = ToolResult(ok=True, tool="get_event", data={"event_id": "xixia-09"})
    assert legacy.items == []
    assert legacy.citations == []
    assert legacy.truncated is False
    assert legacy.snapshot_version is None
    assert legacy.meta == {}

    failed = ToolResult(
        ok=False,
        tool="get_person",
        error=ToolError(code=ErrorCode.INVALID_REQUEST, message="bad input"),
    )
    assert failed.ok is False
    assert failed.error is not None


def test_tool_result_rejects_ok_with_error() -> None:
    with pytest.raises(ValidationError):
        ToolResult(
            ok=True,
            tool="get_event",
            error=ToolError(code=ErrorCode.INTERNAL, message="should not happen"),
        )
