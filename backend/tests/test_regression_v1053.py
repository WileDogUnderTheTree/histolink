"""史脉 HistoLink V1.0.5.3 全面体检专项回归测试（离线，不访问网络、不调用真实 LLM）。

用途
----
这是 V1.0.5.3「全面体检」的**专项回归**基线：只验证四条最容易在迭代中回退、
且与用户可见行为直接相关的契约，不重复现有 336 个测试的细粒度实现用例。

覆盖范围（四条主线）
--------------------
1. **模型降级**：主模型 429 / 502 / 504 / 超时自动切换备用模型；`model_used` 与
   `trace.model_used` 反映实际模型；主备都失败时 502 / 504 错误 envelope；显式指定
   未注册模型时 API 400 与 LLMClient `LLMConfigError` 两层兜底；非降级状态码不重试。
2. **会话隔离**：同一请求对象连续运行不累积对话状态（不传 session_context 时）；`history` 只在
   本次请求生效、且首次请求会迁移进服务端会话；不同 `session_id` 的会话历史互相隔离，
   `session_id` 本身不进入 Prompt；并发 `AgentOrchestrator.run()` 互不串扰；
   工具结果与 UI 动作命名空间不跨请求复用。
3. **边界兜底**：空问题 / 纯空白 / 超长问题 / 缺字段 / 非法 context / 非法 JSON 全部
   400 `INVALID_REQUEST` 且不进入问答链路；无可用工具结果时 grounded 降级为
   insufficient；RAG 不可用或空结果不导致 500；工具内部异常被吸收；模型配置缺失
   返回 503 `LLM_NOT_CONFIGURED`。
4. **契约一致性**：`contracts/tools.py` / `contracts/tool_registry` / 工具实现三处
   9 个工具名一致、统一信封字段不漂移；动作类型 / 可用性 / 导出物一致；
   `SCHEMA_VERSION` 与冻结 OpenAPI `info.version` 一致，`API_VERSION` 与
   `APP_VERSION` 及 `/api/health`、`/api/meta`、`/api/agent/models` 一致；
   错误码、路径与 Agent 响应 envelope 字段不漂移。

运行命令
--------
    cd backend
    .\\.venv\\Scripts\\python.exe -m pytest tests/test_regression_v1053.py -q
    .\\.venv\\Scripts\\python.exe -m pytest -q

说明
----
- 全部使用 `tests/conftest.py` 的真实快照 fixture、`tests/agent_testkit.py` 的 FakeLLM /
  请求构造器，以及 `httpx.MockTransport`；不访问网络、不读取真实 API key；
- 已知契约缺口 `/api/search/events` 仅在冻结 OpenAPI / 契约桩中声明、运行实现未挂载，
  本文件用显式断言固定当前差异并在最终报告中记录，不修改生产代码。
"""

from __future__ import annotations

import json
import threading
from concurrent.futures import ThreadPoolExecutor
from dataclasses import replace
from pathlib import Path
from typing import Any

import httpx
import jsonschema
import pytest
from agent_testkit import (
    FakeLLM,
    ask_request,
    final_step,
    grounded_answer,
    insufficient_answer,
    tool_call_step,
)
from fastapi.testclient import TestClient

import agent.tools.rag as rag_tool
from agent.orchestrator import AgentOrchestrator
from agent.tool_registry import SPECS, ToolRegistry
from agent.tools import TOOL_FUNCTIONS, TOOL_NAMES, Toolkit
from contracts.action_types import (
    ACTION_SURFACE,
    V1_AVAILABLE_ACTIONS,
    V1_PLANNED_ACTIONS,
    UIActionType,
    UISurface,
)
from contracts.models import (
    API_VERSION,
    SCHEMA_VERSION,
    Answer,
    AnswerEnvelope,
    ErrorCode,
    ModelsResponse,
    Trace,
)
from contracts.tools import TOOLS
from llm_client import (
    DEFAULT_FALLBACK_MODEL,
    DEFAULT_MODEL,
    LLMClient,
    LLMConfigError,
    LLMSettings,
    LLMTimeoutError,
    LLMUpstreamError,
    resolve_model_pair,
)
from main import APP_VERSION
from rag.store import RagUnavailableError
from routers.agent import build_answer_envelope
from routers.deps import get_llm_client

PRIMARY_MODEL = DEFAULT_MODEL
FALLBACK_MODEL = DEFAULT_FALLBACK_MODEL
API_KEY = "sk-regression-v1053-not-a-real-key"
MESSAGES = [
    {"role": "system", "content": "只输出 JSON"},
    {"role": "user", "content": "赤壁之战发生在哪一年？"},
]
ASK_BODY: dict[str, Any] = {
    "question": "赤壁之战发生在哪一年？",
    "session_id": "regression-v1053",
    "context": {"route": "/timeline"},
}
CHIBI_EVENT = "handong-chibi"
XIXIA_EVENT = "xixia-09"
CHIBI_CITATION = "cite-handong-chibi-0"
XIXIA_CITATION = "cite-xixia-09-0"
INVALID_MODEL_ID = "Qwen/Not-In-Registry-V1053"


# ---------------------------------------------------------------------------
# 公共辅助
# ---------------------------------------------------------------------------


