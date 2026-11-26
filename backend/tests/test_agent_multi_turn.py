"""V1.0.6 多轮记忆验收测试（离线，不访问网络、不调用真实 LLM）。

对应任务三的两个多轮场景（用 FakeLLM + 真实快照离线复现）：

- 第一轮：「曹操和刘备是什么关系？」→ grounded；服务端把两人的 person_id 写入 SessionStore；
- 第二轮：「他们打过什么仗？」→ 服务端从 SessionStore 取最近历史 + 实体记忆，
  把「他们 → 曹操(p-caocao-b012)、刘备(p-liubei-0c86)」的确定性指代解析注入 Prompt；
  模型据此带 person_id 调用图谱工具 → grounded 回答命中「赤壁之战 / 汉中之战」。

同时覆盖：
- 不同 session 的实体记忆互相隔离（不会把别处的人物当成「他们」）；
- 长对话截断：历史最多 6 条消息进入 Prompt，且不撑爆 LLM 单条消息上限；
- 纯函数：代词检测 / 解析 / Prompt 记忆块。
"""

from __future__ import annotations

import json
from typing import Any

import pytest
from agent_testkit import (
    FakeLLM,
    ask_request,
    final_step,
    insufficient_answer,
    tool_batch_step,
)
from fastapi.testclient import TestClient

from agent.prompts import build_user_message
from agent.session_memory import (
    SessionContext,
    build_session_memory_block,
    detect_reference_cues,
    resolve_references,
)
from contracts.models import AskRequest
from routers.deps import get_llm_client
from session_store import SessionStore

CAO_ID = "p-caocao-b012"
LIU_ID = "p-liubei-0c86"
RELATION_ID = "刘备__曹操"
RELATION_CITATION = "cite-relation-刘备__曹操"
CHIBI_EVENT = "handong-chibi"
CHIBI_CITATION = "cite-handong-chibi-0"
HANZHONG_EVENT = "handong-hanzhongzhizhanxiangfanzhizhanxiqujingzh-08"
HANZHONG_CITATION = "cite-handong-hanzhongzhizhanxiangfanzhizhanxiqujingzh-08-0"
SESSION_ID = "session-multiturn-sanguo"

FIRST_QUESTION = "曹操和刘备是什么关系？"
SECOND_QUESTION = "他们打过什么仗？"

# tool_batch 每批最多 4 个调用：第 1 批解析两人，第 2 批一次性取关系 / 两人详情 / 事件详情。
FIRST_TURN_SCRIPT: list[str] = [
    tool_batch_step(
        [
            {"tool": "resolve_entity", "arguments": {"query": "曹操"}},
            {"tool": "resolve_entity", "arguments": {"query": "刘备"}},
        ]
    ),
    tool_batch_step(
        [
            {
                "tool": "get_relation",
                "arguments": {"person_id_a": CAO_ID, "person_id_b": LIU_ID},
            },
            {"tool": "get_person", "arguments": {"person_id": CAO_ID}},
            {"tool": "get_person", "arguments": {"person_id": LIU_ID}},
            {"tool": "get_event", "arguments": {"event_id": CHIBI_EVENT}},
        ]
    ),
    final_step(
        {
            "mode": "grounded",
            "claims": [
                {"id": "c1", "citation_ids": [RELATION_CITATION]},
                {"id": "c2", "citation_ids": [CHIBI_CITATION]},
            ],
            "evidence": [
                {"entity_type": "person", "entity_id": CAO_ID},
                {"entity_type": "person", "entity_id": LIU_ID},
                {"entity_type": "relation", "entity_id": RELATION_ID},
                {"entity_type": "event", "entity_id": CHIBI_EVENT},
            ],
            "related_event_ids": [],
            "missing_reasons": [],
            "reason_code": None,
            "ui_actions": [],
        }
    ),
]

