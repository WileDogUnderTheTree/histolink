"""契约测试（V1.0.1 / TC-04）。

覆盖验收标准 §5：
- 合法请求通过；缺字段拒绝；`answer.mode` 非法值拒绝；`ui_actions[].target.surface` 非法值拒绝；
- 澄清分支、错误信封、动作信封、工具 schema 与 OpenAPI 生成物一致。
"""

from __future__ import annotations

import json
import subprocess
import sys
from pathlib import Path
from typing import Any, Callable

import pytest
from jsonschema import Draft202012Validator
from pydantic import ValidationError

from contracts.action_types import (
    V1_AVAILABLE_ACTIONS,
    V1_PLANNED_ACTIONS,
    UIActionType,
    UISurface,
)
from contracts.models import (
    Answer,
    AnswerEnvelope,
    AskRequest,
    ErrorEnvelope,
    UIAction,
)

Clock = Callable[[], Any]


# ---------------------------------------------------------------------------
# 请求契约
# ---------------------------------------------------------------------------


def test_ask_request_accepts_sample(load_sample: Callable[[str], Any]) -> None:
    request = AskRequest.model_validate(load_sample("ask-request.json"))
    assert request.context.route == "/timeline"
    assert request.context.dynasty == "西夏"
    assert request.client_schema_version == "1.0"


def test_ask_request_rejects_missing_context(load_sample: Callable[[str], Any]) -> None:
    payload = load_sample("ask-request.json")
    payload.pop("context")
    with pytest.raises(ValidationError):
        AskRequest.model_validate(payload)


def test_ask_request_rejects_unknown_field(load_sample: Callable[[str], Any]) -> None:
    payload = load_sample("ask-request.json")
    payload["unexpected_field"] = "x"
    with pytest.raises(ValidationError):
        AskRequest.model_validate(payload)


def test_ask_request_rejects_unknown_schema_version(load_sample: Callable[[str], Any]) -> None:
    payload = load_sample("ask-request.json")
    payload["client_schema_version"] = "0.9"
    with pytest.raises(ValidationError):
        AskRequest.model_validate(payload)


def test_ask_request_rejects_orphan_selected_person(load_sample: Callable[[str], Any]) -> None:
    payload = load_sample("ask-request.json")
    payload["selected_person_id"] = "p-liangtaihou-handong-90be"
    with pytest.raises(ValidationError):
        AskRequest.model_validate(payload)


def test_ask_request_rejects_overlong_history(load_sample: Callable[[str], Any]) -> None:
    payload = load_sample("ask-request.json")
    payload["history"] = [{"role": "user", "content": "x"} for _ in range(21)]
    with pytest.raises(ValidationError):
        AskRequest.model_validate(payload)


# ---------------------------------------------------------------------------
# 回答契约
# ---------------------------------------------------------------------------


def test_grounded_answer_envelope_accepts_sample(load_sample: Callable[[str], Any]) -> None:
    envelope = AnswerEnvelope.model_validate(load_sample("answer-grounded.json"))
    assert envelope.answer is not None
    assert envelope.answer.mode.value == "grounded"
    assert len(envelope.citations) == 2
    assert envelope.citations[0].attribution


def test_grounded_answer_requires_citation(load_sample: Callable[[str], Any]) -> None:
    payload = load_sample("answer-grounded.json")
    payload["citations"] = []
    with pytest.raises(ValidationError):
        AnswerEnvelope.model_validate(payload)


def test_grounded_claim_must_reference_existing_citation(load_sample: Callable[[str], Any]) -> None:
    payload = load_sample("answer-grounded.json")
    payload["answer"]["claims"][0]["citation_ids"] = ["cite_missing"]
    with pytest.raises(ValidationError):
        AnswerEnvelope.model_validate(payload)


def test_grounded_answer_requires_claim(load_sample: Callable[[str], Any]) -> None:
    payload = load_sample("answer-grounded.json")
    payload["answer"]["claims"] = []
    with pytest.raises(ValidationError):
        AnswerEnvelope.model_validate(payload)


@pytest.mark.parametrize("invalid_mode", ["bogus", "answered", ""])
def test_answer_mode_enum_rejects_invalid(invalid_mode: str) -> None:
    with pytest.raises(ValidationError):
        Answer(markdown="x", mode=invalid_mode)


def test_insufficient_answer_requires_missing() -> None:
    with pytest.raises(ValidationError):
        Answer(markdown="资料不足", mode="insufficient")


def test_refusal_answer_requires_reason_code() -> None:
    with pytest.raises(ValidationError):
        Answer(markdown="超出范围", mode="refusal")


def test_envelope_requires_answer_or_clarification(load_sample: Callable[[str], Any]) -> None:
    payload = load_sample("answer-grounded.json")
    payload.pop("answer")
    with pytest.raises(ValidationError):
        AnswerEnvelope.model_validate(payload)


# ---------------------------------------------------------------------------
# 澄清契约（Q5）
# ---------------------------------------------------------------------------


def test_clarification_accepts_sample(load_sample: Callable[[str], Any]) -> None:
    envelope = AnswerEnvelope.model_validate(load_sample("clarification.json"))
    assert envelope.answer is None
    assert envelope.clarification is not None
    assert len(envelope.clarification.candidates) == 2
    assert envelope.clarification.candidates[0].disambiguator