def _settings(*, fallback_model: str | None = FALLBACK_MODEL) -> LLMSettings:
    """固定主备模型的离线设置（不读取进程环境，避免受 .env 影响）。"""

    return LLMSettings(
        api_key=API_KEY,
        base_url="https://llm.invalid/v1",
        model=PRIMARY_MODEL,
        timeout_seconds=5.0,
        fallback_model=fallback_model,
    )


def _client(handler: Any) -> LLMClient:
    return LLMClient(_settings(), transport=httpx.MockTransport(handler))


def _ok_response(model: str, content: str = '{"action":"final"}') -> httpx.Response:
    return httpx.Response(
        200,
        json={
            "model": model,
            "choices": [{"message": {"role": "assistant", "content": content}}],
            "usage": {"prompt_tokens": 9, "completion_tokens": 1, "total_tokens": 10},
        },
    )


class _EmptyRagStore:
    """模拟「向量库可用但检索为空」：工具应返回 ok=true + total=0。"""

    provider = "fake"
    model = "fake-embedding-v1053"

    def search(self, query: str, top_k: int = 3) -> list[Any]:
        assert isinstance(query, str) and query.strip(), (
            "RAG 工具不得把空 query 传给向量库"
        )
        assert 1 <= top_k <= 3, "RAG 工具必须把 top_k 限制在 1..3"
        return []


class _SequencedModelUsedFakeLLM(FakeLLM):
    """按脚本逐轮返回不同的 `model_used`，用于验证 trace 记录的是**最后一轮实际模型**。"""

    def __init__(
        self,
        responses: list[str | BaseException],
        *,
        model_used_sequence: list[str],
        **kwargs: Any,
    ) -> None:
        super().__init__(responses, **kwargs)
        self._model_used_sequence = list(model_used_sequence)

    def chat(self, messages: list[dict[str, str]], **kwargs: Any):
        result = super().chat(messages, **kwargs)
        used = (
            self._model_used_sequence.pop(0)
            if self._model_used_sequence
            else result.model_used
        )
        return replace(result, model_used=used)


@pytest.fixture
def install_llm(client: TestClient):
    """安装 FakeLLM 依赖覆盖，并在用例结束后恢复。"""

    def _install(fake: Any) -> Any:
        client.app.dependency_overrides[get_llm_client] = lambda: fake
        return fake

    yield _install
    client.app.dependency_overrides.pop(get_llm_client, None)


# ===========================================================================
# 主线一：模型降级
# ===========================================================================


@pytest.mark.parametrize("upstream_status", [429, 502, 504])
def test_主模型可重试状态码自动切换备用模型(upstream_status: int) -> None:
    """429 / 502 / 504 必须自动切到另一款模型重试一次，并用 model_used 标明实际模型。"""

    models: list[str] = []

    def handler(request: httpx.Request) -> httpx.Response:
        models.append(json.loads(request.content)["model"])
        if len(models) == 1:
            return httpx.Response(
                upstream_status, text="upstream busy", request=request
            )
        return _ok_response(FALLBACK_MODEL)

    result = _client(handler).chat(MESSAGES)

    assert models == [PRIMARY_MODEL, FALLBACK_MODEL], (
        f"HTTP {upstream_status} 应触发一次备用模型重试"
    )
    assert result.model_used == FALLBACK_MODEL, (
        "model_used 必须是最终完成回答的备用模型"
    )
    assert result.model == FALLBACK_MODEL, "备用模型成功时上游回显模型应为备用模型"
    assert "final" in result.content, "降级后应返回备用模型的正常内容"
    assert result.usage == {
        "prompt_tokens": 9,
        "completion_tokens": 1,
        "total_tokens": 10,
    }


def test_主模型超时自动切换备用模型() -> None:
    """超时（含连接超时）与 429/502/504 同等对待，必须自动降级一次。"""

    models: list[str] = []

    def handler(request: httpx.Request) -> httpx.Response:
        models.append(json.loads(request.content)["model"])
        if len(models) == 1:
            raise httpx.TimeoutException("read timeout")
        return _ok_response(FALLBACK_MODEL)

    result = _client(handler).chat(MESSAGES)

    assert models == [PRIMARY_MODEL, FALLBACK_MODEL], "超时后应切换到备用模型"
    assert result.model_used == FALLBACK_MODEL
    assert result.model == FALLBACK_MODEL


