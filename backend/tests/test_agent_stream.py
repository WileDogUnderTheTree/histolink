"""`POST /api/agent/chat_stream` SSE 端点测试（V1.0.6.2，全离线）。

覆盖：
- 正常流：start → delta* → done；`text/event-stream`；思考内容不下发；
- 成功后写入会话库（V1.0.8：命中实体的直答把 `ui_actions` 一起持久化，
  刷新后历史消息仍能重建联动按钮；无动作时按普通 Markdown 恢复）；
- 流中错误（LLMUpstreamError）→ error 事件（HTTP 仍是 200）；
- 参数 / 模型白名单 / 开关类错误在响应开始前返回统一错误信封；
- 首次请求把客户端 history 迁移进服务端会话（与 /api/agent/ask 语义一致）；
- V1.0.8 Prompt 兜底：开头「用户未提供……无法直接列举」推诿句被确定性删除。
"""

from __future__ import annotations

import json
from types import SimpleNamespace
from typing import Any

import pytest
from fastapi.testclient import TestClient

from llm_client import LLMUpstreamError
from llm_stream import StreamEvent
from routers.deps import get_stream_chat_client

STREAM_BODY = {
    "question": "赤壁之战发生在哪一年？",
    "session_id": "stream-session-1",
}


class FakeStreamClient:
    """假流式客户端：记录收到的 messages / enable_thinking，按脚本 yield 事件 / 抛错。"""

    def __init__(
        self,
        events: list[StreamEvent] | None = None,
        *,
        error: Exception | None = None,
    ) -> None:
        self.settings = SimpleNamespace(
            model="hf.co/mradermacher/XiaoHong-v1-GGUF:Q4_K_M",
            system_prompt="TEST SYSTEM PROMPT",
        )
        self.events = events or []
        self.error = error
        self.calls: list[dict[str, Any]] = []

    def stream(
        self,
        messages: list[dict[str, str]],
        *,
        model: str | None = None,
        enable_thinking: bool = False,
    ):
        self.calls.append(
            {
                "messages": messages,
                "model": model,
                "enable_thinking": enable_thinking,
            }
        )
        yield from self.events
        if self.error is not None:
            raise self.error


@pytest.fixture
def override_stream(client: TestClient):
    def _install(fake: FakeStreamClient) -> FakeStreamClient:
        client.app.dependency_overrides[get_stream_chat_client] = lambda: fake
        return fake

    yield _install
    client.app.dependency_overrides.pop(get_stream_chat_client, None)


def _parse_sse(lines: list[str]) -> list[dict[str, Any]]:
    events: list[dict[str, Any]] = []
    for line in lines:
        if not line or not line.startswith("data: "):
            continue
        events.append(json.loads(line[len("data: ") :]))
    return events


def _collect_stream(
    client: TestClient, body: dict[str, Any]
) -> tuple[Any, list[dict[str, Any]]]:
    with client.stream("POST", "/api/agent/chat_stream", json=body) as response:
        events = _parse_sse(list(response.iter_lines()))
        return response, events


def test_chat_stream_emits_deltas_and_done(client: TestClient, override_stream) -> None:
    fake = override_stream(
        FakeStreamClient(
            [
                StreamEvent(type="delta", text="赤壁之战"),
                StreamEvent(type="delta", text="发生在公元 208 年。"),
                StreamEvent(
                    type="done",
                    answer="赤壁之战发生在公元 208 年。",
                    model="hf.co/mradermacher/XiaoHong-v1-GGUF:Q4_K_M",
                    latency_ms=1234,
                    first_token_ms=320,
                    reasoning_chars=87,
                    filtered_chars=95,
                ),
            ]
        )
    )
    response, events = _collect_stream(client, STREAM_BODY)

    assert response.status_code == 200
    assert response.headers["content-type"].startswith("text/event-stream")
    assert [event["type"] for event in events] == ["start", "delta", "delta", "done"]
    assert events[0]["session_id"] == "stream-session-1"
    assert events[1]["text"] == "赤壁之战"
    done = events[-1]
    assert done["answer"] == "赤壁之战发生在公元 208 年。"
    assert done["reasoning_chars"] == 87
    assert "request_id" in done
    # 思考内容绝不下发（只有字符数观测）。
    assert "87" not in json.dumps(events[1:3], ensure_ascii=False)
    # 模型名与系统提示词来自依赖客户端。
    assert fake.calls[0]["model"] == "hf.co/mradermacher/XiaoHong-v1-GGUF:Q4_K_M"
    assert fake.calls[0]["messages"][0] == {
        "role": "system",
        "content": "TEST SYSTEM PROMPT",
    }
    # V1.0.6.2：默认不开启深度思考。
    assert fake.calls[0]["enable_thinking"] is False
    assert events[0]["enable_thinking"] is False
    assert done["enable_thinking"] is False
    assert done["thinking_fallback"] is False


