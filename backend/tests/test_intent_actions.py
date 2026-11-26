"""UI Action 后置推断测试（V1.0.6.2 专项修复 · 痛点 1，全离线）。

覆盖：
- 直答链路：问题命中快照事件 / 人物 / 关系时生成合法动作（事件题优先时间轴，
  关系题优先关系图，人物题关系图人物）；
- 证据管线：模型未返回 `ui_actions` 时从已核验 evidence 实体推断，模型返回过动作
  （即使全部不合法被过滤）时**不**覆盖为推断动作；
- 未命中 / 彩蛋事件不生成动作；动作字段满足冻结契约（label / surface / payload）。
"""

from __future__ import annotations

from typing import Any

import pytest

from agent.intent import (
    infer_actions_for_question,
    infer_actions_from_evidence,
    match_question,
)
from agent.schemas import ModelAnswer
from agent.validator import EvidenceValidator, ObservedEntity, ObservedEvidence
from contracts.action_types import ACTION_LABEL, UIActionType


def _action_types(actions: list[Any]) -> list[str]:
    return [action.type.value for action in actions]


# ---------------------------------------------------------------------------
# 直答链路：问题 → 快照实体
# ---------------------------------------------------------------------------


def test_event_question_infers_timeline_focus(store: Any) -> None:
    question = "淝水之战中，前秦的统帅是谁，击败前秦的是哪一个东晋名臣？"
    matched = match_question(store, question)
    assert matched.focus == "event"
    assert matched.events[0]["event_id"] == "dongjin-07"

    actions = infer_actions_for_question(store, question)
    assert actions, "命中具体事件的回答必须能弹出史引"
    first = actions[0]
    assert first.type is UIActionType.TIMELINE_FOCUS_EVENT
    assert first.payload["event_id"] == "dongjin-07"
    assert first.target.surface.value == "timeline"
    assert first.target.params["event_id"] == "dongjin-07"
    assert first.label == ACTION_LABEL[UIActionType.TIMELINE_FOCUS_EVENT]
    assert first.auto is True


def test_relation_question_infers_graph_relation(store: Any) -> None:
    question = "曹操和刘备是什么关系？"
    matched = match_question(store, question)
    assert matched.focus == "relation"
    assert matched.relation is not None

    actions = infer_actions_for_question(store, question)
    assert actions
    first = actions[0]
    assert first.type is UIActionType.GRAPH_FOCUS_RELATION
    assert first.target.surface.value == "graph"
    pair = {first.payload["person_id_a"], first.payload["person_id_b"]}
    assert pair == {"p-caocao-b012", "p-liubei-0c86"}


def test_person_question_infers_graph_person(store: Any) -> None:
    actions = infer_actions_for_question(store, "武则天是哪个朝代的人物？")
    assert actions
    assert actions[0].type is UIActionType.GRAPH_FOCUS_PERSON
    assert actions[0].payload["person_id"] == "p-wuzetian-2920"


# ---------------------------------------------------------------------------
# V1.0.6.3 双图联动：一句提问同时返回时间轴 + 人物图动作
# ---------------------------------------------------------------------------


def test_event_question_also_infers_related_person(store: Any) -> None:
    """事件题（玄武门之变）：除时间轴动作外，还要补上事件叙事里第一位关联人物的图谱动作。"""

    actions = infer_actions_for_question(store, "玄武门之变发生在哪一年？")
    types = _action_types(actions)
    assert UIActionType.TIMELINE_FOCUS_EVENT.value in types
    assert UIActionType.GRAPH_FOCUS_PERSON.value in types
    event_action = next(
        action for action in actions if action.type is UIActionType.TIMELINE_FOCUS_EVENT
    )
    person_action = next(
        action for action in actions if action.type is UIActionType.GRAPH_FOCUS_PERSON
    )
    assert event_action.payload["event_id"] == "tang-04"
    # participants 顺序第一位是李世民（事件真正的主角），不是任意关联人物。
    assert person_action.payload["person_id"] == "p-lishimin-7efd"
    assert event_action.target.surface.value == "timeline"
    assert person_action.target.surface.value == "graph"


def test_person_question_also_infers_representative_event(store: Any) -> None:
    """人物题（李世民）：除人物图动作外，还要补上其代表事件的时间轴动作。"""

    actions = infer_actions_for_question(store, "展示李世民的人物关系图")
    types = _action_types(actions)
    assert UIActionType.GRAPH_FOCUS_PERSON.value in types
    assert UIActionType.TIMELINE_FOCUS_EVENT.value in types
    person_action = next(
        action for action in actions if action.type is UIActionType.GRAPH_FOCUS_PERSON
    )
    event_action = next(
        action for action in actions if action.type is UIActionType.TIMELINE_FOCUS_EVENT
    )
    assert person_action.payload["person_id"] == "p-lishimin-7efd"
    # 重要性最高 + 本人为主角 + 年份最早 → 玄武门之变（626）。
    assert event_action.payload["event_id"] == "tang-04"