@pytest.mark.parametrize(
    ("failure_kind", "expected_status", "expected_code"),
    [
        pytest.param("timeout", 504, "LLM_TIMEOUT", id="主备都超时"),
        pytest.param("upstream_502", 502, "LLM_UPSTREAM_ERROR", id="主备都502"),
    ],
)
def test_主备都失败_降级上下文与API错误信封(
    failure_kind: str,
    expected_status: int,
    expected_code: str,
    client: TestClient,
    install_llm: Any,
) -> None:
    """备用模型也失败时：异常带「已自动降级」上下文，API 映射为 502/504 envelope。"""

    models: list[str] = []

    def handler(request: httpx.Request) -> httpx.Response:
        models.append(json.loads(request.content)["model"])
        if failure_kind == "timeout":
            raise httpx.TimeoutException("read timeout")
        return httpx.Response(502, text="bad gateway", request=request)

    with pytest.raises((LLMTimeoutError, LLMUpstreamError)) as exc_info:
        _client(handler).chat(MESSAGES)

    error = exc_info.value
    assert models == [PRIMARY_MODEL, FALLBACK_MODEL], "主备都必须被实际请求一次"
    assert isinstance(
        error, LLMTimeoutError if failure_kind == "timeout" else LLMUpstreamError
    )
    assert PRIMARY_MODEL in str(error) and FALLBACK_MODEL in str(error)
    assert "已自动降级" in str(error), "主备都失败的异常必须保留降级上下文"
    if isinstance(error, LLMUpstreamError):
        assert error.upstream_status == 502
        assert error.retryable is True

    install_llm(FakeLLM([error], model=PRIMARY_MODEL))
    response = client.post("/api/agent/ask", json=ASK_BODY)
    payload = response.json()

    assert response.status_code == expected_status, "主备都失败时不得返回 500"
    assert payload["ok"] is False
    assert payload["error"]["code"] == expected_code
    assert payload["error"]["retryable"] is True
    assert payload["error"]["details"]["model"] == PRIMARY_MODEL
    if failure_kind == "upstream_502":
        assert payload["error"]["details"]["upstream_status"] == 502
    assert "已自动降级" in payload["error"]["message"], (
        "envelope 应保留可运维的降级上下文"
    )


def test_手动选择备用模型遇超时仍降级回主模型() -> None:
    """请求级模型选择后双向降级仍生效：所选备用模型超时 → 自动切回主模型。"""

    models: list[str] = []

    def handler(request: httpx.Request) -> httpx.Response:
        models.append(json.loads(request.content)["model"])
        if len(models) == 1:
            raise httpx.TimeoutException("read timeout")
        return _ok_response(PRIMARY_MODEL)

    result = _client(handler).chat(MESSAGES, model_id=FALLBACK_MODEL)

    assert models == [FALLBACK_MODEL, PRIMARY_MODEL], (
        "手动选择备用模型后主模型应成为降级目标"
    )
    assert result.model_used == PRIMARY_MODEL
    assert result.model == PRIMARY_MODEL


@pytest.mark.parametrize("upstream_status", [401, 500])
def test_不可重试状态码不触发降级且只请求一次(upstream_status: int) -> None:
    """只有 429/502/504/超时才降级；401/500 换模型也不会好，必须按原错误上抛。"""

    models: list[str] = []

    def handler(request: httpx.Request) -> httpx.Response:
        models.append(json.loads(request.content)["model"])
        return httpx.Response(upstream_status, text="fatal", request=request)

    with pytest.raises(LLMUpstreamError) as exc_info:
        _client(handler).chat(MESSAGES)

    assert models == [PRIMARY_MODEL], "非可重试状态码不得请求备用模型"
    assert exc_info.value.upstream_status == upstream_status
    assert exc_info.value.retryable is (upstream_status >= 500)


def test_未注册模型在_API_与_LLMClient_两层均被拒绝(
    client: TestClient, install_llm: Any
) -> None:
    """显式指定注册表外模型：API 400 且不进入问答链路；LLMClient 也不得透传给上游。"""

    fake = install_llm(FakeLLM([]))
    response = client.post(
        "/api/agent/ask", json={**ASK_BODY, "model_id": INVALID_MODEL_ID}
    )
    payload = response.json()

    assert response.status_code == 400, "未知模型应返回 400 而不是 500"
    assert payload["ok"] is False
    assert payload["error"]["code"] == "INVALID_REQUEST"
    assert "未知模型" in payload["error"]["message"]
    assert fake.calls == [], "未知模型必须在模型调用前被拒绝"

    called: list[httpx.Request] = []

    def handler(request: httpx.Request) -> httpx.Response:
        called.append(request)
        return _ok_response(PRIMARY_MODEL)

    with pytest.raises(LLMConfigError, match="未知模型"):
        _client(handler).chat(MESSAGES, model_id=INVALID_MODEL_ID)
    assert called == [], "LLMClient 不得把未注册模型透传给上游"

    # 没有备用模型时：默认主模型仍可用，但备用模型不再属于注册表，也没有降级目标。
    settings_without_fallback = replace(_settings(), fallback_model=None)
    assert resolve_model_pair(settings_without_fallback) == (PRIMARY_MODEL, None)
    with pytest.raises(LLMConfigError, match="未知模型"):
        resolve_model_pair(settings_without_fallback, FALLBACK_MODEL)


def test_trace_model_used_记录最后一轮实际模型(store: Any) -> None:
    """多轮对话中主模型先答、后续轮被备用模型接管时，trace.model_used 必须取最后一轮实际模型。"""

    fake = _SequencedModelUsedFakeLLM(
        [
            tool_call_step("get_event", {"event_id": CHIBI_EVENT}),
            final_step(grounded_answer(citation_ids=[CHIBI_CITATION])),
        ],
        model=PRIMARY_MODEL,
        model_used_sequence=[PRIMARY_MODEL, FALLBACK_MODEL],
    )
    request = ask_request("赤壁之战发生在哪一年？")
    result = AgentOrchestrator(store, fake).run(request)

    assert result.answer.mode == "grounded"
    assert result.steps == 2
    assert result.model == PRIMARY_MODEL, "trace.model 沿用上游回显模型名"
    assert result.model_used == FALLBACK_MODEL, (
        "model_used 应是最后一轮实际完成回答的模型"
    )

    envelope = build_answer_envelope(result, request, store)
    assert envelope.trace is not None
    assert envelope.trace.model == PRIMARY_MODEL
    assert envelope.trace.model_used == FALLBACK_MODEL
    assert envelope.trace.model_requested is None, (
        "未显式选择模型时 model_requested 必须为 null"
    )


