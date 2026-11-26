"""事件检索与时间轴工具：`search_events` / `get_event` / `get_person_events` / `timeline_span`。"""

from __future__ import annotations

from collections import Counter
from collections.abc import Iterable, Mapping
from typing import Any

from .base import (
    DEFAULT_LIMIT,
    ToolContext,
    ToolInputError,
    ensure_event,
    ensure_person,
    event_citations,
    event_priority_key,
    event_summary,
    format_year,
    parse_event_id,
    parse_importance_min,
    parse_limit,
    parse_optional_text,
    parse_person_id,
    parse_text,
    parse_year,
    parse_year_range,
    success,
    tool,
)

#: 查询里嵌入人物名时的最长查询长度（避免把整段长问句拆出过多词）。
_EMBEDDED_NAME_QUERY_MAX = 30
#: 允许做「人物名 + 事件词」扩展的事件词后缀（如「王安石变法」→「王安石」）。
#: 只限定在这些明确的事件名词上，避免把「秦始皇 西红柿」这类问题扩展成大量无关人物事件。
_EVENT_TOPIC_SUFFIXES = (
    "变法",
    "改革",
    "新政",
    "起义",
    "之变",
    "之战",
    "之乱",
    "之役",
    "改制",
)


def _search_terms(ctx: ToolContext, query: str) -> set[str]:
    """关键词 + 别名 / 人物名展开。

    - 问「唐太宗」时同时检索「李世民」（既有别名行为）；
    - V1.0.5.1：事件图谱标题与问法常不一致（如问「王安石变法」，图谱事件标题是「熙宁变法」），
      因此当查询是「已知人物名 + 明确事件词后缀」时，把该人物名也作为检索词，避免 Agent 为同一
      对象反复换词试探、在对比任务里白耗轮次。只新增检索词，不改变结果排序规则与证据要求。
    """

    terms = {query.casefold()}
    for person in ctx.store.persons_by_name.get(query, []):
        terms.add(person["display_name"].casefold())
    if len(query) <= _EMBEDDED_NAME_QUERY_MAX and not any(ch.isspace() for ch in query):
        for suffix in _EVENT_TOPIC_SUFFIXES:
            if not query.endswith(suffix):
                continue
            prefix = query[: -len(suffix)]
            for person in ctx.store.persons_by_name.get(prefix, []):
                terms.add(person["display_name"].casefold())
    return {term for term in terms if term}


def _score_event(event: Mapping[str, Any], terms: Iterable[str]) -> int:
    title = event["title"].casefold()
    description = event["description"].casefold()
    participants = {name.casefold() for name in event.get("participants") or []}
    score = 0
    for term in terms:
        if title == term:
            score += 100
        elif term in title:
            score += 20
        if term in participants:
            score += 10
        if term in description:
            score += 5
    return score


def _source_ref_dict(reference: Mapping[str, Any]) -> dict[str, Any]:
    payload = {
        "label": reference["label"],
        "book": reference["book"],
        "raw": reference["raw"],
    }
    if reference.get("chapter"):
        payload["chapter"] = reference["chapter"]
    return payload


def _co_occurring_person_ids(
    ctx: ToolContext, person_id: str, events: Iterable[Mapping[str, Any]]
) -> list[tuple[str, int]]:
    """按同现次数降序、person_id 升序返回（不含本人）。"""

    counter: Counter[str] = Counter()
    for event in events:
        for other_id in event.get("person_ids") or []:
            if other_id != person_id:
                counter[other_id] += 1
    return sorted(counter.items(), key=lambda item: (-item[1], item[0]))


@tool("search_events")
def search_events(
    ctx: ToolContext,
    q: str,
    dynasty: str | None = None,
    year_range: Mapping[str, Any] | None = None,
    importance_min: int | None = None,
    limit: int = DEFAULT_LIMIT,
) -> dict[str, Any]:
    """按关键词（标题 / 参与者 / 摘要）、朝代、年份区间、最低重要度检索事件。

    - 关键词必填（契约 `q` required），别名会展开为人物正名；
    - 彩蛋事件（`is_special`）默认排除，避免混入史实回答；
    - 空结果为 `ok=true` + `total=0`（明确「查无」而非报错）。
    """

    text = parse_text(q, "q", max_length=200)
    dynasty_text = parse_optional_text(dynasty, "dynasty", max_length=50)
    bounds = parse_year_range(year_range)
    importance_floor = parse_importance_min(importance_min)
    parsed_limit = parse_limit(limit)

    terms = _search_terms(ctx, text)
    scored: list[tuple[int, dict[str, Any]]] = []
    for event in ctx.events_by_id.values():
        if event.get("is_special"):
            continue
        if dynasty_text is not None and event["dynasty"] != dynasty_text:
            continue
        if bounds is not None and not (bounds[0] <= event["year"] <= bounds[1]):
            continue
        if (
            importance_floor is not None
            and int(event.get("importance") or 2) < importance_floor
        ):
            continue
        score = _score_event(event, terms)
        if score > 0:
            scored.append((score, event))

    scored.sort(
        key=lambda item: (
            -item[0],
            -int(item[1].get("importance") or 2),
            item[1]["year"],
            item[1]["event_id"],
        )
    )
    total = len(scored)
    shown = [event for _, event in scored[:parsed_limit]]
    events = [event_summary(event) for event in shown]

    return success(
        ctx,
        "search_events",
        data={"events": events, "total": total},
        items=events,
        citations=event_citations(shown),
        truncated=total > parsed_limit,
        meta={
            "total": total,
            "limit": parsed_limit,
            "terms": sorted(terms),
        },
    )