def test_chat_stream_persists_ui_actions_for_refresh(
    client: TestClient, override_stream
) -> None:
    """V1.0.8 Bug 1：直答轮次的 ui_actions 必须跟着消息一起落库。

    刷新页面后前端 `GET /api/sessions/{id}` 能拿回 `ui_actions`，从而重建历史消息
    底部的「展开图谱 / 时间轴」按钮并再次拉起右侧史引面板。
    """

    answer = "赤壁之战发生在公元 208 年。"
    override_stream(
        FakeStreamClient(
            [StreamEvent(type="done", answer=answer, model="m", latency_ms=10)]
        )
    )
    _response, events = _collect_stream(
        client, {**STREAM_BODY, "session_id": "stream-persist-actions"}
    )
    done_actions = events[-1]["ui_actions"]
    assert done_actions, "命中快照事件的直答必须下发 UI 动作"

    detail = client.get("/api/sessions/stream-persist-actions")
    assert detail.status_code == 200
    payload = detail.json()
    turns = payload["session"]["turns"]
    assert [turn["role"] for turn in turns] == ["user", "assistant"]
    assert turns[0]["content"] == STREAM_BODY["question"]
    assert turns[1]["content"] == answer
    stored = turns[1]["answer"]
    assert stored is not None
    # ui_actions 随消息持久化（刷新后可恢复深链接按钮）。
    assert stored["ui_actions"] == done_actions
    assert stored["answer"]["markdown"] == answer
    assert stored["answer"]["mode"] == "grounded"
    assert stored["streamed"] is True
    assert stored["request_id"] == events[-1]["request_id"]


def test_chat_stream_persists_plain_markdown_without_actions(
    client: TestClient, override_stream
) -> None:
    """没有联动动作的直答仍按纯 Markdown 消息恢复（不伪造结构化回答外观）。"""

    answer = "这个问题与历史无关。"
    override_stream(
        FakeStreamClient([StreamEvent(type="done", answer=answer, model="m")])
    )
    _collect_stream(
        client,
        {"question": "今天天气怎么样？", "session_id": "stream-persist-plain"},
    )

    detail = client.get("/api/sessions/stream-persist-plain")
    turns = detail.json()["session"]["turns"]
    assert turns[1]["content"] == answer
    assert turns[1]["answer"] is None


def test_chat_stream_error_event_keeps_http_200(
    client: TestClient, override_stream
) -> None:
    override_stream(
        FakeStreamClient(
            [StreamEvent(type="delta", text="半截")],
            error=LLMUpstreamError(
                "上游返回 HTTP 500：boom", upstream_status=500, retryable=True
            ),
        )
    )
    response, events = _collect_stream(client, STREAM_BODY)

    assert response.status_code == 200
    assert events[0]["type"] == "start"
    error = events[-1]
    assert error["type"] == "error"
    assert error["code"] == "LLM_UPSTREAM_ERROR"
    assert error["retryable"] is True
    assert error["message"] == "上游返回 HTTP 500：boom"
    assert "done" not in [event["type"] for event in events]