# ===========================================================================
# 主线二：会话隔离
# ===========================================================================


def test_同一请求对象连续运行不累积对话状态(store: Any) -> None:
    """同一 AskRequest 连续跑两次：Prompt 必须完全一致，不能把上一轮消息带进下一轮。"""

    fake = FakeLLM(
        [
            final_step(insufficient_answer(["NO_MATCHING_ENTITY"])),
            final_step(insufficient_answer(["NO_MATCHING_ENTITY"])),
        ]
    )
    request = ask_request("孔子是谁？", route="/graph")
    orchestrator = AgentOrchestrator(store, fake)

    first = orchestrator.run(request)
    second = orchestrator.run(request)

    assert first.steps == second.steps == 1
    assert fake.calls[0]["messages"] == fake.calls[1]["messages"], (
        "同一请求两次运行的 Prompt 必须逐字一致（无共享可变对话状态）"
    )
    assert len(request.history) == 0, "运行不得回写请求对象"
    assert all(
        message["role"] != "assistant" for message in fake.calls[1]["messages"]
    ), "第二轮不得复用上一轮 assistant 消息"


def test_history_首次请求迁移进会话并对后续请求生效(
    client: TestClient, install_llm: Any
) -> None:
    """V1.0.6：首次请求携带的 history 会迁移进服务端会话，同一 session 的后续请求可见。"""

    fake = install_llm(
        FakeLLM(
            [
                final_step(insufficient_answer(["INSUFFICIENT_DATA"])),
                final_step(insufficient_answer(["INSUFFICIENT_DATA"])),
            ]
        )
    )
    history = [
        {"role": "user", "content": "上一轮问题：孔子是谁？"},
        {"role": "assistant", "content": "上一轮回答：孔子是春秋时期的思想家。"},
    ]

    first = client.post("/api/agent/ask", json={**ASK_BODY, "history": history})
    second = client.post("/api/agent/ask", json=ASK_BODY)

    assert first.status_code == second.status_code == 200
    first_texts = [message["content"] for message in fake.calls[0]["messages"]]
    second_texts = [message["content"] for message in fake.calls[1]["messages"]]
    assert first_texts[1:3] == [
        "上一轮问题：孔子是谁？",
        "上一轮回答：孔子是春秋时期的思想家。",
    ], "首次请求迁移的 history 必须按顺序进入 Prompt"
    assert "上一轮问题：孔子是谁？" in second_texts, (
        "同一 session_id 的后续请求必须能看到上一轮历史（V1.0.6 多轮记忆）"
    )
    assert "上一轮回答：孔子是春秋时期的思想家。" in second_texts
    assert history == [
        {"role": "user", "content": "上一轮问题：孔子是谁？"},
        {"role": "assistant", "content": "上一轮回答：孔子是春秋时期的思想家。"},
    ], "服务端不得修改调用方传入的 history"


def test_session_id_隔离不同会话不共享历史(
    client: TestClient, install_llm: Any
) -> None:
    """V1.0.6：会话历史按 session_id 隔离；session_id 本身不进入 Prompt。"""

    fake = install_llm(
        FakeLLM(
            [
                final_step(insufficient_answer(["NO_MATCHING_ENTITY"])),
                final_step(insufficient_answer(["NO_MATCHING_ENTITY"])),
            ]
        )
    )

    first = client.post(
        "/api/agent/ask",
        json={**ASK_BODY, "session_id": "session-a", "question": "孔子是谁？"},
    )
    second = client.post(
        "/api/agent/ask",
        json={**ASK_BODY, "session_id": "session-b", "question": "墨子是谁？"},
    )

    assert first.status_code == second.status_code == 200
    first_payload = first.json()
    second_payload = second.json()
    assert first_payload["ok"] is True and second_payload["ok"] is True
    assert first_payload["request_id"] != second_payload["request_id"], (
        "每次请求必须独立 request_id"
    )
    assert first_payload["snapshot"] == second_payload["snapshot"], (
        "快照引用不得因 session_id 变化"
    )

    second_texts = [message["content"] for message in fake.calls[1]["messages"]]
    # 只检查「历史消息 + 当前问题」，System Prompt 里含有工具说明示例（可能提到孔子）。
    second_context_texts = second_texts[1:]
    assert not any("孔子" in text for text in second_context_texts), (
        "session-a 的历史不得泄漏进 session-b 的 Prompt"
    )
    assert all(
        "session-a" not in text and "session-b" not in text for text in second_texts
    ), "session_id 不得进入 Prompt"

    sessions = client.get("/api/sessions").json()["sessions"]
    assert {item["session_id"] for item in sessions} == {"session-a", "session-b"}
    # 两个会话各自独立记录了一轮问答。
    for session_id in ("session-a", "session-b"):
        detail = client.get(f"/api/sessions/{session_id}").json()["session"]
        assert detail["turn_count"] == 2
        assert detail["turns"][0]["role"] == "user"