@tool("get_event")
def get_event(ctx: ToolContext, event_id: str) -> dict[str, Any]:
    """按稳定 `event_id` 取事件全字段 + 参与者 ID + 结构化引用。"""

    parsed_id = parse_event_id(event_id)
    event = ensure_event(ctx, parsed_id)
    surface = event.get("surface") or {"timeline": False, "graph": False}

    data = {
        "event_id": event["event_id"],
        "title": event["title"],
        "dynasty": event["dynasty"],
        "year": event["year"],
        "description": event["description"],
        "importance": int(event.get("importance") or 2),
        "is_special": bool(event.get("is_special")),
        "person_ids": list(event.get("person_ids") or [])[:50],
        "source_refs": [
            _source_ref_dict(reference)
            for reference in (event.get("source_refs") or [])[:10]
        ],
        "source_status": event.get("source_status", "cited"),
        "surface": {
            "timeline": bool(surface.get("timeline")),
            "graph": bool(surface.get("graph")),
        },
    }

    return success(
        ctx,
        "get_event",
        data=data,
        items=[data],
        citations=event_citations([event]),
        truncated=False,
        meta={
            "fact_usable": not bool(event.get("is_special")),
            "source_ref_total": len(event.get("source_refs") or []),
        },
    )


@tool("get_person_events")
def get_person_events(
    ctx: ToolContext, person_id: str, limit: int = DEFAULT_LIMIT
) -> dict[str, Any]:
    """按人物取参与事件（按年排序），并给出每人与谁同现（按同现次数排序）。"""

    parsed_id = parse_person_id(person_id)
    person = ensure_person(ctx, parsed_id)
    parsed_limit = parse_limit(limit)

    person_events = ctx.events_by_person.get(parsed_id) or ()
    total = len(person_events)
    shown = list(person_events[:parsed_limit])
    events = [event_summary(event) for event in shown]
    co_occurring = _co_occurring_person_ids(ctx, parsed_id, person_events)

    data = {
        "events": events,
        "total": total,
        "co_occurring_person_ids": [other_id for other_id, _ in co_occurring[:80]],
    }

    return success(
        ctx,
        "get_person_events",
        data=data,
        items=events,
        citations=event_citations(shown),
        truncated=total > parsed_limit,
        meta={
            "person_name": person["display_name"],
            "total": total,
            "limit": parsed_limit,
            "co_occurring_total": len(co_occurring),
        },
    )


@tool("timeline_span")
def timeline_span(
    ctx: ToolContext, start_year: int, end_year: int, limit: int = DEFAULT_LIMIT
) -> dict[str, Any]:
    """取年份区间内的事件（史书纪年，含负数），返回总数与代表事件。

    - 区间为闭区间；`year=0` 非法（史书纪年无公元 0 年）；
    - 彩蛋事件默认排除；
    - `representative_event_ids` 按重要度从**全量区间**中挑，不受 `limit` 影响。
    """

    start = parse_year(start_year, "start_year")
    end = parse_year(end_year, "end_year")
    if start > end:
        raise ToolInputError("start_year 不能晚于 end_year")
    parsed_limit = parse_limit(limit)

    matched = [
        event
        for event in ctx.events_by_id.values()
        if not event.get("is_special") and start <= event["year"] <= end
    ]
    total = len(matched)
    ordered = sorted(
        matched,
        key=lambda event: (
            event["year"],
            -int(event.get("importance") or 2),
            event["event_id"],
        ),
    )
    shown = ordered[:parsed_limit]
    representative = sorted(matched, key=event_priority_key)[:10]
    events = [event_summary(event) for event in shown]

    data = {
        "events": events,
        "total": total,
        "representative_event_ids": [event["event_id"] for event in representative],
    }

    return success(
        ctx,
        "timeline_span",
        data=data,
        items=events,
        citations=event_citations(representative),
        truncated=total > parsed_limit,
        meta={
            "start_year": start,
            "end_year": end,
            "start_label": format_year(start),
            "end_label": format_year(end),
            "total": total,
            "limit": parsed_limit,
        },
    )
