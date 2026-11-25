"""V1.0.5.4 对比分析（二次归纳）单测。

覆盖验收要求：
1. 对比类问题触发二次归纳，返回 grounded 且含对比分析；
2. 分析中含未证实年份 → 分析被丢弃、事实实证保留；
3. 分析中含事实块外人物 → 分析被丢弃；
4. 非对比类问题不触发二次归纳（不多调模型）；
5. 二次归纳模型调用失败 → 降级为只保留事实实证，不报 500（Orchestrator 不抛异常）。
另含事实块构建 / 年份-人物白名单校验 / JSON 协议解析 / 契约向后兼容等边界用例。

全部离线：FakeLLM 按脚本返回，工具层读真实快照。
"""

from __future__ import annotations

import json
from typing import Any

import pytest
from agent_testkit import (
    FakeLLM,
    ask_request,
    final_step,
    grounded_answer,
    insufficient_answer,
    tool_batch_step,
    tool_call_step,
)
from pydantic import ValidationError

from agent.comparison import (
    ComparisonFacts,
    build_comparison_facts,
    collect_rescue_entities,
    extract_year_tokens,
    extract_years,
    find_comparison_subjects,
    find_unverified_person_names,
    find_unverified_years,
    observed_graph_person_names,
    parse_comparison_analysis,
    validate_comparison_analysis,
)
from agent.orchestrator import (
    COMPARISON_MAX_TOKENS,
    MAX_PROMPT_MESSAGE_CHARS,
    AgentOrchestrator,
    _shrink_messages,
)
from agent.prompts import (
    COMPARISON_SYNTHESIS_SYSTEM_PROMPT,
    MAX_TOOL_MESSAGE_CHARS,
    build_comparison_synthesis_messages,
    build_tool_result_message,
)
from agent.schemas import FinalAnswer
from agent.validator import (
    ObservedEvidence,
    detect_comparison_intent,
    detect_question_focus,
)
from contracts.models import Answer as ContractAnswer
from llm_client import LLMTimeoutError

SHANG_YANG_EVENT = "zhanguo-05"
WANG_EVENT = "beisong-10"
CHIBI_EVENT = "handong-chibi"
CHIBI_CITATION = "cite-handong-chibi-0"
COMPARISON_QUESTION = "商鞅变法与王安石变法的区别"
SUMMARY_QUESTION = "总结商鞅变法和王安石变法的异同"

#: 手动构造的事实块（单元测试用，模拟 `build_comparison_facts` 的产物）。
FACTS = ComparisonFacts(
    block=(
        "事件：商鞅变法（战国，前359年）、熙宁变法（北宋，1069年）；"
        "人物：商鞅、秦孝公、王安石、赵顼（宋神宗）；史料记载涉及前356年—前350年。"
    ),
    years=frozenset({-359, -356, -350, 1069}),
    person_names=frozenset({"商鞅", "秦孝公", "王安石", "赵顼", "宋神宗"}),
)
KNOWN_PERSON_NAMES = {
    "商鞅",
    "秦孝公",
    "王安石",
    "赵顼",
    "宋神宗",
    "秦始皇",
    "王莽",
    "启",
    "李广",
    "李广利",
}


# ---------------------------------------------------------------------------
# 触发条件 / 事实块构建
# ---------------------------------------------------------------------------


def test_detect_comparison_intent_cues() -> None:
    assert detect_comparison_intent("商鞅变法与王安石变法的区别") is True
    assert detect_comparison_intent("对比一下商鞅变法和王安石变法") is True
    assert detect_comparison_intent("它们有什么不同？") is True
    assert detect_comparison_intent("总结商鞅变法和王安石变法") is True
    assert detect_comparison_intent("归纳两场变法的异同") is True
    # 普通事实问答不触发二次归纳。
    assert detect_comparison_intent("赤壁之战发生在哪一年") is False
    assert detect_comparison_intent("王安石是谁") is False
    assert detect_comparison_intent("") is False