def test_dual_surface_actions_stay_within_contract_limit(store: Any) -> None:
    """双图联动不得突破契约上限（3 条）且类型 / 实体不重复。"""

    for question in ("玄武门之变发生在哪一年？", "展示李世民的人物关系图", "赤壁之战"):
        actions = infer_actions_for_question(store, question)
        assert 1 <= len(actions) <= 3
        keys = [
            (action.type.value, tuple(sorted(action.payload.items())))
            for action in actions
        ]
        assert len(keys) == len(set(keys))
        surfaces = {action.type.value.split(".", 1)[0] for action in actions}
        assert surfaces == {"timeline", "graph"}, (
            f"『{question}』应同时命中时间轴与人物图谱两类动作"
        )


def test_unmatched_question_returns_no_actions(store: Any) -> None:
    assert infer_actions_for_question(store, "今天天气怎么样？") == []
    assert match_question(store, "今天天气怎么样？").has_any is False


def test_actions_max_three_and_unique(store: Any) -> None:
    actions = infer_actions_for_question(store, "商鞅变法和王安石变法有什么区别？")
    assert 1 <= len(actions) <= 3
    keys = [
        (action.type.value, tuple(sorted(action.payload.items()))) for action in actions
    ]
    assert len(keys) == len(set(keys))


def test_easter_egg_event_never_inferred(store: Any) -> None:
    special = next(
        event for event in store.events_by_id.values() if event.get("is_special")
    )
    actions = infer_actions_for_question(store, f"{special['title']}是怎么回事？")
    assert all(
        action.type is not UIActionType.TIMELINE_FOCUS_EVENT for action in actions
    ), "彩蛋事件不得作为史引联动目标"


# ---------------------------------------------------------------------------
# 证据管线：从已核验 evidence 推断
# ---------------------------------------------------------------------------


def _observed_event_entity() -> ObservedEntity:
    return ObservedEntity(
        kind="event",
        entity_id="dongjin-07",
        source_tool="get_event",
        exposure="detail",
        detail={"title": "淝水之战", "dynasty": "东晋十六国"},
        citation_ids={"cite-dongjin-07-0"},
    )


def _observed_person_entity(
    person_id: str = "p-fujian-ee34", name: str = "苻坚"
) -> ObservedEntity:
    return ObservedEntity(
        kind="person",
        entity_id=person_id,
        source_tool="get_person",
        exposure="detail",
        detail={"display_name": name},
        citation_ids={f"cite-{person_id}-0"},
    )


def test_infer_from_evidence_event_first() -> None:
    actions = infer_actions_from_evidence(
        "淝水之战中，前秦的统帅是谁？",
        [_observed_event_entity(), _observed_person_entity()],
        "event",
    )
    assert [action.type for action in actions][:2] == [
        UIActionType.TIMELINE_FOCUS_EVENT,
        UIActionType.GRAPH_FOCUS_PERSON,
    ]
    assert actions[0].payload["event_id"] == "dongjin-07"


def test_infer_from_evidence_person_question() -> None:
    actions = infer_actions_from_evidence(
        "苻坚是谁？", [_observed_person_entity(), _observed_event_entity()], "person"
    )
    assert actions[0].type is UIActionType.GRAPH_FOCUS_PERSON


def test_infer_from_evidence_relation_first() -> None:
    relation = ObservedEntity(
        kind="relation",
        entity_id="刘备__曹操",
        source_tool="get_relation",
        exposure="detail",
        detail={"label": "对手"},
        related_person_ids={"p-liubei-0c86", "p-caocao-b012"},
        citation_ids={"cite-relation-刘备__曹操"},
    )
    actions = infer_actions_from_evidence(
        "曹操和刘备是什么关系？",
        [
            _observed_person_entity("p-liubei-0c86", "刘备"),
            _observed_person_entity("p-caocao-b012", "曹操"),
            relation,
        ],
        "relation",
    )
    assert actions[0].type is UIActionType.GRAPH_FOCUS_RELATION


def test_infer_from_evidence_skips_unusable_entities() -> None:
    list_only = ObservedEntity(
        kind="person",
        entity_id="p-fujian-ee34",
        source_tool="get_relation",
        exposure="list",
        detail={"display_name": "苻坚"},
    )
    assert infer_actions_from_evidence("苻坚是谁？", [list_only], "person") == []


# ---------------------------------------------------------------------------
# V1.0.6.3 双图联动：证据管线只查到一侧实体时，用工具真实关联补齐另一侧
# ---------------------------------------------------------------------------


