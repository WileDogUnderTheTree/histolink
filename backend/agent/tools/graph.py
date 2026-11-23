"""图谱工具：`get_era_graph`（V1.0.2）。

输入 `era_id`（细览 18 期）或 `scope_id`（简阅 7 组）二选一；可选 `center_person_id`
裁到中心人物的一跳邻居。节点上限 80、边上限 160，与工具契约一致。
"""

from __future__ import annotations

from collections.abc import Iterable, Mapping
from typing import Any

from .base import (
    DEFAULT_LIMIT,
    ToolContext,
    ToolEntityNotFound,
    ToolInputError,
    event_citations,
    parse_limit,
    parse_optional_text,
    parse_person_id,
    success,
    tool,
)

#: 图谱节点 / 边硬上限（与 `contracts/tools.py` 的 maxItems 一致）。
MAX_GRAPH_NODES = 80
MAX_GRAPH_EDGES = 160


def _node_payload(node: Mapping[str, Any]) -> dict[str, Any]:
    return {"person_id": node["person_id"], "name": node["name"]}


def _edge_payload(
    ctx: ToolContext, edge: Mapping[str, Any]
) -> dict[str, Any]:
    payload: dict[str, Any] = {
        "person_id_a": edge["person_id_a"],
        "person_id_b": edge["person_id_b"],
        "weight": int(edge.get("weight") or 1),
    }
    relation = ctx.relations_by_pair.get(
        frozenset((edge["person_id_a"], edge["person_id_b"]))
    )
    if relation is not None:
        payload["relation_label"] = relation["label"]
    return payload


def _ordered_node_ids(
    edges: Iterable[Mapping[str, Any]], center_person_id: str
) -> list[str]:
    """中心人物优先，其后按边权降序、person_id 升序的一跳邻居。"""

    neighbor_weights: dict[str, int] = {}
    for edge in edges:
        if edge["person_id_a"] == center_person_id:
            neighbor = edge["person_id_b"]
        elif edge["person_id_b"] == center_person_id:
            neighbor = edge["person_id_a"]
        else:
            continue
        weight = int(edge.get("weight") or 1)
        if weight > neighbor_weights.get(neighbor, 0):
            neighbor_weights[neighbor] = weight
    neighbors = sorted(neighbor_weights.items(), key=lambda item: (-item[1], item[0]))
    return [center_person_id, *(person_id for person_id, _ in neighbors)]


def _graph_citations(
    ctx: ToolContext, edges: Iterable[Mapping[str, Any]]
) -> list[Any]:
    """边引用的共同事件书目；按边权顺序取到上限为止。"""

    events = []
    seen_event_ids: set[str] = set()
    for edge in edges:
        for event_id in edge.get("shared_event_ids") or []:
            if event_id in seen_event_ids:
                continue
            event = ctx.events_by_id.get(event_id)
            if event is None:
                continue
            seen_event_ids.add(event_id)
            events.append(event)
    return event_citations(events)


@tool("get_era_graph")
def get_era_graph(
    ctx: ToolContext,
    era_id: str | None = None,
    scope_id: str | None = None,
    center_person_id: str | None = None,
    limit: int = DEFAULT_LIMIT,
) -> dict[str, Any]:
    """取某期（细览）或某断代（简阅）的人物图节点 / 边。"""

    era_text = parse_optional_text(era_id, "era_id", max_length=64)
    scope_text = parse_optional_text(scope_id, "scope_id", max_length=64)
    if (era_text is None) == (scope_text is None):
        raise ToolInputError("era_id 与 scope_id 必须且只能提供一个")
    parsed_limit = parse_limit(limit, maximum=MAX_GRAPH_NODES)
    center = (
        parse_person_id(center_person_id, "center_person_id")
        if center_person_id is not None
        else None
    )

    if era_text is not None:
        graph_source = ctx.era_by_id.get(era_text)
        if graph_source is None:
            raise ToolEntityNotFound(f"未知的期 ID：{era_text}")
        graph_data = graph_source.get("graph") or {}
        graph_key: dict[str, str] = {"era_id": era_text}
    else:
        assert scope_text is not None
        graph_source = ctx.scope_by_id.get(scope_text)
        if graph_source is None:
            raise ToolEntityNotFound(f"未知的断代 ID：{scope_text}")
        graph_data = graph_source.get("graph") or {}
        graph_key = {"scope_id": scope_text}

    all_nodes = list(graph_data.get("nodes") or [])
    all_edges = list(graph_data.get("edges") or [])
    node_by_id = {node["person_id"]: node for node in all_nodes}

    if center is not None:
        if center not in node_by_id:
            center_name = ctx.persons_by_id.get(center, {}).get("display_name")
            suffix = f"（{center_name}）" if center_name else ""
            raise ToolEntityNotFound(f"中心人物{suffix}不在该图中：{center}")
        ordered_ids = _ordered_node_ids(all_edges, center)
    else:
        ordered_ids = [node["person_id"] for node in all_nodes]

    selected_ids = ordered_ids[:parsed_limit]
    nodes_truncated = len(ordered_ids) > len(selected_ids)
    selected = set(selected_ids)
    nodes = [
        _node_payload(node_by_id[person_id])
        for person_id in selected_ids
        if person_id in node_by_id
    ]

    candidate_edges = [
        edge
        for edge in all_edges
        if edge["person_id_a"] in selected and edge["person_id_b"] in selected
    ]
    candidate_edges.sort(
        key=lambda edge: (
            -int(edge.get("weight") or 1),
            edge["person_id_a"],
            edge["person_id_b"],
        )
    )
    shown_edges = candidate_edges[:MAX_GRAPH_EDGES]
    edges = [_edge_payload(ctx, edge) for edge in shown_edges]
    truncated = nodes_truncated or len(candidate_edges) > len(shown_edges)

    data: dict[str, Any] = {
        **graph_key,
        "nodes": nodes,
        "edges": edges,
        "truncated": truncated,
    }
    if center is not None:
        data["center_person_id"] = center

    return success(
        ctx,
        "get_era_graph",
        data=data,
        items=nodes,
        citations=_graph_citations(ctx, shown_edges),
        truncated=truncated,
        meta={
            **graph_key,
            "node_total": len(all_nodes),
            "edge_total": len(all_edges),
            "node_returned": len(nodes),
            "edge_returned": len(edges),
            "limit": parsed_limit,
            "center_person_id": center,
        },
    )