def test_并发运行的工具结果与引用互不串扰(store: Any, toolkit: Any) -> None:
    """并发多请求共享只读快照：每个结果只能引用自己请求内工具返回的 citation。"""

    event_ids = [CHIBI_EVENT, XIXIA_EVENT] * 3
    citation_by_event: dict[str, str] = {}
    for event_id in sorted(set(event_ids)):
        result = toolkit.call("get_event", event_id=event_id)
        assert result["ok"] is True and result["citations"]
        citation_by_event[event_id] = result["citations"][0]["id"]

    barrier = threading.Barrier(len(event_ids))

    def _run_one(item: tuple[int, str]) -> tuple[str, Any]:
        index, event_id = item
        citation = citation_by_event[event_id]
        fake = FakeLLM(
            [
                tool_call_step("get_event", {"event_id": event_id}),
                final_step(
                    grounded_answer(citation_ids=[citation], entity_id=event_id)
                ),
            ]
        )
        orchestrator = AgentOrchestrator(store, fake)
        barrier.wait(timeout=10)
        return event_id, orchestrator.run(
            ask_request(f"{event_id}-{index} 事件发生在哪一年？", route="/timeline")
        )

    with ThreadPoolExecutor(max_workers=len(event_ids)) as pool:
        outputs = list(pool.map(_run_one, enumerate(event_ids)))

    assert len(outputs) == len(event_ids)
    seen_questions: set[str] = set()
    for event_id, result in outputs:
        expected_citation = citation_by_event[event_id]
        assert result.answer.mode == "grounded", f"{event_id} 在并发下应正常 grounded"
        assert [citation.id for citation in result.citations] == [expected_citation], (
            f"{event_id} 的 citations 混入了其它请求的结果"
        )
        assert [record.arguments["event_id"] for record in result.tools] == [event_id]
        seen_questions.add(result.question)
    assert len(seen_questions) == len(event_ids), "每个并发请求必须保留自己的问题"


def test_工具结果与动作命名空间不跨请求复用(store: Any) -> None:
    """上一轮的 evidence / citation / UI 动作不得在下一轮生效（ObservedEvidence 必须每轮新建）。"""

    stale_action = {
        "id": "act-stale-chibi",
        "type": "timeline.focus_event",
        "payload": {"event_id": CHIBI_EVENT},
        "target": {"surface": "timeline", "params": {"event_id": CHIBI_EVENT}},
        "auto": False,
        "reason": None,
    }
    fake = FakeLLM(
        [
            # 第 1 轮：真实取到赤壁事件。
            tool_call_step("get_event", {"event_id": CHIBI_EVENT}),
            final_step(
                grounded_answer(citation_ids=[CHIBI_CITATION], entity_id=CHIBI_EVENT)
            ),
            # 第 2 轮：只取西夏事件，却试图复用上一轮的 UI 动作。
            tool_call_step("get_event", {"event_id": XIXIA_EVENT}),
            final_step(
                grounded_answer(
                    citation_ids=[XIXIA_CITATION],
                    entity_id=XIXIA_EVENT,
                    ui_actions=[stale_action],
                )
            ),
            # 第 3 轮：不调用任何工具，直接复用第 1 轮的 citation / evidence → 必须降级。
            *[
                final_step(
                    grounded_answer(
                        citation_ids=[CHIBI_CITATION], entity_id=CHIBI_EVENT
                    )
                )
                for _ in range(6)
            ],
        ]
    )
    orchestrator = AgentOrchestrator(store, fake)

    first = orchestrator.run(ask_request("赤壁之战发生在哪一年？"))
    second = orchestrator.run(ask_request("西夏好水之战发生在哪一年？"))
    third = orchestrator.run(ask_request("赤壁之战发生在哪一年？"))

    assert first.answer.mode == "grounded"
    assert [citation.id for citation in first.citations] == [CHIBI_CITATION]

    assert second.answer.mode == "grounded"
    assert [citation.id for citation in second.citations] == [XIXIA_CITATION]
    assert second.answer.ui_actions == [], "引用上一轮实体的 UI 动作必须被过滤"
    assert [record.name for record in second.tools] == ["get_event"]

    assert third.answer.mode == "insufficient", "上一轮工具结果不能作为本轮证据"
    assert third.downgraded is True
    assert third.citations == []
    assert third.tools == []
    assert any(CHIBI_EVENT in reason for reason in third.answer.missing)


# ===========================================================================
# 主线三：边界兜底
# ===========================================================================


