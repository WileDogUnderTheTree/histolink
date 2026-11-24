"""9 个只读工具的统一入口（V1.0.2 工具层 + V1.0.5 RAG 史料检索）。

规划器（V1.0.3）只需要两样东西：
1. `Toolkit(store)`：启动时构造一次，内部持 `ToolContext` 与派生索引；
2. `toolkit.call(name, **arguments)`：返回统一信封（ok/tool/items/citations/truncated/
   snapshot_version/data/error/meta），无需感知工具实现。

工具函数本身是纯函数（`ctx` + 入参 → dict），可直接单测，不发 HTTP、不写盘；
`search_historical_text` 是唯一会读本地向量库的工具（首次调用才加载 chromadb + embedding）。
"""

from __future__ import annotations

from typing import Any

from contracts.models import ErrorCode
from snapshot_store import SnapshotStore

from .base import ToolContext, failure
from .entities import get_person, resolve_entity
from .events import get_event, get_person_events, search_events, timeline_span
from .graph import get_era_graph
from .rag import search_historical_text
from .relations import get_relation

#: 工具名（顺序与 `contracts/tools.py` / 审核报告 §9.1 一致；V1.0.5 追加 RAG 检索）。
TOOL_NAMES: tuple[str, ...] = (
    "resolve_entity",
    "search_events",
    "get_event",
    "get_person",
    "get_person_events",
    "get_relation",
    "get_era_graph",
    "timeline_span",
    "search_historical_text",
)

#: 工具名 → 实现。
TOOL_FUNCTIONS = {
    "resolve_entity": resolve_entity,
    "search_events": search_events,
    "get_event": get_event,
    "get_person": get_person,
    "get_person_events": get_person_events,
    "get_relation": get_relation,
    "get_era_graph": get_era_graph,
    "timeline_span": timeline_span,
    "search_historical_text": search_historical_text,
}

if set(TOOL_FUNCTIONS) != set(TOOL_NAMES):  # pragma: no cover - 导入期自检
    raise RuntimeError("工具注册表与 TOOL_NAMES 不一致")


def call_tool(ctx: ToolContext, name: str, /, **arguments: Any) -> dict[str, Any]:
    """按工具名分发；未知工具返回 `INVALID_REQUEST` 信封而不是抛异常。"""

    function = TOOL_FUNCTIONS.get(name)
    if function is None:
        return failure(
            ctx,
            str(name or "unknown"),
            ErrorCode.INVALID_REQUEST,
            f"未知工具：{name}（可用：{', '.join(TOOL_NAMES)}）",
        )
    return function(ctx, **arguments)


class Toolkit:
    """工具层门面：构造一次、按名调用。"""

    def __init__(self, store: SnapshotStore) -> None:
        self.context = ToolContext.from_store(store)

    @property
    def snapshot_version(self) -> str:
        return self.context.snapshot_version

    def call(self, name: str, /, **arguments: Any) -> dict[str, Any]:
        return call_tool(self.context, name, **arguments)

    def __contains__(self, name: object) -> bool:
        return name in TOOL_FUNCTIONS


def build_toolkit(store: SnapshotStore) -> Toolkit:
    return Toolkit(store)


__all__ = [
    "TOOL_FUNCTIONS",
    "TOOL_NAMES",
    "ToolContext",
    "Toolkit",
    "build_toolkit",
    "call_tool",
    "get_era_graph",
    "get_event",
    "get_person",
    "get_person_events",
    "get_relation",
    "resolve_entity",
    "search_events",
    "search_historical_text",
    "timeline_span",
]