def test_chat_stream_rejects_unknown_model(client: TestClient, override_stream) -> None:
    override_stream(FakeStreamClient([]))
    response = client.post(
        "/api/agent/chat_stream",
        json={**STREAM_BODY, "model_id": "Qwen/Not-A-Real-Model"},
    )
    assert response.status_code == 400
    payload = response.json()
    assert payload["ok"] is False
    assert payload["error"]["code"] == "INVALID_REQUEST"
    assert "未知模型" in payload["error"]["message"]


def test_chat_stream_can_be_disabled(
    client: TestClient, override_stream, monkeypatch: pytest.MonkeyPatch
) -> None:
    override_stream(FakeStreamClient([]))
    monkeypatch.setenv("ENABLE_STREAM_CHAT", "0")
    response = client.post("/api/agent/chat_stream", json=STREAM_BODY)
    assert response.status_code == 404
    payload = response.json()
    assert payload["ok"] is False
    assert payload["error"]["code"] == "ROUTE_NOT_FOUND"


def test_chat_stream_rejects_empty_question(
    client: TestClient, override_stream
) -> None:
    override_stream(FakeStreamClient([]))
    response = client.post(
        "/api/agent/chat_stream", json={"question": "  ", "session_id": "s-1"}
    )
    assert response.status_code == 400
    assert response.json()["error"]["code"] == "INVALID_REQUEST"


def test_chat_stream_bootstraps_client_history(
    client: TestClient, override_stream
) -> None:
    fake = override_stream(
        FakeStreamClient([StreamEvent(type="done", answer="答案", model="m")])
    )
    body = {
        "question": "那它和官渡之战有什么关系？",
        "session_id": "stream-history-1",
        "history": [
            {"role": "user", "content": "赤壁之战是哪一年？"},
            {"role": "assistant", "content": "公元 208 年。"},
        ],
    }
    _collect_stream(client, body)
    messages = fake.calls[0]["messages"]
    assert messages[0]["role"] == "system"
    assert messages[1:] == [
        {"role": "user", "content": "赤壁之战是哪一年？"},
        {"role": "assistant", "content": "公元 208 年。"},
        {"role": "user", "content": "那它和官渡之战有什么关系？"},
    ]


# ---------------------------------------------------------------------------
# V1.0.6.2 专项修复：意图后置推断 + 重复输出治理
# ---------------------------------------------------------------------------


def test_chat_stream_done_includes_inferred_ui_actions(
    client: TestClient, override_stream
) -> None:
    """直答链路没有工具调用：done 事件必须由服务端补上推断的 UI 动作（痛点 1）。"""

    override_stream(
        FakeStreamClient(
            [
                StreamEvent(
                    type="done",
                    answer="赤壁之战发生在建安十三年（208年）。",
                    model="m",
                )
            ]
        )
    )
    _response, events = _collect_stream(
        client, {**STREAM_BODY, "session_id": "stream-actions-1"}
    )
    done = events[-1]

    assert done["type"] == "done"
    actions = done["ui_actions"]
    assert actions, "命中快照事件的直答必须下发 UI 动作"
    assert actions[0]["type"] == "timeline.focus_event"
    assert actions[0]["payload"]["event_id"] == "handong-chibi"
    assert actions[0]["target"]["surface"] == "timeline"
    assert actions[0]["label"] == "在时间轴中查看"


def test_chat_stream_done_has_no_actions_for_unmatched_question(
    client: TestClient, override_stream
) -> None:
    override_stream(
        FakeStreamClient(
            [StreamEvent(type="done", answer="这个问题与历史无关。", model="m")]
        )
    )
    _response, events = _collect_stream(
        client,
        {"question": "今天天气怎么样？", "session_id": "stream-actions-none"},
    )
    assert events[-1]["ui_actions"] == []


