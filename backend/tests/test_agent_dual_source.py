"""V1.0.5.2 双数据源单测：问题分类 / 分节顺序 / 覆盖硬校验 / 单源省略。

全部离线，使用真实快照工具层构造 ObservedEvidence。
"""

from __future__ import annotations

from typing import Any

from agent.schemas import ModelAnswer
from agent.validator import (
    SOURCE_GRAPH,
    SOURCE_TIMELINE,
    EvidenceValidator,
    ObservedEntity,
    ObservedEvidence,
    check_dual_source_coverage,
    detect_question_focus,
    source_coverage,
)

CHIBI_EVENT = "handong-chibi"
ZHOUYU = "p-zhouyu-b475"


def _grounded(evidence: list[dict[str, Any]], claims: list[dict[str, Any]]) -> ModelAnswer:
    return ModelAnswer.model_validate(
        {
            "mode": "grounded",
            "claims": claims,
            "evidence": evidence,
        }
    )


def _observed_chibi_and_zhouyu(toolkit: Any) -> tuple[ObservedEvidence, str, str]:
    event_result = toolkit.call("get_event", event_id=CHIBI_EVENT)
    person_result = toolkit.call("get_person", person_id=ZHOUYU)
    observed = ObservedEvidence.from_results([event_result, person_result])
    event_citation = next(
        citation["id"]
        for citation in event_result["citations"]
        if citation["kind"] == "event"
    )
    person_citation = person_result["citations"][0]["id"]
    return observed, event_citation, person_citation


def test_detect_question_focus_variants() -> None:
    assert detect_question_focus("和孔子有关系的人有哪些") == "relation"
    assert detect_question_focus("孔子和老子是什么关系") == "relation"
    assert detect_question_focus("武则天是哪个朝代的人物") == "person"
    assert detect_question_focus("商鞅变法和王安石变法的区别") == "comparison"
    assert detect_question_focus("赤壁之战发生在哪一年") == "event"
    # 无关键词时按证据兜底：只有人物证据 → person，只有关系证据 → relation，否则 event。
    person_entity = ObservedEntity(
        kind="person",
        entity_id="p-demo",
        source_tool="get_person",
        exposure="detail",
    )
    relation_entity = ObservedEntity(
        kind="relation",
        entity_id="p-a|p-b",
        source_tool="get_relation",
        exposure="detail",
    )
    assert detect_question_focus("随便问问", [person_entity]) == "person"
    assert detect_question_focus("随便问问", [relation_entity]) == "relation"
    assert detect_question_focus("随便问问", []) == "event"


def test_check_dual_source_coverage_by_focus(toolkit: Any) -> None:
    observed, _, _ = _observed_chibi_and_zhouyu(toolkit)
    graph_entities = [
        entity for entity in observed.entities.values() if entity.kind == "person"
    ]
    timeline_entities = [
        entity for entity in observed.entities.values() if entity.kind in ("event", "rag")
    ]
    assert check_dual_source_coverage(graph_entities, "person") is None
    assert check_dual_source_coverage(timeline_entities, "person") is not None
    assert check_dual_source_coverage(timeline_entities, "event") is None
    assert check_dual_source_coverage(graph_entities, "event") is not None
    assert source_coverage(graph_entities) == {SOURCE_TIMELINE: False, SOURCE_GRAPH: True}
    assert source_coverage(timeline_entities) == {
        SOURCE_TIMELINE: True,
        SOURCE_GRAPH: False,
    }


def test_person_question_composes_graph_section_first(toolkit: Any) -> None:
    observed, event_citation, person_citation = _observed_chibi_and_zhouyu(toolkit)
    answer = _grounded(
        evidence=[
            {"entity_type": "person", "entity_id": ZHOUYU},
            {"entity_type": "event", "entity_id": CHIBI_EVENT},
        ],
        claims=[
            {"id": "c1", "citation_ids": [person_citation]},
            {"id": "c2", "citation_ids": [event_citation]},
        ],
    )
    outcome = EvidenceValidator().validate(answer, observed, question="周瑜是谁")

    assert outcome.downgraded is False
    markdown = outcome.answer.markdown
    assert "**[人物关系图]**" in markdown
    assert "**[时间轴·大事记]**" in markdown
    # 人物类：关系图在前，时间轴作背景补充。
    assert markdown.index("[人物关系图]") < markdown.index("[时间轴·大事记]")
    assert outcome.source_coverage == {SOURCE_TIMELINE: True, SOURCE_GRAPH: True}


def test_event_question_composes_timeline_section_first(toolkit: Any) -> None:
    observed, event_citation, person_citation = _observed_chibi_and_zhouyu(toolkit)
    answer = _grounded(
        evidence=[
            {"entity_type": "person", "entity_id": ZHOUYU},
            {"entity_type": "event", "entity_id": CHIBI_EVENT},
        ],
        claims=[
            {"id": "c1", "citation_ids": [person_citation]},
            {"id": "c2", "citation_ids": [event_citation]},
        ],
    )
    outcome = EvidenceValidator().validate(
        answer, observed, question="赤壁之战发生在哪一年"
    )

    assert outcome.downgraded is False
    markdown = outcome.answer.markdown
    assert markdown.index("[时间轴·大事记]") < markdown.index("[人物关系图]")


def test_person_focus_without_graph_evidence_is_downgraded(toolkit: Any) -> None:
    observed, event_citation, _ = _observed_chibi_and_zhouyu(toolkit)
    answer = _grounded(
        evidence=[{"entity_type": "event", "entity_id": CHIBI_EVENT}],
        claims=[{"id": "c1", "citation_ids": [event_citation]}],
    )
    outcome = EvidenceValidator().validate(answer, observed, question="周瑜是谁")

    assert outcome.downgraded is True
    assert outcome.answer.mode == "insufficient"
    assert "人物关系图证据" in (outcome.reason or "")


def test_event_focus_without_timeline_evidence_is_downgraded(toolkit: Any) -> None:
    person_result = toolkit.call("get_person", person_id=ZHOUYU)
    observed = ObservedEvidence.from_results([person_result])
    person_citation = person_result["citations"][0]["id"]
    answer = _grounded(
        evidence=[{"entity_type": "person", "entity_id": ZHOUYU}],
        claims=[{"id": "c1", "citation_ids": [person_citation]}],
    )
    outcome = EvidenceValidator().validate(
        answer, observed, question="赤壁之战发生在哪一年"
    )

    assert outcome.downgraded is True
    assert "时间轴证据" in (outcome.reason or "")


def test_single_source_question_omits_other_section(toolkit: Any) -> None:
    event_result = toolkit.call("get_event", event_id=CHIBI_EVENT)
    observed = ObservedEvidence.from_results([event_result])
    event_citation = next(
        citation["id"]
        for citation in event_result["citations"]
        if citation["kind"] == "event"
    )
    answer = _grounded(
        evidence=[{"entity_type": "event", "entity_id": CHIBI_EVENT}],
        claims=[{"id": "c1", "citation_ids": [event_citation]}],
    )
    outcome = EvidenceValidator().validate(
        answer, observed, question="赤壁之战发生在哪一年"
    )

    markdown = outcome.answer.markdown
    assert "**[时间轴·大事记]**" in markdown
    assert "[人物关系图]" not in markdown
    assert outcome.source_coverage == {SOURCE_TIMELINE: True, SOURCE_GRAPH: False}