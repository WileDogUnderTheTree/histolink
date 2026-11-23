"""图谱工具测试：`get_era_graph`（V1.0.2）。"""

from __future__ import annotations

from collections.abc import Callable
from typing import Any

from agent.tools import get_era_graph

LI_YUANHAO = "p-liyuanhao-f692"
KONG_ZI = "p-kongzi-e89c"


def _node_ids(result: dict[str, Any]) -> list[str]:
    return [node["person_id"] for node in result["data"]["nodes"]]


def test_get_era_graph_default_crop(
    tool_context: Any, assert_tool_contract: Callable[[dict[str, Any], str], None]
) -> None:
    result = get_era_graph(tool_context, era_id="xixia")
    assert_tool_contract(result, "get_era_graph")

    data = result["data"]
    assert result["ok"] is True
    assert data["era_id"] == "xixia"
    assert "scope_id" not in data
    assert len(data["nodes"]) == 20
    assert result["meta"]["node_total"] == 29
    assert result["meta"]["edge_total"] == 46
    assert result["truncated"] is True
    assert result["items"] == data["nodes"]
    assert len(data["edges"]) <= 160

    node_ids = set(_node_ids(result))
    for edge in data["edges"]:
        assert edge["person_id_a"] in node_ids
        assert edge["person_id_b"] in node_ids
        assert edge["weight"] >= 1


def test_get_era_graph_full_when_under_limit(
    tool_context: Any, assert_tool_contract: Callable[[dict[str, Any], str], None]
) -> None:
    result = get_era_graph(tool_context, era_id="xixia", limit=80)
    assert_tool_contract(result, "get_era_graph")

    data = result["data"]
    assert len(data["nodes"]) == 29
    assert len(data["edges"]) == 46
    assert data["truncated"] is False
    assert result["truncated"] is False
    assert result["citations"]


def test_get_era_graph_center_neighborhood(
    tool_context: Any, assert_tool_contract: Callable[[dict[str, Any], str], None]
) -> None:
    result = get_era_graph(
        tool_context, era_id="xixia", center_person_id=LI_YUANHAO, limit=5
    )
    assert_tool_contract(result, "get_era_graph")

    data = result["data"]
    assert data["center_person_id"] == LI_YUANHAO
    assert len(data["nodes"]) == 5
    # 中心人物必须排第一，其余为邻居。
    assert data["nodes"][0]["person_id"] == LI_YUANHAO
    assert result["truncated"] is True

    node_ids = set(_node_ids(result))
    center_incident = [
        edge
        for edge in data["edges"]
        if LI_YUANHAO in (edge["person_id_a"], edge["person_id_b"])
    ]
    assert center_incident, "中心人物至少要有一条边"
    for edge in data["edges"]:
        assert edge["person_id_a"] in node_ids
        assert edge["person_id_b"] in node_ids


def test_get_era_graph_center_must_belong_to_graph(
    tool_context: Any, assert_tool_contract: Callable[[dict[str, Any], str], None]
) -> None:
    result = get_era_graph(tool_context, era_id="xixia", center_person_id=KONG_ZI)
    assert_tool_contract(result, "get_era_graph")

    assert result["ok"] is False
    assert result["error"]["code"] == "ENTITY_NOT_FOUND"


def test_get_era_graph_unknown_center_returns_entity_not_found(
    tool_context: Any, assert_tool_contract: Callable[[dict[str, Any], str], None]
) -> None:
    result = get_era_graph(
        tool_context, era_id="xixia", center_person_id="p-nobody-0000"
    )
    assert_tool_contract(result, "get_era_graph")

    assert result["ok"] is False
    assert result["error"]["code"] == "ENTITY_NOT_FOUND"


def test_get_era_graph_scope_mode(
    tool_context: Any, assert_tool_contract: Callable[[dict[str, Any], str], None]
) -> None:
    result = get_era_graph(tool_context, scope_id="songliaojinxia", limit=10)
    assert_tool_contract(result, "get_era_graph")

    data = result["data"]
    assert result["ok"] is True
    assert data["scope_id"] == "songliaojinxia"
    assert "era_id" not in data
    assert len(data["nodes"]) == 10
    assert result["meta"]["node_total"] == 205
    assert result["truncated"] is True


def test_get_era_graph_edges_are_capped(
    tool_context: Any, assert_tool_contract: Callable[[dict[str, Any], str], None]
) -> None:
    result = get_era_graph(tool_context, scope_id="songliaojinxia", limit=80)
    assert_tool_contract(result, "get_era_graph")

    assert len(result["data"]["nodes"]) == 80
    assert len(result["data"]["edges"]) <= 160
    assert result["truncated"] is True


def test_get_era_graph_requires_exactly_one_source(
    tool_context: Any, assert_tool_contract: Callable[[dict[str, Any], str], None]
) -> None:
    neither = get_era_graph(tool_context)
    assert_tool_contract(neither, "get_era_graph")
    assert neither["ok"] is False
    assert neither["error"]["code"] == "INVALID_REQUEST"

    both = get_era_graph(tool_context, era_id="xixia", scope_id="songliaojinxia")
    assert_tool_contract(both, "get_era_graph")
    assert both["ok"] is False
    assert both["error"]["code"] == "INVALID_REQUEST"


def test_get_era_graph_unknown_ids(
    tool_context: Any, assert_tool_contract: Callable[[dict[str, Any], str], None]
) -> None:
    unknown_era = get_era_graph(tool_context, era_id="tianxia")
    assert_tool_contract(unknown_era, "get_era_graph")
    assert unknown_era["ok"] is False
    assert unknown_era["error"]["code"] == "ENTITY_NOT_FOUND"

    unknown_scope = get_era_graph(tool_context, scope_id="tianxia")
    assert_tool_contract(unknown_scope, "get_era_graph")
    assert unknown_scope["ok"] is False
    assert unknown_scope["error"]["code"] == "ENTITY_NOT_FOUND"


def test_get_era_graph_rejects_out_of_range_limit(
    tool_context: Any, assert_tool_contract: Callable[[dict[str, Any], str], None]
) -> None:
    result = get_era_graph(tool_context, era_id="xixia", limit=81)
    assert_tool_contract(result, "get_era_graph")

    assert result["ok"] is False
    assert result["error"]["code"] == "INVALID_REQUEST"
