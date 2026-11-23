"""事件工具测试：`search_events` / `get_event` / `get_person_events` / `timeline_span`。"""

from __future__ import annotations

from collections.abc import Callable
from typing import Any

from agent.tools import get_event, get_person_events, search_events, timeline_span

LI_SHIMIN = "p-lishimin-7efd"
WU_ZETIAN = "p-wuzetian-2920"


def test_search_events_by_keyword(
    tool_context: Any, assert_tool_contract: Callable[[dict[str, Any], str], None]
) -> None:
    result = search_events(tool_context, q="赤壁")
    assert_tool_contract(result, "search_events")

    assert result["ok"] is True
    assert result["data"]["total"] == 1
    event = result["data"]["events"][0]
    assert event["event_id"] == "handong-chibi"
    assert event["title"] == "赤壁之战"
    assert event["year"] == 208
    assert event["importance"] == 3
    assert result["truncated"] is False
    assert result["citations"]


def test_search_events_by_dynasty_and_year_range(
    tool_context: Any, assert_tool_contract: Callable[[dict[str, Any], str], None]
) -> None:
    result = search_events(
        tool_context,
        q="安史",
        dynasty="唐",
        year_range={"start": 750, "end": 760},
    )
    assert_tool_contract(result, "search_events")

    assert result["ok"] is True
    assert result["data"]["total"] == 2
    event_ids = {event["event_id"] for event in result["data"]["events"]}
    assert event_ids == {"tang-17", "tang-20"}
    for event in result["data"]["events"]:
        assert event["dynasty"] == "唐"
        assert 750 <= event["year"] <= 760


def test_search_events_expands_alias(
    tool_context: Any, assert_tool_contract: Callable[[dict[str, Any], str], None]
) -> None:
    result = search_events(tool_context, q="唐太宗", dynasty="唐", limit=5)
    assert_tool_contract(result, "search_events")

    assert result["ok"] is True
    assert result["data"]["total"] > 0
    # 「唐太宗」是别名，检索时应展开到正名「李世民」参与的事件。
    event_ids = {event["event_id"] for event in result["data"]["events"]}
    assert "tang-04" in event_ids
    assert set(result["meta"]["terms"]) == {"唐太宗", "李世民"}


def test_search_events_respects_limit_and_marks_truncated(
    tool_context: Any, assert_tool_contract: Callable[[dict[str, Any], str], None]
) -> None:
    result = search_events(tool_context, q="孔子", limit=2)
    assert_tool_contract(result, "search_events")

    assert result["ok"] is True
    assert result["data"]["total"] == 7
    assert len(result["data"]["events"]) == 2
    assert result["truncated"] is True


def test_search_events_empty_result_is_explicit(
    tool_context: Any, assert_tool_contract: Callable[[dict[str, Any], str], None]
) -> None:
    result = search_events(tool_context, q="完全不存在的事件关键词")
    assert_tool_contract(result, "search_events")

    assert result["ok"] is True
    assert result["data"] == {"events": [], "total": 0}
    assert result["items"] == []
    assert result["citations"] == []
    assert result["truncated"] is False


def test_search_events_excludes_special_easter_egg(
    tool_context: Any, assert_tool_contract: Callable[[dict[str, Any], str], None]
) -> None:
    result = search_events(tool_context, q="教员")
    assert_tool_contract(result, "search_events")

    assert result["ok"] is True
    assert result["data"]["total"] == 0
    assert result["items"] == []


def test_search_events_invalid_year_range(
    tool_context: Any, assert_tool_contract: Callable[[dict[str, Any], str], None]
) -> None:
    result = search_events(tool_context, q="赤壁", year_range={"start": 220, "end": 200})
    assert_tool_contract(result, "search_events")

    assert result["ok"] is False
    assert result["error"]["code"] == "INVALID_REQUEST"


def test_search_events_rejects_year_zero(
    tool_context: Any, assert_tool_contract: Callable[[dict[str, Any], str], None]
) -> None:
    result = search_events(tool_context, q="赤壁", year_range={"start": 0, "end": 220})
    assert_tool_contract(result, "search_events")

    assert result["ok"] is False
    assert result["error"]["code"] == "INVALID_REQUEST"


def test_search_events_rejects_out_of_range_limit(
    tool_context: Any, assert_tool_contract: Callable[[dict[str, Any], str], None]
) -> None:
    result = search_events(tool_context, q="赤壁", limit=81)
    assert_tool_contract(result, "search_events")

    assert result["ok"] is False
    assert result["error"]["code"] == "INVALID_REQUEST"


