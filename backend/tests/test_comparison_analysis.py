"""对比问题事实块 / 图谱兜底单测（V1.0.5.4 起源；**V1.0.6.1 起二次归纳层已废除**）。

V1.0.6.1 变更说明：
- 旧的 `COMPARISON_SYNTHESIS_SYSTEM_PROMPT` / `build_comparison_synthesis_messages` 已删除，
  「💡 史令分析」并入模型 `markdown` 的「史令分析」节（见 `test_agent_markdown.py`）；
- `agent.comparison` 中**事实块构建 / 年份人物白名单 / A-B 主体识别 / 兜底实体收集**等纯函数
  仍然保留，并被 `agent.factcheck`（文本级事实核查）复用，本文件继续覆盖它们；
- 对比问题的「图谱兜底」仍保留：模型判 insufficient 但 A/B 实体已在手时，由服务端用真实事实
  合成 grounded 事实实证正文（`fact_check.status = server_fallback`，不再附带二次归纳）。

全部离线：FakeLLM 按脚本返回，工具层读真实快照。
"""

from __future__ import annotations

from typing import Any

import pytest
from agent_testkit import (
    FakeLLM,
    ask_request,
    final_step,
    grounded_answer,
    insufficient_answer,
    tool_batch_step,
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
    validate_comparison_analysis,
)
from agent.orchestrator import (
    MAX_PROMPT_MESSAGE_CHARS,
    AgentOrchestrator,
    _shrink_messages,
)
from agent.prompts import MAX_TOOL_MESSAGE_CHARS, build_tool_result_message
from agent.schemas import FinalAnswer
from agent.validator import (
    ObservedEvidence,
    detect_comparison_intent,
    detect_question_focus,
)
from contracts.models import Answer as ContractAnswer

SHANG_YANG_EVENT = "zhanguo-05"
WANG_EVENT = "beisong-10"
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
    # 普通事实问答不触发对比 / 兜底逻辑。
    assert detect_comparison_intent("赤壁之战发生在哪一年") is False
    assert detect_comparison_intent("王安石是谁") is False
    assert detect_comparison_intent("") is False


def test_build_comparison_facts_from_real_tool_results(
    toolkit: Any, store: Any
) -> None:
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
# 年份 / 人物白名单工具（被 factcheck 复用）
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

    facts = ComparisonFacts(
        block="开启改革", years=frozenset(), person_names=frozenset()
    )
    checked, reason = validate_comparison_analysis(
        "这场改革开启了新局面。", facts, {"启"}
    )
    assert reason is None and checked is not None


def test_validate_analysis_allows_name_covered_by_longer_whitelist_name() -> None:
    facts = ComparisonFacts(
        block="李广利出征", years=frozenset(), person_names=frozenset({"李广利"})
    )
    checked, reason = validate_comparison_analysis(
        "李广利率军出征。", facts, {"李广", "李广利"}
    )
    assert reason is None and checked is not None


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
    # 问题类型判定与兜底触发共用同一套线索：隐式对比也应判定为 comparison。
    assert detect_question_focus(question) == "comparison"


@pytest.mark.parametrize("question", NON_COMPARISON_QUESTIONS)
def test_detect_comparison_intent_keeps_normal_questions_untouched(
    question: str,
) -> None:
    assert detect_comparison_intent(question) is False


# ---------------------------------------------------------------------------
# V1.0.5.4 修复二 / V1.0.6.1：A/B 图谱实体识别 + 对比兜底（不得提前判 insufficient）
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


def _liubang_rescue_responses(toolkit: Any) -> list[Any]:
    """工具批次（双方人物 + 双方事件）→ 直接 insufficient（触发服务端图谱兜底）。"""

    return [
        tool_batch_step(
            [
                {"tool": "get_person", "arguments": {"person_id": LIU_BANG_PERSON}},
                {
                    "tool": "get_person",
                    "arguments": {"person_id": QIN_SHI_HUANG_PERSON},
                },
                {"tool": "get_event", "arguments": {"event_id": QIN_UNIFY_EVENT}},
                {"tool": "get_event", "arguments": {"event_id": HAN_FOUNDED_EVENT}},
            ]
        ),
        final_step(insufficient_answer(["INSUFFICIENT_DATA"])),
    ]