def test_clarification_requires_two_candidates(load_sample: Callable[[str], Any]) -> None:
    payload = load_sample("clarification.json")
    payload["clarification"]["candidates"] = payload["clarification"]["candidates"][:1]
    with pytest.raises(ValidationError):
        AnswerEnvelope.model_validate(payload)


def test_clarification_cannot_carry_answer(load_sample: Callable[[str], Any]) -> None:
    payload = load_sample("clarification.json")
    payload["answer"] = load_sample("answer-grounded.json")["answer"]
    with pytest.raises(ValidationError):
        AnswerEnvelope.model_validate(payload)


# ---------------------------------------------------------------------------
# 错误与动作契约
# ---------------------------------------------------------------------------


def test_error_envelope_accepts_sample(load_sample: Callable[[str], Any]) -> None:
    envelope = ErrorEnvelope.model_validate(load_sample("error.json"))
    assert envelope.ok is False
    assert envelope.error.retryable is True


def test_error_code_rejects_unknown(load_sample: Callable[[str], Any]) -> None:
    payload = load_sample("error.json")
    payload["error"]["code"] = "SOMETHING_ELSE"
    with pytest.raises(ValidationError):
        ErrorEnvelope.model_validate(payload)


def test_ui_action_accepts_sample(load_sample: Callable[[str], Any]) -> None:
    action = UIAction.model_validate(load_sample("ui-action.json"))
    assert action.type is UIActionType.GRAPH_FOCUS_PERSON
    assert action.target.surface is UISurface.GRAPH
    assert action.auto is False


@pytest.mark.parametrize("invalid_surface", ["entity", "search", "current", ""])
def test_ui_action_target_surface_rejects_invalid(
    load_sample: Callable[[str], Any], invalid_surface: str
) -> None:
    payload = load_sample("ui-action.json")
    payload["target"]["surface"] = invalid_surface
    with pytest.raises(ValidationError):
        UIAction.model_validate(payload)


def test_ui_action_type_rejects_unknown(load_sample: Callable[[str], Any]) -> None:
    payload = load_sample("ui-action.json")
    payload["type"] = "open.nonexistent"
    with pytest.raises(ValidationError):
        UIAction.model_validate(payload)


def test_action_availability_sets_are_frozen() -> None:
    assert {action.value for action in V1_AVAILABLE_ACTIONS} == {
        "timeline.focus_event",
        "timeline.focus_dynasty",
        "graph.focus_person",
        "graph.focus_relation",
        "ask.suggest",
    }
    assert {action.value for action in V1_PLANNED_ACTIONS} == {
        "timeline.highlight_events",
        "graph.highlight_persons",
        "open.event_card",
        "open.person_card",
    }


# ---------------------------------------------------------------------------
# 生成物一致性
# ---------------------------------------------------------------------------


def test_openapi_has_required_paths_and_models(contracts_dir: Path) -> None:
    spec = json.loads((contracts_dir / "api-v1.openapi.json").read_text(encoding="utf-8"))
    assert spec["openapi"].startswith("3.1")
    assert spec["info"]["version"] == "1.0"
    for api_path in [
        "/api/health",
        "/api/meta",
        "/api/entities/person/{person_id}",
        "/api/entities/event/{event_id}",
        "/api/entities/persons",
        "/api/search/events",
        "/api/agent/ask",
    ]:
        assert api_path in spec["paths"], api_path
    for model in ["AskRequest", "AnswerEnvelope", "ErrorEnvelope", "UIAction", "Clarification"]:
        assert model in spec["components"]["schemas"], model


def test_tools_schema_is_valid_jsonschema(contracts_dir: Path) -> None:
    schema = json.loads((contracts_dir / "tools-v1.schema.json").read_text(encoding="utf-8"))
    assert schema["$schema"] == "https://json-schema.org/draft/2020-12/schema"
    tools = schema["tools"]
    assert len(tools) == 8
    assert {tool["name"] for tool in tools} == {
        "resolve_entity",
        "search_events",
        "get_event",
        "get_person",
        "get_person_events",
        "get_relation",
        "get_era_graph",
        "timeline_span",
    }
    for tool in tools:
        Draft202012Validator.check_schema(tool["input"])
        Draft202012Validator.check_schema(tool["output"])


def test_action_policy_covers_every_action_type(contracts_dir: Path) -> None:
    policy = json.loads((contracts_dir / "action-policy.json").read_text(encoding="utf-8"))
    action_schema = json.loads((contracts_dir / "actions-v1.schema.json").read_text(encoding="utf-8"))
    assert set(policy["actions"]) == set(action_schema["x-action-types"])
    assert set(policy["surfaces"]) == {"timeline", "graph", "ask"}
    for action_type, entry in policy["actions"].items():
        assert entry["availability"] in {"available", "planned"}
        if entry["availability"] == "available":
            assert entry["surface"] in policy["surfaces"], action_type
            assert entry["auto"] == "same_page_only", action_type


def test_export_contracts_check_passes(repo_root: Path) -> None:
    backend_dir = repo_root / "backend"
    result = subprocess.run(
        [sys.executable, "scripts/export_contracts.py", "--check"],
        cwd=backend_dir,
        capture_output=True,
        text=True,
        encoding="utf-8",
    )
    assert result.returncode == 0, result.stderr or result.stdout
