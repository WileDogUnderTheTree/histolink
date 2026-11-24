"""9 个只读工具的入参 / 出参契约（冻结于 V1.0.1 / TC-04，V1.0.2 更新统一返回信封）。

V1.0.5 新增第 9 个工具 ``search_historical_text``（RAG 史料检索），并给
``Citation`` 增加可选 ``kind="rag"`` 与 ``record_type``（正史 / 传说），均为**新增可选值**，
不破坏既有调用方。

来源：审核报告 §9.1。工具原则：
- **只读**：不提供任何写操作；
- **有界**：`limit` 有上限；
- **返回 ID**，不返回自由文本作为实体标识；
- **空结果有明确语义**（`ok=false` + `ErrorCode` 或空列表 + `total=0`）。

V1.0.2 变更（已获产品批复）：
- `output` 由「工具专属出参」升级为**统一返回信封**（`ToolResult`），
  成功/失败两个变体用 `oneOf` 表达；
- 工具专属出参收进信封的 `data` 字段，其 schema 与 V1.0.1 完全一致；
- 新增 `items` / `citations` / `truncated` / `snapshot_version` 四个统一字段；
- 生成物 `contracts/tools-v1.schema.json` 由 `backend/scripts/export_contracts.py` 导出。
"""

from __future__ import annotations

from typing import Any

from contracts.models import ErrorCode

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


def _nullable_string(max_length: int) -> JsonSchema:
    return {"type": ["string", "null"], "maxLength": max_length}


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

#: `contracts.models.SourceRefModel` 的 JSON Schema 镜像（citation 里 chapter 可为 null）。
CITATION_SOURCE_REF = _object(
    {
        "label": {"type": "string"},
        "book": {"type": "string"},
        "chapter": _nullable_string(200),
        "raw": {"type": "string"},
    },
    ["label", "book", "raw"],
)
#: `contracts.models.Citation` 的 JSON Schema 镜像（统一信封 citations[] 使用）。
CITATION = _object(
    {
        "id": STRING,
        "kind": {"enum": ["event", "relation", "person", "rag"]},
        "event_id": _nullable_string(128),
        "person_id": _nullable_string(128),
        "relation_id": _nullable_string(256),
        "title": {"type": "string", "minLength": 1, "maxLength": 300},
        "year": {"type": ["integer", "null"]},
        "dynasty": _nullable_string(50),
        "quote": _nullable_string(2000),
        "source_label": _nullable_string(200),
        "source_ref": {"anyOf": [CITATION_SOURCE_REF, {"type": "null"}]},
        "attribution": {"type": "string", "minLength": 1, "maxLength": 300},
        "license": {"const": "CC BY-NC-SA 4.0"},
        "record_type": {"enum": ["正史", "传说", None]},
    },
    ["id", "kind", "title", "attribution", "license"],
)

#: RAG 史料 chunk（`search_historical_text` 的 data.chunks[] / items[]）。
RAG_CHUNK = _object(
    {
        "chunk_id": STRING,
        "event_name": {"type": "string"},
        "title": {"type": "string"},
        "text": {"type": "string", "maxLength": 300},
        "type": {"enum": ["正史", "传说"]},
        "record_type": {"enum": ["正史", "传说"]},
        "section": {"type": "string"},
        "source": {"type": "string"},
        "score": {"type": "number"},
        "source_label": {"type": "string"},
        "book": {"type": "string"},
        "chapter": {"type": "string"},
        "event_id": EVENT_ID,
        "year_min": YEAR,
        "year_max": YEAR,
    },
    ["chunk_id", "event_name", "text", "record_type", "section", "score"],
)

#: 工具失败信封的 error（`contracts.models.ToolError`）。
TOOL_ERROR = _object(
    {
        "code": {"enum": [code.value for code in ErrorCode]},
        "message": {"type": "string", "minLength": 1, "maxLength": 500},
    },
    ["code", "message"],
)

# ---- 单实体工具的专属出参（同时用于 items[]） ----
EVENT_DETAIL = _object(
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
)
PERSON_DETAIL = _object(
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
)
RELATION_DETAIL = _object(
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
)
GRAPH_NODE = _object(
    {"person_id": PERSON_ID, "name": {"type": "string"}},
    ["person_id", "name"],
)
GRAPH_EDGE = _object(
    {
        "person_id_a": PERSON_ID,
        "person_id_b": PERSON_ID,
        "weight": {"type": "integer", "minimum": 1},
        "relation_label": {"type": "string"},
    },
    ["person_id_a", "person_id_b", "weight"],
)


