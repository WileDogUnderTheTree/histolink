"""Agent 图谱 + RAG 混合路由测试（V1.0.5）。

离线：FakeLLM 按脚本输出，RAG 工具用 fake store（不读真实 chromadb），图谱工具读真实快照。
覆盖两条验收路径：
1. 「商鞅变法为什么能成功？」→ 先图谱、再 RAG、最终 ① ② 分节 grounded；
2. 「秦始皇吃过西红柿吗？」→ 图谱与 RAG 都查无 → 老实返回 insufficient。
"""

from __future__ import annotations

from typing import Any

import pytest
from agent_testkit import (
    FakeLLM,
    ask_request,
    final_step,
    insufficient_answer,
    tool_batch_step,
    tool_call_step,
)

import agent.tools.rag as rag_tool
from agent.orchestrator import AgentOrchestrator
from rag.store import RetrievedChunk

SHANG_YANG_EVENT = "zhanguo-05"
WANG_AN_SHI_EVENT = "beisong-10"


class FakeRagStore:
    provider = "fake"
    model = "fake-bge-small-zh-v1.5"

    def __init__(self, chunks: list[RetrievedChunk]) -> None:
        self._chunks = list(chunks)
        self.queries: list[tuple[str, int]] = []

    def search(self, query: str, top_k: int = 3) -> list[RetrievedChunk]:
        self.queries.append((query, top_k))
        return self._chunks[:top_k]


def _shang_yang_chunks() -> list[RetrievedChunk]:
    return [
        RetrievedChunk(
            chunk_id="rag-04-00",
            text=(
                "商鞅变法是战国时期秦国最为深刻的政治与社会改革运动，发生于秦孝公在位期间"
                "（公元前356年、前350年分两次推行），是秦国由弱变强、最终统一六国的根本制度基础。"
            ),
            event_name="商鞅变法",
            title="商鞅变法",
            record_type="正史",
            section="白话文详述",
            source="史脉综述",
            source_label="",
            book="",
            chapter=None,
            event_id=SHANG_YANG_EVENT,
            year_min=-356,
            year_max=-350,
            score=0.8037,
        ),
        RetrievedChunk(
            chunk_id="rag-04-01",
            text="令既具，未布，恐民之不信，已乃立三丈之木于国都市南门，募民有能徙置北门者予十金。",
            event_name="商鞅变法",
            title="商鞅变法",
            record_type="正史",
            section="古文原典摘录",
            source="史记",
            source_label="《史记·商君列传》",
            book="史记",
            chapter="商君列传",
            event_id=SHANG_YANG_EVENT,
            year_min=-356,
            year_max=-350,
            score=0.7123,
        ),
    ]


@pytest.fixture
def fake_rag(monkeypatch: pytest.MonkeyPatch):
    def _install(chunks: list[RetrievedChunk]) -> FakeRagStore:
        store = FakeRagStore(chunks)
        monkeypatch.setattr(rag_tool, "get_rag_store", lambda: store)
        return store

    return _install


def _event_citation_id(toolkit: Any, event_id: str) -> str:
    result = toolkit.call("get_event", event_id=event_id)
    assert result["ok"] is True and result["citations"]
    return result["citations"][0]["id"]


def test_hybrid_route_graph_then_rag(store: Any, toolkit: Any, fake_rag: Any) -> None:
    rag_store = fake_rag(_shang_yang_chunks())
    event_citation = _event_citation_id(toolkit, SHANG_YANG_EVENT)

    fake = FakeLLM(
        [
            tool_call_step("search_events", {"q": "商鞅变法"}),
            tool_call_step("get_event", {"event_id": SHANG_YANG_EVENT}),
            tool_call_step(
                "search_historical_text",
                {"query": "商鞅变法 商鞅 秦孝公 前359年 为什么能成功", "top_k": 3},
            ),
            final_step(
                {
                    "mode": "grounded",
                    "claims": [
                        {"id": "c1", "citation_ids": [event_citation]},
                        {"id": "c2", "citation_ids": ["rag-04-00", "rag-04-01"]},
                    ],
                    "evidence": [
                        {"entity_type": "event", "entity_id": SHANG_YANG_EVENT},
                        {"entity_type": "rag", "entity_id": "rag-04-00"},
                        {"entity_type": "rag", "entity_id": "rag-04-01"},
                    ],
                    "related_event_ids": [SHANG_YANG_EVENT],
                    "missing_reasons": [],
                    "reason_code": None,
                    "ui_actions": [],
                }
            ),
        ]
    )

    result = AgentOrchestrator(store, fake).run(
        ask_request("商鞅变法为什么能成功？", route="/ask")
    )

    assert result.answer.mode == "grounded"
    assert result.downgraded is False
    assert [record.name for record in result.tools] == [
        "search_events",
        "get_event",
        "search_historical_text",
    ]
    assert all(record.ok for record in result.tools)

    # RAG 查询词由模型拼接了图谱实体与年份（工具 trace 可审计）。
    rag_record = result.tools[-1]
    assert "商鞅变法" in rag_record.arguments["query"]
    assert rag_store.queries and rag_store.queries[0][1] == 3

    markdown = result.answer.markdown
    assert "① 基础事实（来自图谱）" in markdown
    assert "② 史料记载细节（来自 RAG）" in markdown
    assert "商鞅变法" in markdown
    assert "史记" in markdown or "商君列传" in markdown

    citation_ids = [citation.id for citation in result.citations]
    assert event_citation in citation_ids
    assert "rag-04-00" in citation_ids and "rag-04-01" in citation_ids
    rag_citations = [
        citation for citation in result.citations if citation.kind == "rag"
    ]
    assert rag_citations and all(
        citation.record_type == "正史" for citation in rag_citations
    )


