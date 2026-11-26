"""V1.0.2 工具层公共基座。

设计约束（审核报告 §9.1）：
- **只读**：只读内存快照，不写任何数据；
- **有界**：`limit` 上限 80，图谱节点 / 边另有硬上限；
- **返回 ID**：结果以 `person_id` / `event_id` 标识实体，自由文本只作展示；
- **空结果有明确语义**：要么空列表 + `total=0`，要么 `ok=false` + 明确 `ErrorCode`。

统一信封（`contracts.models.ToolResult`，V1.0.2 只新增可选字段）：
    {ok, tool, items, citations, truncated, snapshot_version, data, error, meta}

`data` 严格等于 `contracts/tools-v1.schema.json` 中该工具的 `output`；`items` 是 `data`
里主结果列表的同一份内容（对象型结果则包一层列表），便于 V1.0.3 规划器统一消费。
"""

from __future__ import annotations

import re
from collections.abc import Callable, Iterable, Mapping, Sequence
from dataclasses import dataclass
from functools import wraps
from typing import Any

from contracts.models import (
    ATTRIBUTION_TEXT,
    Citation,
    ErrorCode,
    SourceRefModel,
    ToolError,
    ToolResult,
)
from snapshot_store import SnapshotStore

#: 单次返回的主结果上限（与工具契约 LIMIT.maximum 一致）。
MAX_LIMIT = 80
#: `limit` 缺省值（与工具契约 LIMIT.default 一致）。
DEFAULT_LIMIT = 20
#: 单次返回的引用上限（与 `AnswerEnvelope.citations` 的 max_length 一致）。
MAX_CITATIONS = 50
#: 统一信封 `items` 的上限（与 `ToolResult.items` 一致）。
MAX_ITEMS = 80

#: 与 `contracts/tools.py` 中 PERSON_ID / EVENT_ID 的 pattern 保持一致。
PERSON_ID_RE = re.compile(r"^p-[a-z0-9]+(?:-[a-z0-9]+)*-[0-9a-f]{4}$")
EVENT_ID_RE = re.compile(r"^[a-z0-9][a-z0-9-]*$")

#: 关系库无人工定性记录时的署名（不得伪装成已校订关系）。
RELATION_NO_RECORD_ATTRIBUTION = "史脉关系库（无人工定性记录）"
#: 关系库归属（与快照 relations[].attribution 一致）。
RELATION_ATTRIBUTION = "史脉关系库（人工校订）"


class ToolInputError(ValueError):
    """工具入参不合法；对外映射为 `INVALID_REQUEST`。"""


class ToolEntityNotFound(LookupError):
    """实体 / 时期 ID 在快照中不存在；对外映射为 `ENTITY_NOT_FOUND`。"""


# ---------------------------------------------------------------------------
# 只读上下文：快照 + 派生索引
# ---------------------------------------------------------------------------


@dataclass(frozen=True)
class ToolContext:
    """一次构造、全程复用的只读上下文。

    直接持有 `SnapshotStore`（其中已是内存 JSON），只额外建立工具需要的派生索引，
    请求期不做线性扫描、不发 HTTP、不写盘。
    """

    store: SnapshotStore
    persons_by_id: Mapping[str, dict[str, Any]]
    events_by_id: Mapping[str, dict[str, Any]]
    era_by_id: Mapping[str, dict[str, Any]]
    scope_by_id: Mapping[str, dict[str, Any]]
    group_by_id: Mapping[str, dict[str, Any]]
    relations_by_pair: Mapping[frozenset[str], dict[str, Any]]
    events_by_person: Mapping[str, tuple[dict[str, Any], ...]]

    @property
    def snapshot_version(self) -> str:
        return str(self.store.meta["snapshot_version"])

    @classmethod
    def from_store(cls, store: SnapshotStore) -> ToolContext:
        snapshot = store.snapshot
        events_by_id = store.events_by_id
        events_by_person: dict[str, tuple[dict[str, Any], ...]] = {}
        for person_id, person in store.persons_by_id.items():
            person_events = [
                events_by_id[event_id]
                for event_id in person.get("event_ids") or []
                if event_id in events_by_id
            ]
            person_events.sort(key=event_sort_key)
            events_by_person[person_id] = tuple(person_events)

        relations_by_pair = {
            frozenset((relation["person_id_a"], relation["person_id_b"])): relation
            for relation in snapshot.get("relations") or []
        }

        return cls(
            store=store,
            persons_by_id=store.persons_by_id,
            events_by_id=events_by_id,
            era_by_id={era["era_id"]: era for era in snapshot.get("eras") or []},
            scope_by_id={
                scope["scope_id"]: scope for scope in snapshot.get("scopes") or []
            },
            group_by_id={
                group["group_id"]: group for group in snapshot.get("groups") or []
            },
            relations_by_pair=relations_by_pair,
            events_by_person=events_by_person,
        )