def test_chat_stream_sanitizes_repeated_answer(
    client: TestClient, override_stream
) -> None:
    """注入的客户端返回重复正文时，done 与落库内容都必须只有一份事实（痛点 2）。"""

    repeated = (
        "淝水之战中，前秦的统帅是苻坚，击败前秦的是东晋名臣谢安。\n\n"
        "淝水之战中，前秦的统帅是苻坚，击败前秦的是东晋名臣谢安。\n\n"
        "1. 依据一：苻坚亲征东晋，但被谢安、谢玄击败。"
    )
    override_stream(
        FakeStreamClient([StreamEvent(type="done", answer=repeated, model="m")])
    )
    _response, events = _collect_stream(
        client, {**STREAM_BODY, "session_id": "stream-dedupe-1"}
    )
    done = events[-1]

    assert done["answer"].count("击败前秦的是东晋名臣谢安") == 1
    assert done["deduped_chars"] > 0

    detail = client.get("/api/sessions/stream-dedupe-1")
    turns = detail.json()["session"]["turns"]
    assert turns[1]["content"] == done["answer"]


# ---------------------------------------------------------------------------
# V1.0.8：Prompt 优化 —— 删除「用户未提供……无法直接列举」这类自相矛盾推诿开场白
# ---------------------------------------------------------------------------


def test_chat_stream_strips_false_refusal_preamble(
    client: TestClient, override_stream
) -> None:
    """模型开头说「无法直接列举」、紧接着又列举战役时：服务端删掉开头废话。"""

    contradictory = (
        "用户未提供具体战役名称，无法直接列举。\n\n"
        "韩信参与的主要战役包括：\n"
        "1. 破魏之战（前205年）；\n"
        "2. 井陉之战（前204年）；\n"
        "3. 潍水之战（前203年）；\n"
        "4. 垓下之战（前202年）。"
    )
    override_stream(
        FakeStreamClient([StreamEvent(type="done", answer=contradictory, model="m")])
    )
    _response, events = _collect_stream(
        client,
        {"question": "韩信打过什么仗？", "session_id": "stream-refusal-preamble"},
    )
    done = events[-1]

    assert "用户未提供" not in done["answer"]
    assert "无法直接列举" not in done["answer"]
    assert "韩信参与的主要战役" in done["answer"]
    assert done["refusal_removed_chars"] > 0
    # 落库正文同样是清洗后的内容（刷新后不会又冒出推诿句）。
    detail = client.get("/api/sessions/stream-refusal-preamble")
    assert detail.json()["session"]["turns"][1]["content"] == done["answer"]


def test_chat_stream_keeps_pure_refusal_answer(
    client: TestClient, override_stream
) -> None:
    """整段都只有推诿句（确实没有答案）时不得清空回答。"""

    refusal = "用户未提供具体信息，无法直接回答。"
    override_stream(
        FakeStreamClient([StreamEvent(type="done", answer=refusal, model="m")])
    )
    _response, events = _collect_stream(
        client,
        {"question": "某个不存在的问题", "session_id": "stream-refusal-only"},
    )
    assert events[-1]["answer"] == refusal
    assert events[-1].get("refusal_removed_chars") is None


# ---------------------------------------------------------------------------
# V1.0.6.2 深度思考开关（默认关闭 / 开启透传 / 只思考时自动回退）
# ---------------------------------------------------------------------------


def test_chat_stream_passes_enable_thinking_flag(
    client: TestClient, override_stream
) -> None:
    """开启深度思考：请求透传 enable_thinking=True + Prompt 追加推理约束。"""

    fake = override_stream(
        FakeStreamClient(
            [
                StreamEvent(
                    type="done",
                    answer="赤壁之战发生在建安十三年（208年）。",
                    model="m",
                    reasoning_chars=42,
                )
            ]
        )
    )
    _response, events = _collect_stream(
        client,
        {
            **STREAM_BODY,
            "session_id": "stream-thinking-1",
            "enable_thinking": True,
        },
    )

    assert fake.calls[0]["enable_thinking"] is True
    system_prompt = fake.calls[0]["messages"][0]["content"]
    assert "深度思考模式" in system_prompt
    assert "不要输出思考过程" in system_prompt
    done = events[-1]
    assert done["type"] == "done"
    assert done["enable_thinking"] is True
    assert done["thinking_fallback"] is False
    # 思考正文仍然不下发，只上报字符数。
    assert done["reasoning_chars"] == 42
    assert "42" not in json.dumps(events[1:-1], ensure_ascii=False)