def test_comparison_synthesis_prompt_keeps_required_constraints() -> None:
    """需求原文约束必须逐字出现在二次归纳 Prompt 中。"""

    assert "你是一个严谨的历史分析助手" in COMPARISON_SYNTHESIS_SYSTEM_PROMPT
    assert "严禁使用你自身的知识储备" in COMPARISON_SYNTHESIS_SYSTEM_PROMPT
    assert "材料不足时明确写“材料未提供”" in COMPARISON_SYNTHESIS_SYSTEM_PROMPT

    messages = build_comparison_synthesis_messages("问题", "事实块")
    assert [message["role"] for message in messages] == ["system", "user"]
    assert messages[0]["content"] == COMPARISON_SYNTHESIS_SYSTEM_PROMPT
    assert "事实块" in messages[1]["content"]
    assert "材料未提供" in messages[1]["content"]


def test_build_comparison_facts_from_real_tool_results(toolkit: Any, store: Any) -> None:
    observed = ObservedEvidence.from_results(
        [
            toolkit.call("get_event", event_id=SHANG_YANG_EVENT),
            toolkit.call("get_event", event_id=WANG_EVENT),
        ]
    )
    entities = [
        observed.entities[("event", SHANG_YANG_EVENT)],
        observed.entities[("event", WANG_EVENT)],
    ]
    facts = build_comparison_facts(observed, entities, store)

    assert facts is not None
    # 纯数据事实块：事件标题 / 年份 / 参与者 / 史料出处。
    assert "商鞅变法" in facts.block and "熙宁变法" in facts.block
    assert "前359年" in facts.block and "1069年" in facts.block
    assert "参与者" in facts.block
    # 年份白名单包含两场变法年份；人物白名单包含参与者（含别名）。
    assert -359 in facts.years and 1069 in facts.years
    assert "商鞅" in facts.person_names and "王安石" in facts.person_names
    assert "宋神宗" in facts.person_names


def test_build_comparison_facts_returns_none_without_entities(store: Any) -> None:
    observed = ObservedEvidence()
    assert build_comparison_facts(observed, [], store) is None


# ---------------------------------------------------------------------------
# 证据链校验：年份 / 人物白名单
# ---------------------------------------------------------------------------


def test_extract_years_handles_bc_ad_and_durations() -> None:
    assert extract_years("公元前356年，前350年，1069年，公元220年") == {
        -356,
        -350,
        1069,
        220,
    }
    tokens = extract_year_tokens("推行了20年，公元前356年")
    assert tokens[0].year == 20 and tokens[0].must_verify is False
    assert tokens[1].year == -356 and tokens[1].must_verify is True


def test_validate_analysis_accepts_verified_facts() -> None:
    text = (
        "**背景**：商鞅变法发生于前359年，王安石变法发生于1069年。"
        "**目的**：两者都试图富国强兵。**结果**：材料未提供完整对比结论。"
    )
    checked, reason = validate_comparison_analysis(text, FACTS, KNOWN_PERSON_NAMES)
    assert reason is None
    assert checked == text


def test_validate_analysis_rejects_unverified_year() -> None:
    text = "商鞅变法发生于前359年，但秦始皇统一六国发生于公元前221年。"
    checked, reason = validate_comparison_analysis(text, FACTS, KNOWN_PERSON_NAMES)
    assert checked is None
    assert reason is not None and "年份" in reason
    assert find_unverified_years(text, FACTS) == {-221}


def test_validate_analysis_rejects_person_outside_fact_block() -> None:
    text = "商鞅变法与王安石变法都重视制度，秦始皇也推行过类似改革。"
    checked, reason = validate_comparison_analysis(text, FACTS, KNOWN_PERSON_NAMES)
    assert checked is None
    assert reason is not None and "人物" in reason
    assert find_unverified_person_names(text, FACTS, KNOWN_PERSON_NAMES) == ["秦始皇"]


def test_validate_analysis_allows_fact_person_alias() -> None:
    text = "**背景**：宋神宗支持王安石变法；商鞅变法得到秦孝公支持。"
    checked, reason = validate_comparison_analysis(text, FACTS, KNOWN_PERSON_NAMES)
    assert reason is None and checked is not None


def test_validate_analysis_ignores_single_char_name_false_positive() -> None:
    """单字人名（启）不做正则式扫描，避免「开启」被误判为人物。"""

    facts = ComparisonFacts(block="开启改革", years=frozenset(), person_names=frozenset())
    checked, reason = validate_comparison_analysis("这场改革开启了新局面。", facts, {"启"})
    assert reason is None and checked is not None