# ---------------------------------------------------------------------------
# 事件 / 人物展示口径
# ---------------------------------------------------------------------------


def effective_importance(event: Mapping[str, Any]) -> int:
    """事件重要度；缺省为 2，与前端 `importanceOf()` 口径一致。"""

    return int(event.get("importance") or 2)


def format_year(year: int) -> str:
    return f"前{abs(year)}年" if year < 0 else f"{year}年"


def format_disambiguator(person: Mapping[str, Any]) -> str:
    """人物消歧副标题：「时期·身份」，与只读 API 的展示口径一致。"""

    disambiguator = person.get("disambiguator") or {}
    period = disambiguator.get("period") or person.get("primary_dynasty") or "时期未详"
    role = disambiguator.get("role")
    return f"{period}·{role}" if role else str(period)


def event_summary(event: Mapping[str, Any]) -> dict[str, Any]:
    """工具契约里的 EVENT_SUMMARY；`importance` 用有效值（缺省 2）。"""

    return {
        "event_id": event["event_id"],
        "title": event["title"],
        "dynasty": event["dynasty"],
        "year": event["year"],
        "importance": effective_importance(event),
    }


def event_sort_key(event: Mapping[str, Any]) -> tuple[int, str]:
    return (int(event["year"]), str(event["event_id"]))


def event_priority_key(event: Mapping[str, Any]) -> tuple[int, int, str]:
    """重要度优先、同年按 event_id 稳定排序。"""

    return (-effective_importance(event), int(event["year"]), str(event["event_id"]))


# ---------------------------------------------------------------------------
# 引用构造
# ---------------------------------------------------------------------------


def _event_citation(
    event: Mapping[str, Any], reference_index: int, reference: Mapping[str, Any]
) -> Citation:
    return Citation(
        id=f"cite-{event['event_id']}-{reference_index}",
        kind="event",
        event_id=event["event_id"],
        title=event["title"],
        year=event["year"],
        dynasty=event["dynasty"],
        quote=event["description"],
        source_label=reference["label"],
        source_ref=SourceRefModel(
            label=reference["label"],
            book=reference["book"],
            chapter=reference.get("chapter"),
            raw=reference["raw"],
        ),
        attribution=ATTRIBUTION_TEXT,
    )


def event_citations(
    events: Iterable[Mapping[str, Any]], *, limit: int = MAX_CITATIONS
) -> list[Citation]:
    """把事件的结构化 `source_refs` 转成引用；按事件顺序、逐引用去重，最多 `limit` 条。"""

    citations: list[Citation] = []
    seen: set[str] = set()
    for event in events:
        for reference_index, reference in enumerate(event.get("source_refs") or []):
            citation_id = f"cite-{event['event_id']}-{reference_index}"
            if citation_id in seen:
                continue
            seen.add(citation_id)
            citations.append(_event_citation(event, reference_index, reference))
            if len(citations) >= limit:
                return citations
    return citations


def relation_background(relation: Mapping[str, Any]) -> str:
    """关系「来龙去脉」：优先人工描述，缺失时用共同事件摘要拼接（不新增书目）。"""

    description = (relation.get("description") or "").strip()
    if description:
        return description
    summaries = relation.get("event_summaries") or {}
    return "；".join(str(text) for text in summaries.values() if text).strip()