def test_chat_stream_default_keeps_fast_mode_prompt(
    client: TestClient, override_stream
) -> None:
    fake = override_stream(
        FakeStreamClient([StreamEvent(type="done", answer="答案", model="m")])
    )
    _collect_stream(client, {**STREAM_BODY, "session_id": "stream-fast-1"})
    system_prompt = fake.calls[0]["messages"][0]["content"]
    assert fake.calls[0]["enable_thinking"] is False
    assert "深度思考模式" not in system_prompt


class ThinkingOnlyThenFallbackClient:
    """第一次（思考开启）只产出 reasoning 后报错；第二次（关闭思考）正常回答。"""

    def __init__(self, answer: str = "玄武门之变发生在公元 626 年。") -> None:
        self.settings = SimpleNamespace(
            model="hf.co/mradermacher/XiaoHong-v1-GGUF:Q4_K_M",
            system_prompt="TEST SYSTEM PROMPT",
        )
        self.answer = answer
        self.calls: list[dict[str, Any]] = []

    def stream(
        self,
        messages: list[dict[str, str]],
        *,
        model: str | None = None,
        enable_thinking: bool = False,
    ):
        self.calls.append({"messages": messages, "enable_thinking": enable_thinking})
        if enable_thinking:
            raise LLMUpstreamError(
                "模型只输出了思考内容（reasoning），没有最终答案。"
                "请把 LLM_REASONING_EFFORT 设为 none 后重试。",
                retryable=False,
            )
        yield StreamEvent(type="delta", text=self.answer)
        yield StreamEvent(type="done", answer=self.answer, model="m")


def test_chat_stream_thinking_only_answer_falls_back_without_thinking(
    client: TestClient, override_stream
) -> None:
    """本地模型开启思考后只有 reasoning：自动关闭思考重试一次，用户仍能拿到答案。"""

    fake = ThinkingOnlyThenFallbackClient()
    override_stream(fake)
    _response, events = _collect_stream(
        client,
        {
            "question": "玄武门之变发生在哪一年？",
            "session_id": "stream-thinking-fallback-1",
            "enable_thinking": True,
        },
    )

    assert [call["enable_thinking"] for call in fake.calls] == [True, False]
    assert [event["type"] for event in events] == ["start", "delta", "done"]
    done = events[-1]
    assert done["enable_thinking"] is True
    assert done["thinking_fallback"] is True
    assert done["answer"] == "玄武门之变发生在公元 626 年。"
    # 回退后的一轮仍然写入会话库（用户刷新后能看到完整问答）。
    detail = client.get("/api/sessions/stream-thinking-fallback-1")
    assert detail.status_code == 200
    assert detail.json()["session"]["turns"][1]["content"] == done["answer"]


def test_chat_stream_does_not_retry_after_visible_delta(
    client: TestClient, override_stream
) -> None:
    """已经向浏览器下发过 delta 后不得重试（否则前端会出现两份半截答案）。"""

    class _DeltaThenThinkingOnlyError:
        def __init__(self) -> None:
            self.settings = SimpleNamespace(model="m", system_prompt="SYS")
            self.calls: list[bool] = []

        def stream(self, messages, *, model=None, enable_thinking=False):
            self.calls.append(enable_thinking)
            yield StreamEvent(type="delta", text="半截答案")
            raise LLMUpstreamError(
                "模型只输出了思考内容（reasoning），没有最终答案。", retryable=False
            )

    fake = _DeltaThenThinkingOnlyError()
    override_stream(fake)
    _response, events = _collect_stream(
        client,
        {
            "question": "赤壁之战",
            "session_id": "stream-noretry",
            "enable_thinking": True,
        },
    )

    assert fake.calls == [True]
    assert [event["type"] for event in events] == ["start", "delta", "error"]
    assert "思考内容" in events[-1]["message"]
