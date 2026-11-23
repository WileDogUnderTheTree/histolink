"""Orchestrator 核心循环测试（V1.0.3）：多轮工具、轮次上限、证据降级、协议修复。

全部离线：FakeLLM 按脚本返回 JSON，工具层读真实快照。
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

from agent.orchestrator import (
    AgentOrchestrator,
    AgentProtocolError,
    parse_model_step,
)
from agent.schemas import AgentResult

CHIBI_CITATION = "cite-handong-chibi-0"


def _run(store: Any, responses: list[Any], **kwargs: Any) -> tuple[AgentResult, FakeLLM]:
    fake = FakeLLM(responses)
    result = AgentOrchestrator(store, fake, **kwargs).run(ask_request())
    return result, fake


def test_tool_then_grounded_answer(store: Any) -> None:
    result, fake = _run(
        store,
        [
            tool_call_step("get_event", {"event_id": "handong-chibi"}),
            final_step(grounded_answer(citation_ids=[CHIBI_CITATION])),
        ],
    )

    assert result.answer.mode == "grounded"
    assert result.downgraded is False
    assert result.steps == 2
    assert [record.name for record in result.tools] == ["get_event"]
    assert result.tools[0].ok is True and result.tools[0].hits == 1
    assert [citation.id for citation in result.citations] == [CHIBI_CITATION]
    assert result.model == "fake-qwen"
    assert result.usage and result.usage["total_tokens"] == 30

    # 模型调用参数：关闭思考 + JSON 模式 + temperature=0。
    assert fake.calls[0]["enable_thinking"] is False
    assert fake.calls[0]["response_format"] == {"type": "json_object"}
    assert fake.calls[0]["temperature"] == 0.0
    # 工具结果确实回传给了模型（第二轮 messages 里包含 result，且明确标注为“仅数据”）。
    second_round_messages = fake.calls[1]["messages"]
    assert any("【工具结果" in message["content"] for message in second_round_messages)
    assert any("仅数据" in message["content"] for message in second_round_messages)
    assert any(CHIBI_CITATION in message["content"] for message in second_round_messages)


def test_max_steps_stops_tool_loop(store: Any) -> None:
    result, fake = _run(
        store,
        [
            tool_call_step("get_event", {"event_id": "xixia-09"}),
            tool_call_step("get_event", {"event_id": "xixia-09"}),
            tool_call_step("get_event", {"event_id": "xixia-09"}),
        ],
        max_steps=3,
    )

    assert len(fake.calls) == 3
    assert len(result.tools) == 3
    assert result.steps == 3
    assert result.answer.mode == "insufficient"
    assert result.downgraded is True
    assert any("轮次" in item for item in result.answer.missing)


def test_invalid_evidence_forces_insufficient(store: Any) -> None:
    result, _ = _run(
        store,
        [final_step(grounded_answer(citation_ids=["cite-fabricated-0"], entity_id="tang-04"))],
    )

    assert result.answer.mode == "insufficient"
    assert result.downgraded is True
    assert result.citations == []
    assert result.answer.claims == []
    assert any("tang-04" in item for item in result.answer.missing)


def test_invalid_citation_forces_insufficient(store: Any) -> None:
    result, _ = _run(
        store,
        [
            tool_call_step("get_event", {"event_id": "handong-chibi"}),
            final_step(grounded_answer(citation_ids=["cite-fabricated-0"])),
        ],
    )

    assert result.answer.mode == "insufficient"
    assert result.downgraded is True
    assert result.citations == []
    assert any("cite-fabricated-0" in item for item in result.answer.missing)
    # 工具照常执行并记录，便于观测。
    assert len(result.tools) == 1


def test_invalid_json_then_recovers_on_next_round(store: Any) -> None:
    result, fake = _run(
        store,
        ["这不是 JSON", final_step(insufficient_answer())],
    )

    assert result.answer.mode == "insufficient"
    assert result.downgraded is False
    assert result.steps == 2
    repair_message = fake.calls[1]["messages"][-1]
    assert repair_message["role"] == "user"
    assert "不是合法 JSON" in repair_message["content"]


def test_invalid_json_every_round_falls_back(store: Any) -> None:
    result, fake = _run(store, ["bad-json", "still-not-json"], max_steps=2)

    assert len(fake.calls) == 2
    assert result.answer.mode == "insufficient"
    assert result.downgraded is True
    assert any("JSON" in item for item in result.answer.missing)


def test_invalid_tool_arguments_are_fed_back(store: Any) -> None:
    result, fake = _run(
        store,
        [
            tool_call_step("get_event", {"event_id": "Bad Event ID"}),
            final_step(insufficient_answer(["NO_MATCHING_ENTITY"])),
        ],
    )

    assert result.tools[0].ok is False
    assert result.tools[0].error_code == "INVALID_REQUEST"
    assert result.steps == 2
    assert result.answer.mode == "insufficient"
    # 第二轮 prompt 里回传了工具失败信封。
    assert any("INVALID_REQUEST" in message["content"] for message in fake.calls[1]["messages"])


def test_refusal_mode_passes_through(store: Any) -> None:
    result, _ = _run(store, [final_step(refusal_answer("OUT_OF_SCOPE"))])

    assert result.answer.mode == "refusal"
    assert result.answer.reason_code == "OUT_OF_SCOPE"
    assert result.downgraded is False
    assert result.citations == []


def test_ui_actions_are_filtered(store: Any) -> None:
    valid_action = {
        "id": "act-ok",
        "type": "timeline.focus_event",
        "payload": {"event_id": "handong-chibi"},
        "target": {"surface": "timeline", "params": {"event_id": "handong-chibi"}},
        "auto": True,
        "reason": None,
    }
    bad_action = {
        "id": "act-bad",
        "type": "timeline.focus_event",
        "payload": {"event_id": "tang-04"},
        "target": {"surface": "timeline", "params": {"event_id": "tang-04"}},
        "auto": True,
        "reason": None,
    }
    result, _ = _run(
        store,
        [
            tool_call_step("get_event", {"event_id": "handong-chibi"}),
            final_step(
                grounded_answer(
                    citation_ids=[CHIBI_CITATION],
                    ui_actions=[valid_action, bad_action],
                )
            ),
        ],
    )

    assert result.answer.mode == "grounded"
    assert [action.id for action in result.answer.ui_actions] == ["act-ok"]


def test_system_prompt_and_context(store: Any) -> None:
    fake = FakeLLM([final_step(insufficient_answer())])
    request = ask_request(
        question="梁太后是谁？",
        route="/graph",
        history=[
            {"role": "user", "content": "先问一句"},
            {"role": "assistant", "content": "上一轮回答"},
        ],
    )
    AgentOrchestrator(store, fake).run(request)
    messages = fake.calls[0]["messages"]

    assert messages[0]["role"] == "system"
    system_prompt = messages[0]["content"]
    for tool_name in ("resolve_entity", "search_events", "get_relation", "timeline_span"):
        assert tool_name in system_prompt
    assert "禁止幻觉" in system_prompt
    assert "grounded" in system_prompt and "insufficient" in system_prompt and "refusal" in system_prompt

    # 历史对话按顺序保留，最后一条是当前问题 + 页面上下文。
    assert messages[1]["content"] == "先问一句"
    assert messages[2]["content"] == "上一轮回答"
    assert "梁太后是谁？" in messages[-1]["content"]
    assert "/graph" in messages[-1]["content"]


def test_selected_person_is_injected(store: Any) -> None:
    fake = FakeLLM([final_step(insufficient_answer())])
    request = ask_request(
        question="他是谁？",
        selected_person_id="p-liangtaihou-xixia-0d0f",
    )
    AgentOrchestrator(store, fake).run(request)

    assert "p-liangtaihou-xixia-0d0f" in fake.calls[0]["messages"][-1]["content"]


# ---------------------------------------------------------------------------
# P1-1：最大轮次是硬上限 4
# ---------------------------------------------------------------------------


def test_max_steps_hard_limit_is_four(store: Any) -> None:
    fake = FakeLLM([final_step(insufficient_answer())])
    for allowed in (1, 2, 3, 4):
        assert AgentOrchestrator(store, fake, max_steps=allowed).max_steps == allowed

    for rejected in (0, 5, 8):
        with pytest.raises(ValueError, match="max_steps"):
            AgentOrchestrator(store, fake, max_steps=rejected)


# ---------------------------------------------------------------------------
# P1-4：模型响应必须是完整且唯一的 JSON 对象
# ---------------------------------------------------------------------------


def test_parse_model_step_accepts_pure_json_and_fence() -> None:
    pure = '{"action":"tool_call","tool":"get_event","arguments":{"event_id":"xixia-09"}}'
    assert parse_model_step(pure).tool == "get_event"
    fenced = f"```json\n{pure}\n```"
    assert parse_model_step(fenced).tool == "get_event"


@pytest.mark.parametrize(
    "content",
    [
        '说明文字\n{"action":"tool_call","tool":"get_event","arguments":{}}\n结束文字',
        '前缀 {"action":"tool_call","tool":"get_event","arguments":{}}',
        '{"action":"tool_call","tool":"get_event","arguments":{}} 后缀',
        '```json\n{"action":"tool_call","tool":"get_event","arguments":{}}\n```\n多余文字',
    ],
)
def test_parse_model_step_rejects_surrounding_text(content: str) -> None:
    with pytest.raises(AgentProtocolError):
        parse_model_step(content)


def test_text_wrapped_json_triggers_repair_round(store: Any) -> None:
    wrapped = "好的，这是结果：" + (
        '{"action":"final","thought":"结束","answer":{"mode":"insufficient",'
        '"markdown":"内部说明","missing_reasons":["INSUFFICIENT_DATA"]}}'
    )
    result, fake = _run(store, [wrapped, final_step(insufficient_answer())], max_steps=2)

    assert result.steps == 2
    assert result.downgraded is False
    assert any("不是合法 JSON" in message["content"] for message in fake.calls[1]["messages"])


def test_model_supplied_certainty_triggers_repair_round(store: Any) -> None:
    """P0-3：certainty 已从模型协议移除，旧格式会进入修复轮而不是被信任。"""

    legacy = (
        '{"action":"final","thought":"结束","answer":'
        '{"mode":"insufficient","markdown":"曹操是外星人",'
        '"certainty":"high","missing_reasons":["INSUFFICIENT_DATA"]}}'
    )
    result, fake = _run(store, [legacy, final_step(insufficient_answer())], max_steps=2)

    assert result.steps == 2
    assert result.downgraded is False
    assert any("不是合法 JSON" in message["content"] for message in fake.calls[1]["messages"])
    assert "外星人" not in result.answer.markdown
