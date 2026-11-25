from __future__ import annotations

import argparse
import importlib.util
import json
import sys
from pathlib import Path

import pytest

SCRIPT_PATH = Path(__file__).resolve().parents[1] / "scripts" / "ingest_graph_data.py"
SPEC = importlib.util.spec_from_file_location("ingest_graph_data", SCRIPT_PATH)
assert SPEC is not None and SPEC.loader is not None
ingest_graph_data = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = ingest_graph_data
SPEC.loader.exec_module(ingest_graph_data)


def test_sanguo_special_document_is_included_and_fully_parsed() -> None:
    ingestor = ingest_graph_data.GraphIngestor.__new__(ingest_graph_data.GraphIngestor)
    ingestor.args = argparse.Namespace(pattern=None)
    ingestor.config = json.loads(ingest_graph_data.CONFIG_PATH.read_text(encoding="utf-8"))

    document = ingest_graph_data.DOCS_DIR / "史脉_V1.0.5.4_图谱扩充_三国特化.md"
    included = set(ingestor.resolve_doc_paths())
    assert document in included
    for filename in (
        "史脉_V1.0.5.4_图谱扩充_唐特化.md",
        "史脉_V1.0.5.4_图谱扩充_宋特化.md",
        "史脉_V1.0.5.4_图谱扩充_明特化.md",
    ):
        assert ingest_graph_data.DOCS_DIR / filename in included

    parsed = ingest_graph_data.parse_document(document)
    assert len(parsed.events) == 24
    assert len(parsed.relations) == 36
    assert any(event.year == 200 and event.title == "孙策遇刺、孙权继位" for event in parsed.events)
    assert any(event.year == 238 and event.title == "司马懿平定辽东" for event in parsed.events)
    assert {(relation.person_a, relation.person_b) for relation in parsed.relations} >= {
        ("刘备", "关羽"),
        ("刘备", "张飞"),
        ("孙策", "孙权"),
    }


@pytest.mark.parametrize(
    ("filename", "expected_title", "expected_year", "expected_dynasty"),
    [
        ("史脉_V1.0.5.4_图谱扩充_唐特化.md", "晋阳起兵", 617, "隋"),
        ("史脉_V1.0.5.4_图谱扩充_宋特化.md", "陈桥兵变", 960, "北宋"),
        ("史脉_V1.0.5.4_图谱扩充_明特化.md", "朱元璋崛起", 1352, "元"),
    ],
)
def test_other_special_documents_parse_events_and_relation_people(
    filename: str,
    expected_title: str,
    expected_year: int,
    expected_dynasty: str,
) -> None:
    parsed = ingest_graph_data.parse_document(ingest_graph_data.DOCS_DIR / filename)

    assert len(parsed.events) == 25
    assert parsed.relations
    event = next(item for item in parsed.events if item.title == expected_title)
    assert (event.year, event.dynasty) == (expected_year, expected_dynasty)
    assert event.participants


def test_special_supplement_expands_grouped_relationships() -> None:
    document = ingest_graph_data.DOCS_DIR / "史脉_V1.0.5.4_图谱扩充_明特化.md"
    parsed = ingest_graph_data.parse_document(document)

    hongwu = next(item for item in parsed.events if item.title == "开国制度建设")
    assert (hongwu.year, hongwu.dynasty) == (1383, "明")
    battle = next(item for item in parsed.events if item.title == "鄱阳湖之战")
    assert battle.dynasty == "明"
    assert {
        (relation.person_a, relation.person_b)
        for relation in parsed.relations
    } >= {
        ("朱元璋", "李善长"),
        ("朱元璋", "蓝玉"),
        ("朱元璋", "胡惟庸"),
    }


def test_special_period_ranges_match_existing_event_years() -> None:
    assert ingest_graph_data.year_range_contains("979—986", 986)
    parsed = ingest_graph_data.parse_document(
        ingest_graph_data.DOCS_DIR / "史脉_V1.0.5.4_图谱扩充_宋特化.md"
    )
    battle = next(item for item in parsed.events if item.title == "采石之战")
    assert battle.dynasty == "金"


def test_sanguo_special_rejects_ambiguous_multi_person_pairing(tmp_path: Path) -> None:
    document = tmp_path / "史脉_V1.0.5.4_图谱扩充_三国特化.md"
    document.write_text(
        "## 表二：人物关系\n\n"
        "| 人物A | 关系 | 人物B | 正史内容 |\n"
        "|---|---|---|---|\n"
        "| 甲、乙 | 同僚 | 丙、丁、戊 | 关系说明 |\n",
        encoding="utf-8",
    )

    with pytest.raises(ingest_graph_data.IngestError, match="两侧人数不同"):
        ingest_graph_data.parse_document(document)
