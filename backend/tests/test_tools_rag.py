"""RAG 检索工具测试（V1.0.5）：Token 控制 / citations / 证据校验分节。

用 fake store 注入，不加载真实 chromadb 与 embedding 模型；
真实入库链路由 ``backend/scripts/ingest_rag.py`` 与 ``test_rag_corpus.py`` 覆盖。
"""

from __future__ import annotations

from typing import Any

import pytest

import agent.tools.rag as rag_tool
from agent.schemas import ModelAnswer
from agent.tools import Toolkit
from agent.validator import EvidenceValidator, ObservedEvidence
from rag.store import RagUnavailableError, RetrievedChunk

CHIBI_EVENT = "handong-chibi"
CHIBI_CITATION = "cite-handong-chibi-0"


def _chunk(**overrides: Any) -> RetrievedChunk:
    payload: dict[str, Any] = {
        "chunk_id": "rag-12-00",
        "text": "赤壁之战发生于建安十三年（公元208年），是三国鼎立格局形成的决定性战役。",
        "event_name": "赤壁之战",
        "title": "赤壁之战",
        "record_type": "正史",
        "section": "白话文详述",
        "source": "史脉综述",
        "source_label": "",
        "book": "",
        "chapter": None,
        "event_id": CHIBI_EVENT,
        "year_min": 208,
        "year_max": 208,
        "score": 0.7767,
    }
    payload.update(overrides)
    return RetrievedChunk(**payload)


class FakeRagStore:
    provider = "fake"
    model = "fake-bge-small-zh-v1.5"

    def __init__(self, chunks: list[RetrievedChunk]) -> None:
        self._chunks = list(chunks)
        self.queries: list[tuple[str, int]] = []

    def search(self, query: str, top_k: int = 3) -> list[RetrievedChunk]:
        self.queries.append((query, top_k))
        return self._chunks[:top_k]


@pytest.fixture
def install_fake_rag(monkeypatch: pytest.MonkeyPatch):
    def _install(chunks: list[RetrievedChunk]) -> FakeRagStore:
        store = FakeRagStore(chunks)
        monkeypatch.setattr(rag_tool, "get_rag_store", lambda: store)
        return store

    return _install


# ---------------------------------------------------------------------------
# 工具层
# ---------------------------------------------------------------------------


def test_tool_returns_envelope_with_rag_citations(
    toolkit: Toolkit,
    install_fake_rag: Any,
    assert_tool_contract: Any,
) -> None:
    install_fake_rag([_chunk()])
    result = toolkit.call("search_historical_text", query="赤壁之战 208年", top_k=3)
    assert_tool_contract(result, "search_historical_text")

    assert result["ok"] is True
    assert result["tool"] == "search_historical_text"
    assert result["data"]["total"] == 1
    assert result["meta"]["source"] == "rag"
    assert len(result["items"]) == 1

    item = result["items"][0]
    assert item["chunk_id"] == "rag-12-00"
    assert item["event_name"] == "赤壁之战"
    assert item["record_type"] == "正史"
    assert item["type"] == "正史"
    assert item["event_id"] == CHIBI_EVENT
    assert item["score"] > 0

    citation = result["citations"][0]
    # citation id 即 chunk_id，模型 evidence / claim 直接引用它。
    assert citation["id"] == item["chunk_id"]
    assert citation["kind"] == "rag"
    assert citation["record_type"] == "正史"
    assert citation["event_id"] == CHIBI_EVENT
    assert citation["quote"] == item["text"]
    assert citation["attribution"]