def test_validate_analysis_allows_name_covered_by_longer_whitelist_name() -> None:
    facts = ComparisonFacts(
        block="李广利出征", years=frozenset(), person_names=frozenset({"李广利"})
    )
    checked, reason = validate_comparison_analysis("李广利率军出征。", facts, {"李广", "李广利"})
    assert reason is None and checked is not None


def test_validate_analysis_rejects_empty_and_oversized_text() -> None:
    assert validate_comparison_analysis("   ", FACTS, KNOWN_PERSON_NAMES)[0] is None
    huge = "商鞅变法" * 400
    checked, reason = validate_comparison_analysis(huge, FACTS, KNOWN_PERSON_NAMES)
    assert checked is None and reason is not None and "超长" in reason


def test_parse_comparison_analysis_protocol() -> None:
    assert parse_comparison_analysis('{"analysis": "对比结论"}') == "对比结论"
    assert (
        parse_comparison_analysis('```json\n{"analysis": "对比结论"}\n```')
        == "对比结论"
    )
    # 非 JSON / 缺字段 / 空文本 / 前后夹带解释文字 → None（调用方丢弃分析）。
    assert parse_comparison_analysis("对比结论") is None
    assert parse_comparison_analysis('{"text": "对比结论"}') is None
    assert parse_comparison_analysis('{"analysis": "  "}') is None
    assert parse_comparison_analysis('好的，分析如下：{"analysis": "x"}') is None
    assert parse_comparison_analysis("") is None


# ---------------------------------------------------------------------------
# Orchestrator：触发 / 校验失败丢弃 / 非对比不触发 / 模型失败降级
# ---------------------------------------------------------------------------


def _event_citation_id(toolkit: Any, event_id: str) -> str:
    result = toolkit.call("get_event", event_id=event_id)
    assert result["ok"] is True and result["citations"]
    return next(citation["id"] for citation in result["citations"] if citation["kind"] == "event")


def _comparison_tool_and_final(toolkit: Any) -> list[str]:
    shang_citation = _event_citation_id(toolkit, SHANG_YANG_EVENT)
    wang_citation = _event_citation_id(toolkit, WANG_EVENT)
    return [
        tool_batch_step(
            [
                {"tool": "get_event", "arguments": {"event_id": SHANG_YANG_EVENT}},
                {"tool": "get_event", "arguments": {"event_id": WANG_EVENT}},
            ]
        ),
        final_step(
            {
                "mode": "grounded",
                "claims": [
                    {"id": "c1", "citation_ids": [shang_citation]},
                    {"id": "c2", "citation_ids": [wang_citation]},
                ],
                "evidence": [
                    {"entity_type": "event", "entity_id": SHANG_YANG_EVENT},
                    {"entity_type": "event", "entity_id": WANG_EVENT},
                ],
                "related_event_ids": [SHANG_YANG_EVENT, WANG_EVENT],
                "missing_reasons": [],
                "reason_code": None,
                "ui_actions": [],
            }
        ),
    ]


def _analysis_response(text: str) -> str:
    return json.dumps({"analysis": text}, ensure_ascii=False)


def _run(store: Any, responses: list[Any], question: str = COMPARISON_QUESTION):
    fake = FakeLLM(responses)
    result = AgentOrchestrator(store, fake).run(ask_request(question, route="/ask"))
    return result, fake