def test_comparison_route_batches_both_dynasties(store: Any, toolkit: Any, fake_rag: Any) -> None:
    """跨朝代比较应能在 6 轮预算内完成双方图谱 + 双方 RAG。"""
    rag_store = fake_rag([_shang_yang_chunks()[0],
        RetrievedChunk(
            chunk_id="rag-wang-00",
            text="王安石变法始于北宋熙宁年间，重点在理财、强兵与整顿吏治。",
            event_name="王安石变法",
            title="王安石变法",
            record_type="正史",
            section="白话文详述",
            source="史脉综述",
            source_label="",
            book="",
            chapter=None,
            event_id=WANG_AN_SHI_EVENT,
            year_min=1069,
            year_max=1085,
            score=0.79,
        )
    ])
    shang_citation = _event_citation_id(toolkit, SHANG_YANG_EVENT)
    wang_citation = _event_citation_id(toolkit, WANG_AN_SHI_EVENT)
    fake = FakeLLM([
        tool_batch_step([
            {"tool": "get_event", "arguments": {"event_id": SHANG_YANG_EVENT}},
            {"tool": "get_event", "arguments": {"event_id": WANG_AN_SHI_EVENT}},
        ]),
        tool_batch_step([
            {"tool": "search_historical_text", "arguments": {"query": "商鞅变法 战国 秦孝公 措施 影响", "top_k": 2}},
            {"tool": "search_historical_text", "arguments": {"query": "王安石变法 北宋 宋神宗 措施 影响", "top_k": 2}},
        ]),
        final_step({
            "mode": "grounded",
            "claims": [
                {"id": "c1", "citation_ids": [shang_citation]},
                {"id": "c2", "citation_ids": [wang_citation]},
                {"id": "c3", "citation_ids": ["rag-04-00", "rag-wang-00"]},
            ],
            "evidence": [
                {"entity_type": "event", "entity_id": SHANG_YANG_EVENT},
                {"entity_type": "event", "entity_id": WANG_AN_SHI_EVENT},
                {"entity_type": "rag", "entity_id": "rag-04-00"},
                {"entity_type": "rag", "entity_id": "rag-wang-00"},
            ],
            "related_event_ids": [SHANG_YANG_EVENT, WANG_AN_SHI_EVENT],
            "missing_reasons": [],
            "reason_code": None,
            "ui_actions": [],
        }),
    ])

    result = AgentOrchestrator(store, fake).run(
        ask_request("王安石变法和商鞅变法的区别", route="/ask")
    )

    assert result.answer.mode == "grounded"
    assert result.downgraded is False
    assert [record.name for record in result.tools] == [
        "get_event", "get_event", "search_historical_text", "search_historical_text"
    ]
    assert len(fake.calls) == 3
    assert {query for query, _ in rag_store.queries} == {
        "商鞅变法 战国 秦孝公 措施 影响",
        "王安石变法 北宋 宋神宗 措施 影响",
    }
    assert "商鞅变法" in result.answer.markdown and "王安石变法" in result.answer.markdown


def test_system_prompt_advertises_rag_tool_and_status(
    store: Any, toolkit: Any, fake_rag: Any
) -> None:
    fake_rag([])
    fake = FakeLLM(
        [
            tool_call_step("search_events", {"q": "赤壁"}),
            final_step(insufficient_answer()),
        ]
    )
    AgentOrchestrator(store, fake).run(ask_request("赤壁之战"))

    system_prompt = fake.calls[0]["messages"][0]["content"]
    assert "search_historical_text" in system_prompt
    assert "RAG 史料库状态" in system_prompt
    assert "① 基础事实（来自图谱）" in system_prompt


def test_system_prompt_documents_comparison_batch_strategy(
    store: Any, toolkit: Any, fake_rag: Any
) -> None:
    """V1.0.5.1：System Prompt 必须显式给出对比任务的「并行图谱 → 并行 RAG → 回答」策略。"""

    fake_rag([])
    fake = FakeLLM([final_step(insufficient_answer())])
    AgentOrchestrator(store, fake).run(ask_request("王安石变法和商鞅变法的区别", route="/ask"))

    system_prompt = fake.calls[0]["messages"][0]["content"]
    assert "对比任务专项策略" in system_prompt
    assert "第一轮并行定位" in system_prompt
    assert "第二轮并行取证" in system_prompt
    assert "action=tool_batch" in system_prompt
    assert "第三轮生成回答" in system_prompt


def test_both_sources_miss_returns_insufficient(
    store: Any, toolkit: Any, fake_rag: Any
) -> None:
    """「秦始皇吃过西红柿吗？」：图谱 search_events 为空、RAG 也为空 → insufficient。"""

    rag_store = fake_rag([])
    fake = FakeLLM(
        [
            tool_call_step("search_events", {"q": "秦始皇 西红柿"}),
            tool_call_step("search_historical_text", {"query": "秦始皇 吃过 西红柿"}),
            final_step(insufficient_answer(["NO_MATCHING_ENTITY"])),
        ]
    )

    result = AgentOrchestrator(store, fake).run(
        ask_request("秦始皇吃过西红柿吗？", route="/ask")
    )

    assert [record.name for record in result.tools] == [
        "search_events",
        "search_historical_text",
    ]
    assert result.tools[0].ok is True and result.tools[0].hits == 0
    assert result.tools[1].ok is True and result.tools[1].hits == 0
    assert rag_store.queries
    assert result.answer.mode == "insufficient"
    assert result.citations == []
    assert result.answer.claims == []
    assert result.answer.missing
    assert (
        "没有检索到" in result.answer.markdown
        or "无法完整回答" in result.answer.markdown
    )
