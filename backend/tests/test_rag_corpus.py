"""RAG 语料解析 / 切分测试（V1.0.5）。

只测纯文本层（不加载 chromadb / embedding）：
- 四份语料按 ``## 事件名`` 切出 90 篇；
- chunk 硬上限 500 字、目标 300–500 字，元数据（正史/传说、section、出处、纪年）齐全；
- 与图谱事件的对齐结果稳定（商鞅变法 → zhanguo-05 等）。
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

import pytest

from rag.corpus import (
    DEFAULT_CORPUS_FILES,
    EXPECTED_DOCUMENT_COUNT,
    MAX_CHUNK_CHARS,
    RECORD_TYPE_HISTORY,
    RECORD_TYPE_LEGEND,
    build_chunks,
    corpus_fingerprint,
    extract_years,
    normalize_title,
    parse_corpus,
    parse_document,
    resolve_event_ids,
    split_text,
    summarize,
)


@pytest.fixture(scope="module")
def corpus_paths(repo_root: Path) -> list[Path]:
    return [repo_root / "docs" / name for name in DEFAULT_CORPUS_FILES]


@pytest.fixture(scope="module")
def documents(corpus_paths: list[Path]):
    return parse_corpus(corpus_paths)


@pytest.fixture(scope="module")
def chunks(documents):
    return build_chunks(documents)


@pytest.fixture(scope="module")
def graph_events(repo_root: Path) -> list[dict[str, Any]]:
    payload = json.loads(
        (repo_root / "backend" / "data" / "snapshot.v1.json").read_text(
            encoding="utf-8"
        )
    )
    return payload["events"]


def test_parses_expected_documents(documents) -> None:
    assert len(documents) == EXPECTED_DOCUMENT_COUNT
    names = [document.event_name for document in documents]
    assert names[0] == "黄帝战蚩尤（涿鹿之战）【传说】"
    assert "商鞅变法" in names
    assert "闭关锁国与鸦片战争" in names
    # 每篇都有白话文与古文摘录。
    assert all(document.vernacular for document in documents)
    assert all(document.excerpts for document in documents)


def test_chunk_size_is_bounded(chunks) -> None:
    assert len(chunks) > EXPECTED_DOCUMENT_COUNT
    assert max(len(chunk.text) for chunk in chunks) <= MAX_CHUNK_CHARS
    assert all(chunk.text.strip() for chunk in chunks)
    # chunk id 全局唯一且可直接当 citation id 用（≤64 字符）。
    ids = [chunk.chunk_id for chunk in chunks]
    assert len(ids) == len(set(ids))
    assert all(len(chunk_id) <= 64 for chunk_id in ids)


def test_chunk_metadata(chunks) -> None:
    first = chunks[0]
    assert first.event_name.startswith("黄帝战蚩尤")
    assert first.record_type == RECORD_TYPE_LEGEND
    assert first.section == "白话文详述"
    metadata = first.metadata()
    allowed = (str, int, float, bool)
    assert all(isinstance(value, allowed) for value in metadata.values())

    shang_yang = [chunk for chunk in chunks if chunk.event_name == "商鞅变法"]
    assert len(shang_yang) >= 2
    sections = {chunk.section for chunk in shang_yang}
    assert sections == {"白话文详述", "古文原典摘录"}
    excerpt = next(chunk for chunk in shang_yang if chunk.section == "古文原典摘录")
    assert excerpt.source == "史记"
    assert "商君列传" in (excerpt.source_label or "")
    assert excerpt.chapter == "商君列传"
    assert all(chunk.record_type == RECORD_TYPE_HISTORY for chunk in shang_yang)


def test_legend_is_marked_only_where_corpus_marks_it(documents) -> None:
    legends = [document.title for document in documents if document.is_legend]
    assert legends == ["黄帝战蚩尤（涿鹿之战）"]


def test_year_extraction() -> None:
    assert extract_years("发生于秦孝公在位期间（公元前356年、前350年分两次推行）") == (
        -356,
        -350,
    )
    assert extract_years("赤壁之战发生于建安十三年（公元208年）") == (208,)
    assert extract_years("没有纪年的白话") == ()
    assert extract_years("公元1000年与公元前841年") == (-841, 1000)


def test_split_text_never_exceeds_max() -> None:
    sentence = "秦孝公任用商鞅推行变法，奖励耕战，实行连坐。"
    text = "".join(sentence for _ in range(120))
    pieces = split_text(text)
    assert pieces
    assert all(len(piece) <= MAX_CHUNK_CHARS for piece in pieces)
    assert "".join(piece.replace("\n", "") for piece in pieces) == text


def test_parse_document_handles_multiple_quotes_and_source() -> None:
    block = """## 测试事件
### 白话文详述
前356年，秦国开始变法。

### 古文原典摘录
**出处：《史记·商君列传》**

> 立三丈之木于国都市南门。

> 行之十年，秦民大说。
"""
    document = parse_document(block, doc_index=0, source_file="test.md")
    assert document.title == "测试事件"
    assert document.years == (-356,)
    assert len(document.excerpts) == 2
    assert document.excerpts[0].book == "史记"
    assert document.excerpts[0].chapter == "商君列传"


def test_normalize_title_strips_markers() -> None:
    assert normalize_title("黄帝战蚩尤（涿鹿之战）【传说】") == "黄帝战蚩尤"
    assert normalize_title("卧薪尝胆·吴越争霸") == "卧薪尝胆"


def test_resolve_event_ids_links_graph_events(chunks, graph_events) -> None:
    linked = resolve_event_ids(chunks, graph_events)
    by_event = {chunk.event_name: chunk.event_id for chunk in linked}
    assert by_event["商鞅变法"] == "zhanguo-05"
    assert by_event["赤壁之战"] == "handong-chibi"
    assert by_event["长平之战"] == "zhanguo-31"
    # 传说事件在快照里没有对应事件，保持 None（不编造 event_id）。
    assert by_event["黄帝战蚩尤（涿鹿之战）【传说】"] is None
    assert sum(1 for chunk in linked if chunk.event_id) > 0


def test_summary_and_fingerprint(corpus_paths: list[Path], documents, chunks) -> None:
    stats = summarize(documents, chunks)
    assert stats.documents == EXPECTED_DOCUMENT_COUNT
    assert stats.chunks == len(chunks)
    assert stats.vernacular_chunks + stats.excerpt_chunks == stats.chunks
    assert stats.legend_documents == 1
    assert stats.max_chars <= MAX_CHUNK_CHARS
    assert len(corpus_fingerprint(corpus_paths)) == 64
