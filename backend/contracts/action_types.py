"""动作枚举与 V1.0 可用性（冻结于 V1.0.1 / TC-04）。

对应审核报告 §5.4 的动作清单与 §8.1 Q2 决策：
- `available`：V1.0 冻结可用集合（服务端可以下发的动作）；
- `planned`：已登记但暂缓下发（V1.0.4/V1.0.5 启用），避免 V1.0.3 才开始改协议。

约定（Q2）：
- 服务端只给「语义 + ID」，`auto` 仅是建议值；
- 前端按 `target.surface === 当前路由` 判定同页自动，跨页一律渲染为确认按钮；
- 未知动作类型前端忽略并上报，不抛错。
"""

from __future__ import annotations

from enum import Enum
from typing import Literal


class UISurface(str, Enum):
    """动作目标界面；V1.0 只允许这三个。"""

    TIMELINE = "timeline"
    GRAPH = "graph"
    ASK = "ask"


class UIActionType(str, Enum):
    """动作类型枚举（V1.0 冻结）。"""

    TIMELINE_FOCUS_EVENT = "timeline.focus_event"
    TIMELINE_FOCUS_DYNASTY = "timeline.focus_dynasty"
    GRAPH_FOCUS_PERSON = "graph.focus_person"
    GRAPH_FOCUS_RELATION = "graph.focus_relation"
    ASK_SUGGEST = "ask.suggest"

    # ---- planned：登记但 V1.0.1 不下发 ----
    TIMELINE_HIGHLIGHT_EVENTS = "timeline.highlight_events"
    GRAPH_HIGHLIGHT_PERSONS = "graph.highlight_persons"
    OPEN_EVENT_CARD = "open.event_card"
    OPEN_PERSON_CARD = "open.person_card"


#: 动作类型 → 目标界面（`None` 表示 planned 阶段尚未定界面）。
ACTION_SURFACE: dict[UIActionType, UISurface | None] = {
    UIActionType.TIMELINE_FOCUS_EVENT: UISurface.TIMELINE,
    UIActionType.TIMELINE_FOCUS_DYNASTY: UISurface.TIMELINE,
    UIActionType.GRAPH_FOCUS_PERSON: UISurface.GRAPH,
    UIActionType.GRAPH_FOCUS_RELATION: UISurface.GRAPH,
    UIActionType.ASK_SUGGEST: UISurface.ASK,
    UIActionType.TIMELINE_HIGHLIGHT_EVENTS: UISurface.TIMELINE,
    UIActionType.GRAPH_HIGHLIGHT_PERSONS: UISurface.GRAPH,
    UIActionType.OPEN_EVENT_CARD: None,
    UIActionType.OPEN_PERSON_CARD: None,
}

#: 动作类型 → V1.0 可用性。
ACTION_AVAILABILITY: dict[UIActionType, Literal["available", "planned"]] = {
    UIActionType.TIMELINE_FOCUS_EVENT: "available",
    UIActionType.TIMELINE_FOCUS_DYNASTY: "available",
    UIActionType.GRAPH_FOCUS_PERSON: "available",
    UIActionType.GRAPH_FOCUS_RELATION: "available",
    UIActionType.ASK_SUGGEST: "available",
    UIActionType.TIMELINE_HIGHLIGHT_EVENTS: "planned",
    UIActionType.GRAPH_HIGHLIGHT_PERSONS: "planned",
    UIActionType.OPEN_EVENT_CARD: "planned",
    UIActionType.OPEN_PERSON_CARD: "planned",
}

#: 动作类型 → 服务端写死的 UI 文案（V1.0.4：模型不再提供 label）。
ACTION_LABEL: dict[UIActionType, str] = {
    UIActionType.TIMELINE_FOCUS_EVENT: "在时间轴中查看",
    UIActionType.TIMELINE_FOCUS_DYNASTY: "在时间轴中查看该时期",
    UIActionType.GRAPH_FOCUS_PERSON: "在关系图中查看",
    UIActionType.GRAPH_FOCUS_RELATION: "在关系图中查看人物关系",
    UIActionType.ASK_SUGGEST: "继续提问",
    UIActionType.TIMELINE_HIGHLIGHT_EVENTS: "在时间轴中高亮事件",
    UIActionType.GRAPH_HIGHLIGHT_PERSONS: "在关系图中高亮人物",
    UIActionType.OPEN_EVENT_CARD: "查看事件详情",
    UIActionType.OPEN_PERSON_CARD: "查看人物详情",
}

#: V1.0 冻结可用动作集合（报告 §5.4）。
V1_AVAILABLE_ACTIONS: tuple[UIActionType, ...] = tuple(
    action
    for action, availability in ACTION_AVAILABILITY.items()
    if availability == "available"
)

#: 暂缓动作集合。
V1_PLANNED_ACTIONS: tuple[UIActionType, ...] = tuple(
    action
    for action, availability in ACTION_AVAILABILITY.items()
    if availability == "planned"
)


def action_type_values() -> list[str]:
    """返回动作类型字符串列表（导出 JSON Schema 用）。"""

    return [action.value for action in UIActionType]


def surface_values() -> list[str]:
    """返回目标界面字符串列表。"""

    return [surface.value for surface in UISurface]