def relation_citation(relation: Mapping[str, Any]) -> Citation:
    """关系定性引用：不新增书目，只标注关系库归属。"""

    pair_key = str(relation["pair_key"])
    title = f"{pair_key.replace('__', '·')}·{relation['label']}"
    return Citation(
        id=f"cite-relation-{pair_key}",
        kind="relation",
        relation_id=pair_key,
        title=title[:300],
        quote=(relation_background(relation) or relation["label"])[:2000],
        attribution=str(relation.get("attribution") or RELATION_ATTRIBUTION),
    )


def merge_citations(
    *groups: Iterable[Citation], limit: int = MAX_CITATIONS
) -> list[Citation]:
    """合并多组引用并按 id 去重，保持首次出现顺序。"""

    merged: list[Citation] = []
    seen: set[str] = set()
    for group in groups:
        for citation in group:
            if citation.id in seen:
                continue
            seen.add(citation.id)
            merged.append(citation)
            if len(merged) >= limit:
                return merged
    return merged


# ---------------------------------------------------------------------------
# 统一返回信封
# ---------------------------------------------------------------------------


def success(
    ctx: ToolContext,
    tool: str,
    *,
    data: Any,
    items: Sequence[Any] | None = None,
    citations: Sequence[Citation] | None = None,
    truncated: bool = False,
    meta: Mapping[str, Any] | None = None,
) -> dict[str, Any]:
    """构造成功结果；始终补齐 items / citations / truncated / snapshot_version。"""

    result_items = list(items or [])
    if len(result_items) > MAX_ITEMS:
        raise ValueError(f"工具 {tool} 返回的 items 超过上限 {MAX_ITEMS}")
    result_citations = list(citations or [])[:MAX_CITATIONS]
    result_meta: dict[str, Any] = {
        "returned": len(result_items),
        "citation_count": len(result_citations),
    }
    if meta:
        result_meta.update(meta)

    payload = ToolResult(
        ok=True,
        tool=tool,
        data=data,
        error=None,
        meta=result_meta,
        items=result_items,
        citations=result_citations,
        truncated=bool(truncated),
        snapshot_version=ctx.snapshot_version,
    )
    return payload.model_dump(mode="json")


def failure(
    ctx: ToolContext, tool: str, code: ErrorCode, message: str
) -> dict[str, Any]:
    """构造失败结果；统一字段仍齐全（items 为空），便于规划器稳定处理。"""

    payload = ToolResult(
        ok=False,
        tool=tool,
        data=None,
        error=ToolError(code=code, message=message[:500] or code.value),
        meta={"returned": 0, "citation_count": 0},
        items=[],
        citations=[],
        truncated=False,
        snapshot_version=ctx.snapshot_version,
    )
    return payload.model_dump(mode="json")


def tool(
    name: str,
) -> Callable[[Callable[..., dict[str, Any]]], Callable[..., dict[str, Any]]]:
    """把入参/实体异常统一翻译成 `ToolResult` 失败信封；内部错误继续抛出。"""

    def decorator(
        function: Callable[..., dict[str, Any]],
    ) -> Callable[..., dict[str, Any]]:
        @wraps(function)
        def wrapper(ctx: ToolContext, *args: Any, **kwargs: Any) -> dict[str, Any]:
            try:
                return function(ctx, *args, **kwargs)
            except ToolInputError as exc:
                return failure(ctx, name, ErrorCode.INVALID_REQUEST, str(exc))
            except ToolEntityNotFound as exc:
                return failure(ctx, name, ErrorCode.ENTITY_NOT_FOUND, str(exc))

        wrapper.tool_name = name  # type: ignore[attr-defined]
        return wrapper

    return decorator


# ---------------------------------------------------------------------------
# 入参校验（schema 约束在实现侧再校验一次，错误码统一）
# ---------------------------------------------------------------------------


def parse_text(value: Any, field: str, *, max_length: int = 200) -> str:
    if not isinstance(value, str):
        raise ToolInputError(f"{field} 必须是字符串")
    text = value.strip()
    if not text:
        raise ToolInputError(f"{field} 不能为空")
    if len(text) > max_length:
        raise ToolInputError(f"{field} 超过最大长度 {max_length}")
    return text


