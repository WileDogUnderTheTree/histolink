"""实体消歧与人物详情工具：`resolve_entity` / `get_person`（V1.0.2）。"""

from __future__ import annotations

from collections.abc import Mapping
from typing import Any

from .base import (
    ToolContext,
    ToolEntityNotFound,
    ensure_person,
    event_citations,
    event_priority_key,
    format_disambiguator,
    format_year,
    parse_optional_text,
    parse_person_id,
    parse_text,
    person_in_period,
    resolve_period,
    success,
    tool,
)

#: 候选上限（`CANDIDATE` 数组 maxItems=10）。
MAX_CANDIDATES = 10


def _person_candidate(person: Mapping[str, Any]) -> dict[str, Any]:
    return {
        "person_id": person["person_id"],
        "name": person["display_name"],
        "disambiguator": format_disambiguator(person),
        "era_ids": list(person.get("era_ids") or [])[:10],
    }


def _event_era_ids(ctx: ToolContext, event: Mapping[str, Any]) -> list[str]:
    """事件所属分期：按「朝代 ∈ era.dynasties」反查（可能有多期，如东汉属秦汉/三国）。"""

    dynasty = event["dynasty"]
    return [
        era_id
        for era_id, era in ctx.era_by_id.items()
        if dynasty in (era.get("dynasties") or [])
    ][:10]


def _event_candidate(ctx: ToolContext, event: Mapping[str, Any]) -> dict[str, Any]:
    return {
        "event_id": event["event_id"],
        "name": event["title"],
        "disambiguator": f"{event['dynasty']}·{format_year(event['year'])}",
        "era_ids": _event_era_ids(ctx, event),
    }


def _dedupe_persons(persons: list[dict[str, Any]]) -> list[dict[str, Any]]:
    seen: set[str] = set()
    unique: list[dict[str, Any]] = []
    for person in persons:
        person_id = person["person_id"]
        if person_id in seen:
            continue
        seen.add(person_id)
        unique.append(person)
    return unique


def _resolve_citations(ctx: ToolContext, candidates: list[dict[str, Any]]) -> list[Any]:
    """候选的引用素材：人物取最早一条事件，事件取自身书目。"""

    events = []
    for candidate in candidates:
        person_id = candidate.get("person_id")
        if person_id:
            person_events = ctx.events_by_person.get(person_id) or ()
            if person_events:
                events.append(person_events[0])
            continue
        event_id = candidate.get("event_id")
        if event_id and event_id in ctx.events_by_id:
            events.append(ctx.events_by_id[event_id])
    return event_citations(events)


@tool("resolve_entity")
def resolve_entity(
    ctx: ToolContext, query: str, era_id: str | None = None
) -> dict[str, Any]:
    """把姓名 / 别名（可带时期上下文）解析为候选人物，必要时回退到事件标题。

    - 无时期上下文时必须返回**全部**候选（最多 10 条），`ambiguous` 标识是否歧义；
    - 禁止默认取第一条：是否收敛由调用方（澄清或上下文）决定。
    """

    text = parse_text(query, "query", max_length=100)
    period_id = parse_optional_text(era_id, "era_id", max_length=64)
    dynasties: set[str] | None = None
    if period_id is not None:
        _, dynasties = resolve_period(ctx, period_id)

    candidates: list[dict[str, Any]] = []
    truncated = False

    # 1) 精确姓名 / 别名（含大小写归一）
    normalized = text.casefold()
    exact_persons = [
        person
        for person in ctx.persons_by_id.values()
        if any(
            name.casefold() == normalized
            for name in [person["display_name"], *(person.get("aliases") or [])]
        )
        and person_in_period(person, period_id, dynasties)
    ]
    exact_persons = _dedupe_persons(exact_persons)
    exact_persons.sort(key=lambda person: (person["first_year"], person["person_id"]))

    if exact_persons:
        truncated = len(exact_persons) > MAX_CANDIDATES
        candidates = [
            _person_candidate(person) for person in exact_persons[:MAX_CANDIDATES]
        ]
    else:
        # 2) 姓名 / 别名子串（容忍「唐太宗李世民」这类带前缀的提问）
        substring_persons = [
            person
            for person in ctx.persons_by_id.values()
            if person_in_period(person, period_id, dynasties)
            and any(
                len(name) >= 2
                and (normalized in name.casefold() or name.casefold() in normalized)
                for name in [person["display_name"], *(person.get("aliases") or [])]
            )
        ]
        substring_persons = _dedupe_persons(substring_persons)
        substring_persons.sort(
            key=lambda person: (person["first_year"], person["person_id"])
        )
        if substring_persons:
            truncated = len(substring_persons) > MAX_CANDIDATES
            candidates = [
                _person_candidate(person)
                for person in substring_persons[:MAX_CANDIDATES]
            ]

    # 3) 人物解析不到时，回退到事件标题（如「赤壁之战」）
    if not candidates:
        pool = [
            event
            for event in ctx.events_by_id.values()
            if not event.get("is_special")
            and (dynasties is None or event["dynasty"] in dynasties)
        ]
        exact_events = [
            event for event in pool if event["title"].casefold() == normalized
        ]
        if exact_events:
            matched_events = exact_events
        else:
            matched_events = [
                event
                for event in pool
                if len(event["title"]) >= 2
                and (
                    normalized in event["title"].casefold()
                    or event["title"].casefold() in normalized
                )
            ]
        matched_events.sort(key=lambda event: (event["year"], event["event_id"]))
        truncated = len(matched_events) > MAX_CANDIDATES
        candidates = [
            _event_candidate(ctx, event) for event in matched_events[:MAX_CANDIDATES]
        ]

    if not candidates:
        raise ToolEntityNotFound(f"无法解析实体：{text}")

    data = {"candidates": candidates, "ambiguous": len(candidates) > 1}
    citations = _resolve_citations(ctx, candidates)
    return success(
        ctx,
        "resolve_entity",
        data=data,
        items=candidates,
        citations=citations,
        truncated=truncated,
        meta={
            "candidate_count": len(candidates),
            "ambiguous": data["ambiguous"],
            "period_id": period_id,
        },
    )


@tool("get_person")
def get_person(ctx: ToolContext, person_id: str) -> dict[str, Any]:
    """按稳定 `person_id` 取人物主数据 + 别名 + 分期 + 关联事件 ID。"""

    parsed_id = parse_person_id(person_id)
    person = ensure_person(ctx, parsed_id)
    person_events = ctx.events_by_person.get(parsed_id) or ()

    data = {
        "person_id": person["person_id"],
        "display_name": person["display_name"],
        "romanized": person["romanized"],
        "disambiguator": format_disambiguator(person),
        "aliases": list(person.get("aliases") or [])[:20],
        "primary_dynasty": person["primary_dynasty"],
        "dynasties": list(person.get("dynasties") or [])[:10],
        "era_ids": list(person.get("era_ids") or [])[:20],
        "scope_ids": list(person.get("scope_ids") or [])[:10],
        "first_year": person["first_year"],
        "last_year": person["last_year"],
        "event_ids": list(person.get("event_ids") or [])[:200],
    }

    # 引用素材：重要度最高的 5 条事件（无引用的事件自然跳过）。
    key_events = sorted(person_events, key=event_priority_key)[:5]
    citations = event_citations(key_events)
    return success(
        ctx,
        "get_person",
        data=data,
        items=[data],
        citations=citations,
        truncated=False,
        meta={
            "event_total": len(person_events),
            "event_ids_truncated": len(person.get("event_ids") or []) > 200,
        },
    )