def test_comparison_question_triggers_analysis_and_stays_grounded(
    store: Any, toolkit: Any
) -> None:
    """验收 1：对比类问题触发二次归纳，返回 grounded 且含对比分析。"""

    analysis = (
        "**背景**：商鞅变法发生于前359年，王安石变法发生于1069年。"
        "**目的**：两者都试图通过制度调整实现富国强兵。"
        "**结果**：材料未提供完整对比结论。"
    )
    responses = [
        *_comparison_tool_and_final(toolkit),
        _analysis_response(analysis),
    ]
    result, fake = _run(store, responses)

    assert result.answer.mode == "grounded"
    assert result.downgraded is False
    # 1 轮工具批次 + 1 次 final + 1 次二次归纳 = 3 次模型调用。
    assert len(fake.calls) == 3
    assert result.answer.comparison_analysis is not None
    assert result.answer.comparison_analysis.text == analysis
    # 事实实证正文不变，且不包含分析文本（两层严格分离）。
    assert "**[时间轴·大事记]**" in result.answer.markdown
    assert "[人物关系图]" not in result.answer.markdown
    assert analysis not in result.answer.markdown

    # 二次归纳调用参数：JSON 模式、关闭思考、temperature=0、专用 token 上限。
    analysis_call = fake.calls[2]
    assert analysis_call["response_format"] == {"type": "json_object"}
    assert analysis_call["enable_thinking"] is False
    assert analysis_call["temperature"] == 0.0
    assert analysis_call["max_tokens"] == COMPARISON_MAX_TOKENS
    assert analysis_call["messages"][0]["content"] == COMPARISON_SYNTHESIS_SYSTEM_PROMPT
    # 事实块是纯数据（来自工具真实返回），包含双方事件与年份。
    assert "商鞅变法" in analysis_call["messages"][1]["content"]
    assert "熙宁变法" in analysis_call["messages"][1]["content"]
    assert "前359年" in analysis_call["messages"][1]["content"]


@pytest.mark.parametrize("question", [COMPARISON_QUESTION, SUMMARY_QUESTION])
def test_summary_question_also_triggers_analysis(
    store: Any, toolkit: Any, question: str
) -> None:
    responses = [
        *_comparison_tool_and_final(toolkit),
        _analysis_response("**背景**：商鞅变法在前359年，王安石变法在1069年。"),
    ]
    result, _fake = _run(store, responses, question=question)
    assert result.answer.mode == "grounded"
    assert result.answer.comparison_analysis is not None


def test_unverified_year_drops_analysis_keeps_facts(store: Any, toolkit: Any) -> None:
    """验收 2：分析含未证实年份 → 分析被丢弃，事实实证保留（仍 grounded）。"""

    responses = [
        *_comparison_tool_and_final(toolkit),
        _analysis_response("商鞅变法开始于前359年，但秦始皇在公元前221年也推行过变法。"),
    ]
    result, fake = _run(store, responses)

    assert len(fake.calls) == 3  # 确实调用了二次归纳
    assert result.answer.mode == "grounded"
    assert result.downgraded is False
    assert result.answer.comparison_analysis is None
    assert result.answer.markdown  # 事实实证仍完整保留
    assert "商鞅变法" in result.answer.markdown
    assert result.citations  # 引用不受影响


def test_person_outside_fact_block_drops_analysis(store: Any, toolkit: Any) -> None:
    """验收 3：分析含事实块外人物 → 分析被丢弃，事实实证保留。"""

    responses = [
        *_comparison_tool_and_final(toolkit),
        _analysis_response("商鞅变法与王安石变法都重视制度，秦始皇也推行过类似改革。"),
    ]
    result, _fake = _run(store, responses)

    assert result.answer.mode == "grounded"
    assert result.answer.comparison_analysis is None
    assert "商鞅变法" in result.answer.markdown


def test_non_comparison_question_does_not_call_model_again(store: Any) -> None:
    """验收 4：非对比类问题不触发二次归纳（普通事实问答不得多调模型）。"""

    chibi_citation = "cite-handong-chibi-0"
    fake = FakeLLM(
        [
            tool_call_step("get_event", {"event_id": CHIBI_EVENT}),
            final_step(grounded_answer(citation_ids=[chibi_citation], entity_id=CHIBI_EVENT)),
        ]
    )
    result = AgentOrchestrator(store, fake).run(
        ask_request("赤壁之战发生在哪一年？", route="/timeline")
    )

    assert result.answer.mode == "grounded"
    assert result.answer.comparison_analysis is None
    assert len(fake.calls) == 2


def test_analysis_llm_failure_degrades_to_facts_only(store: Any, toolkit: Any) -> None:
    """验收 5：二次归纳模型调用失败 → 只保留事实实证，不抛异常、不降级。"""

    responses = [
        *_comparison_tool_and_final(toolkit),
        LLMTimeoutError("二次归纳调用超时"),
    ]
    result, fake = _run(store, responses)

    assert len(fake.calls) == 3
    assert result.answer.mode == "grounded"
    assert result.downgraded is False
    assert result.answer.comparison_analysis is None
    assert result.answer.markdown
    assert result.citations


