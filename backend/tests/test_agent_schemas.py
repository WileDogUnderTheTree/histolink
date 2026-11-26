"""Agent 数据模型测试（V1.0.3；V1.0.6.1 解绑 markdown 生成权）。

V1.0.6.1 协议变化：`ModelAnswer.markdown` 重新成为模型可见字段（grounded 正文），
但要通过服务端双重事实核查才会被采用；`certainty` / 自由 `missing` / `claims[].text` /
UIAction.label 仍不属于模型协议，出现即被 `extra="forbid"` 拒绝。
"""

from __future__ import annotations

import pytest
from pydantic import ValidationError

from agent.schemas import (
    FinalStep,
    ModelAnswer,
    ModelClaim,
    ModelUIAction,
    ToolCall,
    ToolCallStep,
)


def _claim() -> dict:
    return {"id": "c1", "citation_ids": ["cite-handong-chibi-0"]}


def _evidence() -> list[dict]:
    return [{"entity_type": "event", "entity_id": "handong-chibi"}]


def _grounded() -> dict:
    return {
        "mode": "grounded",
        "claims": [_claim()],
        "evidence": _evidence(),
    }


def _model_action(action_id: str = "act-1") -> dict:
    return {
        "id": action_id,
        "type": "timeline.focus_event",
        "payload": {"event_id": "handong-chibi"},
        "target": {"surface": "timeline", "params": {"event_id": "handong-chibi"}},
        "auto": True,
        "reason": None,
    }


def test_grounded_requires_claim() -> None:
    with pytest.raises(ValidationError):
        ModelAnswer(mode="grounded")


def test_grounded_rejects_missing_reasons() -> None:
    with pytest.raises(ValidationError):
        ModelAnswer(**_grounded(), missing_reasons=["INSUFFICIENT_DATA"])


def test_insufficient_requires_missing_reasons() -> None:
    with pytest.raises(ValidationError):
        ModelAnswer(mode="insufficient")


def test_insufficient_rejects_claims() -> None:
    with pytest.raises(ValidationError):
        ModelAnswer(
            mode="insufficient",
            missing_reasons=["INSUFFICIENT_DATA"],
            claims=[_claim()],
        )


def test_insufficient_missing_reasons_must_be_enum() -> None:
    with pytest.raises(ValidationError):
        ModelAnswer(
            mode="insufficient",
            missing_reasons=["模型随便写的缺失原因"],
        )


def test_refusal_requires_reason_code() -> None:
    with pytest.raises(ValidationError):
        ModelAnswer(mode="refusal")


def test_refusal_rejects_claims() -> None:
    with pytest.raises(ValidationError):
        ModelAnswer(
            mode="refusal",
            reason_code="OUT_OF_SCOPE",
            claims=[_claim()],
        )


def test_model_answer_rejects_unknown_fields() -> None:
    with pytest.raises(ValidationError):
        ModelAnswer(
            mode="insufficient",
            missing_reasons=["INSUFFICIENT_DATA"],
            extra_field=1,
        )


def test_model_answer_accepts_markdown_v1061() -> None:
    """V1.0.6.1：grounded 回答的 markdown 重新属于模型协议（核查后采用）。"""

    answer = ModelAnswer(
        **_grounded(),
        markdown="### 📜 史料实证\n赤壁之战发生于 208 年。\n\n### 💡 史令分析\n此战奠定三国鼎立。",
    )
    assert answer.markdown is not None
    assert "史料实证" in answer.markdown


def test_model_answer_markdown_is_optional_for_legacy_flows() -> None:
    """兼容旧协议 / 离线脚本：markdown 缺省时服务端回退事实实证正文（不为 None 保险）。"""

    answer = ModelAnswer(**_grounded())
    assert answer.markdown is None


def test_model_answer_rejects_markdown_too_long() -> None:
    with pytest.raises(ValidationError):
        ModelAnswer(**_grounded(), markdown="史" * 10001)


def test_model_answer_rejects_model_supplied_certainty() -> None:
    """P0-3：certainty 只能由服务端写死，模型不得提供。"""

    with pytest.raises(ValidationError):
        ModelAnswer(**_grounded(), certainty="high")


def test_model_answer_rejects_free_text_missing() -> None:
    """P0-3：missing 自由文本字段已被移除，改为枚举 missing_reasons。"""

    with pytest.raises(ValidationError):
        ModelAnswer(
            mode="insufficient",
            missing_reasons=["INSUFFICIENT_DATA"],
            missing=["模型自由文本"],
        )


def test_model_claim_rejects_text_field() -> None:
    """放行后清理：claims[].text 已删除（服务端生成 claim 文本）。"""

    with pytest.raises(ValidationError):
        ModelClaim(id="c1", citation_ids=["cite-handong-chibi-0"], text="假历史")


def test_model_ui_action_rejects_model_supplied_label() -> None:
    """放行后清理：UIAction.label 由服务端按 action.type 写死。"""

    payload = _model_action()
    payload["label"] = "模型自定义文案"
    with pytest.raises(ValidationError):
        ModelUIAction.model_validate(payload)


def test_model_ui_action_requires_target_and_known_type() -> None:
    with pytest.raises(ValidationError):
        ModelUIAction.model_validate({"id": "act-1", "type": "timeline.focus_event"})
    with pytest.raises(ValidationError):
        ModelUIAction.model_validate(
            {
                "id": "act-1",
                "type": "rm.rf",
                "target": {"surface": "timeline"},
            }
        )


def test_final_step_uses_model_answer() -> None:
    step = FinalStep.model_validate(
        {
            "action": "final",
            "answer": {
                "mode": "insufficient",
                "missing_reasons": ["NO_MATCHING_ENTITY"],
            },
        }
    )
    assert isinstance(step.answer, ModelAnswer)
    assert step.answer.missing_reasons == ["NO_MATCHING_ENTITY"]


def test_tool_call_step_strict() -> None:
    step = ToolCallStep.model_validate(
        {
            "action": "tool_call",
            "tool": "get_event",
            "arguments": {"event_id": "xixia-09"},
        }
    )
    assert isinstance(step, ToolCallStep)
    with pytest.raises(ValidationError):
        ToolCallStep.model_validate(
            {
                "action": "tool_call",
                "tool": "get_event",
                "arguments": {},
                "unexpected": 1,
            }
        )


def test_tool_call_arguments_must_be_object() -> None:
    with pytest.raises(ValidationError):
        ToolCall(tool="get_event", arguments=["xixia-09"])


def test_model_answer_ui_actions_capped_at_three() -> None:
    """P1-2：Prompt 约定最多 3 个动作，Schema 也必须拒绝第 4 个。"""

    actions = [_model_action(f"act-{index}") for index in range(4)]
    with pytest.raises(ValidationError):
        ModelAnswer(
            mode="insufficient",
            missing_reasons=["INSUFFICIENT_DATA"],
            ui_actions=actions,
        )