def test_tool_limits_results_to_three_and_text_to_300_chars(
    toolkit: Toolkit,
    install_fake_rag: Any,
) -> None:
    long_text = "商" * 600
    chunks = [
        _chunk(
            chunk_id=f"rag-04-0{index}",
            event_name="商鞅变法",
            text=long_text,
            event_id=None,
        )
        for index in range(5)
    ]
    install_fake_rag(chunks)
    result = toolkit.call("search_historical_text", query="商鞅变法", top_k=3)

    assert result["ok"] is True
    assert len(result["items"]) == 3
    assert len(result["citations"]) == 3
    for item, citation in zip(result["items"], result["citations"]):
        assert len(item["text"]) <= rag_tool.MAX_CHUNK_CHARS
        assert len(citation["quote"]) <= rag_tool.MAX_CHUNK_CHARS
        assert item["text"].endswith("…")


def test_tool_rejects_top_k_above_three(
    toolkit: Toolkit, install_fake_rag: Any
) -> None:
    install_fake_rag([_chunk()])
    result = toolkit.call("search_historical_text", query="赤壁之战", top_k=4)

    assert result["ok"] is False
    assert result["error"]["code"] == "INVALID_REQUEST"
    assert "top_k" in result["error"]["message"]


def test_tool_empty_result_is_not_an_error(
    toolkit: Toolkit, install_fake_rag: Any
) -> None:
    install_fake_rag([])
    result = toolkit.call("search_historical_text", query="秦始皇吃过西红柿吗")

    assert result["ok"] is True
    assert result["data"] == {"chunks": [], "total": 0, "query": "秦始皇吃过西红柿吗"}
    assert result["items"] == []
    assert result["citations"] == []


def test_tool_reports_unavailable_vector_store(
    toolkit: Toolkit, monkeypatch: pytest.MonkeyPatch
) -> None:
    def _raise() -> None:
        raise RagUnavailableError("RAG 向量库未入库：缺少 manifest.json")

    monkeypatch.setattr(rag_tool, "get_rag_store", _raise)
    result = toolkit.call("search_historical_text", query="商鞅变法")

    assert result["ok"] is False
    assert result["error"]["code"] == "INSUFFICIENT_EVIDENCE"
    assert "manifest" in result["error"]["message"]
    assert result["items"] == []
    assert result["citations"] == []


# ---------------------------------------------------------------------------
# 证据校验 / 结构化正文
# ---------------------------------------------------------------------------


def _observed(toolkit: Toolkit, *calls: tuple[str, dict[str, Any]]):
    results = [toolkit.call(name, **arguments) for name, arguments in calls]
    return ObservedEvidence.from_results(results)


def test_mixed_answer_is_rendered_in_two_sections(
    toolkit: Toolkit,
    install_fake_rag: Any,
) -> None:
    install_fake_rag([_chunk()])
    observed = _observed(
        toolkit,
        ("get_event", {"event_id": CHIBI_EVENT}),
        ("search_historical_text", {"query": "赤壁之战 208年"}),
    )
    answer = ModelAnswer(
        mode="grounded",
        claims=[
            {"id": "c1", "citation_ids": [CHIBI_CITATION]},
            {"id": "c2", "citation_ids": ["rag-12-00"]},
        ],
        evidence=[
            {"entity_type": "event", "entity_id": CHIBI_EVENT},
            {"entity_type": "rag", "entity_id": "rag-12-00"},
        ],
    )
    outcome = EvidenceValidator().validate(answer, observed)

    assert outcome.downgraded is False
    assert outcome.answer.mode == "grounded"
    markdown = outcome.answer.markdown
    # V1.0.5.2：事件 + RAG 同属「时间轴·大事记」源，合并为一节；不虚构人物关系图节。
    assert "**[时间轴·大事记]**" in markdown
    assert "[人物关系图]" not in markdown
    assert "赤壁之战" in markdown
    assert "208年" in markdown
    # 图谱写 208、语料也写 208 → 不标注冲突。
    assert "史料记载有异" not in markdown
    citation_ids = [citation.id for citation in outcome.citations]
    assert CHIBI_CITATION in citation_ids
    assert "rag-12-00" in citation_ids


