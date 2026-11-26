"""关系工具：`get_relation`（V1.0.2）。

关系引用边界（审核报告 §8.1 Q3）：
- 关系描述是人工校订的定性文字，**没有「据《…》」书目**，不得编造出处；
- 引用只取该关系 `basis_event_ids` 指向的共同事件书目，关系定性本身标注关系库归属；
- 关系库无记录的两人，仍可返回**共同事件**（由快照事件参与人求交），但明确标注「无定性记录」。
"""

from __future__ import annotations

from typing import Any

from .base import (
    RELATION_ATTRIBUTION,
    RELATION_NO_RECORD_ATTRIBUTION,
    ToolContext,
    ToolInputError,
    ensure_person,
    event_citations,
    parse_person_id,
    relation_background,
    relation_citation,
    success,
    tool,
)


@tool("get_relation")
def get_relation(
    ctx: ToolContext, person_id_a: str, person_id_b: str
) -> dict[str, Any]:
    """取两个人物之间的关系定性、共同事件与来龙去脉。"""

    person_a_id = parse_person_id(person_id_a, "person_id_a")
    person_b_id = parse_person_id(person_id_b, "person_id_b")
    if person_a_id == person_b_id:
        raise ToolInputError("person_id_a 与 person_id_b 不能是同一人")

    person_a = ensure_person(ctx, person_a_id)
    person_b = ensure_person(ctx, person_b_id)

    events_a = set(person_a.get("event_ids") or [])
    events_b = set(person_b.get("event_ids") or [])
    shared_event_ids = sorted(
        events_a & events_b,
        key=lambda event_id: (
            ctx.events_by_id[event_id]["year"],
            event_id,
        ),
    )

    relation = ctx.relations_by_pair.get(frozenset((person_a_id, person_b_id)))
    if relation is not None:
        label = relation["label"]
        attribution = str(relation.get("attribution") or RELATION_ATTRIBUTION)
        basis_event_ids = list(relation.get("basis_event_ids") or [])
        background = relation_background(relation)
        citations = [relation_citation(relation)]
        citations = _merge_event_citations(
            citations,
            [
                ctx.events_by_id[event_id]
                for event_id in basis_event_ids
                if event_id in ctx.events_by_id
            ],
        )
    else:
        basis_event_ids = []
        shared_events = [
            ctx.events_by_id[event_id]
            for event_id in shared_event_ids
            if event_id in ctx.events_by_id
        ]
        if shared_events:
            label = "共同事件（关系库无定性记录）"
            background = (
                f"关系库暂无{person_a['display_name']}与{person_b['display_name']}的定性记录；"
                f"两人共同参与 {len(shared_events)} 个事件，引用来自这些事件的书目。"
            )
        else:
            label = "无直接关系记录"
            background = (
                f"关系库无{person_a['display_name']}与{person_b['display_name']}的定性记录，"
                "两人也没有共同事件。"
            )
        attribution = RELATION_NO_RECORD_ATTRIBUTION
        citations = event_citations(shared_events)

    data: dict[str, Any] = {
        "person_id_a": person_a_id,
        "person_id_b": person_b_id,
        "label": label,
        "shared_event_ids": shared_event_ids[:50],
        "basis_event_ids": basis_event_ids[:50],
        "attribution": attribution,
    }
    if background:
        data["description"] = background[:1000]

    return success(
        ctx,
        "get_relation",
        data=data,
        items=[data],
        citations=citations,
        truncated=len(shared_event_ids) > 50 or len(basis_event_ids) > 50,
        meta={
            "relation_found": relation is not None,
            "person_a_name": person_a["display_name"],
            "person_b_name": person_b["display_name"],
            "shared_event_total": len(shared_event_ids),
            "basis_event_total": len(basis_event_ids),
        },
    )


def _merge_event_citations(
    citations: list[Any], events: list[dict[str, Any]]
) -> list[Any]:
    """关系引用在前，共同事件引用在后，按 id 去重。"""

    seen = {citation.id for citation in citations}
    for citation in event_citations(events):
        if citation.id not in seen:
            seen.add(citation.id)
            citations.append(citation)
    return citations
