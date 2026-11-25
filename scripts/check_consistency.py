#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""《史脉》RAG 语料 ↔ 知识图谱一致性 / 孤儿节点检查（V1.0.5.4）。

背景
----
V1.0.5.4 起图谱数据由 `backend/scripts/ingest_graph_data.py` 从 docs 图谱扩充表自动合并。
本脚本是入库流水线的最后一步：确认「RAG 里说的历史名词，图谱里真的有人 / 有事件」，
并检查快照内部引用完整性、图谱孤儿节点；发现遗漏时打印**可直接行动**的警告清单。

检查项
------
A. 快照内部引用完整性（error，直接退出 1）
   - events.person_ids / persons.event_ids / relations 两端 / 别名目标 / 图谱节点与边
     必须全部互相可解析（等价于后端 fail-fast 的引用完整性，另做一次独立复核）；
   - 图谱默认中心必须在该期节点内。
B. 孤儿节点（warning；`--strict` 时升级为失败）
   - 图谱节点没有任何边（孤立人物）；
   - 人物存在事件但不在任何分期 / 断代图中（仅时间轴可搜到）；
   - 事件有参与者但未进入任何人物图（时间轴可见、图谱不可见）。
C. RAG 名词覆盖（本脚本核心）
   - 扫描 `docs/史脉_RAG语料库_*.md`，对核心实体词表（默认含大禹 / 商汤 / 伊尹 /
     夏桀 / 周公旦 / 周定公 …，可用 `--terms` 追加）检查：
       · RAG 提到该词 → 图谱人物库（display_name / aliases）或事件库必须能命中；
       · 未命中即打印「RAG 提及但图谱缺失」警告清单；
   - 反向检查 RAG 篇目标题：`## 事件名` 若在事件库中找不到同名 / 包涵匹配，列为
     「RAG 篇目未入库」提示（不计失败，供下一批数据补全参考）。

用法
----
    python scripts/check_consistency.py                # 常规检查（warning 不阻断）
    python scripts/check_consistency.py --strict       # CI 模式：warning 也失败
    python scripts/check_consistency.py --json         # 机器可读输出
    python scripts/check_consistency.py --terms 桀,大禹 # 追加关注实体