def test_year_conflict_is_flagged_and_graph_wins(
    toolkit: Toolkit,
    install_fake_rag: Any,
) -> None:
    # 语料纪年 250 年 vs 图谱 208 年：以图谱为准并标注「史料记载有异」。
    install_fake_rag([_chunk(year_min=250, year_max=250)])
    observed = _observed(
        toolkit,
        ("get_event", {"event_id": CHIBI_EVENT}),
        ("search_historical_text", {"query": "赤壁之战"}),
    )
    answer = ModelAnswer(
        mode="grounded",
        claims=[
            {"id": "c1", "citation_ids": [CHIBI_CITATION]},
            {"id": "c2", "citation_ids": ["rag-12-00"]},
        ],
        evidence=[
            {"entity_type": "event", "entity_id": CHIBI_EVENT},
            {"entity_type": "rag", "entity_id": "rag-12-00"},
        ],
    )
    outcome = EvidenceValidator().validate(answer, observed)

    assert outcome.downgraded is False
    markdown = outcome.answer.markdown
    assert "史料记载有异" in markdown
    assert "以图谱为准" in markdown
    assert "208年" in markdown
    # V1.0.5.2：时间轴节内部顺序为「冲突提示 → 事件 claim → RAG 史料」。
    assert markdown.index("史料记载有异") < markdown.index("208年")


def test_legend_chunk_gets_tag_and_rag_only_answer(
    toolkit: Toolkit,
    install_fake_rag: Any,
) -> None:
    legend_chunk = _chunk(
        chunk_id="rag-00-01",
        text="蚩尤作乱，不用帝命。于是黄帝乃征师诸侯，与蚩尤战于涿鹿之野，遂禽杀蚩尤。",
        event_name="黄帝战蚩尤（涿鹿之战）【传说】",
        title="黄帝战蚩尤（涿鹿之战）",
        record_type="传说",
        section="古文原典摘录",
        source="史记",
        source_label="《史记·五帝本纪》",
        book="史记",
        chapter="五帝本纪",
        event_id=None,
        year_min=None,
        year_max=None,
    )
    install_fake_rag([legend_chunk])
    observed = _observed(
        toolkit,
        ("search_historical_text", {"query": "黄帝战蚩尤"}),
    )
    answer = ModelAnswer(
        mode="grounded",
        claims=[{"id": "c1", "citation_ids": ["rag-00-01"]}],
        evidence=[{"entity_type": "rag", "entity_id": "rag-00-01"}],
    )
    outcome = EvidenceValidator().validate(answer, observed)

    assert outcome.downgraded is False
    assert outcome.answer.mode == "grounded"
    markdown = outcome.answer.markdown
    # V1.0.5.2：RAG-only（传说）命中「时间轴·大事记」源，只输出该节。
    assert "**[时间轴·大事记]**" in markdown
    assert "[人物关系图]" not in markdown
    assert "[传说]" in markdown
    # 传说史料行必须紧跟在 [传说] 标签后，便于前端/用户识别。
    legend_line = next(line for line in markdown.splitlines() if "[传说]" in line)
    assert legend_line.lstrip().startswith("[传说]")
    assert "《史记·五帝本纪》" in markdown


def test_rag_citation_inconsistency_downgrades(
    toolkit: Toolkit, install_fake_rag: Any
) -> None:
    """模型编一个不存在的 rag entity_id → 证据不可核验，必须降级 insufficient。"""

    install_fake_rag([_chunk()])
    observed = _observed(
        toolkit,
        ("get_event", {"event_id": CHIBI_EVENT}),
        ("search_historical_text", {"query": "赤壁之战"}),
    )
    answer = ModelAnswer(
        mode="grounded",
        claims=[{"id": "c1", "citation_ids": ["rag-fake-99"]}],
        evidence=[{"entity_type": "rag", "entity_id": "rag-fake-99"}],
    )
    outcome = EvidenceValidator().validate(answer, observed)

    assert outcome.downgraded is True
    assert outcome.answer.mode == "insufficient"
    assert outcome.citations == []