def test_analysis_invalid_json_degrades_to_facts_only(store: Any, toolkit: Any) -> None:
    responses = [
        *_comparison_tool_and_final(toolkit),
        "这是一段完全不符合 JSON 协议的文本",
    ]
    result, _fake = _run(store, responses)

    assert result.answer.mode == "grounded"
    assert result.answer.comparison_analysis is None
    assert result.answer.markdown


def test_insufficient_comparison_question_does_not_trigger_analysis(store: Any) -> None:
    fake = FakeLLM(
        [
            tool_call_step("get_event", {"event_id": CHIBI_EVENT}),
            final_step(insufficient_answer(["INSUFFICIENT_DATA"])),
        ]
    )
    result = AgentOrchestrator(store, fake).run(
        ask_request(COMPARISON_QUESTION, route="/ask")
    )

    assert result.answer.mode == "insufficient"
    assert result.answer.comparison_analysis is None
    assert len(fake.calls) == 2  # insufficient 不浪费第二次模型调用


def test_finalize_round_also_attaches_comparison_analysis(store: Any, toolkit: Any) -> None:
    """收尾轮 grounded 后同样可以触发二次归纳（两处返回点行为一致）。"""

    shang_citation = _event_citation_id(toolkit, SHANG_YANG_EVENT)
    wang_citation = _event_citation_id(toolkit, WANG_EVENT)
    fake = FakeLLM(
        [
            tool_batch_step(
                [
                    {"tool": "get_event", "arguments": {"event_id": SHANG_YANG_EVENT}},
                    {"tool": "get_event", "arguments": {"event_id": WANG_EVENT}},
                ]
            ),
            # 用完轮次预算后，收尾轮才给出 final。
            final_step(
                {
                    "mode": "grounded",
                    "claims": [
                        {"id": "c1", "citation_ids": [shang_citation]},
                        {"id": "c2", "citation_ids": [wang_citation]},
                    ],
                    "evidence": [
                        {"entity_type": "event", "entity_id": SHANG_YANG_EVENT},
                        {"entity_type": "event", "entity_id": WANG_EVENT},
                    ],
                }
            ),
            _analysis_response("**背景**：商鞅变法在前359年，王安石变法在1069年。"),
        ]
    )
    result = AgentOrchestrator(store, fake, max_steps=1).run(
        ask_request(COMPARISON_QUESTION, route="/ask")
    )

    assert result.answer.mode == "grounded"
    assert result.answer.comparison_analysis is not None
    assert len(fake.calls) == 3


# ---------------------------------------------------------------------------
# 契约 / 数据结构向后兼容
# ---------------------------------------------------------------------------


def test_contract_comparison_analysis_is_optional_and_grounded_only() -> None:
    base = {
        "markdown": "根据本轮工具返回的可核验资料：……",
        "mode": "grounded",
        "claims": [{"id": "c1", "text": "事实", "citation_ids": ["cite-x-0"]}],
    }
    legacy = ContractAnswer.model_validate(base)
    assert legacy.comparison_analysis is None

    with_analysis = ContractAnswer.model_validate(
        {**base, "comparison_analysis": {"text": "对比分析"}}
    )
    assert with_analysis.comparison_analysis is not None
    assert with_analysis.comparison_analysis.text == "对比分析"

    with pytest.raises(ValidationError):
        ContractAnswer.model_validate(
            {
                "markdown": "资料不足",
                "mode": "insufficient",
                "missing": ["缺少资料"],
                "comparison_analysis": {"text": "对比分析"},
            }
        )


def test_agent_final_answer_comparison_analysis_field() -> None:
    with pytest.raises(ValidationError):
        FinalAnswer(
            mode="insufficient",
            markdown="资料不足",
            missing=["缺少资料"],
            comparison_analysis={"text": "对比分析"},
        )


# ---------------------------------------------------------------------------
# V1.0.5.4 修复一：对比意图全面覆盖（隐式问法不能再漏判）
# ---------------------------------------------------------------------------

