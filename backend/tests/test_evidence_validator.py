"""证据校验器测试（V1.0.3）：evidence / citation 不可核验必须降级；三态文本由服务端生成。"""

from __future__ import annotations

from typing import Any

from agent.schemas import ModelAnswer
from agent.validator import EvidenceValidator, ObservedEvidence


def _observed_for_chibi(toolkit: Any) -> ObservedEvidence:
    result = toolkit.call("get_event", event_id="handong-chibi")
    return ObservedEvidence.from_results([result])


def _model_action(action_id: str = "act-ok") -> dict[str, Any]:
    """模型只提供动作意图；label 由服务端写死。"""

    return {
        "id": action_id,
        "type": "timeline.focus_event",
        "payload": {"event_id": "handong-chibi"},
        "target": {"surface": "timeline", "params": {"event_id": "handong-chibi"}},
        "auto": True,
        "reason": None,
    }


def _grounded(
    *,
    citation_ids: list[str] | None = None,
    entity_id: str = "handong-chibi",
    evidence: bool = True,
    ui_actions: list[dict[str, Any]] | None = None,
) -> ModelAnswer:
    return ModelAnswer.model_validate(
        {
            "mode": "grounded",
            "claims": [
                {
                    "id": "c1",
                    "citation_ids": citation_ids or ["cite-handong-chibi-0"],
                }
            ],
            "evidence": (
                [{"entity_type": "event", "entity_id": entity_id}] if evidence else []
            ),
            "related_event_ids": ["handong-chibi", "not-observed"],
            "ui_actions": ui_actions or [],
        }
    )


def test_observed_evidence_collects_entity_and_citation_ids(toolkit: Any) -> None:
    observed = _observed_for_chibi(toolkit)
    assert "handong-chibi" in observed.entity_ids
    assert "p-zhouyu-b475" in observed.entity_ids
    assert "cite-handong-chibi-0" in observed.citations


def test_observed_evidence_does_not_treat_era_ids_as_entities(toolkit: Any) -> None:
    person_result = toolkit.call("get_person", person_id="p-liangtaihou-xixia-0d0f")
    observed = ObservedEvidence.from_results([person_result])
    assert "p-liangtaihou-xixia-0d0f" in observed.entity_ids
    # era_ids / scope_ids 不是证据实体，不进入 observed 集合。
    assert "xixia" not in observed.entity_ids
    assert "songliaojinxia" not in observed.entity_ids


def test_grounded_with_valid_evidence_passes(toolkit: Any) -> None:
    outcome = EvidenceValidator().validate(_grounded(), _observed_for_chibi(toolkit))
    assert outcome.downgraded is False
    assert outcome.answer.mode == "grounded"
    assert [citation.id for citation in outcome.citations] == ["cite-handong-chibi-0"]
    # related_event_ids 里未在工具结果出现的会被过滤。
    assert outcome.answer.related_event_ids == ["handong-chibi"]
    # P0-3：certainty 由服务端写死。
    assert outcome.answer.certainty == "high"


def test_invalid_evidence_entity_forces_insufficient(toolkit: Any) -> None:
    outcome = EvidenceValidator().validate(
        _grounded(entity_id="tang-04"), _observed_for_chibi(toolkit)
    )
    assert outcome.downgraded is True
    assert outcome.answer.mode == "insufficient"
    assert outcome.citations == []
    assert outcome.answer.claims == []
    assert outcome.answer.missing
    assert "tang-04" in outcome.answer.missing[0]


def test_missing_evidence_forces_insufficient(toolkit: Any) -> None:
    outcome = EvidenceValidator().validate(
        _grounded(evidence=False), _observed_for_chibi(toolkit)
    )
    assert outcome.downgraded is True
    assert outcome.answer.mode == "insufficient"
    assert "evidence" in outcome.answer.missing[0]


def test_invalid_citation_forces_insufficient(toolkit: Any) -> None:
    outcome = EvidenceValidator().validate(
        _grounded(citation_ids=["cite-fabricated-0"]), _observed_for_chibi(toolkit)
    )
    assert outcome.downgraded is True
    assert outcome.answer.mode == "insufficient"
    assert "cite-fabricated-0" in outcome.answer.missing[0]


def test_insufficient_and_refusal_are_not_marked_downgraded(toolkit: Any) -> None:
    observed = _observed_for_chibi(toolkit)
    insufficient = ModelAnswer(
        mode="insufficient",
        missing_reasons=["NO_MATCHING_ENTITY"],
    )
    outcome = EvidenceValidator().validate(insufficient, observed)
    assert outcome.downgraded is False
    assert outcome.citations == []
    assert outcome.answer.mode == "insufficient"
    assert outcome.answer.certainty == "low"
    assert outcome.answer.missing == ["没有检索到与问题匹配的人物或事件"]
    assert outcome.answer.markdown.startswith(
        "抱歉，现有的历史数据无法完整回答您的问题。"
    )

    refusal = ModelAnswer(
        mode="refusal",
        reason_code="OUT_OF_SCOPE",
    )
    outcome = EvidenceValidator().validate(refusal, observed)
    assert outcome.downgraded is False
    assert outcome.answer.reason_code == "OUT_OF_SCOPE"
    assert outcome.answer.certainty is None
    assert outcome.answer.markdown == (
        "抱歉，这个问题超出了史脉历史数据的回答范围，我无法给出可靠回答。"
    )


def test_ui_actions_are_filtered_by_whitelist_and_observed_ids(toolkit: Any) -> None:
    observed = _observed_for_chibi(toolkit)
    valid_subset = _model_action("act-ok")
    unobserved_target = _model_action("act-bad-id")
    unobserved_target["payload"] = {"event_id": "tang-04"}
    unobserved_target["target"] = {
        "surface": "timeline",
        "params": {"event_id": "tang-04"},
    }
    planned_type = _model_action("act-planned")
    planned_type["type"] = "timeline.highlight_events"
    planned_type["payload"] = {}
    planned_type["target"] = {"surface": "timeline", "params": {}}

    answer = _grounded(ui_actions=[valid_subset, unobserved_target, planned_type])
    outcome = EvidenceValidator().validate(answer, observed)
    assert outcome.downgraded is False
    assert [action.id for action in outcome.answer.ui_actions] == ["act-ok"]
    # 放行后清理：label 由服务端按 type 写死，模型无法自定义。
    assert outcome.answer.ui_actions[0].label == "在时间轴中查看"