# 第二轮模拟「模型看到指代解析后」的正确行为：带 person_id 查两人事件 + 人物详情，
# 再取赤壁 / 汉中两个事件详情，最后 grounded。
SECOND_TURN_SCRIPT: list[str] = [
    tool_batch_step(
        [
            {
                "tool": "get_person_events",
                "arguments": {"person_id": CAO_ID, "limit": 20},
            },
            {
                "tool": "get_person_events",
                "arguments": {"person_id": LIU_ID, "limit": 20},
            },
            {"tool": "get_person", "arguments": {"person_id": CAO_ID}},
            {"tool": "get_person", "arguments": {"person_id": LIU_ID}},
        ]
    ),
    tool_batch_step(
        [
            {"tool": "get_event", "arguments": {"event_id": CHIBI_EVENT}},
            {"tool": "get_event", "arguments": {"event_id": HANZHONG_EVENT}},
        ]
    ),
    final_step(
        {
            "mode": "grounded",
            "claims": [
                {"id": "c1", "citation_ids": [CHIBI_CITATION]},
                {"id": "c2", "citation_ids": [HANZHONG_CITATION]},
            ],
            "evidence": [
                {"entity_type": "event", "entity_id": CHIBI_EVENT},
                {"entity_type": "event", "entity_id": HANZHONG_EVENT},
                {"entity_type": "person", "entity_id": CAO_ID},
                {"entity_type": "person", "entity_id": LIU_ID},
            ],
            "related_event_ids": [],
            "missing_reasons": [],
            "reason_code": None,
            "ui_actions": [],
        }
    ),
]

ASK_CONTEXT = {"route": "/graph"}


@pytest.fixture
def install_llm(client: TestClient):
    """按轮次安装 FakeLLM（依赖覆盖），用例结束后恢复。"""

    def _install(fake: FakeLLM) -> FakeLLM:
        client.app.dependency_overrides[get_llm_client] = lambda: fake
        return fake

    yield _install
    client.app.dependency_overrides.pop(get_llm_client, None)


# ---------------------------------------------------------------------------
# 纯函数：代词检测 / 解析 / Prompt 记忆块
# ---------------------------------------------------------------------------


def test_代词线索检测() -> None:
    assert detect_reference_cues("他们打过什么仗？") == ["他们"]
    assert detect_reference_cues("这两人是什么关系") == ["这两人"]
    assert detect_reference_cues("双方有什么恩怨") == ["双方"]
    assert detect_reference_cues("他后来怎么样了") == ["他"]
    assert detect_reference_cues("其他人都打过什么仗？") == [], "「其他」不是代词"
    assert detect_reference_cues("曹操和刘备是什么关系") == [], "没有代词时不得猜测"


def test_代词解析_复数取最近两位_单数取最近一位() -> None:
    memory = {
        "person_ids": [CAO_ID, LIU_ID, "p-sunquan-19a7"],
        "person_names": {CAO_ID: "曹操", LIU_ID: "刘备", "p-sunquan-19a7": "孙权"},
    }
    plural = resolve_references("他们打过什么仗？", memory)
    assert len(plural) == 1
    assert plural[0].cue == "他们"
    assert plural[0].plural is True
    assert [person.person_id for person in plural[0].persons] == [CAO_ID, LIU_ID]
    assert [person.name for person in plural[0].persons] == ["曹操", "刘备"]

    singular = resolve_references("他后来怎么样了？", memory)
    assert singular[0].plural is False
    assert [person.person_id for person in singular[0].persons] == [CAO_ID]

    assert resolve_references("他们打过什么仗？", None) == [], "无实体记忆时不解析"


def test_会话实体记忆块_包含ID与指代解析() -> None:
    memory = {
        "person_ids": [CAO_ID, LIU_ID],
        "person_names": {CAO_ID: "曹操", LIU_ID: "刘备"},
        "event_ids": [CHIBI_EVENT],
    }
    block = build_session_memory_block(SECOND_QUESTION, memory)
    assert block is not None
    assert "多轮会话实体记忆" in block
    assert f"person_id={CAO_ID}" in block
    assert f"person_id={LIU_ID}" in block
    assert "「他们」" in block
    assert "get_relation" in block and "get_person_events" in block
    # 没有实体记忆时不注入，保持单轮请求的消息结构。
    assert build_session_memory_block(SECOND_QUESTION, None) is None


def test_build_user_message_追加记忆块在问题之后() -> None:
    request = AskRequest.model_validate(
        {
            "question": SECOND_QUESTION,
            "session_id": "s1",
            "context": {"route": "/graph"},
        }
    )
    block = build_session_memory_block(
        SECOND_QUESTION,
        {"person_ids": [CAO_ID], "person_names": {CAO_ID: "曹操"}},
    )
    message = build_user_message(request, entity_memory_block=block)
    assert SECOND_QUESTION in message
    assert message.index("多轮会话实体记忆") > message.index(SECOND_QUESTION)


