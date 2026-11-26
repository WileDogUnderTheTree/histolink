"""关系工具测试：`get_relation`（V1.0.2）。

关系引用边界：关系库定性文字没有书目，引用只取共同事件的书目（审核报告 §8.1 Q3）。
"""

from __future__ import annotations

from collections.abc import Callable
from typing import Any

from agent.tools import get_relation

DING_RUCHANG = "p-dingruchang-4ff9"
YIDONG_YOUHENG = "p-yidongyouheng-37bf"
LIU_BANG = "p-liubang-f5be"
XIANG_YU = "p-xiangyu-3d47"
KONG_ZI = "p-kongzi-e89c"
LIANG_XIXIA = "p-liangtaihou-xixia-0d0f"
LI_SHIMIN = "p-lishimin-7efd"
WU_ZETIAN = "p-wuzetian-2920"


def test_get_relation_from_relation_library(
    tool_context: Any, assert_tool_contract: Callable[[dict[str, Any], str], None]
) -> None:
    result = get_relation(
        tool_context, person_id_a=DING_RUCHANG, person_id_b=YIDONG_YOUHENG
    )
    assert_tool_contract(result, "get_relation")

    relation = result["data"]
    assert result["ok"] is True
    assert relation["person_id_a"] == DING_RUCHANG
    assert relation["person_id_b"] == YIDONG_YOUHENG
    assert relation["label"] == "敌手"
    assert relation["description"]
    assert relation["shared_event_ids"] == ["qing-42"]
    assert relation["basis_event_ids"] == ["qing-42"]
    assert relation["attribution"] == "史脉关系库（人工校订）"
    assert result["meta"]["relation_found"] is True
    assert result["truncated"] is False

    kinds = [citation["kind"] for citation in result["citations"]]
    assert "relation" in kinds
    relation_citation = next(
        citation for citation in result["citations"] if citation["kind"] == "relation"
    )
    assert relation_citation["relation_id"] == "丁汝昌__伊东祐亨"
    # 关系定性本身不带书目，其引用必须落到共同事件的书目上。
    event_citation = next(
        citation for citation in result["citations"] if citation["kind"] == "event"
    )
    assert event_citation["event_id"] == "qing-42"
    assert event_citation["source_ref"]["book"]


def test_get_relation_is_order_insensitive_but_preserves_caller_order(
    tool_context: Any, assert_tool_contract: Callable[[dict[str, Any], str], None]
) -> None:
    forward = get_relation(
        tool_context, person_id_a=DING_RUCHANG, person_id_b=YIDONG_YOUHENG
    )
    reversed_result = get_relation(
        tool_context, person_id_a=YIDONG_YOUHENG, person_id_b=DING_RUCHANG
    )
    assert_tool_contract(reversed_result, "get_relation")

    assert reversed_result["ok"] is True
    assert reversed_result["data"]["person_id_a"] == YIDONG_YOUHENG
    assert reversed_result["data"]["person_id_b"] == DING_RUCHANG
    assert reversed_result["data"]["label"] == forward["data"]["label"]
    assert (
        reversed_result["data"]["shared_event_ids"]
        == forward["data"]["shared_event_ids"]
    )


def test_get_relation_synthesizes_background_from_event_summaries(
    tool_context: Any, assert_tool_contract: Callable[[dict[str, Any], str], None]
) -> None:
    result = get_relation(tool_context, person_id_a=LI_SHIMIN, person_id_b=WU_ZETIAN)
    assert_tool_contract(result, "get_relation")

    relation = result["data"]
    assert relation["label"] == "才人与帝王（入宫）"
    # 该关系无人工 description，只能由 event_summaries 拼接「来龙去脉」。
    assert relation["description"].startswith("武则天十四岁入宫")
    assert relation["basis_event_ids"] == ["tang-07"]
    assert set(relation["basis_event_ids"]).issubset(set(relation["shared_event_ids"]))


def test_get_relation_falls_back_to_shared_events(
    tool_context: Any, assert_tool_contract: Callable[[dict[str, Any], str], None]
) -> None:
    result = get_relation(tool_context, person_id_a=LIU_BANG, person_id_b=XIANG_YU)
    assert_tool_contract(result, "get_relation")

    relation = result["data"]
    assert result["ok"] is True
    assert result["meta"]["relation_found"] is False
    assert relation["label"] == "共同事件（关系库无定性记录）"
    assert relation["attribution"] == "史脉关系库（无人工定性记录）"
    assert relation["basis_event_ids"] == []
    assert relation["shared_event_ids"] == [
        "qin-liubang-xiangliang",
        "xihan-hongmen",
        "xihan-pengcheng",
        "xihan-gaixia",
    ]
    assert relation["description"]
    assert result["citations"]
    assert all(citation["kind"] == "event" for citation in result["citations"])


def test_get_relation_no_record_and_no_shared_event(
    tool_context: Any, assert_tool_contract: Callable[[dict[str, Any], str], None]
) -> None:
    result = get_relation(tool_context, person_id_a=KONG_ZI, person_id_b=LIANG_XIXIA)
    assert_tool_contract(result, "get_relation")

    relation = result["data"]
    assert result["ok"] is True
    assert result["meta"]["relation_found"] is False
    assert relation["label"] == "无直接关系记录"
    assert relation["shared_event_ids"] == []
    assert relation["basis_event_ids"] == []
    assert result["citations"] == []


def test_get_relation_rejects_same_person(
    tool_context: Any, assert_tool_contract: Callable[[dict[str, Any], str], None]
) -> None:
    result = get_relation(
        tool_context, person_id_a=DING_RUCHANG, person_id_b=DING_RUCHANG
    )
    assert_tool_contract(result, "get_relation")

    assert result["ok"] is False
    assert result["error"]["code"] == "INVALID_REQUEST"


def test_get_relation_unknown_person_returns_entity_not_found(
    tool_context: Any, assert_tool_contract: Callable[[dict[str, Any], str], None]
) -> None:
    result = get_relation(
        tool_context, person_id_a="p-nobody-0000", person_id_b=DING_RUCHANG
    )
    assert_tool_contract(result, "get_relation")

    assert result["ok"] is False
    assert result["error"]["code"] == "ENTITY_NOT_FOUND"


def test_get_relation_invalid_id_is_invalid_request(
    tool_context: Any, assert_tool_contract: Callable[[dict[str, Any], str], None]
) -> None:
    result = get_relation(tool_context, person_id_a="丁汝昌", person_id_b=DING_RUCHANG)
    assert_tool_contract(result, "get_relation")

    assert result["ok"] is False
    assert result["error"]["code"] == "INVALID_REQUEST"