def test_infer_from_evidence_event_pairs_related_person() -> None:
    """只查到事件证据时：用 get_event 返回的真实 person_ids 补人物图动作。"""

    event_only = ObservedEntity(
        kind="event",
        entity_id="tang-04",
        source_tool="get_event",
        exposure="detail",
        detail={"title": "玄武门之变", "dynasty": "唐"},
        related_person_ids={"p-lishimin-7efd", "p-liyuan-1546"},
        citation_ids={"cite-tang-04-0"},
    )
    actions = infer_actions_from_evidence(
        "玄武门之变发生在哪一年？", [event_only], "event"
    )
    types = _action_types(actions)
    assert UIActionType.TIMELINE_FOCUS_EVENT.value in types
    assert UIActionType.GRAPH_FOCUS_PERSON.value in types
    person_action = next(
        action for action in actions if action.type is UIActionType.GRAPH_FOCUS_PERSON
    )
    assert person_action.payload["person_id"] in {
        "p-lishimin-7efd",
        "p-liyuan-1546",
    }


def test_infer_from_evidence_person_pairs_related_event() -> None:
    """只查到人物证据时：用 get_person 返回的真实 event_ids 补时间轴动作。"""

    person_only = ObservedEntity(
        kind="person",
        entity_id="p-lishimin-7efd",
        source_tool="get_person",
        exposure="detail",
        detail={"display_name": "李世民"},
        related_event_ids={"tang-04", "tang-05"},
        citation_ids={"cite-p-lishimin-7efd-0"},
    )
    actions = infer_actions_from_evidence(
        "展示李世民的人物关系图", [person_only], "person"
    )
    types = _action_types(actions)
    assert UIActionType.GRAPH_FOCUS_PERSON.value in types
    assert UIActionType.TIMELINE_FOCUS_EVENT.value in types
    event_action = next(
        action for action in actions if action.type is UIActionType.TIMELINE_FOCUS_EVENT
    )
    assert event_action.payload["event_id"] in {"tang-04", "tang-05"}


# ---------------------------------------------------------------------------
# Validator 集成：模型漏写 ui_actions → 服务端补
# ---------------------------------------------------------------------------


def _grounded_without_actions(citation_id: str = "cite-dongjin-07-0") -> ModelAnswer:
    return ModelAnswer.model_validate(
        {
            "mode": "grounded",
            "claims": [{"id": "c1", "citation_ids": [citation_id]}],
            "evidence": [{"entity_type": "event", "entity_id": "dongjin-07"}],
            "ui_actions": [],
        }
    )


def test_validator_infers_actions_when_model_omits_them(toolkit: Any) -> None:
    result = toolkit.call("get_event", event_id="dongjin-07")
    observed = ObservedEvidence.from_results([result])
    citation_ids = [citation["id"] for citation in result["citations"]]
    assert citation_ids

    outcome = EvidenceValidator().validate(
        _grounded_without_actions(citation_ids[0]),
        observed,
        question="淝水之战发生在哪一年？",
    )
    assert outcome.answer.mode == "grounded"
    assert outcome.answer.ui_actions, "模型漏写 ui_actions 时必须由服务端补齐"
    assert outcome.answer.ui_actions[0].type is UIActionType.TIMELINE_FOCUS_EVENT
    assert outcome.answer.ui_actions[0].payload["event_id"] == "dongjin-07"


def test_validator_does_not_override_invalid_model_actions(toolkit: Any) -> None:
    """模型**返回过**动作但全部被过滤（例如指向未观测实体）时，不补推断动作。"""

    result = toolkit.call("get_event", event_id="dongjin-07")
    observed = ObservedEvidence.from_results([result])
    citation_ids = [citation["id"] for citation in result["citations"]]
    payload = _grounded_without_actions(citation_ids[0]).model_dump(mode="json")
    payload["ui_actions"] = [
        {
            "id": "act-bad",
            "type": "timeline.focus_event",
            "payload": {"event_id": "not-observed"},
            "target": {"surface": "timeline", "params": {"event_id": "not-observed"}},
            "auto": True,
            "reason": None,
        }
    ]
    outcome = EvidenceValidator().validate(
        ModelAnswer.model_validate(payload),
        observed,
        question="淝水之战发生在哪一年？",
    )
    assert outcome.answer.mode == "grounded"
    assert outcome.answer.ui_actions == []


@pytest.mark.parametrize("kind", ["insufficient", "refusal"])
def test_validator_never_infers_actions_for_non_grounded(kind: str) -> None:
    observed = ObservedEvidence()
    if kind == "insufficient":
        answer = ModelAnswer.model_validate(
            {"mode": "insufficient", "missing_reasons": ["NO_MATCHING_ENTITY"]}
        )
    else:
        answer = ModelAnswer.model_validate(
            {"mode": "refusal", "reason_code": "OUT_OF_SCOPE"}
        )
    outcome = EvidenceValidator().validate(answer, observed)
    assert outcome.answer.ui_actions == []
