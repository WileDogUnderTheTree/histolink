"""UI Action 后置推断（V1.0.6.2 专项修复 · 痛点 1；V1.0.6.3 双图联动）。

背景
----
`ui_actions` 原本**完全依赖模型在 final JSON 里输出**。这带来两个问题：

1. 云端大模型（Qwen）能稳定遵守动作协议，但本地小模型（`XiaoHong-v1` / 8B）
   经常整段省略 `ui_actions`（或输出不合法 ID 被服务端过滤），
   于是「回答有史料、右侧史引副驾驶却永远不弹出」；
2. 「逐字回答」直答链路（`/api/agent/chat_stream`）**根本不跑工具**，
   模型不可能自己产出动作，弹史引只能靠服务端补。

本模块提供**服务端确定性意图后置推断**（纯函数 + 快照索引，不调用模型、不联网）：

- `match_question()`：从用户问题里确定性匹配快照中的事件标题 / 人物正名·别名，
  并检查两人之间是否存在关系库记录；
- `infer_actions_for_question()`：直答链路用——按问题实体生成
  `timeline.focus_event` / `graph.focus_relation` / `graph.focus_person` /
  `timeline.focus_dynasty`，由 `/api/agent/chat_stream` 的 `done` 事件下发，
  前端据此自动展开右侧史引面板；
- `infer_actions_from_evidence()`：证据问答链路用——模型没给任何动作时，
  从本轮**已通过证据校验**的 entity（event / person / relation）推断动作，
  保证「查到了具体事件或人物」的回答一定能弹出史引。

所有动作仍复用冻结契约（`contracts.action_types` / `contracts.models.UIAction`）：
label 由服务端按类型写死、`target.surface` 与动作类型匹配、payload 与 target.params
同时填写实体 ID（前端 `hrefForAction` 两处都读）。动作顺序即前端联动优先级：
先满足问题焦点（事件题→时间轴，人物/关系题→关系图）。

V1.0.6.3 双图联动
----------------
用户要求「一句提问里同时看到时间轴和人物图谱两个按钮」。因此问题只命中一侧时，
用快照里的确定性关系补齐另一侧：

- 命中事件 → 从事件 `participants`（叙事顺序）取第一位可解析人物，补 `graph.focus_person`；
- 命中人物 → 从人物参与事件里挑「最重要 + 本人为主角 + 年份最早」的一件，补 `timeline.focus_event`；
- 证据管线同理：`ObservedEntity.related_person_ids` / `related_event_ids` 是工具真实返回，
  直接用于补齐另一侧动作，**不伪造快照里不存在的关系**。
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from typing import Any, Literal

from agent.schemas import UIAction
from contracts.action_types import ACTION_LABEL, UIActionType
from contracts.models import UIActionTarget

__all__ = [
    "QuestionMatch",
    "infer_actions_for_question",
    "infer_actions_from_evidence",
    "match_question",
]

Focus = Literal["event", "person", "relation"]
_MAX_ACTIONS = 3
_MAX_MATCHED_EVENTS = 2
_MAX_MATCHED_PERSONS = 2
#: 事件标题里常见的并列分隔符（如「土木堡之变、北京保卫战」）。
_EVENT_FRAGMENT_SPLIT_RE = re.compile(r"[、，,；;·/|]+")
#: 问题类型线索（与 `agent.validator` 的判定同源，这里只需决定动作排序，保持轻量）。
_RELATION_CUES = (
    "关系",
    "如何认识",
    "怎么认识",
    "什么关系",
    "朋友",
    "师徒",
    "兄弟",
    "父子",
    "夫妻",
    "恩怨",
    "交往",
    "往来",
    "共同",
    "同现",
    "关联",
    "和谁",
    "有谁",
    "认识谁",
    "有哪些人",
)
_EVENT_CUES = (
    "哪一年",
    "发生在",
    "经过",
    "事件",
    "战役",
    "之战",
    "之变",
    "之乱",
    "变法",
    "影响",
)
_PERSON_CUES = (
    "是谁",
    "人物",
    "生平",
    "介绍",
    "哪个朝代",
    "什么朝代",
    "身份",
    "字号",
    "其人",
    "经历",
)
#: 证据实体形态排序（越靠前越适合当联动焦点）。
_EXPOSURE_RANK = {"detail": 3, "structured": 2, "citation": 1, "list": 0}


@dataclass(frozen=True)
class QuestionMatch:
    """问题 → 快照实体的确定性匹配结果。"""

    focus: Focus
    events: tuple[dict[str, Any], ...] = ()
    persons: tuple[dict[str, Any], ...] = ()
    relation: dict[str, Any] | None = None

    @property
    def has_any(self) -> bool:
        return bool(self.events or self.persons or self.relation)


# ---------------------------------------------------------------------------
# 快照匹配
# ---------------------------------------------------------------------------


def _event_fragments(event: dict[str, Any]) -> list[str]:
    """把事件标题拆成可匹配片段（标题本身 + 并列分句），过滤过短片段。"""

    title = event.get("title")
    if not isinstance(title, str) or not title.strip():
        return []
    fragments = {title.strip()}
    fragments.update(part.strip() for part in _EVENT_FRAGMENT_SPLIT_RE.split(title))
    return [fragment for fragment in fragments if len(fragment) >= 3]


def _match_events(store: Any, question: str) -> list[dict[str, Any]]:
    """问题里出现的快照事件（标题 / 并列分句子串命中），按匹配长度与重要性排序。"""

    scored: list[tuple[int, int, int, dict[str, Any]]] = []
    for event in getattr(store, "events_by_id", {}).values():
        if (
            event.get("is_special") is True
            or event.get("source_status") == "easter_egg"
        ):
            continue
        best = 0
        for fragment in _event_fragments(event):
            if fragment in question and len(fragment) > best:
                best = len(fragment)
        if best <= 0:
            continue
        importance = event.get("importance")
        year = event.get("year")
        scored.append(
            (
                best,
                int(importance) if isinstance(importance, int) else 0,
                -int(year) if isinstance(year, int) else 0,
                event,
            )
        )
    scored.sort(
        key=lambda item: (-item[0], -item[1], item[2], item[3].get("event_id", ""))
    )
    return [item[3] for item in scored[:_MAX_MATCHED_EVENTS]]


def _match_persons(
    store: Any,
    question: str,
    *,
    event_person_ids: set[str] | None = None,
) -> list[dict[str, Any]]:
    """问题里出现的人物（正名 / 别名子串命中），优先与命中事件相关的候选。

    同名歧义时按「事件交集多 → 事件总数多 → person_id」确定性排序选第一位，
    避免随机取到同名的另一个历史人物。
    """

    related_ids = event_person_ids or set()
    candidates: list[tuple[int, int, int, str, dict[str, Any]]] = []
    for name, persons in getattr(store, "persons_by_name", {}).items():
        if not isinstance(name, str) or len(name) < 2 or name not in question:
            continue
        for person in persons:
            event_ids = set(person.get("event_ids") or [])
            candidates.append(
                (
                    len(name),
                    len(event_ids & related_ids),
                    len(event_ids),
                    person.get("person_id", ""),
                    person,
                )
            )
    candidates.sort(key=lambda item: (-item[0], -item[1], -item[2], item[3]))
    selected: list[dict[str, Any]] = []
    seen_ids: set[str] = set()
    seen_names: set[str] = set()
    for _length, _overlap, _count, _person_id, person in candidates:
        person_id = person.get("person_id")
        display_name = person.get("display_name")
        if not isinstance(person_id, str) or person_id in seen_ids:
            continue
        if isinstance(display_name, str) and display_name in seen_names:
            continue
        seen_ids.add(person_id)
        if isinstance(display_name, str):
            seen_names.add(display_name)
        selected.append(person)
        if len(selected) >= _MAX_MATCHED_PERSONS:
            break
    return selected


def _find_relation(
    store: Any, persons: tuple[dict[str, Any], ...] | list[dict[str, Any]]
) -> dict[str, Any] | None:
    """两个人物之间是否存在关系库记录（返回原始 relation dict）。"""

    if len(persons) < 2:
        return None
    person_ids = {person.get("person_id") for person in persons[:2]}
    if len(person_ids) != 2:
        return None
    for relation in getattr(store, "snapshot", {}).get("relations") or []:
        endpoints = {relation.get("person_id_a"), relation.get("person_id_b")}
        if endpoints == person_ids:
            return relation
    return None


def _is_special_event(event: dict[str, Any]) -> bool:
    """彩蛋 / 特殊事件不得作为史引联动目标（与 `_match_events` 同一口径）。"""

    return event.get("is_special") is True or event.get("source_status") == "easter_egg"


def _related_person_for_event(
    store: Any, event: dict[str, Any] | None
) -> dict[str, Any] | None:
    """事件 → 关联人物（V1.0.6.3 双图联动）。

    优先按事件的 `participants`（叙事 / 重要度顺序）找第一位能在快照里解析到的人物；
    `participants` 缺失或全部无法解析时，退回事件的 `person_ids` 顺序。
    只从**该事件真实关联**的人物里选择，不虚构关系。
    """

    if not event:
        return None
    persons_by_name = getattr(store, "persons_by_name", {})
    allowed_ids = {
        person_id
        for person_id in event.get("person_ids") or []
        if isinstance(person_id, str) and person_id
    }
    for name in event.get("participants") or []:
        if not isinstance(name, str) or not name:
            continue
        for person in persons_by_name.get(name, []):
            person_id = person.get("person_id")
            if not isinstance(person_id, str) or not person_id:
                continue
            if allowed_ids and person_id not in allowed_ids:
                continue
            return person
    persons_by_id = getattr(store, "persons_by_id", {})
    for person_id in event.get("person_ids") or []:
        person = persons_by_id.get(person_id) if isinstance(person_id, str) else None
        if isinstance(person, dict):
            return person
    return None


def _related_event_for_person(
    store: Any, person: dict[str, Any] | None
) -> dict[str, Any] | None:
    """人物 → 代表事件（V1.0.6.3 双图联动）。

    排序口径（确定性）：事件重要性降序 → 「本人是叙事主角（participants[0]）」优先 →
    年份升序 → event_id。保证同一人物每次得到的代表事件稳定，且优先是
    重要性最高的、以本人为主角的事件（例：李世民 → 玄武门之变）。
    """

    if not person:
        return None
    events_by_id = getattr(store, "events_by_id", {})
    display_name = person.get("display_name")
    scored: list[tuple[tuple[int, int, int, str], dict[str, Any]]] = []
    for event_id in person.get("event_ids") or []:
        if not isinstance(event_id, str):
            continue
        event = events_by_id.get(event_id)
        if not isinstance(event, dict) or _is_special_event(event):
            continue
        importance = event.get("importance")
        year = event.get("year")
        participants = event.get("participants") or []
        is_protagonist = bool(participants) and participants[0] == display_name
        scored.append(
            (
                (
                    -(importance if isinstance(importance, int) else 0),
                    0 if is_protagonist else 1,
                    year if isinstance(year, int) else 99_999,
                    event_id,
                ),
                event,
            )
        )
    if not scored:
        return None
    scored.sort(key=lambda item: item[0])
    return scored[0][1]


def _first_related_person_id(entity: Any) -> str | None:
    """证据实体（event）→ 第一个关联人物 ID（工具真实返回的 person_ids）。"""

    for person_id in getattr(entity, "related_person_ids", ()) or ():
        if isinstance(person_id, str) and person_id:
            return person_id
    return None


def _first_related_event_id(entity: Any) -> str | None:
    """证据实体（person）→ 第一个关联事件 ID（工具真实返回的 event_ids）。"""

    for event_id in getattr(entity, "related_event_ids", ()) or ():
        if isinstance(event_id, str) and event_id:
            return event_id
    return None


def _detect_focus(
    question: str,
    events: list[dict[str, Any]],
    persons: list[dict[str, Any]],
    relation: dict[str, Any] | None,
) -> Focus:
    """决定动作排序焦点：关系 > 事件 > 人物（与 validator / 提示词的问题分类口径一致）。"""

    if relation is not None and any(cue in question for cue in _RELATION_CUES):
        return "relation"
    if events and not persons:
        return "event"
    if events and any(cue in question for cue in _EVENT_CUES):
        return "event"
    if relation is not None and len(persons) >= 2:
        return "relation"
    if persons and any(cue in question for cue in _PERSON_CUES):
        return "person"
    if events:
        return "event"
    if persons:
        return "person"
    return "event"


def match_question(store: Any, question: str) -> QuestionMatch:
    """把用户问题确定性映射到快照实体（事件 / 人物 / 关系）。"""

    text = (question or "").strip()
    if not text:
        return QuestionMatch(focus="event")
    events = _match_events(store, text)
    event_person_ids: set[str] = set()
    for event in events:
        event_person_ids.update(
            person_id
            for person_id in event.get("person_ids") or []
            if isinstance(person_id, str)
        )
    persons = _match_persons(store, text, event_person_ids=event_person_ids)
    relation = _find_relation(store, persons)
    focus = _detect_focus(text, events, persons, relation)
    return QuestionMatch(
        focus=focus,
        events=tuple(events),
        persons=tuple(persons),
        relation=relation,
    )


# ---------------------------------------------------------------------------
# 动作构造
# ---------------------------------------------------------------------------


def _make_action(action_type: UIActionType, payload: dict[str, str]) -> UIAction:
    """按冻结契约构造动作（label / surface 由服务端写死）。"""

    surface = "timeline" if action_type.value.startswith("timeline.") else "graph"
    return UIAction(
        id=f"infer-{action_type.value}",
        type=action_type,
        payload=dict(payload),
        target=UIActionTarget(surface=surface, params=dict(payload)),
        auto=True,
        label=ACTION_LABEL[action_type],
        reason="服务端意图后置推断（模型未返回 UI 动作）",
    )


def _ordered_candidates(
    *,
    focus: Focus,
    event: dict[str, Any] | None,
    person: dict[str, Any] | None,
    relation: dict[str, Any] | None,
) -> list[UIAction]:
    """按问题焦点生成候选动作（去重、最多 3 个）。"""

    candidates: list[UIAction] = []

    def add_event() -> None:
        event_id = event.get("event_id") if event else None
        if isinstance(event_id, str) and event_id:
            candidates.append(
                _make_action(UIActionType.TIMELINE_FOCUS_EVENT, {"event_id": event_id})
            )

    def add_person() -> None:
        person_id = person.get("person_id") if person else None
        if isinstance(person_id, str) and person_id:
            candidates.append(
                _make_action(UIActionType.GRAPH_FOCUS_PERSON, {"person_id": person_id})
            )

    def add_relation() -> None:
        if not relation:
            return
        person_a = relation.get("person_id_a")
        person_b = relation.get("person_id_b")
        if (
            isinstance(person_a, str)
            and isinstance(person_b, str)
            and person_a != person_b
        ):
            candidates.append(
                _make_action(
                    UIActionType.GRAPH_FOCUS_RELATION,
                    {"person_id_a": person_a, "person_id_b": person_b},
                )
            )

    if focus == "relation":
        add_relation()
        add_person()
        add_event()
    elif focus == "person":
        add_person()
        add_event()
        add_relation()
    else:
        add_event()
        add_person()
        add_relation()

    # 去重（动作类型 + 实体）并按上限裁剪；时间轴朝代始终排最后（信息量最低）。
    deduped: list[UIAction] = []
    seen: set[tuple[str, tuple[tuple[str, str], ...]]] = set()
    for action in candidates:
        key = (action.type.value, tuple(sorted(action.payload.items())))
        if key in seen:
            continue
        seen.add(key)
        deduped.append(action)
    deduped = deduped[:_MAX_ACTIONS]
    if len(deduped) < _MAX_ACTIONS:
        dynasty_actions = [
            action
            for action in _dynasty_only(event)
            if (action.type.value, tuple(sorted(action.payload.items()))) not in seen
        ]
        if dynasty_actions:
            deduped.append(dynasty_actions[0])
    return deduped


def _dynasty_only(event: dict[str, Any] | None) -> list[UIAction]:
    """候选不足时补一个「时间轴·朝代」动作（仅当事件带朝代）。"""

    dynasty = event.get("dynasty") if event else None
    if not isinstance(dynasty, str) or not dynasty:
        return []
    return [_make_action(UIActionType.TIMELINE_FOCUS_DYNASTY, {"dynasty": dynasty})]


def infer_actions_for_question(store: Any, question: str) -> list[UIAction]:
    """直答链路：问题命中快照实体时，生成 1–3 个 UI 动作（供流式 `done` 事件下发）。

    没有命中任何事件 / 人物时返回空列表（前端不弹史引，不伪造联动目标）。
    """

    matched = match_question(store, question)
    if not matched.has_any:
        return []
    event = matched.events[0] if matched.events else None
    person = matched.persons[0] if matched.persons else None
    # V1.0.6.3 双图联动：问题只命中时间轴 / 人物图一侧时，用快照里的真实关联补齐另一侧，
    # 让一次提问同时拿到 `timeline.focus_event` 与 `graph.focus_person` 两个联动按钮。
    if event is None:
        event = _related_event_for_person(store, person)
    if person is None:
        person = _related_person_for_event(store, event)
    return _ordered_candidates(
        focus=matched.focus,
        event=event,
        person=person,
        relation=matched.relation,
    )


# ---------------------------------------------------------------------------
# 证据管线：从已核验 evidence 实体推断动作
# ---------------------------------------------------------------------------


def _evidence_sort_key(entity: Any) -> tuple[int, int]:
    """证据实体排序：问题直接提到的实体优先，其次是详情级证据。"""

    exposure = _EXPOSURE_RANK.get(str(getattr(entity, "exposure", "")), 0)
    return (0, -exposure)


def _entity_title(entity: Any) -> str:
    detail = getattr(entity, "detail", None)
    if isinstance(detail, dict):
        for key in ("title", "display_name", "name", "label"):
            value = detail.get(key)
            if isinstance(value, str) and value:
                return value
    return ""


def _mention_score(entity: Any, question: str) -> int:
    """实体标题/正名是否在问题中被直接提到（0 / 1）。"""

    title = _entity_title(entity)
    if title and len(title) >= 2 and title in question:
        return 1
    return 0


def _usable_evidence(entities: Any) -> list[Any]:
    usable: list[Any] = []
    for entity in entities or ():
        if not getattr(entity, "fact_usable", False):
            continue
        if str(getattr(entity, "exposure", "list")) == "list":
            continue
        if not getattr(entity, "citation_ids", None):
            continue
        usable.append(entity)
    return usable


def infer_actions_from_evidence(
    question: str,
    entities: Any,
    focus: str = "event",
) -> list[UIAction]:
    """证据问答链路：模型没有返回任何 `ui_actions` 时，从已核验 evidence 推断动作。

    `entities` 为 `agent.validator.ObservedEntity` 列表（鸭子类型：kind / entity_id /
    detail / related_person_ids / fact_usable / exposure / citation_ids）。
    `focus` 为 `agent.validator.detect_question_focus` 的判定结果（comparison 按事件题处理）。
    """

    usable = _usable_evidence(entities)
    if not usable:
        return []
    text = (question or "").strip()

    def pick(kind: str) -> list[Any]:
        candidates = [
            entity for entity in usable if getattr(entity, "kind", "") == kind
        ]
        candidates.sort(
            key=lambda entity: (
                -_mention_score(entity, text),
                *_evidence_sort_key(entity),
            )
        )
        return candidates

    events = pick("event")
    persons = pick("person")
    relations = pick("relation")
    event = events[0] if events else None
    person = persons[0] if persons else None
    relation_entity = relations[0] if relations else None

    event_payload: dict[str, Any] | None = None
    if event is not None:
        event_payload = {
            "event_id": getattr(event, "entity_id", ""),
            "dynasty": (getattr(event, "detail", {}) or {}).get("dynasty"),
        }
    else:
        # V1.0.6.3 双图联动：只查到人物证据时，用人物真实关联事件补齐时间轴动作。
        related_event_id = (
            _first_related_event_id(person) if person is not None else None
        )
        if related_event_id:
            event_payload = {"event_id": related_event_id}
    person_payload: dict[str, Any] | None = None
    if person is not None:
        person_payload = {
            "person_id": getattr(person, "entity_id", ""),
            "display_name": _entity_title(person),
        }
    else:
        # V1.0.6.3 双图联动：只查到事件证据时，用事件真实关联人物补齐人物图动作。
        related_person_id = (
            _first_related_person_id(event) if event is not None else None
        )
        if related_person_id:
            person_payload = {"person_id": related_person_id}
    relation_payload: dict[str, Any] | None = None
    if relation_entity is not None:
        related = sorted(
            person_id
            for person_id in getattr(relation_entity, "related_person_ids", ()) or ()
            if isinstance(person_id, str)
        )
        if len(related) >= 2:
            relation_payload = {"person_id_a": related[0], "person_id_b": related[1]}

    normalized_focus: Focus = (
        "relation"
        if focus == "relation"
        else ("person" if focus == "person" else "event")
    )
    if normalized_focus == "person" and relation_payload is not None:
        # 关系类问题：两个人都有记录时优先弹关系图（信息量大于单个人物）。
        normalized_focus = "relation"
    return _ordered_candidates(
        focus=normalized_focus,
        event=event_payload,
        person=person_payload,
        relation=relation_payload,
    )