def _tool_output(tool_name: str, data_schema: JsonSchema, items_schema: JsonSchema) -> JsonSchema:
    """统一返回信封（V1.0.2）：成功 / 失败两个 oneOf 变体。

    - 成功：`{ok:true, tool, data, items, citations, truncated, snapshot_version, error:null, meta}`
    - 失败：`{ok:false, tool, data:null, items:[], citations:[], truncated:false, snapshot_version, error, meta}`
    """

    shared = {
        "tool": {"const": tool_name},
        "items": _array(items_schema, 80),
        "citations": _array(CITATION, 50),
        "truncated": {"type": "boolean"},
        "snapshot_version": STRING,
        "meta": {"type": "object"},
    }
    required = [
        "ok",
        "tool",
        "items",
        "citations",
        "truncated",
        "snapshot_version",
        "data",
        "error",
        "meta",
    ]
    success = _object(
        {
            "ok": {"const": True},
            **shared,
            "data": data_schema,
            "error": {"type": "null"},
        },
        required,
    )
    failure = _object(
        {
            "ok": {"const": False},
            **shared,
            "data": {"type": "null"},
            "error": TOOL_ERROR,
        },
        required,
    )
    return {"oneOf": [success, failure]}


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
        "output": _tool_output(
            "resolve_entity",
            _object(
                {
                    "candidates": _array(CANDIDATE, 10),
                    "ambiguous": {"type": "boolean"},
                },
                ["candidates", "ambiguous"],
            ),
            CANDIDATE,
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
        "output": _tool_output(
            "search_events",
            _object(
                {
                    "events": _array(EVENT_SUMMARY, 80),
                    "total": {"type": "integer", "minimum": 0},
                },
                ["events", "total"],
            ),
            EVENT_SUMMARY,
        ),
    },
    {
        "name": "get_event",
        "description": "按稳定 event_id 取事件全字段 + 参与者 person_id + 结构化引用。",
        "input": _object({"event_id": EVENT_ID}, ["event_id"]),
        "output": _tool_output("get_event", EVENT_DETAIL, EVENT_DETAIL),
    },
    {
        "name": "get_person",
        "description": "按 person_id 取人物主数据 + 别名 + 所在分期/断代 + 一句话提示。",
        "input": _object({"person_id": PERSON_ID}, ["person_id"]),
        "output": _tool_output("get_person", PERSON_DETAIL, PERSON_DETAIL),
    },
    {
        "name": "get_person_events",
        "description": "按 person_id 取参与事件（按年排序），并给出每人与谁同现。",
        "input": _object({"person_id": PERSON_ID, "limit": LIMIT}, ["person_id"]),
        "output": _tool_output(
            "get_person_events",
            _object(
                {
                    "events": _array(EVENT_SUMMARY, 80),
                    "total": {"type": "integer", "minimum": 0},
                    "co_occurring_person_ids": _array(PERSON_ID, 80),
                },
                ["events", "total", "co_occurring_person_ids"],
            ),
            EVENT_SUMMARY,
        ),
    },
    {
        "name": "get_relation",
        "description": "取两个人物的关系定性、共同事件与来龙去脉；关系引用不新增书目，只能用共同事件的 sourceRefs。",
        "input": _object(
            {"person_id_a": PERSON_ID, "person_id_b": PERSON_ID},
            ["person_id_a", "person_id_b"],
        ),
        "output": _tool_output("get_relation", RELATION_DETAIL, RELATION_DETAIL),
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
        "output": _tool_output(
            "get_era_graph",
            _object(
                {
                    "era_id": ERA_ID,
                    "scope_id": ERA_ID,
                    "center_person_id": PERSON_ID,
                    "nodes": _array(GRAPH_NODE, 80),
                    "edges": _array(GRAPH_EDGE, 160),
                    "truncated": {"type": "boolean"},
                },
                ["nodes", "edges", "truncated"],
            ),
            GRAPH_NODE,
        ),
    },
    {
        "name": "timeline_span",
        "description": "取年份区间内的事件（史书纪年，含负数），返回总数与代表事件。",
        "input": _object({"start_year": YEAR, "end_year": YEAR, "limit": LIMIT}, ["start_year", "end_year"]),
        "output": _tool_output(
            "timeline_span",
            _object(
                {
                    "events": _array(EVENT_SUMMARY, 80),
                    "total": {"type": "integer", "minimum": 0},
                    "representative_event_ids": _array(EVENT_ID, 10),
                },
                ["events", "total", "representative_event_ids"],
            ),
            EVENT_SUMMARY,
        ),
    },
    {
        "name": "search_historical_text",
        "description": (
            "按语义检索史脉 RAG 史料库（51 篇长文语料），返回史料 chunk 正文、元数据与统一 citations；"
            "查询词应为「用户问题 + 图谱实体/年份」；单次最多 3 条、每条正文最多 300 字。"
        ),
        "input": _object(
            {
                "query": {"type": "string", "minLength": 1, "maxLength": 200},
                "top_k": {"type": "integer", "minimum": 1, "maximum": 3, "default": 3},
            },
            ["query"],
        ),
        "output": _tool_output(
            "search_historical_text",
            _object(
                {
                    "chunks": _array(RAG_CHUNK, 3),
                    "total": {"type": "integer", "minimum": 0},
                    "query": {"type": "string"},
                },
                ["chunks", "total"],
            ),
            RAG_CHUNK,
        ),
    },
]

#: 工具契约 JSON Schema（导出为 contracts/tools-v1.schema.json）。
TOOLS_SCHEMA: dict[str, Any] = {
    "$schema": "https://json-schema.org/draft/2020-12/schema",
    "$id": "https://histolink.local/contracts/tools-v1.schema.json",
    "title": "史脉 V1.0 只读工具契约",
    "description": (
        "9 个只读工具的入参 / **统一返回信封** JSON Schema（V1.0.5）。"
        "每个 tool.output 为 oneOf(成功信封, 失败信封)：信封含 ok/tool/items/citations/"
        "truncated/snapshot_version/data/error/meta；工具专属出参在 data 内。"
    ),
    "version": "1.0",
    "x-output-envelope": "ToolResult",
    "tools": TOOLS,
}
