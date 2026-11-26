"""Agent Core 测试工具：脚本化 FakeLLM + 请求/回答构造器（全部离线）。"""

from __future__ import annotations

import json
from types import SimpleNamespace
from typing import Any

from contracts.models import AskRequest
from llm_client import LLMChatResult


class FakeLLM:
    """按脚本返回模型输出；可注入异常以测试超时 / 配置错误映射。"""

    def __init__(
        self,
        responses: list[str | BaseException],
        *,
        model: str = "fake-qwen",
        model_used: str | None = None,
        latency_ms: int = 7,
        usage: dict[str, int] | None = None,
    ) -> None:
        self._responses = list(responses)
        self.model = model
        #: 模拟「主模型降级后由备用模型完成回答」：默认与 model 一致。
        self.model_used = model_used or model
        self.latency_ms = latency_ms
        self.usage = (
            usage
            if usage is not None
            else {"prompt_tokens": 10, "completion_tokens": 5, "total_tokens": 15}
        )
        self.calls: list[dict[str, Any]] = []
        self.settings = SimpleNamespace(model=model)

    @property
    def remaining(self) -> int:
        return len(self._responses)

    def chat(self, messages: list[dict[str, str]], **kwargs: Any) -> LLMChatResult:
        # 快照式保存，避免 Orchestrator 后续 append 影响前面轮次的断言。
        self.calls.append(
            {"messages": [dict(message) for message in messages], **kwargs}
        )
        if not self._responses:
            raise AssertionError("FakeLLM 脚本已耗尽，Orchestrator 调用次数超出预期")
        item = self._responses.pop(0)
        if isinstance(item, BaseException):
            raise item
        return LLMChatResult(
            content=item,
            model=self.model,
            latency_ms=self.latency_ms,
            usage=dict(self.usage),
            model_used=self.model_used,
        )


def ask_request(
    question: str = "赤壁之战发生在哪一年？",
    *,
    route: str = "/timeline",
    history: list[dict[str, str]] | None = None,
    selected_person_id: str | None = None,
    context: dict[str, Any] | None = None,
) -> AskRequest:
    payload: dict[str, Any] = {
        "question": question,
        "session_id": "test-session",
        "context": context or {"route": route},
        "history": history or [],
    }
    if selected_person_id is not None:
        payload["clarification_id"] = "clar_test"
        payload["selected_person_id"] = selected_person_id
    return AskRequest.model_validate(payload)


def tool_call_step(
    tool: str, arguments: dict[str, Any], thought: str = "调用工具"
) -> str:
    return json.dumps(
        {
            "action": "tool_call",
            "thought": thought,
            "tool": tool,
            "arguments": arguments,
        },
        ensure_ascii=False,
    )


def tool_batch_step(calls: list[dict[str, Any]], thought: str = "并行调用工具") -> str:
    return json.dumps(
        {"action": "tool_batch", "thought": thought, "calls": calls}, ensure_ascii=False
    )


def final_step(answer: dict[str, Any], thought: str = "结束") -> str:
    return json.dumps(
        {"action": "final", "thought": thought, "answer": answer}, ensure_ascii=False
    )


def grounded_answer(
    *,
    citation_ids: list[str],
    entity_type: str = "event",
    entity_id: str = "handong-chibi",
    claims: list[dict[str, Any]] | None = None,
    related_event_ids: list[str] | None = None,
    ui_actions: list[dict[str, Any]] | None = None,
    markdown: str | None = None,
) -> dict[str, Any]:
    """构造模型提议的 grounded answer（ModelAnswer）。

    V1.0.6.1：``markdown`` 为模型生成的用户可见正文（可选；缺省时服务端回退事实实证正文），
    提供后会先经过 `agent.factcheck` 文本级事实核查再被采用。
    """

    payload: dict[str, Any] = {
        "mode": "grounded",
        "claims": claims or [{"id": "c1", "citation_ids": citation_ids}],
        "evidence": [
            {"entity_type": entity_type, "entity_id": entity_id, "note": None}
        ],
        "related_event_ids": related_event_ids or [],
        "missing_reasons": [],
        "reason_code": None,
        "ui_actions": ui_actions or [],
    }
    if markdown is not None:
        payload["markdown"] = markdown
    return payload


def insufficient_answer(missing_reasons: list[str] | None = None) -> dict[str, Any]:
    """构造模型提议的 insufficient answer；正文会被服务端固定模板替换。"""

    return {
        "mode": "insufficient",
        "claims": [],
        "evidence": [],
        "related_event_ids": [],
        "missing_reasons": missing_reasons or ["INSUFFICIENT_DATA"],
        "reason_code": None,
        "ui_actions": [],
    }


def refusal_answer(reason_code: str = "OUT_OF_SCOPE") -> dict[str, Any]:
    return {
        "mode": "refusal",
        "claims": [],
        "evidence": [],
        "related_event_ids": [],
        "missing_reasons": [],
        "reason_code": reason_code,
        "ui_actions": [],
    }