def test_非法请求参数统一返回400且不触发模型调用(
    client: TestClient, install_llm: Any
) -> None:
    """空 / 纯空白 / 缺字段 / 超长 / 非法 context 一律 400 envelope，且不进入问答链路。"""

    fake = install_llm(FakeLLM([]))
    invalid_bodies: dict[str, dict[str, Any]] = {
        "空问题": {**ASK_BODY, "question": ""},
        "纯空白问题": {**ASK_BODY, "question": " \n\t "},
        "缺少问题字段": {"session_id": "s", "context": {"route": "/timeline"}},
        "缺少上下文字段": {"question": "赤壁之战", "session_id": "s"},
        "超过 2000 字的问题": {**ASK_BODY, "question": "赤" * 2001},
        "超过 20 轮的 history": {
            **ASK_BODY,
            "history": [{"role": "user", "content": "x"} for _ in range(21)],
        },
        "路由不以斜杠开头": {**ASK_BODY, "context": {"route": "timeline"}},
    }

    for label, body in invalid_bodies.items():
        response = client.post("/api/agent/ask", json=body)
        assert response.status_code == 400, (
            f"{label} 应返回 400，实际 {response.status_code}"
        )
        payload = response.json()
        assert payload["ok"] is False, f"{label} 必须返回错误 envelope"
        assert payload["error"]["code"] == "INVALID_REQUEST", f"{label} 错误码必须冻结"
        assert payload["error"]["message"], f"{label} 错误 envelope 必须带 message"
        assert payload["request_id"].startswith("req_"), f"{label} 必须带 request_id"

    assert fake.calls == [], "非法请求不得调用模型"


def test_非法JSON请求体返回400_envelope(client: TestClient, install_llm: Any) -> None:
    """损坏的 JSON body 由统一错误处理器转 400 envelope，不得出现裸 500。"""

    fake = install_llm(FakeLLM([]))
    response = client.post(
        "/api/agent/ask",
        content='{"question": "赤壁之战",'.encode(),
        headers={"Content-Type": "application/json"},
    )
    payload = response.json()

    assert response.status_code == 400
    assert payload["ok"] is False
    assert payload["error"]["code"] == "INVALID_REQUEST"
    assert payload["error"]["details"]["errors"], "校验错误应带可诊断的 details.errors"
    assert fake.calls == [], "非法 JSON 不得进入问答链路"


def test_无可用工具结果时grounded被降级为insufficient(
    client: TestClient, install_llm: Any
) -> None:
    """工具成功但空结果时，模型仍声称 grounded 也必须被证据校验降级，且 citations 为空。"""

    install_llm(
        FakeLLM(
            [
                tool_call_step("search_events", {"q": "秦始皇 西红柿"}),
                *[
                    final_step(
                        grounded_answer(
                            citation_ids=[CHIBI_CITATION], entity_id=CHIBI_EVENT
                        )
                    )
                    for _ in range(5)
                ],
            ]
        )
    )

    response = client.post("/api/agent/ask", json=ASK_BODY)
    payload = response.json()

    assert response.status_code == 200, "空结果应走降级 envelope，而不是 500"
    assert payload["answer"]["mode"] == "insufficient"
    assert payload["citations"] == []
    assert payload["answer"]["claims"] == []
    assert payload["answer"]["missing"], "insufficient 必须说明 missing"
    assert payload["trace"]["tools"][0]["name"] == "search_events"
    assert payload["trace"]["tools"][0]["hits"] == 0, "空结果必须在 trace 中体现 hits=0"


