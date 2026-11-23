"""实体工具测试：`resolve_entity` / `get_person`（V1.0.2）。

全部使用真实快照（`backend/data/snapshot.v1.json`），不 mock、不发 HTTP。
"""

from __future__ import annotations

from collections.abc import Callable
from typing import Any

from agent.tools import get_person, resolve_entity

LIANG_HAN = "p-liangtaihou-handong-90be"
LIANG_XIXIA = "p-liangtaihou-xixia-0d0f"
LI_SHIMIN = "p-lishimin-7efd"


def test_resolve_entity_returns_all_candidates_without_context(
    tool_context: Any, assert_tool_contract: Callable[[dict[str, Any], str], None]
) -> None:
    result = resolve_entity(tool_context, query="梁太后")
    assert_tool_contract(result, "resolve_entity")

    assert result["ok"] is True
    candidates = result["data"]["candidates"]
    assert len(candidates) == 2
    assert result["data"]["ambiguous"] is True
    assert result["truncated"] is False
    assert {candidate["person_id"] for candidate in candidates} == {LIANG_HAN, LIANG_XIXIA}
    assert all(candidate["disambiguator"] for candidate in candidates)
    assert len({candidate["disambiguator"] for candidate in candidates}) == 2
    # 无上下文时不允许默认取第一条：两条候选都要在 items 中出现。
    assert {item["person_id"] for item in result["items"]} == {LIANG_HAN, LIANG_XIXIA}


def test_resolve_entity_narrows_by_era(
    tool_context: Any, assert_tool_contract: Callable[[dict[str, Any], str], None]
) -> None:
    result = resolve_entity(tool_context, query="梁太后", era_id="xixia")
    assert_tool_contract(result, "resolve_entity")

    assert result["ok"] is True
    assert result["data"]["ambiguous"] is False
    assert [candidate["person_id"] for candidate in result["data"]["candidates"]] == [
        LIANG_XIXIA
    ]


def test_resolve_entity_era_filter_selects_han_record(
    tool_context: Any, assert_tool_contract: Callable[[dict[str, Any], str], None]
) -> None:
    result = resolve_entity(tool_context, query="梁太后", era_id="qinhan")
    assert_tool_contract(result, "resolve_entity")

    assert [candidate["person_id"] for candidate in result["data"]["candidates"]] == [
        LIANG_HAN
    ]
    assert result["data"]["ambiguous"] is False


def test_resolve_entity_resolves_global_alias(
    tool_context: Any, assert_tool_contract: Callable[[dict[str, Any], str], None]
) -> None:
    result = resolve_entity(tool_context, query="唐太宗")
    assert_tool_contract(result, "resolve_entity")

    assert result["ok"] is True
    assert result["data"]["ambiguous"] is False
    candidate = result["data"]["candidates"][0]
    assert candidate["person_id"] == LI_SHIMIN
    assert candidate["name"] == "李世民"


def test_resolve_entity_falls_back_to_event_title(
    tool_context: Any, assert_tool_contract: Callable[[dict[str, Any], str], None]
) -> None:
    result = resolve_entity(tool_context, query="赤壁之战")
    assert_tool_contract(result, "resolve_entity")

    assert result["ok"] is True
    candidate = result["data"]["candidates"][0]
    assert candidate["event_id"] == "handong-chibi"
    assert candidate["name"] == "赤壁之战"
    assert result["data"]["ambiguous"] is False


def test_resolve_entity_unknown_returns_entity_not_found(
    tool_context: Any, assert_tool_contract: Callable[[dict[str, Any], str], None]
) -> None:
    result = resolve_entity(tool_context, query="完全不存在的人物")
    assert_tool_contract(result, "resolve_entity")

    assert result["ok"] is False
    assert result["error"]["code"] == "ENTITY_NOT_FOUND"
    assert result["items"] == []
    assert result["citations"] == []
    assert result["snapshot_version"]


def test_resolve_entity_unknown_era_returns_entity_not_found(
    tool_context: Any, assert_tool_contract: Callable[[dict[str, Any], str], None]
) -> None:
    result = resolve_entity(tool_context, query="梁太后", era_id="no-such-era")
    assert_tool_contract(result, "resolve_entity")

    assert result["ok"] is False
    assert result["error"]["code"] == "ENTITY_NOT_FOUND"


def test_resolve_entity_empty_query_is_invalid(
    tool_context: Any, assert_tool_contract: Callable[[dict[str, Any], str], None]
) -> None:
    result = resolve_entity(tool_context, query="   ")
    assert_tool_contract(result, "resolve_entity")

    assert result["ok"] is False
    assert result["error"]["code"] == "INVALID_REQUEST"


def test_get_person_returns_master_data(
    tool_context: Any, assert_tool_contract: Callable[[dict[str, Any], str], None]
) -> None:
    result = get_person(tool_context, person_id=LIANG_XIXIA)
    assert_tool_contract(result, "get_person")

    person = result["data"]
    assert result["ok"] is True
    assert person["person_id"] == LIANG_XIXIA
    assert person["display_name"] == "梁太后"
    assert person["disambiguator"] == "西夏·毅宗后"
    assert person["primary_dynasty"] == "西夏"
    assert "xixia" in person["era_ids"]
    assert person["first_year"] == 1081 and person["last_year"] == 1082
    assert "xixia-09" in person["event_ids"]
    assert result["items"] == [person]
    # 人物详情必须能给出可引用的事件来源。
    assert result["citations"]
    assert all(citation["kind"] == "event" for citation in result["citations"])


def test_get_person_unknown_returns_entity_not_found(
    tool_context: Any, assert_tool_contract: Callable[[dict[str, Any], str], None]
) -> None:
    result = get_person(tool_context, person_id="p-nobody-0000")
    assert_tool_contract(result, "get_person")

    assert result["ok"] is False
    assert result["error"]["code"] == "ENTITY_NOT_FOUND"


def test_get_person_invalid_id_is_invalid_request(
    tool_context: Any, assert_tool_contract: Callable[[dict[str, Any], str], None]
) -> None:
    result = get_person(tool_context, person_id="not-a-person-id")
    assert_tool_contract(result, "get_person")

    assert result["ok"] is False
    assert result["error"]["code"] == "INVALID_REQUEST"
