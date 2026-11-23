"""8 个只读工具的入参 / 出参契约（冻结于 V1.0.1 / TC-04，V1.0.2 实现）。

来源：审核报告 §9.1。工具原则：
- **只读**：不提供任何写操作；
- **有界**：`limit` 有上限；
- **返回 ID**，不返回自由文本作为实体标识；
- **空结果有明确语义**（`ok=false` + `ErrorCode` 或空列表 + `total=0`）。
"""

from __future__ import annotations

from typing import Any

JsonSchema = dict[str, Any]

STRING = {"type": "string", "minLength": 1}
LIMIT = {"type": "integer", "minimum": 1, "maximum": 80, "default": 20}
YEAR = {"type": "integer", "description": "史书纪年：公元前为负，不允许 0"}
PERSON_ID = {"type": "string", "pattern": r"^p-[a-z0-9]+(?:-[a-z0-9]+)*-[0-9a-f]{4}$"}
EVENT_ID = {"type": "string", "pattern": r"^[a-z0-9][a-z0-9-]*$"}
ERA_ID = {"type": "string", "minLength": 1}


def _object(properties: JsonSchema, required: list[str] | None = None) -> JsonSchema:
    return {
        "type": "object",
        "additionalProperties": False,
        "properties": properties,
        "required": required or [],
    }


def _array(items: JsonSchema, max_items: int = 80) -> JsonSchema:
    return {"type": "array", "items": items, "maxItems": max_items}


#: 工具出参的公共片段。
CANDIDATE = _object(
    {
        "person_id": PERSON_ID,
        "event_id": EVENT_ID,
        "name": {"type": "string"},
        "disambiguator": {"type": "string"},
        "era_ids": _array(ERA_ID, 10),
    },
    ["name", "disambiguator"],
)
EVENT_SUMMARY = _object(
    {
        "event_id": EVENT_ID,
        "title": {"type": "string"},
        "dynasty": {"type": "string"},
        "year": YEAR,
        "importance": {"type": "integer", "minimum": 1, "maximum": 3},
    },
    ["event_id", "title", "dynasty", "year"],
)
SOURCE_REF = _object(
    {
        "label": {"type": "string"},
        "book": {"type": "string"},
        "chapter": {"type": "string"},
        "raw": {"type": "string"},
    },
    ["label", "book", "raw"],
)