IMPLICIT_COMPARISON_QUESTIONS = (
    "刘邦统一汉朝和秦始皇统一六国的历史意义和影响一样吗",
    "秦始皇和刘邦有什么不同",
    "秦始皇和刘邦谁的影响更大",
    "商鞅变法与王安石变法相比如何",
    "两场变法有哪些差异",
    "唐太宗和汉武帝的差别在哪里",
    "这两件事一样吗",
)
NON_COMPARISON_QUESTIONS = (
    "赤壁之战发生在哪一年",
    "王安石是谁",
    "武则天是哪个朝代的人物",
    "安史之乱的经过与影响",
)


@pytest.mark.parametrize("question", IMPLICIT_COMPARISON_QUESTIONS)
def test_detect_comparison_intent_covers_implicit_questions(question: str) -> None:
    assert detect_comparison_intent(question) is True
    # 问题类型判定与二次归纳触发共用同一套线索：隐式对比也应判定为 comparison。
    assert detect_question_focus(question) == "comparison"


@pytest.mark.parametrize("question", NON_COMPARISON_QUESTIONS)
def test_detect_comparison_intent_keeps_normal_questions_untouched(question: str) -> None:
    assert detect_comparison_intent(question) is False


# ---------------------------------------------------------------------------
# V1.0.5.4 修复二：A/B 图谱实体识别 + 对比兜底（不得提前判 insufficient）
# ---------------------------------------------------------------------------

LIU_BANG_PERSON = "p-liubang-f5be"
QIN_SHI_HUANG_PERSON = "p-qinshihuang-f6c7"
QIN_UNIFY_EVENT = "qin-unify"
HAN_FOUNDED_EVENT = "han-founded"
LIU_BANG_QUESTION = "刘邦统一汉朝和秦始皇统一六国的历史意义和影响一样吗"


def _dual_person_event_observed(toolkit: Any) -> ObservedEvidence:
    results = [
        toolkit.call("get_person", person_id=LIU_BANG_PERSON),
        toolkit.call("get_person", person_id=QIN_SHI_HUANG_PERSON),
        toolkit.call("get_event", event_id=QIN_UNIFY_EVENT),
        toolkit.call("get_event", event_id=HAN_FOUNDED_EVENT),
    ]
    return ObservedEvidence.from_results(results)


def _liubang_rescue_responses(toolkit: Any, analysis: str | None) -> list[Any]:
    """工具批次（双方人物 + 双方事件）→ 直接 insufficient → 二次归纳。"""

    responses: list[Any] = [
        tool_batch_step(
            [
                {"tool": "get_person", "arguments": {"person_id": LIU_BANG_PERSON}},
                {"tool": "get_person", "arguments": {"person_id": QIN_SHI_HUANG_PERSON}},
                {"tool": "get_event", "arguments": {"event_id": QIN_UNIFY_EVENT}},
                {"tool": "get_event", "arguments": {"event_id": HAN_FOUNDED_EVENT}},
            ]
        ),
        final_step(insufficient_answer(["INSUFFICIENT_DATA"])),
    ]
    if analysis is not None:
        responses.append(_analysis_response(analysis))
    return responses


def test_find_comparison_subjects_matches_question_persons(toolkit: Any, store: Any) -> None:
    observed = _dual_person_event_observed(toolkit)
    subjects = find_comparison_subjects(LIU_BANG_QUESTION, observed, store)

    assert subjects is not None
    assert {subject.entity_id for subject in subjects.entities} >= {
        LIU_BANG_PERSON,
        QIN_SHI_HUANG_PERSON,
    }
    assert "刘邦" in subjects.matched_names
    assert "秦始皇" in subjects.matched_names

    entities = collect_rescue_entities(observed, subjects, store)
    kinds = {entity.kind for entity in entities}
    assert {"person", "event"} <= kinds


def test_find_comparison_subjects_returns_none_when_only_one_side(toolkit: Any, store: Any) -> None:
    observed = ObservedEvidence.from_results(
        [toolkit.call("get_person", person_id=LIU_BANG_PERSON)]
    )
    assert find_comparison_subjects(LIU_BANG_QUESTION, observed, store) is None