def test_get_event_details(
    tool_context: Any, assert_tool_contract: Callable[[dict[str, Any], str], None]
) -> None:
    result = get_event(tool_context, event_id="xixia-09")
    assert_tool_contract(result, "get_event")

    event = result["data"]
    assert result["ok"] is True
    assert event["event_id"] == "xixia-09"
    assert event["title"] == "灵州之战"
    assert event["dynasty"] == "西夏"
    assert event["year"] == 1081
    assert event["importance"] == 2  # 快照缺省 importance 视为 2（与前端一致）
    assert "p-liangtaihou-xixia-0d0f" in event["person_ids"]
    assert event["source_refs"][0]["book"] == "宋史"
    assert event["source_refs"][0]["chapter"] == "夏国传"
    assert event["surface"] == {"timeline": True, "graph": True}
    assert result["meta"]["fact_usable"] is True
    assert result["citations"][0]["source_ref"]["book"] == "宋史"


def test_get_event_special_easter_egg_is_explicit(
    tool_context: Any, assert_tool_contract: Callable[[dict[str, Any], str], None]
) -> None:
    result = get_event(tool_context, event_id="special-star-1893")
    assert_tool_contract(result, "get_event")

    event = result["data"]
    assert result["ok"] is True
    assert event["is_special"] is True
    assert event["source_status"] == "easter_egg"
    assert event["source_refs"] == []
    assert result["citations"] == []
    assert result["meta"]["fact_usable"] is False


def test_get_event_unknown_returns_entity_not_found(
    tool_context: Any, assert_tool_contract: Callable[[dict[str, Any], str], None]
) -> None:
    result = get_event(tool_context, event_id="no-such-event")
    assert_tool_contract(result, "get_event")

    assert result["ok"] is False
    assert result["error"]["code"] == "ENTITY_NOT_FOUND"


def test_get_event_invalid_id_is_invalid_request(
    tool_context: Any, assert_tool_contract: Callable[[dict[str, Any], str], None]
) -> None:
    result = get_event(tool_context, event_id="Bad Event ID")
    assert_tool_contract(result, "get_event")

    assert result["ok"] is False
    assert result["error"]["code"] == "INVALID_REQUEST"


def test_get_person_events_sorted_with_co_occurrence(
    tool_context: Any, assert_tool_contract: Callable[[dict[str, Any], str], None]
) -> None:
    result = get_person_events(tool_context, person_id=LI_SHIMIN, limit=3)
    assert_tool_contract(result, "get_person_events")

    assert result["ok"] is True
    assert result["data"]["total"] == 10
    assert len(result["data"]["events"]) == 3
    assert result["truncated"] is True
    years = [event["year"] for event in result["data"]["events"]]
    assert years == sorted(years)

    co_occurring = result["data"]["co_occurring_person_ids"]
    assert len(co_occurring) == 17
    assert LI_SHIMIN not in co_occurring
    assert WU_ZETIAN in co_occurring
    assert len(set(co_occurring)) == len(co_occurring)
    assert result["meta"]["co_occurring_total"] == 17
    assert result["citations"]


def test_get_person_events_unknown_returns_entity_not_found(
    tool_context: Any, assert_tool_contract: Callable[[dict[str, Any], str], None]
) -> None:
    result = get_person_events(tool_context, person_id="p-nobody-0000")
    assert_tool_contract(result, "get_person_events")

    assert result["ok"] is False
    assert result["error"]["code"] == "ENTITY_NOT_FOUND"


def test_timeline_span_negative_years(
    tool_context: Any, assert_tool_contract: Callable[[dict[str, Any], str], None]
) -> None:
    result = timeline_span(tool_context, start_year=-260, end_year=-221, limit=3)
    assert_tool_contract(result, "timeline_span")

    assert result["ok"] is True
    assert result["data"]["total"] == 23
    assert len(result["data"]["events"]) == 3
    assert result["truncated"] is True
    years = [event["year"] for event in result["data"]["events"]]
    assert years == sorted(years)
    assert years[0] == -260

    representative = result["data"]["representative_event_ids"]
    assert len(representative) <= 10
    assert "qin-unify" in representative
    assert result["meta"]["start_label"] == "前260年"
    assert result["meta"]["end_label"] == "前221年"


def test_timeline_span_empty_range_is_explicit(
    tool_context: Any, assert_tool_contract: Callable[[dict[str, Any], str], None]
) -> None:
    result = timeline_span(tool_context, start_year=1900, end_year=1901)
    assert_tool_contract(result, "timeline_span")

    assert result["ok"] is True
    assert result["data"]["total"] == 0
    assert result["data"]["events"] == []
    assert result["data"]["representative_event_ids"] == []
    assert result["items"] == []
    assert result["citations"] == []


def test_timeline_span_excludes_special_event(
    tool_context: Any, assert_tool_contract: Callable[[dict[str, Any], str], None]
) -> None:
    result = timeline_span(tool_context, start_year=1893, end_year=1893)
    assert_tool_contract(result, "timeline_span")

    assert result["ok"] is True
    assert result["data"]["total"] == 0


def test_timeline_span_rejects_reversed_range(
    tool_context: Any, assert_tool_contract: Callable[[dict[str, Any], str], None]
) -> None:
    result = timeline_span(tool_context, start_year=220, end_year=200)
    assert_tool_contract(result, "timeline_span")

    assert result["ok"] is False
    assert result["error"]["code"] == "INVALID_REQUEST"