TOOLS: list[dict[str, Any]] = [
    {
        "name": "resolve_entity",
        "description": "把姓名/别名（可带时期上下文）解析为候选人物或事件；无上下文时必须返回全部候选，禁止默认取第一条。",
        "input": _object(
            {
                "query": STRING,
                "era_id": ERA_ID,
            },
            ["query"],
        ),
        "output": _object(
            {
                "candidates": _array(CANDIDATE, 10),
                "ambiguous": {"type": "boolean"},
            },
            ["candidates", "ambiguous"],
        ),
    },
    {
        "name": "search_events",
        "description": "按关键词 / 朝代 / 年份区间 / 最低重要度检索事件，返回结构化事件 ID 列表。",
        "input": _object(
            {
                "q": STRING,
                "dynasty": {"type": "string"},
                "year_range": _object(
                    {"start": YEAR, "end": YEAR},
                    ["start", "end"],
                ),
                "importance_min": {"type": "integer", "minimum": 1, "maximum": 3},
                "limit": LIMIT,
            },
            ["q"],
        ),
        "output": _object(
            {
                "events": _array(EVENT_SUMMARY, 80),
                "total": {"type": "integer", "minimum": 0},
            },
            ["events", "total"],
        ),
    },
    {
        "name": "get_event",
        "description": "按稳定 event_id 取事件全字段 + 参与者 person_id + 结构化引用。",
        "input": _object({"event_id": EVENT_ID}, ["event_id"]),
        "output": _object(
            {
                "event_id": EVENT_ID,
                "title": {"type": "string"},
                "dynasty": {"type": "string"},
                "year": YEAR,
                "description": {"type": "string"},
                "importance": {"type": "integer", "minimum": 1, "maximum": 3},
                "is_special": {"type": "boolean"},
                "person_ids": _array(PERSON_ID, 50),
                "source_refs": _array(SOURCE_REF, 10),
                "source_status": {"enum": ["cited", "easter_egg"]},
                "surface": _object(
                    {"timeline": {"type": "boolean"}, "graph": {"type": "boolean"}},
                    ["timeline", "graph"],
                ),
            },
            ["event_id", "title", "dynasty", "year", "description", "person_ids", "source_refs"],
        ),
    },
    {
        "name": "get_person",
        "description": "按 person_id 取人物主数据 + 别名 + 所在分期/断代 + 一句话提示。",
        "input": _object({"person_id": PERSON_ID}, ["person_id"]),
        "output": _object(
            {
                "person_id": PERSON_ID,
                "display_name": {"type": "string"},
                "romanized": {"type": "string"},
                "disambiguator": {"type": "string"},
                "aliases": _array({"type": "string"}, 20),
                "primary_dynasty": {"type": "string"},
                "dynasties": _array({"type": "string"}, 10),
                "era_ids": _array(ERA_ID, 20),
                "scope_ids": _array(ERA_ID, 10),
                "first_year": YEAR,
                "last_year": YEAR,
                "event_ids": _array(EVENT_ID, 200),
            },
            ["person_id", "display_name", "disambiguator", "primary_dynasty", "event_ids"],
        ),
    },
    {
        "name": "get_person_events",
        "description": "按 person_id 取参与事件（按年排序），并给出每人与谁同现。",
        "input": _object({"person_id": PERSON_ID, "limit": LIMIT}, ["person_id"]),
        "output": _object(
            {
                "events": _array(EVENT_SUMMARY, 80),
                "total": {"type": "integer", "minimum": 0},
                "co_occurring_person_ids": _array(PERSON_ID, 80),
            },
            ["events", "total", "co_occurring_person_ids"],
        ),
    },
    {
        "name": "get_relation",
        "description": "取两个人物的关系定性、共同事件与来龙去脉；关系引用不新增书目，只能用共同事件的 sourceRefs。",
        "input": _object(
            {"person_id_a": PERSON_ID, "person_id_b": PERSON_ID},
            ["person_id_a", "person_id_b"],
        ),
        "output": _object(
            {
                "person_id_a": PERSON_ID,
                "person_id_b": PERSON_ID,
                "label": {"type": "string"},
                "description": {"type": "string"},
                "shared_event_ids": _array(EVENT_ID, 50),
                "basis_event_ids": _array(EVENT_ID, 50),
                "attribution": {"type": "string"},
            },
            ["person_id_a", "person_id_b", "label", "shared_event_ids", "basis_event_ids", "attribution"],
        ),
    },
    {
        "name": "get_era_graph",
        "description": "取某期（细览）或某断代（简阅）的人物图节点/边，裁剪到上限 80；节点以 person_id + 姓名双写。",
        "input": _object(
            {
                "era_id": ERA_ID,
                "scope_id": ERA_ID,
                "center_person_id": PERSON_ID,
                "limit": {**LIMIT, "maximum": 80},
            },
            [],
        ),
        "output": _object(
            {
                "era_id": ERA_ID,
                "scope_id": ERA_ID,
                "center_person_id": PERSON_ID,
                "nodes": _array(
                    _object(
                        {"person_id": PERSON_ID, "name": {"type": "string"}},
                        ["person_id", "name"],
                    ),
                    80,
                ),
                "edges": _array(
                    _object(
                        {
                            "person_id_a": PERSON_ID,
                            "person_id_b": PERSON_ID,
                            "weight": {"type": "integer", "minimum": 1},
                            "relation_label": {"type": "string"},
                        },
                        ["person_id_a", "person_id_b", "weight"],
                    ),
                    160,
                ),
                "truncated": {"type": "boolean"},
            },
            ["nodes", "edges", "truncated"],
        ),
    },
    {
        "name": "timeline_span",
        "description": "取年份区间内的事件（史书纪年，含负数），返回总数与代表事件。",
        "input": _object({"start_year": YEAR, "end_year": YEAR, "limit": LIMIT}, ["start_year", "end_year"]),
        "output": _object(
            {
                "events": _array(EVENT_SUMMARY, 80),
                "total": {"type": "integer", "minimum": 0},
                "representative_event_ids": _array(EVENT_ID, 10),
            },
            ["events", "total", "representative_event_ids"],
        ),
    },
]

#: 工具契约 JSON Schema（导出为 contracts/tools-v1.schema.json）。
TOOLS_SCHEMA: dict[str, Any] = {
    "$schema": "https://json-schema.org/draft/2020-12/schema",
    "$id": "https://histolink.local/contracts/tools-v1.schema.json",
    "title": "史脉 V1.0 只读工具契约",
    "description": "8 个只读工具的入参/出参 JSON Schema；工具不暴露给浏览器（除 dev 调试）。",
    "version": "1.0",
    "tools": TOOLS,
}