def test_comparison_rescue_returns_grounded_with_analysis_when_model_says_insufficient(
    store: Any, toolkit: Any
) -> None:
    """验收 1：模型直接 insufficient，但图谱已有 A/B 实体 → 兜底 grounded + 对比分析。"""

    analysis = (
        "**背景**：秦始皇统一六国发生于前221年，刘邦建立汉朝发生于前202年。"
        "**历史意义**：前者建立中央集权王朝，后者恢复因战乱凋敝的社会经济。"
        "**影响**：两者对后世制度与民生影响并不相同；材料未提供完整评价对比。"
    )
    fake = FakeLLM(_liubang_rescue_responses(toolkit, analysis))
    result = AgentOrchestrator(store, fake).run(ask_request(LIU_BANG_QUESTION, route="/ask"))

    assert result.answer.mode == "grounded"
    assert result.downgraded is False
    assert result.answer.comparison_analysis is not None
    assert result.answer.comparison_analysis.text == analysis
    # 兜底正文由服务端真实事实重写：同时含双方事件与时间轴节。
    assert "刘邦建立汉朝" in result.answer.markdown
    assert "秦始皇统一六国" in result.answer.markdown
    assert result.citations
    # 1 轮工具批次 + 1 次 final(insufficient) + 1 次二次归纳 = 3 次模型调用。
    assert len(fake.calls) == 3
    # 二次归纳确实拿到了本轮事实块（不是空调用）。
    assert "前221年" in fake.calls[2]["messages"][1]["content"]


def test_comparison_rescue_keeps_grounded_facts_when_analysis_invalid(
    store: Any, toolkit: Any
) -> None:
    """兜底后二次归纳输出非法 / 未通过校验 → 仍 grounded（事实实证保留），不回退 insufficient。"""

    responses = _liubang_rescue_responses(toolkit, None)
    responses.append("这不是 JSON")
    fake = FakeLLM(responses)
    result = AgentOrchestrator(store, fake).run(ask_request(LIU_BANG_QUESTION, route="/ask"))

    assert result.answer.mode == "grounded"
    assert result.answer.comparison_analysis is None
    assert result.answer.markdown


def test_comparison_rescue_skipped_without_ab_entities(store: Any) -> None:
    """A/B 图谱实体都没查到 → 保持 insufficient（允许资料不足的唯一条件）。"""

    fake = FakeLLM(
        [
            tool_batch_step(
                [
                    {"tool": "get_event", "arguments": {"event_id": QIN_UNIFY_EVENT}},
                    {"tool": "get_event", "arguments": {"event_id": HAN_FOUNDED_EVENT}},
                ]
            ),
            final_step(insufficient_answer(["INSUFFICIENT_DATA"])),
        ]
    )
    result = AgentOrchestrator(store, fake).run(
        ask_request("赤壁之战与官渡之战的差异", route="/ask")
    )

    assert result.answer.mode == "insufficient"
    assert result.answer.comparison_analysis is None


def test_comparison_rescue_takes_over_after_evidence_downgrade(
    store: Any, toolkit: Any
) -> None:
    """模型提交了 grounded 但证据校验降级（citation 不存在）→ 对比兜底仍接管为 grounded。"""

    analysis = "**背景**：秦始皇统一六国于前221年，刘邦建立汉朝于前202年。**影响**：两者并不相同。"
    responses = _liubang_rescue_responses(toolkit, None)
    # 把第二次响应替换成「会被证据校验降级」的 grounded final（citation 不在工具结果中）。
    responses[1] = final_step(grounded_answer(citation_ids=["cite-does-not-exist"]))
    responses.append(_analysis_response(analysis))
    fake = FakeLLM(responses)
    result = AgentOrchestrator(store, fake).run(ask_request(LIU_BANG_QUESTION, route="/ask"))

    assert result.answer.mode == "grounded"
    assert result.downgraded is False
    assert result.answer.comparison_analysis is not None
    assert result.answer.comparison_analysis.text == analysis
    assert len(fake.calls) == 3


# ---------------------------------------------------------------------------
# V1.0.5.4 修复四：证据链校验兜底（年份模糊匹配 / 图谱人物放行）
# ---------------------------------------------------------------------------