# ---------------------------------------------------------------------------
# 核心验收：两轮连续追问（曹操 / 刘备 → 他们打过什么仗）
# ---------------------------------------------------------------------------


def test_多轮追问_他们解析为曹操刘备并检索到赤壁与汉中(
    client: TestClient,
    install_llm: Any,
) -> None:
    # ---------- 第一轮：曹操和刘备是什么关系？ ----------
    install_llm(FakeLLM(FIRST_TURN_SCRIPT, model="fake-qwen"))
    first = client.post(
        "/api/agent/ask",
        json={
            "question": FIRST_QUESTION,
            "session_id": SESSION_ID,
            "context": ASK_CONTEXT,
        },
    )
    assert first.status_code == 200
    first_payload = first.json()
    assert first_payload["ok"] is True
    assert first_payload["answer"]["mode"] == "grounded", json.dumps(
        first_payload["answer"], ensure_ascii=False
    )

    # 服务端把两人 person_id 记进会话实体状态（顺序 = 证据出现顺序，主体两人排最前）。
    session_detail = client.get(f"/api/sessions/{SESSION_ID}").json()["session"]
    memory = session_detail["entity_memory"]
    assert memory["person_ids"][:2] == [CAO_ID, LIU_ID], (
        f"「他们」必须优先解析为曹操、刘备，实际：{memory['person_ids']}"
    )
    assert memory["person_names"][CAO_ID] == "曹操"
    assert memory["person_names"][LIU_ID] == "刘备"
    assert len(memory["person_ids"]) <= 8
    assert CHIBI_EVENT in memory["event_ids"]
    assert session_detail["turn_count"] == 2

    # ---------- 第二轮：他们打过什么仗？ ----------
    second_fake = install_llm(FakeLLM(SECOND_TURN_SCRIPT, model="fake-qwen"))
    second = client.post(
        "/api/agent/ask",
        json={
            "question": SECOND_QUESTION,
            "session_id": SESSION_ID,
            "context": ASK_CONTEXT,
        },
    )
    assert second.status_code == 200
    second_payload = second.json()
    assert second_payload["answer"]["mode"] == "grounded", json.dumps(
        second_payload["answer"], ensure_ascii=False
    )

    # Prompt 证据 1：上一轮历史按顺序注入（多轮上下文生效）。
    second_messages = second_fake.calls[0]["messages"]
    contents = [message["content"] for message in second_messages]
    assert FIRST_QUESTION in contents
    assert any("对手" in content or "赤壁" in content for content in contents), (
        "上一轮 assistant 回答必须进入历史消息"
    )
    # Prompt 证据 2：代词解析块写进本轮 user message，并带两个真实 person_id。
    current_user_message = contents[-1]
    assert "多轮会话实体记忆" in current_user_message
    assert "指代解析" in current_user_message
    assert "「他们」" in current_user_message
    assert f"person_id={CAO_ID}" in current_user_message
    assert f"person_id={LIU_ID}" in current_user_message

    # 工具证据：模型确实带着解析后的 person_id 查询了图谱。
    first_round_calls = [
        call
        for call in second_payload["trace"]["tools"]
        if call["name"] == "get_person_events"
    ]
    assert [call["args"]["person_id"] for call in first_round_calls] == [CAO_ID, LIU_ID]

    # 答案证据：命中了赤壁之战 / 汉中之战（验收要求的两个战役）。
    markdown = second_payload["answer"]["markdown"]
    assert "赤壁之战" in markdown
    assert "汉中之战" in markdown
    event_ids = {
        citation["event_id"]
        for citation in second_payload["citations"]
        if citation.get("event_id")
    }
    assert CHIBI_EVENT in event_ids
    assert HANZHONG_EVENT in event_ids
    assert second_payload["trace"]["sources"] == {"timeline": True, "graph": True}

    # ---------- 会话持久化：4 条消息 + 实体记忆跨轮更新 ----------
    detail = client.get(f"/api/sessions/{SESSION_ID}").json()["session"]
    assert detail["turn_count"] == 4
    assert [turn["role"] for turn in detail["turns"]] == [
        "user",
        "assistant",
        "user",
        "assistant",
    ]
    assert detail["turns"][0]["content"] == FIRST_QUESTION
    assert detail["turns"][2]["content"] == SECOND_QUESTION
    assert detail["turns"][2]["answer"] is None
    assert detail["turns"][3]["answer"]["answer"]["mode"] == "grounded"
    # 实体记忆仍以最近一轮人物为主，且最近事件排前面。
    assert detail["entity_memory"]["person_ids"][:2] == [CAO_ID, LIU_ID]
    assert detail["entity_memory"]["event_ids"][0] == CHIBI_EVENT