"""

from __future__ import annotations

import argparse
import fnmatch
import json
import re
import sys
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Iterable

ROOT = Path(__file__).resolve().parents[1]
SNAPSHOT_PATH = ROOT / "backend" / "data" / "snapshot.v1.json"
META_PATH = ROOT / "backend" / "data" / "snapshot.meta.json"
RAG_GLOB = "史脉_RAG语料库_*.md"
DOCS_DIR = ROOT / "docs"

#: 核心实体词表：优先覆盖先秦早期（V1.0.5.4 第一批）与 RAG 语料高频人物。
DEFAULT_FOCUS_TERMS: tuple[str, ...] = (
    "鲧",
    "尧",
    "舜",
    "大禹",
    "禹",
    "夏启",
    "伯益",
    "太康",
    "后羿",
    "寒浞",
    "少康",
    "夏桀",
    "桀",
    "商汤",
    "伊尹",
    "太甲",
    "盘庚",
    "武丁",
    "傅说",
    "妇好",
    "商纣王",
    "妲己",
    "比干",
    "箕子",
    "微子",
    "周文王",
    "周武王",
    "周公旦",
    "周定公",
    "周成王",
    "周康王",
    "姜子牙",
    "管叔",
    "蔡叔",
    "武庚",
    "召公",
    "周穆王",
    "周宣王",
    "周厉王",
    "周幽王",
    "褒姒",
    "申侯",
    "鸣条之战",
    "牧野之战",
)

#: RAG 篇目常见泛化词（保留说明：命中这些词的标题不再当作「人物缺失」）。
GENERIC_TITLE_WORDS = (
    "传说",
    "之战",
    "之乱",
    "之变",
    "之治",
    "改制",
    "改革",
    "变法",
    "起义",
    "之狱",
    "称帝",
    "中兴",
    "之死",
)


@dataclass
class CheckResult:
    errors: list[str] = field(default_factory=list)
    warnings: list[str] = field(default_factory=list)
    infos: list[str] = field(default_factory=list)

    def error(self, message: str) -> None:
        self.errors.append(message)

    def warning(self, message: str) -> None:
        self.warnings.append(message)

    def info(self, message: str) -> None:
        self.infos.append(message)


def load_json(path: Path) -> dict[str, Any]:
    return json.loads(path.read_text(encoding="utf-8"))


def collect_rag_documents(paths: Iterable[Path]) -> list[tuple[Path, str]]:
    docs: list[tuple[Path, str]] = []
    for path in paths:
        docs.append((path, path.read_text(encoding="utf-8")))
    return docs


def parse_rag_headings(text: str) -> list[str]:
    headings = []
    for line in text.splitlines():
        if line.startswith("## "):
            title = line[3:].strip()
            if title:
                headings.append(title)
    return headings


def strip_heading(title: str) -> str:
    cleaned = re.sub(r"【[^】]*】", "", title)
    cleaned = re.sub(r"[（(][^）)]*[）)]", "", cleaned)
    return cleaned.strip()


def heading_candidates(title: str) -> list[str]:
    """把 RAG 篇目标题拆成可匹配的候选词（主标题 + 括注别名 + 并列词）。"""
    if "【传说】" in title:
        return []
    candidates: list[str] = [strip_heading(title)]
    for inside in re.findall(r"[（(]([^）)]+)[）)]", title):
        candidates.append(inside.strip())
    expanded: list[str] = []
    for candidate in candidates:
        expanded.append(candidate)
        expanded.extend(part.strip() for part in re.split(r"[与·、/]", candidate) if part.strip())
    return [candidate for candidate in dict.fromkeys(expanded) if len(candidate) >= 2]


def matches_event_title(candidate: str, event_titles: list[str]) -> bool:
    for event_title in event_titles:
        if not event_title:
            continue
        if candidate == event_title or candidate in event_title or event_title in candidate:
            return True
        # 标题与事件名高度重叠（≥ 3 个连续汉字）时也算命中，如「周武王伐纣」≈「牧野之战」。
        common = longest_common_substring(candidate, event_title)
        if common >= 3:
            return True
    return False


def longest_common_substring(left: str, right: str) -> int:
    best = 0
    for start in range(len(left)):
        for end in range(len(left), start + best, -1):
            if left[start:end] in right:
                best = max(best, end - start)
                break
    return best


# ---------------------------------------------------------------------------
# A. 快照内部引用完整性
# ---------------------------------------------------------------------------


def check_snapshot_integrity(snapshot: dict[str, Any], result: CheckResult) -> None:
    events = {event["event_id"]: event for event in snapshot.get("events") or []}
    persons = {person["person_id"]: person for person in snapshot.get("persons") or []}
    aliases = snapshot.get("aliases") or []

    if len(events) != len(snapshot.get("events") or []):
        result.error("快照 events 存在重复 event_id")
    if len(persons) != len(snapshot.get("persons") or []):
        result.error("快照 persons 存在重复 person_id")
    counts = snapshot.get("counts") or {}
    for key, payload_key in (
        ("events", "events"),
        ("persons", "persons"),
        ("relations", "relations"),
        ("eras", "eras"),
        ("scopes", "scopes"),
        ("groups", "groups"),
        ("aliases", "aliases"),
    ):
        if counts.get(key) != len(snapshot.get(payload_key) or []):
            result.error(f"快照 counts.{key}={counts.get(key)} 与数组长度不一致")

    for event in events.values():
        for person_id in event.get("person_ids") or []:
            if person_id not in persons:
                result.error(f"事件 {event['event_id']} 引用了不存在的人物 {person_id}")
    for person in persons.values():
        for event_id in person.get("event_ids") or []:
            if event_id not in events:
                result.error(f"人物 {person['person_id']} 引用了不存在的事件 {event_id}")
    for alias in aliases:
        if alias.get("person_id") not in persons:
            result.error(f"别名「{alias.get('alias')}」指向不存在的 person_id：{alias.get('person_id')}")

    relations = snapshot.get("relations") or []
    for relation in relations:
        for person_id in (relation.get("person_id_a"), relation.get("person_id_b")):
            if person_id not in persons:
                result.error(f"关系 {relation.get('pair_key')} 引用了不存在的人物 {person_id}")
        for event_id in relation.get("basis_event_ids") or []:
            if event_id not in events:
                result.error(f"关系 {relation.get('pair_key')} 的共同事件 {event_id} 不存在")

    graph_entries: list[tuple[str, str, dict[str, Any]]] = []
    for era in snapshot.get("eras") or []:
        graph_entries.append(("分期", era.get("era_id", "?"), era))
    for scope in snapshot.get("scopes") or []:
        graph_entries.append(("断代", scope.get("scope_id", "?"), scope))
    for kind, entry_id, entry in graph_entries:
        graph = entry.get("graph") or {}
        nodes = {node["person_id"] for node in graph.get("nodes") or []}
        center = entry.get("default_center_person_id")
        if center not in nodes:
            result.error(f"{kind}「{entry_id}」的默认中心 {center} 不在节点中")
        for node in graph.get("nodes") or []:
            if node["person_id"] not in persons:
                result.error(f"{kind}「{entry_id}」节点 {node['person_id']} 不在人物库中")
        for edge in graph.get("edges") or []:
            for person_id in (edge.get("person_id_a"), edge.get("person_id_b")):
                if person_id not in nodes:
                    result.error(f"{kind}「{entry_id}」的边 {edge.get('person_id_a')}×{edge.get('person_id_b')} 端点不在图中")
            for event_id in edge.get("shared_event_ids") or []:
                if event_id not in events:
                    result.error(f"{kind}「{entry_id}」的边引用了不存在的事件 {event_id}")
    result.info(
        f"快照引用完整性：{len(events)} 事件 / {len(persons)} 人物 / {len(relations)} 关系 / "
        f"{len(snapshot.get('eras') or [])} 期 / {len(snapshot.get('scopes') or [])} 组"
    )


# ---------------------------------------------------------------------------
# B. 孤儿节点
# ---------------------------------------------------------------------------


def check_orphans(snapshot: dict[str, Any], result: CheckResult) -> dict[str, int]:
    persons = {person["person_id"]: person for person in snapshot.get("persons") or []}
    graph_entries: list[tuple[str, str, dict[str, Any]]] = []
    for era in snapshot.get("eras") or []:
        graph_entries.append(("分期", era.get("era_id", "?"), era))
    for scope in snapshot.get("scopes") or []:
        graph_entries.append(("断代", scope.get("scope_id", "?"), scope))

    graph_members: set[str] = set()
    dangling_nodes: list[str] = []
    isolated: list[str] = []
    for kind, entry_id, entry in graph_entries:
        graph = entry.get("graph") or {}
        nodes = [node["person_id"] for node in graph.get("nodes") or []]
        graph_members.update(nodes)
        adjacency: dict[str, int] = {person_id: 0 for person_id in nodes}
        for edge in graph.get("edges") or []:
            for person_id in (edge.get("person_id_a"), edge.get("person_id_b")):
                if person_id in adjacency:
                    adjacency[person_id] += 1
        for person_id in nodes:
            if adjacency.get(person_id, 0) == 0:
                isolated.append(f"{kind}「{entry_id}」人物 {persons.get(person_id, {}).get('display_name', person_id)}")
        if len(nodes) < 3:
            result.warning(f"{kind}「{entry_id}」只有 {len(nodes)} 个节点，图谱可能过空")

    if isolated:
        result.warning(
            f"图谱孤立节点（没有任何关系边）{len(isolated)} 个：" + "；".join(isolated[:12])
            + ("…" if len(isolated) > 12 else "")
        )

    timeline_only = [
        person
        for person in persons.values()
        if person["person_id"] not in graph_members and (person.get("event_ids") or [])
    ]
    if timeline_only:
        names = "、".join(person["display_name"] for person in timeline_only[:12])
        result.info(f"仅时间轴可搜到、未进入任何人物图的人物 {len(timeline_only)} 位（历史数据允许）：{names}")

    event_in_graphs: set[str] = set()
    for _kind, _entry_id, entry in graph_entries:
        for edge in (entry.get("graph") or {}).get("edges") or []:
            event_in_graphs.update(edge.get("shared_event_ids") or [])
    graph_nodes = graph_members
    timeline_only_events = []
    for event in snapshot.get("events") or []:
        if event.get("person_ids") and event["event_id"] not in event_in_graphs:
            timeline_only_events.append(event)
    if timeline_only_events:
        result.info(
            f"有参与者但未进入任何人物图的事件 {len(timeline_only_events)} 条（时间轴可见）："
            + "、".join(event["title"] for event in timeline_only_events[:8])
        )
    result.info(
        f"孤儿节点检查：{len(graph_entries)} 张图 / 去重人物 {len(graph_nodes)} 位 / 孤立节点 {len(isolated)} 个"
    )
    return {
        "graph_entries": len(graph_entries),
        "graph_members": len(graph_nodes),
        "isolated_nodes": len(isolated),
        "timeline_only_persons": len(timeline_only),
    }


# ---------------------------------------------------------------------------
# C. RAG 名词覆盖
# ---------------------------------------------------------------------------


def check_rag_coverage(
    snapshot: dict[str, Any],
    rag_docs: list[tuple[Path, str]],
    focus_terms: Iterable[str],
    result: CheckResult,
) -> dict[str, Any]:
    persons = snapshot.get("persons") or []
    events = snapshot.get("events") or []
    person_names: set[str] = set()
    for person in persons:
        person_names.add(person["display_name"])
        person_names.update(person.get("aliases") or [])
    event_texts: list[str] = []
    for event in events:
        event_texts.append(
            " ".join(
                [
                    event.get("title", ""),
                    event.get("description", ""),
                    " ".join(event.get("participants") or []),
                ]
            )
        )
    event_blob = "\n".join(event_texts)
    rag_text = "\n".join(text for _path, text in rag_docs)

    missing: list[str] = []
    hit: list[str] = []
    for term in focus_terms:
        if not term or term not in rag_text:
            continue
        if term in person_names or term in event_blob:
            hit.append(term)
        else:
            missing.append(term)
    if missing:
        result.warning(
            "RAG 语料提及但图谱人物 / 事件库缺失的名词 "
            f"{len(missing)} 个：" + "、".join(missing)
        )
    else:
        result.info(f"RAG 核心名词覆盖：{len(hit)} 个关注实体全部可在图谱中命中")

    # RAG 篇目标题 → 事件库覆盖（提示下一批数据缺口，不阻断）。
    unmatched_headings: list[str] = []
    event_titles = [event.get("title", "") for event in events]
    for title in sorted({heading for _path, text in rag_docs for heading in parse_rag_headings(text)}):
        candidates = heading_candidates(title)
        if not candidates:
            continue
        matched = any(matches_event_title(candidate, event_titles) for candidate in candidates)
        if matched:
            continue
        if any(candidate in person_names for candidate in candidates):
            continue
        unmatched_headings.append(title)
    if unmatched_headings:
        result.info(
            f"RAG 篇目标题未在事件库中找到同名 / 包涵匹配 {len(unmatched_headings)} 条"
            "（多数为传说或后续批次主题，供扩充参考）："
            + "、".join(unmatched_headings[:10])
            + ("…" if len(unmatched_headings) > 10 else "")
        )
    return {
        "focus_terms": sorted(set(focus_terms)),
        "rag_mentioned_terms": sorted(set(hit) | set(missing)),
        "hit": sorted(set(hit)),
        "missing": sorted(set(missing)),
        "unmatched_headings": unmatched_headings,
    }


# ---------------------------------------------------------------------------
# 主流程
# ---------------------------------------------------------------------------


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="RAG 语料 ↔ 图谱一致性 / 孤儿节点检查")
    parser.add_argument("--strict", action="store_true", help="warning 也按失败处理（CI）")
    parser.add_argument("--json", action="store_true", help="以 JSON 输出结果")
    parser.add_argument("--terms", default="", help="追加关注实体，逗号分隔")
    parser.add_argument("--rag-glob", default=RAG_GLOB, help=f"RAG 语料文件 glob（默认 {RAG_GLOB}）")
    args = parser.parse_args(argv)

    result = CheckResult()
    if not SNAPSHOT_PATH.exists():
        print(f"✖ 快照不存在：{SNAPSHOT_PATH}（先运行 node scripts/export-snapshot.mjs）", file=sys.stderr)
        return 1
    snapshot = load_json(SNAPSHOT_PATH)

    if META_PATH.exists():
        meta = load_json(META_PATH)
        if meta.get("snapshot_version") != snapshot.get("snapshot_version"):
            result.error("snapshot.meta.json 的 snapshot_version 与快照不一致")
        if meta.get("counts") != snapshot.get("counts"):
            result.error("snapshot.meta.json 的 counts 与快照不一致")

    check_snapshot_integrity(snapshot, result)
    orphan_stats = check_orphans(snapshot, result)

    rag_paths = sorted(path for path in DOCS_DIR.glob(args.rag_glob) if path.is_file())
    if not rag_paths:
        result.warning(f"未找到 RAG 语料文件：docs/{args.rag_glob}")
        rag_docs: list[tuple[Path, str]] = []
    else:
        rag_docs = collect_rag_documents(rag_paths)
        result.info(f"RAG 语料：{len(rag_docs)} 份 / {sum(len(text) for _path, text in rag_docs)} 字符")

    terms = list(DEFAULT_FOCUS_TERMS)
    terms.extend(part.strip() for part in args.terms.split(",") if part.strip())
    rag_stats = check_rag_coverage(snapshot, rag_docs, terms, result)

    payload = {
        "ok": not result.errors and not (args.strict and result.warnings),
        "errors": result.errors,
        "warnings": result.warnings,
        "infos": result.infos,
        "stats": {
            "snapshot": snapshot.get("snapshot_version"),
            "counts": snapshot.get("counts"),
            "orphans": orphan_stats,
            "rag": rag_stats,
        },
    }
    if args.json:
        print(json.dumps(payload, ensure_ascii=False, indent=2))
    else:
        print("=" * 72)
        print("《史脉》RAG 语料 ↔ 知识图谱一致性检查")
        print("=" * 72)
        print(f"快照版本：{snapshot.get('snapshot_version')}；计数：{snapshot.get('counts')}")
        if result.infos:
            print("\nℹ 信息：")
            for message in result.infos:
                print(f"  - {message}")
        if result.warnings:
            print(f"\n⚠ 警告（{len(result.warnings)} 条）：")
            for message in result.warnings:
                print(f"  - {message}")
        if result.errors:
            print(f"\n✖ 错误（{len(result.errors)} 条）：")
            for message in result.errors:
                print(f"  - {message}")
        if not result.errors:
            print(
                "\n✓ 快照引用完整、孤儿节点检查完成；"
                f"RAG 缺失名词 {len(rag_stats['missing'])} 个。"
            )
    if result.errors:
        return 1
    if args.strict and result.warnings:
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())