def test_find_comparison_subjects_matches_question_persons(
    toolkit: Any, store: Any
) -> None:
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


def test_find_comparison_subjects_returns_none_when_only_one_side(
    toolkit: Any, store: Any
) -> None:
    observed = ObservedEvidence.from_results(
        [toolkit.call("get_person", person_id=LIU_BANG_PERSON)]
    )
    assert find_comparison_subjects(LIU_BANG_QUESTION, observed, store) is None


def test_comparison_rescue_returns_grounded_when_model_says_insufficient(
    store: Any, toolkit: Any
) -> None:
    """模型直接 insufficient，但图谱已有 A/B 实体 → 兜底 grounded（服务端事实实证正文）。"""

    fake = FakeLLM(_liubang_rescue_responses(toolkit))
    result = AgentOrchestrator(store, fake).run(
        ask_request(LIU_BANG_QUESTION, route="/ask")
    )

    assert result.answer.mode == "grounded"
    assert result.downgraded is False
    # V1.0.6.1：二次归纳层已废除，兜底正文是服务端事实实证。
    assert result.answer.comparison_analysis is None
    assert result.fact_check is not None
    assert result.fact_check["status"] == "server_fallback"
    assert "刘邦建立汉朝" in result.answer.markdown
    assert "秦始皇统一六国" in result.answer.markdown
    assert result.citations
    # 1 轮工具批次 + 1 次 final(insufficient) = 2 次模型调用（不再有第二次归纳调用）。
    assert len(fake.calls) == 2


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

    responses = _liubang_rescue_responses(toolkit)
    # 把第二次响应替换成「会被证据校验降级」的 grounded final（citation 不在工具结果中）。
    responses[1] = final_step(grounded_answer(citation_ids=["cite-does-not-exist"]))
    fake = FakeLLM(responses)
    result = AgentOrchestrator(store, fake).run(
        ask_request(LIU_BANG_QUESTION, route="/ask")
    )

    assert result.answer.mode == "grounded"
    assert result.downgraded is False
    assert result.answer.comparison_analysis is None
    assert result.fact_check is not None
    assert result.fact_check["status"] == "server_fallback"
    assert len(fake.calls) == 2


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


def test_observed_graph_person_names_reads_graph_entities(
    toolkit: Any, store: Any
) -> None:
    observed = _dual_person_event_observed(toolkit)
    names = observed_graph_person_names(observed, store)
    assert {"刘邦", "秦始皇"} <= names


# ---------------------------------------------------------------------------
# 契约兼容：comparison_analysis 仍为可选字段（V1.0.6.1 起恒为 None）
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
        {**base, "comparison_analysis": {"text": "历史对比分析"}}
    )
    assert with_analysis.comparison_analysis is not None
    assert with_analysis.comparison_analysis.text == "历史对比分析"

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
# V1.0.5.4 修复三：冷启动 / 消息长度（异常报错兜底）
# ---------------------------------------------------------------------------


def test_tool_result_message_never_exceeds_llm_message_limit() -> None:
    """工具结果消息必须 < 20000 字（旧版 2×12000 会撑爆 LLMClient 单条消息上限）。"""

    big = {
        "ok": True,
        "tool": "get_person",
        "data": {"display_name": "x"},
        "items": [],
        "citations": [],
        "meta": {},
        "truncated": False,
        "snapshot_version": None,
    }
    big["data"] = {"display_name": "长" * 30000}
    message = build_tool_result_message(
        [
            ("get_person", {"person_id": "p-a"}, big),
            ("get_person", {"person_id": "p-b"}, big),
        ]
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