def test_不同会话的实体记忆互相隔离(client: TestClient, install_llm: Any) -> None:
    """另一个 session 问「他们」时不得复用别的会话里的人物。"""

    install_llm(FakeLLM(FIRST_TURN_SCRIPT, model="fake-qwen"))
    assert (
        client.post(
            "/api/agent/ask",
            json={
                "question": FIRST_QUESTION,
                "session_id": SESSION_ID,
                "context": ASK_CONTEXT,
            },
        ).status_code
        == 200
    )

    fake = install_llm(
        FakeLLM([final_step(insufficient_answer(["NO_MATCHING_ENTITY"]))])
    )
    response = client.post(
        "/api/agent/ask",
        json={
            "question": SECOND_QUESTION,
            "session_id": "session-other-user",
            "context": ASK_CONTEXT,
        },
    )
    assert response.status_code == 200
    other_messages = [message["content"] for message in fake.calls[0]["messages"]]
    current_user_message = other_messages[-1]
    assert "多轮会话实体记忆" not in current_user_message
    assert "指代解析" not in current_user_message
    assert not any(CAO_ID in content for content in other_messages), (
        "会话 A 的曹操 ID 不得泄漏到会话 B 的 Prompt"
    )
    assert not any(FIRST_QUESTION in content for content in other_messages)


# ---------------------------------------------------------------------------
# 长对话截断
# ---------------------------------------------------------------------------


def test_长对话截断_只注入最近六条消息且不撑爆上下文(store: Any) -> None:
    """20 条历史（10 轮）→ 只保留最近 6 条进入 Prompt，System Prompt 始终保留。"""

    memory_store = SessionStore(":memory:")
    try:
        for index in range(10):
            # 最后一轮的回答故意写得很长：验证单条历史消息也会被截断。
            answer_padding = 5000 if index == 9 else 300
            memory_store.append_exchange(
                "session-long",
                question=f"第 {index} 轮问题：" + "问" * 200,
                answer_markdown=f"第 {index} 轮回答：" + "答" * answer_padding,
            )
        context = SessionContext.from_store(memory_store, "session-long")
        assert len(context.history) == 6, "历史只保留最近 6 条消息（3 轮）"
        assert all(len(message["content"]) <= 1300 for message in context.history), (
            "单条历史消息必须被截断到安全长度"
        )

        fake = FakeLLM([final_step(insufficient_answer(["INSUFFICIENT_DATA"]))])
        from agent.orchestrator import AgentOrchestrator

        result = AgentOrchestrator(store, fake).run(
            ask_request("他们后来怎么样了？", route="/graph"),
            session_context=context,
        )
        messages = fake.calls[0]["messages"]
        assert messages[0]["role"] == "system"
        assert len(messages) == 2 + 6, "system + 最近 6 条历史 + 当前问题"
        assert messages[-1]["role"] == "user"
        # 最早的几轮已被截断，不会进入本轮 Prompt。
        assert not any("第 0 轮问题" in message["content"] for message in messages)
        assert result.answer.mode == "insufficient"
    finally:
        memory_store.close()


def test_无会话记忆时消息结构与单轮一致(store: Any) -> None:
    """没有 SessionContext / 记忆时，Orchestrator 维持单轮请求结构（向后兼容）。"""

    fake = FakeLLM([final_step(insufficient_answer(["INSUFFICIENT_DATA"]))])
    from agent.orchestrator import AgentOrchestrator

    AgentOrchestrator(store, fake).run(ask_request("赤壁之战发生在哪一年？"))
    messages = fake.calls[0]["messages"]
    assert len(messages) == 2
    assert "多轮会话实体记忆" not in messages[-1]["content"]
