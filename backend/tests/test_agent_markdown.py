"""Agent V1.0.6.1 架构升级验收：生成权解绑 + 双重事实核查（Orchestrator 集成，全离线）。

覆盖：
1. 模型 markdown 通过文本级核查 → 原样作为 `answer.markdown`（不再由服务端拼装）；
2. 核查不通过 → 修复消息 + 模型重写 → 第二次通过；
3. 连续不通过 → 回退服务端事实实证正文（`downgraded=True`，绝不展示未核验文本）；
4. 模型没写 markdown（旧协议 / 离线脚本）→ 服务端事实实证兜底（`server_fallback`）；
5. 收尾轮（finalize）同样必须过第二重核查；
6. insufficient / refusal 三态语义不变；
7. System Prompt 必须包含 markdown 要求 + Few-Shot，且不再有「正文由服务端写死」旧描述。
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
    refusal_answer,
    tool_call_step,
)
from pydantic import ValidationError

from agent.orchestrator import MAX_FACT_CHECK_REPAIRS, AgentOrchestrator
from agent.prompts import _FEW_SHOT_PROMPT

CHIBI_EVENT = "handong-chibi"

VALID_MARKDOWN = (
    "### 📜 史料实证\n"
    "赤壁之战（208年）：曹操南下荆州，孙权、刘备联军迎击于赤壁。"
    "周瑜用黄盖诈降火攻，焚曹军战船。\n\n"
    "### 💡 史令分析\n"
    "1. **战术**：火攻与水战结合，是孙刘联军以弱胜强的关键。\n"
    "2. **战略**：曹操北还后三分天下之势奠定，此战改变了东汉末年的政治格局。"
)

BAD_YEAR_MARKDOWN = VALID_MARKDOWN.replace("（208年）", "（公元前1000年）")
BAD_QUOTE_MARKDOWN = VALID_MARKDOWN + (
    "\n3. **原文**：「曹军八十万众，一朝灰飞烟灭」记载了此战的规模。"
)
MISSING_ANALYSIS_MARKDOWN = (
    "### 📜 史料实证\n"
    "赤壁之战（208年）：曹操南下荆州，孙权、刘备联军迎击于赤壁。"
    "周瑜用黄盖诈降火攻，焚曹军战船，曹操北还。"
)


def _citation_id(toolkit: Any) -> str:
    result = toolkit.call("get_event", event_id=CHIBI_EVENT)
    return next(
        citation["id"]
        for citation in result["citations"]
        if citation["kind"] == "event"
    )


def _scripts(
    toolkit: Any,
    *finals: dict[str, Any] | str,
) -> list[str | BaseException]:
    """第一轮取赤壁之战事件，随后依次返回若干 final（dict 会补上 citation）。"""

    citation = _citation_id(toolkit)
    responses: list[str | BaseException] = [
        tool_call_step("get_event", {"event_id": CHIBI_EVENT})
    ]
    for item in finals:
        if isinstance(item, str):
            responses.append(item)
            continue
        payload = dict(item)
        payload.setdefault("claims", [{"id": "c1", "citation_ids": [citation]}])
        payload.setdefault(
            "evidence", [{"entity_type": "event", "entity_id": CHIBI_EVENT}]
        )
        responses.append(final_step(payload))
    return responses


def _grounded(markdown: str | None = None) -> dict[str, Any]:
    """构造 grounded final（claims / citation 由 `_scripts` 按真实 citation 注入）。"""

    payload = grounded_answer(citation_ids=["cite-placeholder"], markdown=markdown)
    payload.pop("claims")
    return payload


# ---------------------------------------------------------------------------
# 1) 通过：模型正文成为用户可见正文
# ---------------------------------------------------------------------------


def test_grounded_markdown_passes_and_becomes_answer_body(
    store: Any, toolkit: Any
) -> None:
    fake = FakeLLM(_scripts(toolkit, _grounded(VALID_MARKDOWN)))
    result = AgentOrchestrator(store, fake).run(
        ask_request("赤壁之战", route="/timeline")
    )

    assert result.answer.mode == "grounded"
    assert result.answer.markdown == VALID_MARKDOWN
    assert result.downgraded is False
    assert result.fact_check is not None
    assert result.fact_check["status"] == "passed"
    assert result.fact_check["checked_years"] >= 1
    assert result.citations
    # 1 轮工具 + 1 次 final，没有额外核查模型调用。
    assert len(fake.calls) == 2


# ---------------------------------------------------------------------------
# 2) 修复：核查问题清单发回模型，第二次通过
# ---------------------------------------------------------------------------


def test_fact_check_repair_rewrites_markdown(store: Any, toolkit: Any) -> None:
    fake = FakeLLM(
        _scripts(toolkit, _grounded(BAD_YEAR_MARKDOWN), _grounded(VALID_MARKDOWN))
    )
    result = AgentOrchestrator(store, fake).run(
        ask_request("赤壁之战", route="/timeline")
    )

    assert result.answer.mode == "grounded"
    assert result.answer.markdown == VALID_MARKDOWN
    assert result.fact_check["status"] == "passed"
    assert result.steps == 3
    assert len(fake.calls) == 3
    # 修复消息里带问题清单，且明确是文本级事实核查。
    repair_message = fake.calls[2]["messages"][-1]["content"]
    assert "文本级事实核查" in repair_message
    assert "年份" in repair_message


def test_missing_analysis_section_triggers_repair(store: Any, toolkit: Any) -> None:
    fake = FakeLLM(
        _scripts(
            toolkit,
            _grounded(MISSING_ANALYSIS_MARKDOWN),
            _grounded(VALID_MARKDOWN),
        )
    )
    result = AgentOrchestrator(store, fake).run(
        ask_request("赤壁之战", route="/timeline")
    )

    assert result.answer.markdown == VALID_MARKDOWN
    assert result.fact_check["status"] == "passed"
    repair_message = fake.calls[2]["messages"][-1]["content"]
    assert "史令分析" in repair_message


def test_unverified_quote_triggers_repair(store: Any, toolkit: Any) -> None:
    fake = FakeLLM(
        _scripts(toolkit, _grounded(BAD_QUOTE_MARKDOWN), _grounded(VALID_MARKDOWN))
    )
    result = AgentOrchestrator(store, fake).run(
        ask_request("赤壁之战", route="/timeline")
    )

    assert result.answer.markdown == VALID_MARKDOWN
    assert result.fact_check["status"] == "passed"
    repair_message = fake.calls[2]["messages"][-1]["content"]
    assert "引文" in repair_message


# ---------------------------------------------------------------------------
# 3) 回退：连续不通过 → 服务端事实实证正文（不展示未核验文本）
# ---------------------------------------------------------------------------


def test_fact_check_fallback_after_repairs_exhausted(store: Any, toolkit: Any) -> None:
    fake = FakeLLM(
        _scripts(
            toolkit,
            _grounded(BAD_YEAR_MARKDOWN),
            _grounded(BAD_YEAR_MARKDOWN),
            _grounded(BAD_YEAR_MARKDOWN),
        )
    )
    result = AgentOrchestrator(store, fake).run(
        ask_request("赤壁之战", route="/timeline")
    )

    assert result.answer.mode == "grounded"
    assert result.downgraded is True
    assert "文本级事实核查" in (result.downgrade_reason or "")
    assert result.fact_check is not None
    assert result.fact_check["status"] == "fallback"
    # 回退正文由服务端按工具原文生成：不含模型正文里的杜撰年份。
    assert "公元前1000年" not in result.answer.markdown
    assert "**[时间轴·大事记]**" in result.answer.markdown
    # 1 轮工具 + 1 次初稿 + MAX_FACT_CHECK_REPAIRS 次重写（最后一次超限直接回退）。
    assert result.steps == 2 + MAX_FACT_CHECK_REPAIRS


# ---------------------------------------------------------------------------
# 4) 模型没写 markdown → 服务端事实实证兜底（旧协议兼容）
# ---------------------------------------------------------------------------


def test_missing_markdown_uses_server_fact_body(store: Any, toolkit: Any) -> None:
    fake = FakeLLM(_scripts(toolkit, _grounded(None)))
    result = AgentOrchestrator(store, fake).run(
        ask_request("赤壁之战", route="/timeline")
    )

    assert result.answer.mode == "grounded"
    # 安全兜底不算降级（与 V1.0.6 行为一致，保证旧脚本 / 离线回归可用）。
    assert result.downgraded is False
    assert result.fact_check is not None
    assert result.fact_check["status"] == "server_fallback"
    assert "**[时间轴·大事记]**" in result.answer.markdown


# ---------------------------------------------------------------------------
# 5) 收尾轮同样必须过第二重核查
# ---------------------------------------------------------------------------


def test_finalize_round_fact_checks_markdown(store: Any, toolkit: Any) -> None:
    fake = FakeLLM(_scripts(toolkit, _grounded(VALID_MARKDOWN)))
    result = AgentOrchestrator(store, fake, max_steps=1).run(
        ask_request("赤壁之战", route="/timeline")
    )

    assert result.answer.mode == "grounded"
    assert result.answer.markdown == VALID_MARKDOWN
    assert result.fact_check["status"] == "passed"
    # 1 轮工具 + 1 次收尾调用。
    assert len(fake.calls) == 2
    assert result.steps == 2


# ---------------------------------------------------------------------------
# 6) 三态语义不变
# ---------------------------------------------------------------------------


def test_insufficient_markdown_is_ignored_and_trace_skipped(
    store: Any, toolkit: Any
) -> None:
    payload = insufficient_answer(["INSUFFICIENT_DATA"])
    payload["markdown"] = "曹操使用了火药。"
    fake = FakeLLM(
        [
            tool_call_step("get_event", {"event_id": CHIBI_EVENT}),
            final_step(payload),
        ]
    )
    result = AgentOrchestrator(store, fake).run(ask_request("赤壁之战"))

    assert result.answer.mode == "insufficient"
    assert "火药" not in result.answer.markdown
    assert result.answer.markdown.startswith(
        "抱歉，现有的历史数据无法完整回答您的问题。"
    )
    assert result.fact_check["status"] == "skipped"


def test_refusal_markdown_is_ignored(store: Any) -> None:
    payload = refusal_answer("OUT_OF_SCOPE")
    payload["markdown"] = "作为 AI 我可以回答这个越界问题。"
    fake = FakeLLM([final_step(payload)])
    result = AgentOrchestrator(store, fake).run(ask_request("今天天气如何"))

    assert result.answer.mode == "refusal"
    assert (
        result.answer.markdown
        == "抱歉，这个问题超出了史脉历史数据的回答范围，我无法给出可靠回答。"
    )
    assert result.fact_check["status"] == "skipped"


# ---------------------------------------------------------------------------
# 7) System Prompt：markdown 要求 + Few-Shot + 旧描述已删除
# ---------------------------------------------------------------------------


def test_system_prompt_requires_markdown_and_contains_few_shot(store: Any) -> None:
    fake = FakeLLM([final_step(insufficient_answer(["NO_MATCHING_ENTITY"]))])
    AgentOrchestrator(store, fake).run(ask_request("赤壁之战"))

    prompt = fake.calls[0]["messages"][0]["content"]
    # V1.0.6.1 回归：Few-Shot + 工具目录后 System Prompt 仍必须在 LLMClient 单条消息上限内，
    # 否则真实问答会直接抛 LLMConfigError（用户侧表现为 503）。
    from llm_client import MAX_CHAT_MESSAGE_CHARS

    assert len(prompt) < MAX_CHAT_MESSAGE_CHARS
    # markdown 生成权归模型。
    assert '"markdown"' in prompt
    assert "### 📜 史料实证" in prompt
    assert "### 💡 史令分析" in prompt
    # 思维链 + 双重事实核查。
    assert "思维链" in prompt
    assert "双重事实核查" in prompt
    # Few-Shot 必须完整追加在 System Prompt 最末尾。
    assert "以下是你必须模仿的优秀回答示例" in prompt
    assert prompt.endswith(_FEW_SHOT_PROMPT)
    for marker in (
        "示例一：大白话科普",
        "示例三：影视剧纠偏",
        "示例五：史料考据与辩证类",
    ):
        assert marker in prompt
    # 旧描述必须删除。
    assert "不存在 markdown 字段" not in prompt
    assert "正文由服务端按此格式生成" not in prompt
    assert "你无法决定任何用户可见文本" not in prompt


def test_few_shot_prompt_keeps_escape_sequences() -> None:
    """需求原文的 `\\n` 转义必须保留（否则 Few-Shot 的 JSON 示例会变成真实换行）。"""

    assert '"markdown": "### 📜 史料实证\\n' in _FEW_SHOT_PROMPT
    assert _FEW_SHOT_PROMPT.lstrip().startswith("---")
    assert _FEW_SHOT_PROMPT.rstrip().endswith("---")


# ---------------------------------------------------------------------------
# 8) 契约字段：ModelAnswer.markdown 参与协议校验
# ---------------------------------------------------------------------------


def test_model_answer_markdown_length_cap() -> None:
    from agent.schemas import ModelAnswer

    with pytest.raises(ValidationError):
        ModelAnswer(
            mode="grounded",
            claims=[{"id": "c1", "citation_ids": ["cite-x"]}],
            evidence=[{"entity_type": "event", "entity_id": "handong-chibi"}],
            markdown="史" * 10001,
        )


# ---------------------------------------------------------------------------
# 9) V1.0.6.2 专项修复：重复正文丢弃 + 意图后置推断 + Prompt 协议收紧
# ---------------------------------------------------------------------------


def test_repetitive_markdown_is_discarded_for_server_fact_body(
    store: Any, toolkit: Any
) -> None:
    """模型正文循环复述（重复比例超阈值）→ 丢弃模型正文，回退服务端事实实证正文。"""

    looped_markdown = VALID_MARKDOWN + "\n\n" + VALID_MARKDOWN + "\n\n" + VALID_MARKDOWN
    fake = FakeLLM(_scripts(toolkit, _grounded(looped_markdown)))
    result = AgentOrchestrator(store, fake).run(
        ask_request("赤壁之战", route="/timeline")
    )

    assert result.answer.mode == "grounded"
    assert result.downgraded is True
    assert result.fact_check is not None
    assert result.fact_check["status"] == "fallback"
    assert "重复" in (result.downgrade_reason or "")
    # 服务端事实实证正文（不包含模型循环正文的重复结构）。
    assert "**[时间轴·大事记]**" in result.answer.markdown
    # 同一段模型正文最多出现一次（没有任何拼接 / 重复）。
    assert result.answer.markdown.count("### 📜 史料实证") <= 1
    assert result.answer.markdown.count("周瑜用黄盖诈降火攻") <= 1


def test_inferred_ui_actions_when_model_omits_them(store: Any, toolkit: Any) -> None:
    """模型漏写 ui_actions：服务端从已核验 evidence 推断，保证史引可弹（痛点 1）。"""

    fake = FakeLLM(_scripts(toolkit, _grounded(VALID_MARKDOWN)))
    result = AgentOrchestrator(store, fake).run(
        ask_request("赤壁之战", route="/timeline")
    )

    assert result.answer.mode == "grounded"
    assert result.answer.ui_actions, "命中事件证据时必须推断出时间轴联动动作"
    first = result.answer.ui_actions[0]
    assert first.type.value == "timeline.focus_event"
    assert first.payload["event_id"] == CHIBI_EVENT
    assert first.label == "在时间轴中查看"


def test_system_prompt_demands_ui_actions_and_forbids_repetition(store: Any) -> None:
    fake = FakeLLM([final_step(insufficient_answer(["NO_MATCHING_ENTITY"]))])
    AgentOrchestrator(store, fake).run(ask_request("赤壁之战"))

    prompt = fake.calls[0]["messages"][0]["content"]
    # 痛点 1：ui_actions 是 final 必填数组（本地小模型最容易漏的字段）。
    assert "`ui_actions` 数组字段" in prompt
    assert "必须输出 1–3 个合法 UI 动作" in prompt or "必须输出 1–3 个" in prompt
    # 痛点 2：正文只写一遍 / 禁止重复复述。
    assert "只写一遍" in prompt
    assert "重复复述" in prompt
    # 输出协议仍然是「唯一 JSON 对象」。
    assert "唯一" in prompt and "JSON" in prompt