def parse_optional_text(value: Any, field: str, *, max_length: int = 200) -> str | None:
    if value is None:
        return None
    return parse_text(value, field, max_length=max_length)


def parse_limit(
    value: Any, *, default: int = DEFAULT_LIMIT, maximum: int = MAX_LIMIT
) -> int:
    if value is None:
        return default
    if isinstance(value, bool) or not isinstance(value, int):
        raise ToolInputError("limit 必须是整数")
    if value < 1 or value > maximum:
        raise ToolInputError(f"limit 必须在 1..{maximum} 之间")
    return value


def parse_year(value: Any, field: str) -> int:
    if isinstance(value, bool) or not isinstance(value, int):
        raise ToolInputError(f"{field} 必须是整数")
    if value == 0:
        raise ToolInputError(f"{field} 不能为 0（史书纪年无公元 0 年）")
    return value


def parse_year_range(value: Any) -> tuple[int, int] | None:
    if value is None:
        return None
    if not isinstance(value, Mapping):
        raise ToolInputError("year_range 必须是 {start, end} 对象")
    extra = set(value) - {"start", "end"}
    if extra:
        raise ToolInputError(f"year_range 含未知字段：{sorted(extra)}")
    if "start" not in value or "end" not in value:
        raise ToolInputError("year_range 必须同时提供 start 与 end")
    start = parse_year(value["start"], "year_range.start")
    end = parse_year(value["end"], "year_range.end")
    if start > end:
        raise ToolInputError("year_range.start 不能晚于 year_range.end")
    return start, end


def parse_importance_min(value: Any) -> int | None:
    if value is None:
        return None
    if isinstance(value, bool) or not isinstance(value, int):
        raise ToolInputError("importance_min 必须是整数")
    if value < 1 or value > 3:
        raise ToolInputError("importance_min 必须在 1..3 之间")
    return value


def parse_person_id(value: Any, field: str = "person_id") -> str:
    text = parse_text(value, field, max_length=128)
    if not PERSON_ID_RE.fullmatch(text):
        raise ToolInputError(f"{field} 不符合 person_id 规则：{text}")
    return text


def parse_event_id(value: Any, field: str = "event_id") -> str:
    text = parse_text(value, field, max_length=128)
    if not EVENT_ID_RE.fullmatch(text):
        raise ToolInputError(f"{field} 不符合 event_id 规则：{text}")
    return text


def ensure_person(ctx: ToolContext, person_id: str) -> dict[str, Any]:
    person = ctx.persons_by_id.get(person_id)
    if person is None:
        raise ToolEntityNotFound(f"人物不存在：{person_id}")
    return person


def ensure_event(ctx: ToolContext, event_id: str) -> dict[str, Any]:
    event = ctx.events_by_id.get(event_id)
    if event is None:
        raise ToolEntityNotFound(f"事件不存在：{event_id}")
    return event


def resolve_period(ctx: ToolContext, period_id: str) -> tuple[str, set[str] | None]:
    """解析 era / scope / group 三类时期 ID。

    返回 `(kind, dynasties)`；`dynasties=None` 表示该时期无法直接映射到 `event.dynasty`
    （scope 没有朝代列表，只能用于人物 `era_ids/scope_ids` 过滤）。
    """

    era = ctx.era_by_id.get(period_id)
    if era is not None:
        return "era", set(era.get("dynasties") or [])
    scope = ctx.scope_by_id.get(period_id)
    if scope is not None:
        return "scope", None
    group = ctx.group_by_id.get(period_id)
    if group is not None:
        return "group", set(group.get("dynasties") or [])
    raise ToolEntityNotFound(f"未知的时期 ID：{period_id}")


def person_in_period(
    person: Mapping[str, Any], period_id: str | None, dynasties: set[str] | None
) -> bool:
    """人物是否属于给定时期：先看 `era_ids/scope_ids`，group 再按朝代归属兜底。"""

    if period_id is None:
        return True
    if period_id in (person.get("era_ids") or []):
        return True
    if period_id in (person.get("scope_ids") or []):
        return True
    if dynasties:
        return any(dynasty in dynasties for dynasty in person.get("dynasties") or [])
    return False