@pytest.mark.parametrize(
    "rag_mode",
    [
        pytest.param("unavailable", id="RAG向量库不可用"),
        pytest.param("empty", id="RAG空结果"),
    ],
)
def test_RAG不可用或空结果不导致500(
    rag_mode: str,
    client: TestClient,
    install_llm: Any,
    store: Any,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """RAG 不可用（失败信封）或空结果（ok=true/total=0）都不得击穿整轮问答。"""

    if rag_mode == "unavailable":

        def _unavailable() -> Any:
            raise RagUnavailableError("RAG 向量库未入库：缺少 manifest.json")

        monkeypatch.setattr(rag_tool, "get_rag_store", _unavailable)
    else:
        monkeypatch.setattr(rag_tool, "get_rag_store", lambda: _EmptyRagStore())

    script = [
        tool_call_step("search_historical_text", {"query": "赤壁之战 208年"}),
        final_step(insufficient_answer(["NO_RELIABLE_SOURCE"])),
    ]
    install_llm(FakeLLM(list(script)))

    response = client.post("/api/agent/ask", json=ASK_BODY)
    payload = response.json()

    assert response.status_code == 200, "RAG 故障不得返回 500"
    assert payload["answer"]["mode"] == "insufficient"
    assert payload["citations"] == []
    assert payload["trace"]["tools"][0]["name"] == "search_historical_text"

    # 直接跑 orchestrator，核对工具层确实给出了明确的成功 / 失败信封。
    result = AgentOrchestrator(store, FakeLLM(list(script))).run(
        ask_request("赤壁之战发生在哪一年？")
    )
    record = result.tools[0]
    assert record.name == "search_historical_text"
    if rag_mode == "unavailable":
        assert record.ok is False
        assert record.error_code == "INSUFFICIENT_EVIDENCE", (
            "RAG 未就绪应映射为证据不足"
        )
    else:
        assert record.ok is True, "空结果不是错误"
        assert record.hits == 0, "空结果必须在审计记录里体现 hits=0"


def test_工具内部异常被吸收不导致整轮崩溃(
    client: TestClient, install_llm: Any, monkeypatch: pytest.MonkeyPatch
) -> None:
    """工具实现抛 KeyError 时，注册表必须转安全失败信封，整轮问答仍返回 200 降级。"""

    def _boom(self: Toolkit, name: str, /, **arguments: Any) -> dict[str, Any]:
        raise KeyError("snapshot index missing")

    monkeypatch.setattr(Toolkit, "call", _boom)
    install_llm(
        FakeLLM(
            [
                tool_call_step("get_event", {"event_id": CHIBI_EVENT}),
                final_step(insufficient_answer(["INSUFFICIENT_DATA"])),
            ]
        )
    )

    response = client.post("/api/agent/ask", json=ASK_BODY)
    payload = response.json()

    assert response.status_code == 200, "工具内部异常不得逃逸为 500"
    assert payload["answer"]["mode"] == "insufficient"
    assert payload["trace"]["tools"][0]["name"] == "get_event"
    assert "snapshot index missing" not in response.text, "内部异常细节不得回传给前端"


def test_模型配置缺失由依赖层返回503(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    """LLM 未配置时，依赖层直接给 503 LLM_NOT_CONFIGURED，而不是等聊天循环炸出 500。"""

    def _raise_from_env(cls: type[LLMClient]) -> LLMClient:
        raise LLMConfigError(
            "未配置模型密钥：请在 backend/.env 写入 MODELSCOPE_API_KEY（或设置同名环境变量）后重启服务。"
        )

    client.app.dependency_overrides.pop(get_llm_client, None)
    monkeypatch.setattr(LLMClient, "from_env", classmethod(_raise_from_env))

    response = client.post("/api/agent/ask", json=ASK_BODY)
    payload = response.json()

    assert response.status_code == 503
    assert payload["ok"] is False
    assert payload["error"]["code"] == "LLM_NOT_CONFIGURED"
    assert payload["error"]["retryable"] is False
    assert "MODELSCOPE_API_KEY" in payload["error"]["message"]


# ===========================================================================
# 主线四：契约一致性
# ===========================================================================


def test_工具契约_注册表_实现三处一致且统一信封不漂移(
    contracts_dir: Path, toolkit: Any
) -> None:
    """9 个工具名在契约 / 注册表 / 实现三处一致；统一信封字段与成功/失败变体不漂移。"""

    schema = json.loads(
        (contracts_dir / "tools-v1.schema.json").read_text(encoding="utf-8")
    )
    exported_names = [tool["name"] for tool in schema["tools"]]

    assert len(exported_names) == 9, "工具契约基线是 9 个只读工具"
    assert (
        exported_names
        == list(TOOL_NAMES)
        == [tool["name"] for tool in TOOLS]
        == list(SPECS)
    )
    assert set(TOOL_FUNCTIONS) == set(TOOL_NAMES) == set(SPECS)
    assert ToolRegistry(toolkit).tool_names == TOOL_NAMES

    assert schema["version"] == SCHEMA_VERSION
    assert schema["x-output-envelope"] == "ToolResult"
    expected_envelope_fields = {
        "ok",
        "tool",
        "data",
        "error",
        "meta",
        "items",
        "citations",
        "truncated",
        "snapshot_version",
    }
    for tool in schema["tools"]:
        variants = tool["output"]["oneOf"]
        assert len(variants) == 2, f"{tool['name']} 输出契约必须区分成功 / 失败变体"
        success, failure = variants
        assert set(success["required"]) == expected_envelope_fields
        assert set(failure["required"]) == expected_envelope_fields
        assert success["properties"]["ok"]["const"] is True
        assert failure["properties"]["ok"]["const"] is False
        assert success["properties"]["tool"]["const"] == tool["name"]
        assert success["properties"]["error"] == {"type": "null"}
        assert failure["properties"]["data"] == {"type": "null"}
        assert failure["properties"]["error"]["type"] == "object"


def test_动作类型_可用性与导出物一致(contracts_dir: Path) -> None:
    """动作枚举 / 可用性 / surface 与 exports（schema + 人工 policy）三方一致。"""

    schema = json.loads(
        (contracts_dir / "actions-v1.schema.json").read_text(encoding="utf-8")
    )
    policy = json.loads(
        (contracts_dir / "action-policy.json").read_text(encoding="utf-8")
    )

    assert schema["version"] == SCHEMA_VERSION
    assert schema["x-action-types"] == [action.value for action in UIActionType]
    assert set(schema["x-surfaces"]) == {surface.value for surface in UISurface}

    exported_available = {
        action
        for action, availability in schema["x-availability"].items()
        if availability == "available"
    }
    exported_planned = {
        action
        for action, availability in schema["x-availability"].items()
        if availability == "planned"
    }
    assert exported_available == {action.value for action in V1_AVAILABLE_ACTIONS}
    assert exported_planned == {action.value for action in V1_PLANNED_ACTIONS}

    expected_surfaces = {
        action.value: (
            ACTION_SURFACE[action].value if ACTION_SURFACE[action] is not None else None
        )
        for action in UIActionType
    }
    assert schema["x-action-surface"] == expected_surfaces

    assert set(policy["actions"]) == set(schema["x-action-types"])
    assert set(policy["surfaces"]) == set(schema["x-surfaces"])
    for action, entry in policy["actions"].items():
        assert entry["availability"] == schema["x-availability"][action]
        if entry["surface"] is not None:
            assert entry["surface"] == schema["x-action-surface"][action]


def test_契约版本与实现版本各自一致且解耦(
    contracts_dir: Path, client: TestClient
) -> None:
    """冻结 OpenAPI 的 info.version 跟 SCHEMA_VERSION；实现版本跟 API_VERSION / APP_VERSION。"""

    spec = json.loads(
        (contracts_dir / "api-v1.openapi.json").read_text(encoding="utf-8")
    )

    assert SCHEMA_VERSION == "1.0"
    assert spec["info"]["version"] == SCHEMA_VERSION, (
        "契约生成物 info.version 冻结为 1.0（README §3.3），不跟随 API_VERSION"
    )
    assert API_VERSION == APP_VERSION
    assert API_VERSION.startswith("1.0.8"), f"当前实现版本基线异常：{API_VERSION}"
    assert AnswerEnvelope.model_fields["schema_version"].default == SCHEMA_VERSION
    assert ModelsResponse.model_fields["api_version"].default == API_VERSION

    health = client.get("/api/health").json()
    meta = client.get("/api/meta").json()
    models = client.get("/api/agent/models").json()
    assert health["version"] == APP_VERSION
    assert meta["schema_version"] == SCHEMA_VERSION
    assert meta["api_version"] == API_VERSION
    assert models["schema_version"] == SCHEMA_VERSION
    assert models["api_version"] == API_VERSION
    assert client.app.openapi()["info"]["version"] == APP_VERSION, (
        "运行中 FastAPI 的 OpenAPI 版本跟 APP_VERSION；与冻结契约的解耦是既定规则"
    )


def test_错误码_路径与Agent响应字段基线不漂移(
    contracts_dir: Path,
    client: TestClient,
    openapi_spec: dict[str, Any],
    install_llm: Any,
) -> None:
    """错误码枚举、11 条冻结路径、运行实现路径差异与 AnswerEnvelope 字段均不得漂移。"""

    spec = json.loads(
        (contracts_dir / "api-v1.openapi.json").read_text(encoding="utf-8")
    )
    error_codes = {code.value for code in ErrorCode}
    assert len(error_codes) == 14, "错误码是冻结枚举，新增必须同步契约测试"
    assert set(spec["components"]["schemas"]["ErrorCode"]["enum"]) == error_codes
    for required_code in (
        "LLM_TIMEOUT",
        "LLM_UPSTREAM_ERROR",
        "LLM_NOT_CONFIGURED",
        "INVALID_REQUEST",
        "ROUTE_NOT_FOUND",
        "SNAPSHOT_NOT_LOADED",
        "SESSION_NOT_FOUND",
    ):
        assert required_code in error_codes

    expected_paths = {
        "/api/health",
        "/api/meta",
        "/api/entities/person/{person_id}",
        "/api/entities/event/{event_id}",
        "/api/entities/persons",
        "/api/search/events",
        "/api/agent/models",
        "/api/agent/ping_llm",
        "/api/agent/ask",
        # V1.0.6：会话管理（多轮记忆 / 前端历史记录真实持久化）。
        "/api/sessions",
        "/api/sessions/{session_id}",
        # V1.0.6.2：本地 OpenAI 兼容模型流式直答（SSE）。
        "/api/agent/chat_stream",
        # V1.0.8：点赞计数（GET 读取 / POST +1）。
        "/api/likes",
    }
    assert set(spec["paths"]) == expected_paths
    assert len(expected_paths) == 13
    expected_methods = {
        "/api/agent/ask": {"post"},
        "/api/agent/chat_stream": {"post"},
        "/api/sessions": {"get", "post"},
        "/api/sessions/{session_id}": {"get", "patch", "delete"},
        "/api/likes": {"get", "post"},
    }
    for path, path_item in spec["paths"].items():
        methods = {
            method
            for method in path_item
            if method in {"get", "post", "put", "patch", "delete"}
        }
        assert methods == expected_methods.get(path, {"get"}), path

    live_paths = set(client.app.openapi()["paths"])
    assert live_paths <= expected_paths, "运行实现不得暴露契约外路径"
    # 已知 gap：/api/search/events 只在契约桩中声明，运行实现尚未挂载（见最终报告）。
    assert expected_paths - live_paths == {"/api/search/events"}, (
        "运行实现与冻结 OpenAPI 的路径差异应仅剩已知 gap /api/search/events"
    )

    install_llm(
        FakeLLM(
            [
                tool_call_step("get_event", {"event_id": CHIBI_EVENT}),
                final_step(grounded_answer(citation_ids=[CHIBI_CITATION])),
            ],
            model=PRIMARY_MODEL,
        )
    )
    response = client.post("/api/agent/ask", json=ASK_BODY)
    payload = response.json()

    assert response.status_code == 200
    jsonschema.Draft202012Validator(
        {**openapi_spec, "$ref": "#/components/schemas/AnswerEnvelope"}
    ).validate(payload)
    assert set(payload) == set(AnswerEnvelope.model_fields)
    assert set(payload["trace"]) == set(Trace.model_fields)
    assert set(payload["answer"]) == set(Answer.model_fields)
    assert payload["schema_version"] == SCHEMA_VERSION
    assert payload["trace"]["model"] == PRIMARY_MODEL
    assert payload["trace"]["model_used"] == PRIMARY_MODEL
    assert payload["trace"]["model_requested"] is None
    assert set(payload["trace"]["sources"]) == {"timeline", "graph"}
    assert payload["trace"]["sources"]["timeline"] is True
    assert set(payload["trace"]["tools"][0]) == {"name", "args", "hits", "ms"}