def test_year_validation_allows_bc_prefix_fuzzy_match() -> None:
    """事实块只有裸年份 `221年` 时，分析写「公元前221年」不能被误杀。"""

    facts = ComparisonFacts(
        block="秦始皇统一六国（前221年）",
        years=frozenset({221}),
        person_names=frozenset({"秦始皇"}),
    )
    checked, reason = validate_comparison_analysis(
        "秦始皇统一六国发生于公元前221年。", facts, {"秦始皇"}
    )
    assert reason is None and checked is not None
    # 真正不同的年份仍然必须被拒绝。
    rejected, reason2 = validate_comparison_analysis(
        "这件事发生在公元前202年。", facts, {"秦始皇"}
    )
    assert rejected is None and reason2 is not None


def test_person_validation_allows_observed_graph_person() -> None:
    """人物只出现在本轮图谱实体、不在事实块白名单时，按修复四放行。"""

    facts = ComparisonFacts(
        block="事件：商鞅变法（前359年）",
        years=frozenset({-359}),
        person_names=frozenset({"商鞅"}),
    )
    text = "秦始皇与刘邦的统一事业和商鞅变法不属于同一类型。"
    rejected, reason = validate_comparison_analysis(
        text, facts, {"商鞅", "秦始皇", "刘邦"}
    )
    assert rejected is None and reason is not None  # 不放行时确实会被拦截

    checked, reason2 = validate_comparison_analysis(
        text, facts, {"商鞅", "秦始皇", "刘邦"}, {"秦始皇", "刘邦"}
    )
    assert reason2 is None and checked is not None


def test_observed_graph_person_names_reads_graph_entities(toolkit: Any, store: Any) -> None:
    observed = _dual_person_event_observed(toolkit)
    names = observed_graph_person_names(observed, store)
    assert {"刘邦", "秦始皇"} <= names


# ---------------------------------------------------------------------------
# V1.0.5.4 修复三：冷启动 / 消息长度（异常报错兜底）
# ---------------------------------------------------------------------------


def test_tool_result_message_never_exceeds_llm_message_limit() -> None:
    """工具结果消息必须 < 20000 字（旧版 2×12000 会撑爆 LLMClient 单条消息上限）。"""

    big = {"ok": True, "tool": "get_person", "data": {"display_name": "x"}, "items": [],
           "citations": [], "meta": {}, "truncated": False, "snapshot_version": None}
    big["data"] = {"display_name": "长" * 30000}
    message = build_tool_result_message(
        [("get_person", {"person_id": "p-a"}, big), ("get_person", {"person_id": "p-b"}, big)]
    )
    assert len(message) <= MAX_TOOL_MESSAGE_CHARS
    assert len(message) < 20000


def test_shrink_messages_caps_single_message_length() -> None:
    system_prompt = "s" * (MAX_PROMPT_MESSAGE_CHARS + 500)
    messages = [
        {"role": "system", "content": system_prompt},
        {"role": "user", "content": "t" * (MAX_PROMPT_MESSAGE_CHARS + 500)},
        {"role": "user", "content": "short"},
    ]
    shrunk = _shrink_messages(messages)
    # 服务端生成的 System Prompt 不裁剪（避免截断规则）；工具结果 / 历史消息裁剪到安全上限。
    assert shrunk[0]["content"] == system_prompt
    assert len(shrunk[1]["content"]) < MAX_PROMPT_MESSAGE_CHARS + 200
    assert shrunk[2]["content"] == "short"


def test_empty_history_cold_start_runs_without_error(store: Any) -> None:
    """无历史上下文的冷启动请求：orchestrator 只带 system + 当前问题，不因 history 缺失报错。"""

    fake = FakeLLM([final_step(insufficient_answer(["NO_MATCHING_ENTITY"]))])
    result = AgentOrchestrator(store, fake).run(ask_request("商鞅变法", history=[]))

    assert result.answer.mode in {"insufficient", "grounded"}
    first_messages = fake.calls[0]["messages"]
    assert first_messages[0]["role"] == "system"
    assert first_messages[-1]["role"] == "user"
    assert "商鞅变法" in first_messages[-1]["content"]