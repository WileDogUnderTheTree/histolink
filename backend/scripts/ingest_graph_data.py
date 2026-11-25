#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""《史脉》图谱数据全自动清洗与合并脚本（V1.0.5.4）。

用途
----
把 `docs/` 下按《史脉》V1.0.5.4 规范编写的「图谱扩充」Markdown（表一：核心事件；
表二：人物关系）自动解析、清洗、去重、合并进前端数据层，并重新生成前后端共享快照。

一次运行完成的事情
------------------
1. 扫描 `backend/data/ingest/config.json` 中 `doc_globs` 命中的全部文档（默认
   `docs/史脉_V1.0.5.4_*.md`），自动识别「表一 / 表二」；
2. 解析事件（朝代 / 年份 / 事件名 / 简述 / 参与人物 / 重要度）与人物关系
   （人物A / 人物B / 关系 / 共同参与事件 / 关系简述）；
3. **智能 ID 生成**：按「朝代拼音 + 人名拼音 + 两位序号」生成稳定可读的
   `event_id` / `person_id`（如 `xizhou-zhougongdan-01`、`p-xizhou-zhoudinggong-01`）；
4. **别名与同名处理**：`canonical_person_names` 归一化异名（大禹→禹、桀→夏桀 …）；
   `extra_person_aliases` 生成别名映射；同名异人（如周公旦 / 周定公）由
   `person_id_pins` 固定为独立 ID，绝不按姓名合并；
5. **去重合并**：事件标题相同或已在 `event_title_map` 中登记为同一史实的，直接复用
   既有 `event_id`，只把新参与人物追加进 `participants`；重要度按「就高」覆盖；
   共同事件锚点追加参与人，保证关系能成为图谱中的一条边；
6. 生成唯一生成物 `frontend/data/ingested-graph-data.generated.ts`（事件 / 参与者增补 /
   重要度覆盖 / 别名 / 人物 ID 固定 / 关系 / 关系补丁 / 新图谱分期 / 名人堂）；
7. 依次运行既有 Node 流水线：`build-persons` → `extract-sources` → `export-snapshot`
   → `validate-data`，最后运行 `scripts/check_consistency.py` 做 RAG / 孤儿节点检查；
8. 写出入库报告 `docs/图谱数据入库报告.md`（可用 `--report` 指定）。

用法
----
    python backend/scripts/ingest_graph_data.py                 # 全自动入库 + 校验
    python backend/scripts/ingest_graph_data.py --dry-run       # 只解析 / 打印报告，不写盘
    python backend/scripts/ingest_graph_data.py --check         # 只校验生成物是否最新（CI）
    python backend/scripts/ingest_graph_data.py --skip-node     # 只写生成物，不跑 Node 流水线
    python backend/scripts/ingest_graph_data.py --skip-consistency
    python backend/scripts/ingest_graph_data.py --pattern "史脉_V1.0.5.4_*.md"

设计约束
--------
* 脚本只依赖 Python 标准库；拼音罗马化复用前端 `pinyin-pro`（通过 Node 辅助脚本调用），
  与 `scripts/build-persons.mjs` 的 ID 规则保持一致；
* 所有输出内容确定性排序、不含时间戳，重复运行字节级一致（`--check` 据此判定）；
* 只写「生成物」：`ingested-graph-data.generated.ts`、`backend/data/ingest/person-id-pins.json`、
  入库报告，以及既有 Node 脚本自己的生成物（persons.generated.ts / event-sources.ts /
  snapshot / 锁文件）；**不改写任何手写数据文件**（timeline-events.ts 等只需一次性接线）。
"""

from __future__ import annotations

import argparse
import json
import re
import subprocess
import sys
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Iterable

ROOT = Path(__file__).resolve().parents[2]
DOCS_DIR = ROOT / "docs"
BACKEND_DIR = ROOT / "backend"
DATA_DIR = ROOT / "frontend" / "data"
INGEST_DIR = BACKEND_DIR / "data" / "ingest"
CONFIG_PATH = INGEST_DIR / "config.json"
PINS_PATH = INGEST_DIR / "person-id-pins.json"
GENERATED_TS = DATA_DIR / "ingested-graph-data.generated.ts"
PERSON_LOCK_PATH = DATA_DIR / "locks" / "person-ids.lock.json"
HELPER = ROOT / "scripts" / "ingest-data-helper.mjs"
DEFAULT_REPORT = DOCS_DIR / "图谱数据入库报告.md"
CONSISTENCY_SCRIPT = ROOT / "scripts" / "check_consistency.py"


class IngestError(RuntimeError):
    """输入数据 / 生成物 / 流水线不一致，必须中止。"""


# ---------------------------------------------------------------------------
# 基础工具
# ---------------------------------------------------------------------------


def log(message: str) -> None:
    print(message, flush=True)


def warn(warnings: list[str], message: str) -> None:
    warnings.append(message)
    print(f"  !  {message}", flush=True)


def find_node() -> str:
    """解析 Node 可执行文件：PATH → DSH 内置运行时 → Windows 常见安装位置。"""
    import shutil

    found = shutil.which("node")
    if found:
        return found
    candidates: list[Path] = []
    dsh_home = Path.home() / ".dsh"
    for runtimes in (dsh_home / "dsh-runtimes", Path.home() / ".dsh" / "runtimes"):
        if runtimes.is_dir():
            for runtime in sorted(runtimes.iterdir()):
                candidates.append(runtime / "dependencies" / "node" / "bin" / "node.exe")
                candidates.append(runtime / "dependencies" / "node" / "node.exe")
    candidates.extend(
        [
            Path("C:/Program Files/nodejs/node.exe"),
            Path.home() / "AppData" / "Local" / "Programs" / "nodejs" / "node.exe",
            Path("C:/Program Files (x86)/nodejs/node.exe"),
        ]
    )
    for candidate in candidates:
        if candidate.is_file():
            return str(candidate)
    raise IngestError(
        "未找到 Node.js。请安装 Node.js ≥ 20 并确保 `node` 在 PATH 中，"
        "或先运行 `pnpm install`（本脚本需要复用前端 pinyin-pro 与既有数据生成脚本）。"
    )


class NodeRunner:
    """Node 子进程封装（统一 UTF-8、错误信息可诊断）。"""

    def __init__(self) -> None:
        self.node = find_node()

    def run(self, args: list[str], *, stdin: str | None = None, cwd: Path = ROOT) -> str:
        command = [self.node, *args]
        process = subprocess.run(
            command,
            cwd=str(cwd),
            input=stdin,
            capture_output=True,
            text=True,
            encoding="utf-8",
            errors="replace",
        )
        if process.returncode != 0:
            raise IngestError(
                f"Node 命令失败（exit={process.returncode}）：{' '.join(command)}\n"
                f"{process.stderr.strip() or process.stdout.strip()}"
            )
        return process.stdout

    def helper(self, command: str, *, stdin: str | None = None) -> Any:
        output = self.run([str(HELPER), command], stdin=stdin)
        try:
            return json.loads(output)
        except json.JSONDecodeError as exc:  # pragma: no cover - 防御性
            raise IngestError(f"Node 辅助脚本输出不是合法 JSON：{exc}\n{output[:500]}") from exc


# ---------------------------------------------------------------------------
# Markdown 解析
# ---------------------------------------------------------------------------


@dataclass
class ParsedEvent:
    dynasty: str
    year: int
    year_raw: str
    title: str
    description: str
    participants: list[str]
    importance: int | None
    source_doc: str


@dataclass
class ParsedRelation:
    dynasty: str
    person_a: str
    person_b: str
    label: str
    anchor_titles: list[str]
    description: str
    source_doc: str


@dataclass
class ParseResult:
    path: Path
    events: list[ParsedEvent] = field(default_factory=list)
    relations: list[ParsedRelation] = field(default_factory=list)


YEAR_RE = re.compile(r"前\s*(\d+)")
YEAR_AD_RE = re.compile(r"(\d{1,4})\s*年?")


def parse_year(raw: str) -> int:
    """把「约前2100 / 前1046后 / 约前1400-前1300 / 827」解析成史书纪年整数。"""
    text = raw.strip().replace("公元", "").replace(" ", "")
    if not text:
        raise IngestError(f"无法解析年份：{raw!r}")
    match = YEAR_RE.search(text)
    if match:
        return -int(match.group(1))
    match = YEAR_AD_RE.search(text)
    if match:
        return int(match.group(1))
    raise IngestError(f"无法解析年份：{raw!r}")


def split_cell_list(cell: str) -> list[str]:
    """按中英文逗号 / 顿号 / 分号切分单元格，保持原顺序并去重。"""
    pieces = re.split(r"[,，、;；]", cell)
    result: list[str] = []
    for piece in pieces:
        value = piece.strip().strip("。")
        if value and value not in result:
            result.append(value)
    return result


def split_table_row(line: str) -> list[str]:
    stripped = line.strip()
    if stripped.startswith("|"):
        stripped = stripped[1:]
    if stripped.endswith("|"):
        stripped = stripped[:-1]
    return [cell.strip() for cell in stripped.split("|")]


def iter_tables(lines: list[str]) -> Iterable[tuple[str, list[str], list[list[str]]]]:
    """逐张产出 (所属章节标题, 表头, 数据行)。"""
    heading = ""
    index = 0
    while index < len(lines):
        line = lines[index]
        if line.startswith("## "):
            heading = line[3:].strip()
            index += 1
            continue
        if not line.strip().startswith("|"):
            index += 1
            continue
        header = split_table_row(line)
        rows: list[list[str]] = []
        index += 1
        while index < len(lines) and lines[index].strip().startswith("|"):
            row_line = lines[index].strip()
            if re.match(r"^\|[\s:|-]+\|?$", row_line):
                index += 1
                continue
            cells = split_table_row(row_line)
            if any(cell for cell in cells):
                rows.append(cells)
            index += 1
        yield heading, header, rows


def column_index(header: list[str], *keys: str) -> int | None:
    for position, cell in enumerate(header):
        if any(key in cell for key in keys):
            return position
    return None


def cell_at(row: list[str], position: int | None, default: str = "") -> str:
    if position is None or position >= len(row):
        return default
    return row[position]


def parse_document(path: Path) -> ParseResult:
    """解析一份「图谱扩充」文档中的表一（事件）/ 表二（人物关系）。"""
    text = path.read_text(encoding="utf-8")
    lines = text.splitlines()
    result = ParseResult(path=path)
    for heading, header, rows in iter_tables(lines):
        joined = "".join(header)
        if "事件名称" in joined and "参与人物" in joined:
            dynasty_col = column_index(header, "朝代")
            year_col = column_index(header, "年份")
            title_col = column_index(header, "事件名称", "事件名")
            desc_col = column_index(header, "事件简述", "简述")
            people_col = column_index(header, "参与人物")
            importance_col = column_index(header, "重要度")
            if title_col is None or people_col is None:
                raise IngestError(f"{path.name}：表一缺少「事件名称 / 参与人物」列（章节：{heading}）")
            for row in rows:
                title = cell_at(row, title_col).strip()
                if not title or title in {"事件名称", "事件名"}:
                    continue
                year_raw = cell_at(row, year_col)
                participants = split_cell_list(cell_at(row, people_col))
                importance_raw = cell_at(row, importance_col)
                importance: int | None = None
                match = re.search(r"[123]", importance_raw)
                if match:
                    importance = int(match.group(0))
                result.events.append(
                    ParsedEvent(
                        dynasty=cell_at(row, dynasty_col).strip() or "未分期",
                        year=parse_year(year_raw),
                        year_raw=year_raw.strip(),
                        title=title,
                        description=cell_at(row, desc_col).strip(),
                        participants=participants,
                        importance=importance,
                        source_doc=path.name,
                    )
                )
        elif "人物A" in joined and "人物B" in joined:
            dynasty_col = column_index(header, "朝代")
            a_col = column_index(header, "人物A")
            b_col = column_index(header, "人物B")
            label_col = column_index(header, "关系")
            event_col = column_index(header, "共同参与事件")
            desc_col = column_index(header, "关系简述", "简述")
            if a_col is None or b_col is None:
                raise IngestError(f"{path.name}：表二缺少「人物A / 人物B」列（章节：{heading}）")
            for row in rows:
                person_a = cell_at(row, a_col).strip()
                person_b = cell_at(row, b_col).strip()
                if not person_a or not person_b or person_a in {"人物A"}:
                    continue
                if person_a == person_b:
                    continue
                result.relations.append(
                    ParsedRelation(
                        dynasty=cell_at(row, dynasty_col).strip() or "未分期",
                        person_a=person_a,
                        person_b=person_b,
                        label=cell_at(row, label_col).strip() or "关系未详",
                        anchor_titles=split_cell_list(cell_at(row, event_col)),
                        description=cell_at(row, desc_col).strip(),
                        source_doc=path.name,
                    )
                )
    return result


# ---------------------------------------------------------------------------
# 数据模型 / 合并结果
# ---------------------------------------------------------------------------


@dataclass
class MergedEvent:
    """合并后的事件：既有事件复用 base_id，只记录参与者增补；否则生成新记录。"""

    title: str
    dynasty: str
    year: int
    importance: int | None
    description: str
    base_id: str | None
    participants: list[str]
    additions: list[str]
    doc_title: str


@dataclass
class FinalEvent:
    event_id: str
    title: str
    dynasty: str
    year: int
    importance: int | None
    description: str
    participants: list[str]


# ---------------------------------------------------------------------------
# 主流程
# ---------------------------------------------------------------------------


class GraphIngestor:
    def __init__(self, args: argparse.Namespace) -> None:
        self.args = args
        self.config: dict[str, Any] = json.loads(CONFIG_PATH.read_text(encoding="utf-8"))
        if self.config.get("schema_version") != "graph-ingest-config.v1":
            raise IngestError("backend/data/ingest/config.json 的 schema_version 非法。")
        self.runner = NodeRunner()
        self.warnings: list[str] = []
        self.report_lines: list[str] = []
        self.parsed: list[ParseResult] = []
        self.base_index: dict[str, Any] = {}
        self.base_events: dict[str, dict[str, Any]] = {}
        self.base_participants: set[str] = set()
        self.base_relation_pairs: dict[str, dict[str, Any]] = {}
        self.base_alias_keys: set[str] = set()
        self.roman: dict[str, str] = {}
        self.pins_state: dict[str, Any] = {"schema_version": "person-id-pins.v1", "persons": {}}
        self.merged_events: list[MergedEvent] = []
        self.final_events: dict[str, FinalEvent] = {}
        self.new_events: list[FinalEvent] = []
        self.importance_overrides: dict[str, list[Any]] = {}
        self.relation_patches: list[dict[str, Any]] = []
        self.new_relations: list[dict[str, Any]] = []
        self.new_eras: list[dict[str, Any]] = []
        self.base_additions: dict[str, list[str]] = {}
        self.key_figures: dict[str, list[str]] = {}
        self.era_scope_map: dict[str, str] = {}
        self.aliases: dict[str, str] = {}
        self.person_pins: dict[str, str] = {}
        self.generated_content = ""
        self.pins_content = ""

    # -- 输入 ---------------------------------------------------------------
    def load_index(self) -> None:
        log("[1/7] 读取基准数据层索引（Node / TypeScript）…")
        self.base_index = self.runner.helper("index")
        self.base_events = {event["id"]: event for event in self.base_index["events"]}
        for event in self.base_events.values():
            for name in event.get("participants") or []:
                self.base_participants.add(name)
        for relation in self.base_index["relations"]:
            key = "__".join(sorted([relation["a"], relation["b"]]))
            self.base_relation_pairs[key] = relation
        self.base_alias_keys = set(self.base_index.get("aliases") or {})
        log(
            f"   基准数据：{len(self.base_events)} 条事件 / {len(self.base_relation_pairs)} 对关系 / "
            f"{len(self.base_index['eras'])} 个细览分期 / {len(self.base_index['dynasty_order'])} 个朝代"
        )

    def resolve_doc_paths(self) -> list[Path]:
        patterns = [self.args.pattern] if self.args.pattern else self.config["doc_globs"]
        excludes = self.config.get("doc_exclude_patterns") or []
        from fnmatch import fnmatch

        paths: list[Path] = []
        for pattern in patterns:
            for path in sorted(DOCS_DIR.glob(pattern)):
                if not path.is_file():
                    continue
                if any(fnmatch(path.name, exclude) for exclude in excludes):
                    continue
                if path in paths:
                    continue
                paths.append(path)
        if not paths:
            raise IngestError(
                f"未在 docs/ 下找到匹配的图谱扩充文档：{patterns}（检查 --pattern 或文件名）"
            )
        return paths

    def parse_documents(self) -> None:
        paths = self.resolve_doc_paths()
        log(f"[2/7] 扫描并解析 {len(paths)} 份文档…")
        for path in paths:
            parsed = parse_document(path)
            if not parsed.events and not parsed.relations:
                warn(self.warnings, f"{path.name} 未解析到表一/表二，已跳过。")
                continue
            self.parsed.append(parsed)
            log(
                f"   {path.name}：事件 {len(parsed.events)} 条 / 人物关系 {len(parsed.relations)} 条"
            )
        if not self.parsed:
            raise IngestError("所有候选文档都没有解析到有效表格数据。")
        self._dedupe_parsed()

    def _dedupe_parsed(self) -> None:
        """跨文档合并同题事件 / 同一人物对关系（只做保守合并，冲突留待人工裁决）。"""
        events_by_title: dict[str, ParsedEvent] = {}
        relations_by_pair: dict[str, ParsedRelation] = {}
        self.original_person_names: set[str] = set()
        for parsed in self.parsed:
            for event in parsed.events:
                # 归一化会改写事件参与者，别名来源必须在归一化前采集。
                self.original_person_names.update(event.participants)
                key = self._normalize_title(event.title)
                existing = events_by_title.get(key)
                if existing is None:
                    events_by_title[key] = event
                    continue
                if (existing.dynasty, existing.year) != (event.dynasty, event.year):
                    warn(
                        self.warnings,
                        f"同题事件「{event.title}」在多份文档中朝代/年份不一致，保留首个（{existing.dynasty} {existing.year_raw}）。",
                    )
                for name in event.participants:
                    if name not in existing.participants:
                        existing.participants.append(name)
                if event.importance and (existing.importance or 0) < event.importance:
                    existing.importance = event.importance
            for relation in parsed.relations:
                self.original_person_names.update([relation.person_a, relation.person_b])
                key = "__".join(sorted([relation.person_a, relation.person_b]))
                if key not in relations_by_pair:
                    relations_by_pair[key] = relation
        self.doc_events = list(events_by_title.values())
        self.doc_relations = list(relations_by_pair.values())
        log(
            f"   去重后：事件 {len(self.doc_events)} 条 / 人物关系 {len(self.doc_relations)} 条"
        )

    # -- 归一化 -------------------------------------------------------------
    @staticmethod
    def _normalize_title(title: str) -> str:
        return re.sub(r"[\s·・•\-—_（）()【】\[\]《》]", "", title.strip())

    def canonical_person(self, name: str) -> str:
        cleaned = name.strip()
        return self.config.get("canonical_person_names", {}).get(cleaned, cleaned)

    def batch_romanize(self, texts: Iterable[str]) -> None:
        pending = sorted({text for text in texts if text and text not in self.roman})
        if not pending:
            return
        mapping = self.runner.helper("romanize", stdin=json.dumps(pending, ensure_ascii=False))
        self.roman.update({key: value for key, value in mapping.items() if value})

    # -- 事件合并 -----------------------------------------------------------
    def merge_events(self) -> None:
        log("[3/7] 合并事件（去重 / 参与人增补 / 重要度就高 / 新事件 ID）…")
        title_map: dict[str, str] = {
            self._normalize_title(title): event_id
            for title, event_id in (self.config.get("event_title_map") or {}).items()
        }
        base_title_index: dict[str, list[str]] = {}
        for event_id, event in self.base_events.items():
            base_title_index.setdefault(self._normalize_title(event["title"]), []).append(event_id)

        # 先归一化 + 收集候选，再批量罗马化。
        prepared: list[ParsedEvent] = []
        for event in self.doc_events:
            event.participants = [
                canonical
                for canonical in (self.canonical_person(name) for name in event.participants)
                if canonical
            ]
            # 去重且保持顺序
            seen: set[str] = set()
            event.participants = [
                name for name in event.participants if not (name in seen or seen.add(name))
            ]
            prepared.append(event)

        # 来源表里只列了主角、但史料明确共同参与的人物（如《史记》载祭公谋父谏穆王征犬戎），
        # 由 config 人工补全，避免单参与者事件产生孤立节点。
        for event in prepared:
            for extra_name in (self.config.get("event_participant_additions") or {}).get(
                event.title, []
            ):
                canonical_extra = self.canonical_person(extra_name)
                if canonical_extra and canonical_extra not in event.participants:
                    event.participants.append(canonical_extra)
        new_titles = []
        for event in prepared:
            key = self._normalize_title(event.title)
            if title_map.get(key) or base_title_index.get(key):
                continue
            new_titles.append(event.title)
        self.batch_romanize([*new_titles, *[event.title for event in prepared]])

        # 新事件按「朝代顺序 → 年份 → 标题」排序后编号，保证 ID 稳定。
        dynasty_rank = {dynasty: index for index, dynasty in enumerate(self.base_index["dynasty_order"])}
        unknown_new = [
            event
            for event in prepared
            if not title_map.get(self._normalize_title(event.title))
            and not base_title_index.get(self._normalize_title(event.title))
        ]
        unknown_new.sort(
            key=lambda event: (
                dynasty_rank.get(event.dynasty, len(dynasty_rank)),
                event.year,
                event.title,
            )
        )
        dynasty_prefix = self.config.get("dynasty_ids", {})
        ordinal_by_dynasty: dict[str, int] = {}
        new_id_by_title: dict[str, str] = {}
        for event in unknown_new:
            dynasty_key = dynasty_prefix.get(event.dynasty) or self.roman.get(event.dynasty, "dynasty")
            ordinal_by_dynasty[dynasty_key] = ordinal_by_dynasty.get(dynasty_key, 0) + 1
            roman_title = self.roman.get(event.title, "event")
            new_id_by_title[self._normalize_title(event.title)] = (
                f"{dynasty_key}-{roman_title[:40]}-{ordinal_by_dynasty[dynasty_key]:02d}"
            )

        self.final_events = {
            event_id: FinalEvent(
                event_id=event_id,
                title=event["title"],
                dynasty=event["dynasty"],
                year=event["year"],
                importance=event.get("importance"),
                description=event.get("description", ""),
                participants=list(event.get("participants") or []),
            )
            for event_id, event in self.base_events.items()
        }

        for event in prepared:
            key = self._normalize_title(event.title)
            base_id = title_map.get(key)
            if base_id is None:
                base_candidates = base_title_index.get(key) or []
                if len(base_candidates) == 1:
                    base_id = base_candidates[0]
                elif len(base_candidates) > 1:
                    raise IngestError(
                        f"事件「{event.title}」在既有数据中有多个同题事件：{base_candidates}，请在 event_title_map 指定。"
                    )
            if base_id:
                base = self.base_events.get(base_id)
                if base is None:
                    raise IngestError(
                        f"event_title_map 把「{event.title}」映射到了不存在的事件 {base_id}。"
                    )
                additions = [name for name in event.participants if name not in base["participants"]]
                if additions:
                    bucket = self.base_additions.setdefault(base_id, [])
                    for name in additions:
                        if name not in bucket:
                            bucket.append(name)
                base_importance = base.get("importance")
                if event.importance and (base_importance or 2) < event.importance:
                    self.importance_overrides[base_id] = [base_importance, event.importance]
                self.merged_events.append(
                    MergedEvent(
                        title=base["title"],
                        dynasty=base["dynasty"],
                        year=base["year"],
                        importance=event.importance,
                        description=base.get("description", ""),
                        base_id=base_id,
                        participants=list(base["participants"]),
                        additions=additions,
                        doc_title=event.title,
                    )
                )
                continue

            event_id = new_id_by_title[key]
            if event_id in self.final_events:
                raise IngestError(f"生成的新事件 ID 冲突：{event_id}（{event.title}）")
            description = self._with_source_note(event)
            final = FinalEvent(
                event_id=event_id,
                title=event.title,
                dynasty=event.dynasty,
                year=event.year,
                importance=event.importance,
                description=description,
                participants=list(event.participants),
            )
            self.final_events[event_id] = final
            self.new_events.append(final)
            self.merged_events.append(
                MergedEvent(
                    title=event.title,
                    dynasty=event.dynasty,
                    year=event.year,
                    importance=event.importance,
                    description=description,
                    base_id=None,
                    participants=list(event.participants),
                    additions=list(event.participants),
                    doc_title=event.title,
                )
            )

        # 把「参与人增补」应用到最终事件池（关系判定 / 图谱节点 / 快照都以最终池为准）。
        for event_id, additions in self.base_additions.items():
            event = self.final_events[event_id]
            for name in additions:
                if name not in event.participants:
                    event.participants.append(name)

        # 批量罗马化全部参与者姓名（新人物 ID / 别名 / 事件 ID 共用同一套拼音）。
        self.batch_romanize(
            [
                name
                for event in self.final_events.values()
                for name in event.participants
            ]
        )

        # 模糊重复提示：未映射但对既有标题高度相近，提示人工确认是否补 event_title_map。
        for event in prepared:
            key = self._normalize_title(event.title)
            if title_map.get(key) or base_title_index.get(key):
                continue
            for base_title, base_ids in base_title_index.items():
                if len(key) >= 4 and (key in base_title or base_title in key):
                    warn(
                        self.warnings,
                        f"事件「{event.title}」与既有事件「{self.base_events[base_ids[0]]['title']}」"
                        f"（{base_ids[0]}）标题高度相近，脚本未自动合并；如属同一史实请补 event_title_map。",
                    )
        log(
            f"   新事件 {len(self.new_events)} 条 / 复用并增补既有事件 "
            f"{sum(1 for item in self.merged_events if item.base_id)} 条"
        )

    def _with_source_note(self, event: ParsedEvent) -> str:
        sources = (self.config.get("event_source_map") or {}).get(event.title)
        if not sources:
            sources = {
                "夏": "《史记·夏本纪》",
                "商": "《史记·殷本纪》",
                "西周": "《史记·周本纪》",
            }.get(event.dynasty)
        if not sources:
            warn(
                self.warnings,
                f"新事件「{event.title}」没有配置 event_source_map，且朝代「{event.dynasty}」无默认出处；"
                "将标记为（出处待补），可能无法通过 extract-sources 校验。",
            )
            return f"{event.description}（出处待补）"
        note = ""
        if event.year < int(self.config.get("source_notes_after_year", -841)):
            note = f"；{self.config.get('source_note', '年代依夏商周断代工程推定')}"
        description = event.description.strip()
        if not description.endswith("。"):
            description += "。"
        return f"{description}（据{sources}{note}）"

    # -- 关系合并 -----------------------------------------------------------
    def merge_relations(self) -> None:
        log("[4/7] 合并人物关系（共同事件锚点 / 参与人兜底 / 关系补丁）…")
        dynasty_rank = {dynasty: index for index, dynasty in enumerate(self.base_index["dynasty_order"])}
        relation_records: list[ParsedRelation] = []
        for relation in self.doc_relations:
            relation.person_a = self.canonical_person(relation.person_a)
            relation.person_b = self.canonical_person(relation.person_b)
            if not relation.person_a or not relation.person_b:
                continue
            relation_records.append(relation)
        relation_records.sort(
            key=lambda item: (
                dynasty_rank.get(item.dynasty, len(dynasty_rank)),
                item.person_a,
                item.person_b,
            )
        )

        def event_has(event: FinalEvent, name: str) -> bool:
            return name in event.participants

        new_event_ids = {event.event_id for event in self.new_events}

        def add_participant(event_id: str, name: str) -> None:
            event = self.final_events[event_id]
            if name in event.participants:
                return
            event.participants.append(name)
            if event_id not in new_event_ids:
                bucket = self.base_additions.setdefault(event_id, [])
                if name not in bucket:
                    bucket.append(name)
            for merged in self.merged_events:
                if merged.base_id == event_id and name not in merged.additions:
                    merged.additions.append(name)

        for relation in relation_records:
            a, b = relation.person_a, relation.person_b
            anchor_ids: list[str] = []
            for anchor in relation.anchor_titles:
                event_id = self._resolve_event_title(anchor)
                if event_id and event_id not in anchor_ids:
                    anchor_ids.append(event_id)
            shared = [
                event
                for event in self.final_events.values()
                if event_has(event, a) and event_has(event, b)
            ]
            primary: str | None = None
            for anchor_id in anchor_ids:
                if anchor_id in {event.event_id for event in shared}:
                    primary = anchor_id
                    break
            if primary is None and shared:
                shared.sort(
                    key=lambda event: (
                        0 if event.dynasty == relation.dynasty else 1,
                        -abs(event.year),
                        event.event_id,
                    )
                )
                primary = shared[0].event_id
            if primary is None and anchor_ids:
                primary = anchor_ids[0]
                add_participant(primary, a)
                add_participant(primary, b)
            if primary is None:
                warn(
                    self.warnings,
                    f"关系「{a} × {b}」（{relation.dynasty}）找不到可用的共同事件锚点，已跳过。",
                )
                continue
            if not (event_has(self.final_events[primary], a) and event_has(self.final_events[primary], b)):
                add_participant(primary, a)
                add_participant(primary, b)

            pair_key = "__".join(sorted([a, b]))
            summary = relation.description or relation.label
            if pair_key in self.base_relation_pairs:
                base_summaries = set(self.base_relation_pairs[pair_key].get("event_summaries") or [])
                if primary in base_summaries:
                    continue
                self.relation_patches.append(
                    {"pairKey": pair_key, "eventSummaries": {primary: summary}}
                )
                continue
            self.new_relations.append(
                {
                    "a": a,
                    "b": b,
                    "label": relation.label,
                    "description": relation.description or None,
                    "eventSummaries": {primary: summary},
                }
            )
        log(
            f"   新增关系 {len(self.new_relations)} 对 / 合并进既有关系 "
            f"{len(self.relation_patches)} 对补丁"
        )

    def _resolve_event_title(self, title: str) -> str | None:
        key = self._normalize_title(title)
        mapping = {
            self._normalize_title(doc_title): event_id
            for doc_title, event_id in (self.config.get("event_title_map") or {}).items()
        }
        if key in mapping:
            return mapping[key]
        for event_id, event in self.final_events.items():
            if self._normalize_title(event.title) == key:
                return event_id
        candidates = [
            event_id
            for event_id, event in self.final_events.items()
            if len(key) >= 4 and key in self._normalize_title(event.title)
        ]
        if len(candidates) == 1:
            return candidates[0]
        return None

    # -- 图谱分期 / 别名 / 名人堂 -------------------------------------------
    def build_eras(self) -> None:
        log("[5/7] 生成新图谱分期 / 别名 / 名人堂配置…")
        dynasty_rank = {dynasty: index for index, dynasty in enumerate(self.base_index["dynasty_order"])}
        existing_era_dynasties: set[str] = set()
        for era in self.base_index["eras"]:
            existing_era_dynasties.update(era["dynasties"])
        batch_dynasties = []
        for event in self.final_events.values():
            if event.dynasty not in batch_dynasties:
                batch_dynasties.append(event.dynasty)
        batch_dynasties.sort(
            key=lambda dynasty: (dynasty_rank.get(dynasty, len(dynasty_rank)), dynasty)
        )

        era_defaults = self.config.get("era_defaults") or {}
        era_extra = self.config.get("era_extra_dynasties") or {}
        era_scope = self.config.get("era_scope_map") or {}
        for dynasty in batch_dynasties:
            if dynasty in existing_era_dynasties:
                continue
            extra_dynasties = [item for item in era_extra.get(dynasty, []) if item in self.base_index["dynasty_start_years"]]
            graph_dynasties = extra_dynasties + [dynasty]
            graph_dynasties.sort(key=lambda item: (dynasty_rank.get(item, len(dynasty_rank)), item))
            default = era_defaults.get(dynasty) or {}
            era_id = default.get("id") or self.config.get("dynasty_ids", {}).get(dynasty)
            if not era_id:
                era_id = self.roman.get(dynasty) or self.runner.helper(
                    "romanize", stdin=json.dumps([dynasty], ensure_ascii=False)
                )[dynasty]
            event_ids = sorted(
                event.event_id
                for event in self.final_events.values()
                if event.dynasty in graph_dynasties
            )
            if not event_ids:
                warn(self.warnings, f" dynasty「{dynasty}」没有任何事件，跳过图谱分期生成。")
                continue
            center = default.get("default_center_person_id") or self._top_figures(
                event_ids, 1, main_dynasty=dynasty
            )[0]
            participants = {name for event_id in event_ids for name in self.final_events[event_id].participants}
            if center not in participants:
                raise IngestError(
                    f"图谱分期「{dynasty}」默认中心「{center}」不在该期事件参与者中："
                    f"{sorted(participants)[:20]}"
                )
            self.new_eras.append(
                {
                    "id": era_id,
                    "label": dynasty,
                    "dynasties": graph_dynasties,
                    "eventIds": event_ids,
                    "defaultCenterPersonId": center,
                }
            )
            figures = self._top_figures(
                event_ids, int(self.config.get("key_figure_size", 8)), main_dynasty=dynasty
            )
            if center not in figures:
                figures = [center, *figures][: int(self.config.get("key_figure_size", 8))]
            self.key_figures[dynasty] = figures
            scope = era_scope.get(dynasty)
            if scope:
                self.era_scope_map[era_id] = scope
        log(f"   新增图谱分期 {len(self.new_eras)} 个：{[era['label'] for era in self.new_eras]}")

    def _top_figures(
        self, event_ids: list[str], limit: int, main_dynasty: str | None = None
    ) -> list[str]:
        """按事件度数排出代表性人物；指定 main_dynasty 时只保留「本朝为主」的人物（排除前史）。"""
        counter: dict[str, int] = {}
        main_counter: dict[str, int] = {}
        for event_id in event_ids:
            event = self.final_events[event_id]
            for name in event.participants:
                counter[name] = counter.get(name, 0) + 1
                if event.dynasty == main_dynasty:
                    main_counter[name] = main_counter.get(name, 0) + 1
        ranked = [
            (name, count)
            for name, count in counter.items()
            if main_dynasty is None or main_counter.get(name, 0) * 2 >= count
        ]
        ranked.sort(key=lambda item: (-item[1], item[0]))
        return [name for name, _count in ranked[:limit]]

    def build_aliases(self) -> None:
        configured = self.config.get("canonical_person_names") or {}
        participant_names = {
            name for event in self.final_events.values() for name in event.participants
        }
        graph_names: set[str] = set()
        for era in self.new_eras:
            for event_id in era["eventIds"]:
                graph_names.update(self.final_events[event_id].participants)
        for scope in self.base_index["scopes"]:
            graph_names.update(participant_names)  # 先秦简阅覆盖全部前秦事件，兜底
        originals: set[str] = set(getattr(self, "original_person_names", set()))
        for parsed in self.parsed:
            for event in parsed.events:
                originals.update(event.participants)
            for relation in parsed.relations:
                originals.update([relation.person_a, relation.person_b])
        for original in sorted(originals):
            canonical = configured.get(original)
            if not canonical or canonical == original:
                continue
            if canonical not in participant_names:
                warn(
                    self.warnings,
                    f"别名「{original}」→「{canonical}」的目标不是任何事件参与者，已跳过。",
                )
                continue
            if original in participant_names:
                warn(
                    self.warnings,
                    f"别名「{original}」本身也是事件参与者姓名，为避免串人已跳过。",
                )
                continue
            self.aliases[original] = canonical
        for alias, target in (self.config.get("extra_person_aliases") or {}).items():
            if target not in participant_names:
                warn(self.warnings, f"额外别名「{alias}」→「{target}」的目标不是事件参与者，已跳过。")
                continue
            if alias in participant_names:
                warn(self.warnings, f"额外别名「{alias}」本身是人物姓名，已跳过。")
                continue
            self.aliases[alias] = target
        # 目标必须在某个图谱节点中出现（否则 validate-data 会失败）。
        for alias, target in sorted(self.aliases.items()):
            if target not in graph_names:
                warn(
                    self.warnings,
                    f"别名「{alias}」→「{target}」的目标不在任何图谱节点中，已跳过。",
                )
                del self.aliases[alias]
        log(f"   别名映射 {len(self.aliases)} 条：{self.aliases}")

    def build_person_pins(self) -> None:
        if PINS_PATH.exists():
            try:
                state = json.loads(PINS_PATH.read_text(encoding="utf-8"))
                if isinstance(state.get("persons"), dict):
                    self.pins_state = state
            except json.JSONDecodeError:
                warn(self.warnings, f"{PINS_PATH} 不是合法 JSON，将按空状态重建。")
        state_persons: dict[str, str] = {
            str(name): str(person_id)
            for name, person_id in (self.pins_state.get("persons") or {}).items()
        }
        manual_pins: dict[str, str] = {
            str(name): str(person_id)
            for name, person_id in (self.config.get("person_id_pins") or {}).items()
        }
        # 既有 person_id（锁文件 + 生成器），用于冲突检测。
        existing_ids: set[str] = set()
        if PERSON_LOCK_PATH.exists():
            try:
                lock = json.loads(PERSON_LOCK_PATH.read_text(encoding="utf-8"))
                existing_ids.update(entry["id"] for entry in lock.get("persons") or [])
            except json.JSONDecodeError:
                warn(self.warnings, f"{PERSON_LOCK_PATH} 不是合法 JSON，ID 冲突检测可能不完整。")
        participant_names = {
            name for event in self.final_events.values() for name in event.participants
        }
        new_persons = sorted(participant_names - self.base_participants)
        claimed = set(manual_pins.values()) | set(state_persons.values())
        dynasty_rank = {dynasty: index for index, dynasty in enumerate(self.base_index["dynasty_order"])}
        for name in new_persons:
            if name in manual_pins or name in state_persons:
                continue
            related = sorted(
                (event for event in self.final_events.values() if name in event.participants),
                key=lambda event: (event.year, event.event_id),
            )
            dynasty = related[0].dynasty if related else "未知"
            dynasty_prefix = self.config.get("dynasty_ids", {}).get(dynasty) or self.roman.get(
                dynasty, "dynasty"
            )
            roman = self.roman.get(name) or self.runner.helper(
                "romanize", stdin=json.dumps([name], ensure_ascii=False)
            ).get(name, "unknown")
            ordinal = 1
            candidate = f"p-{dynasty_prefix}-{roman}-{ordinal:02d}"
            while candidate in existing_ids or candidate in claimed:
                ordinal += 1
                if ordinal > 99:
                    raise IngestError(f"人物「{name}」的 ID 序号超过 99，请检查数据。")
                candidate = f"p-{dynasty_prefix}-{roman}-{ordinal:02d}"
            state_persons[name] = candidate
            claimed.add(candidate)
        # 手工 pin 必须覆盖 / 覆盖优先级最高。
        merged_pins = {**state_persons, **manual_pins}
        for name, person_id in merged_pins.items():
            if name not in participant_names:
                warn(
                    self.warnings,
                    f"人物 ID 固定「{name}」→「{person_id}」未出现在本批参与者中（保留历史固定，不报错）。",
                )
        self.person_pins = dict(sorted(merged_pins.items()))
        self.pins_state = {
            "schema_version": "person-id-pins.v1",
            "description": "由 backend/scripts/ingest_graph_data.py 维护：新增人物的可读 person_id 固定表（禁止手改键顺序）。",
            "persons": dict(sorted(state_persons.items())),
        }
        self.pins_content = (
            json.dumps(self.pins_state, ensure_ascii=False, indent=2, sort_keys=False) + "\n"
        )
        log(
            f"   新增人物 {len(new_persons)} 位：{new_persons}；人物 ID 固定 {len(self.person_pins)} 条"
        )

    # -- 生成物 -------------------------------------------------------------
    def render_generated_ts(self) -> str:
        def ts_json(value: Any) -> str:
            return json.dumps(value, ensure_ascii=False, sort_keys=True)

        def ts_object(entries: Iterable[tuple[str, Any]]) -> str:
            lines = []
            for key, value in entries:
                lines.append(f"  {json.dumps(key, ensure_ascii=False)}: {ts_json(value)},")
            return "{\n" + "\n".join(lines) + "\n}"

        doc_files = sorted({parsed.path.name for parsed in self.parsed})
        lines: list[str] = [
            "/**",
            " * 自动生成，禁止手改（backend/scripts/ingest_graph_data.py）。",
            " *",
            f" * 来源文档：{'、'.join(doc_files)}",
            " * 重新生成：python backend/scripts/ingest_graph_data.py",
            " * 校验：python backend/scripts/ingest_graph_data.py --check",
            " *",
            " * 生成内容：新事件 / 既有事件参与者增补 / 重要度覆盖 / 人物别名 / 人物 ID 固定 /",
            " * 人物关系与关系补丁 / 新图谱分期 / 名人堂。数据接线见 timeline-events.ts、",
            " * timeline-participants.ts、person-graph.ts、person-relations.ts。",
            " */",
            'import type { Dynasty } from "./timeline-events";',
            'import type { PersonRelationRecord } from "./person-relations";',
            "",
            "export interface IngestedEventRecord {",
            "  id: string;",
            "  title: string;",
            "  dynasty: Dynasty;",
            "  year: number;",
            "  date?: string;",
            "  description: string;",
            "  importance?: 1 | 2 | 3;",
            "  isSpecial?: boolean;",
            "}",
            "",
            "export interface IngestedGraphEraSpec {",
            "  id: string;",
            "  label: string;",
            "  dynasties: readonly Dynasty[];",
            "  eventIds: readonly string[];",
            "  defaultCenterPersonId: string;",
            "}",
            "",
            "export interface IngestedRelationPatch {",
            "  pairKey: string;",
            "  eventSummaries: Readonly<Record<string, string>>;",
            "}",
            "",
            "export const INGESTED_DOC_FILES: readonly string[] = "
            + json.dumps(doc_files, ensure_ascii=False)
            + ";",
            "",
            "export const INGESTED_EVENT_RECORDS: readonly IngestedEventRecord[] = [",
        ]
        event_records = []
        for event in sorted(
            self.new_events,
            key=lambda item: (
                self._dynasty_rank(item.dynasty),
                item.year,
                item.event_id,
            ),
        ):
            record: dict[str, Any] = {
                "id": event.event_id,
                "title": event.title,
                "dynasty": event.dynasty,
                "year": event.year,
                "description": event.description,
            }
            if event.importance:
                record["importance"] = event.importance
            event_records.append(record)
        for record in event_records:
            lines.append("  " + json.dumps(record, ensure_ascii=False) + ",")
        lines.append("];")
        lines.append("")

        participant_map: dict[str, list[str]] = {}
        new_event_ids = {event.event_id for event in self.new_events}
        for event_id, event in self.final_events.items():
            if event_id in new_event_ids:
                participant_map[event_id] = list(event.participants)
        for event_id, additions in self.base_additions.items():
            if not additions:
                continue
            bucket = participant_map.setdefault(event_id, [])
            for name in additions:
                if name not in bucket:
                    bucket.append(name)
        lines.append(
            "export const INGESTED_EVENT_PARTICIPANTS: Readonly<Record<string, readonly string[]>> = "
            + ts_object((key, participant_map[key]) for key in sorted(participant_map))
            + ";"
        )
        lines.append("")

        override_entries = []
        for event_id in sorted(self.importance_overrides):
            override_entries.append((event_id, self.importance_overrides[event_id]))
        lines.append(
            "export const INGESTED_IMPORTANCE_OVERRIDES: Readonly<"
            "Record<string, readonly [1 | 2 | 3 | null, 1 | 2 | 3]>> = "
            + (
                "{\n"
                + "\n".join(
                    f"  {json.dumps(key, ensure_ascii=False)}: {ts_json(value)},"
                    for key, value in override_entries
                )
                + "\n}"
                if override_entries
                else "{}"
            )
            + ";"
        )
        lines.append("")

        alias_entries = sorted(self.aliases.items())
        lines.append(
            "export const INGESTED_PERSON_ALIASES: Readonly<Record<string, string>> = "
            + (
                "{\n"
                + "\n".join(
                    f"  {json.dumps(key, ensure_ascii=False)}: {json.dumps(value, ensure_ascii=False)},"
                    for key, value in alias_entries
                )
                + "\n}"
                if alias_entries
                else "{}"
            )
            + ";"
        )
        lines.append("")

        pin_entries = sorted(self.person_pins.items())
        lines.append(
            "export const INGESTED_PERSON_ID_PINS: Readonly<Record<string, string>> = "
            + (
                "{\n"
                + "\n".join(
                    f"  {json.dumps(key, ensure_ascii=False)}: {json.dumps(value, ensure_ascii=False)},"
                    for key, value in pin_entries
                )
                + "\n}"
                if pin_entries
                else "{}"
            )
            + ";"
        )
        lines.append("")

        lines.append("export const INGESTED_RELATIONS: readonly PersonRelationRecord[] = [")
        for relation in sorted(
            self.new_relations,
            key=lambda item: "__".join(sorted([item["a"], item["b"]])),
        ):
            record: dict[str, Any] = {
                "a": relation["a"],
                "b": relation["b"],
                "label": relation["label"],
            }
            if relation.get("description"):
                record["description"] = relation["description"]
            record["eventSummaries"] = relation["eventSummaries"]
            lines.append("  " + json.dumps(record, ensure_ascii=False) + ",")
        lines.append("];")
        lines.append("")

        lines.append("export const INGESTED_RELATION_PATCHES: readonly IngestedRelationPatch[] = [")
        for patch in sorted(self.relation_patches, key=lambda item: item["pairKey"]):
            lines.append("  " + json.dumps(patch, ensure_ascii=False) + ",")
        lines.append("];")
        lines.append("")

        lines.append("export const INGESTED_GRAPH_ERAS: readonly IngestedGraphEraSpec[] = [")
        for era in self.new_eras:
            lines.append(
                "  "
                + json.dumps(
                    {
                        "id": era["id"],
                        "label": era["label"],
                        "dynasties": era["dynasties"],
                        "eventIds": era["eventIds"],
                        "defaultCenterPersonId": era["defaultCenterPersonId"],
                    },
                    ensure_ascii=False,
                )
                + ","
            )
        lines.append("];")
        lines.append("")

        figure_entries = sorted(self.key_figures.items())
        lines.append(
            "export const INGESTED_KEY_FIGURES: Readonly<Record<string, readonly string[]>> = "
            + (
                "{\n"
                + "\n".join(
                    f"  {json.dumps(key, ensure_ascii=False)}: {ts_json(value)},"
                    for key, value in figure_entries
                )
                + "\n}"
                if figure_entries
                else "{}"
            )
            + ";"
        )
        lines.append("")

        scope_entries = sorted(self.era_scope_map.items())
        lines.append(
            "export const INGESTED_ERA_TO_SCOPE: Readonly<Record<string, string>> = "
            + (
                "{\n"
                + "\n".join(
                    f"  {json.dumps(key, ensure_ascii=False)}: {json.dumps(value, ensure_ascii=False)},"
                    for key, value in scope_entries
                )
                + "\n}"
                if scope_entries
                else "{}"
            )
            + ";"
        )
        lines.append("")
        return "\n".join(lines)

    def _dynasty_rank(self, dynasty: str) -> int:
        order = self.base_index.get("dynasty_order") or []
        return order.index(dynasty) if dynasty in order else len(order)

    # -- 写盘 / 校验 --------------------------------------------------------
    def check_or_write(self) -> bool:
        """返回 True 表示有写盘（非 check 模式且内容有变化）。"""
        changed = False
        if GENERATED_TS.exists():
            current = GENERATED_TS.read_text(encoding="utf-8")
        else:
            current = None
        if current != self.generated_content:
            changed = True
            if self.args.check:
                raise IngestError(
                    "生成物 frontend/data/ingested-graph-data.generated.ts 已过期；"
                    "请运行 python backend/scripts/ingest_graph_data.py 重新生成。"
                )
            GENERATED_TS.write_text(self.generated_content, encoding="utf-8")
            log(f"   已写入 {GENERATED_TS.relative_to(ROOT)}")
        if PINS_PATH.exists():
            current_pins = PINS_PATH.read_text(encoding="utf-8")
        else:
            current_pins = None
        if current_pins != self.pins_content:
            changed = True
            if self.args.check:
                raise IngestError(
                    "生成物 backend/data/ingest/person-id-pins.json 已过期；"
                    "请运行 python backend/scripts/ingest_graph_data.py 重新生成。"
                )
            PINS_PATH.parent.mkdir(parents=True, exist_ok=True)
            PINS_PATH.write_text(self.pins_content, encoding="utf-8")
            log(f"   已写入 {PINS_PATH.relative_to(ROOT)}")
        return changed

    def write_report(self) -> None:
        lines: list[str] = []
        lines.append("# 《史脉》图谱数据入库报告（V1.0.5.4）")
        lines.append("")
        lines.append("> 本文件由 `backend/scripts/ingest_graph_data.py` 自动生成：解析 docs 图谱扩充表、")
        lines.append("> 去重合并进数据层并重新生成快照后的结果留档。重新运行即可覆盖。")
        lines.append("")
        lines.append("## 1. 扫描与解析")
        lines.append("")
        lines.append(f"- 文档：{len(self.parsed)} 份")
        for parsed in self.parsed:
            lines.append(f"  - `{parsed.path.name}`：事件 {len(parsed.events)} / 关系 {len(parsed.relations)}")
        lines.append(f"- 去重后事件：{len(self.doc_events)} 条；人物关系：{len(self.doc_relations)} 条")
        lines.append("")
        lines.append("## 2. 事件合并")
        lines.append("")
        lines.append(f"- 新增事件：**{len(self.new_events)}** 条")
        for event in self.new_events:
            lines.append(
                f"  - `{event.event_id}` {event.title}（{event.dynasty} {event.year}，"
                f"重要度 {event.importance if event.importance is not None else '—'}）"
            )
        mapped = [item for item in self.merged_events if item.base_id]
        lines.append(f"- 复用既有事件：**{len(mapped)}** 条（标题同题 / 已登记同史实）")
        for merged in mapped:
            addition = "、".join(merged.additions) if merged.additions else "无新增参与人"
            lines.append(f"  - 「{merged.doc_title}」→ `{merged.base_id}`（{addition}）")
        if self.importance_overrides:
            lines.append("")
            lines.append("- 重要度覆盖（简阅 / 细览分级按来源表就高）：")
            for event_id, (base, applied) in sorted(self.importance_overrides.items()):
                lines.append(f"  - `{event_id}`：{base if base is not None else '—'} → {applied}")
        lines.append("")
        lines.append("## 3. 人物关系")
        lines.append("")
        lines.append(f"- 新增关系：**{len(self.new_relations)}** 对")
        for relation in self.new_relations:
            summaries = "、".join(relation["eventSummaries"])
            lines.append(
                f"  - {relation['a']} × {relation['b']}（{relation['label']}，锚点 `{summaries}`）"
            )
        lines.append(f"- 合并进既有关系的事件简述补丁：**{len(self.relation_patches)}** 对")
        if self.relation_patches:
            for patch in self.relation_patches:
                lines.append(f"  - `{patch['pairKey']}`：补齐 {', '.join(patch['eventSummaries'])}")
        lines.append("")
        lines.append("## 4. 人物、别名与 ID 固定")
        lines.append("")
        new_persons = sorted(set(self.person_pins) - set(self.base_participants))
        lines.append(f"- 人物 ID 固定表：{len(self.person_pins)} 条；本批新增人物 {len(new_persons)} 位")
        for name in new_persons:
            lines.append(f"  - {name} → `{self.person_pins[name]}`")
        lines.append(f"- 别名映射：{len(self.aliases)} 条")
        for alias, target in sorted(self.aliases.items()):
            lines.append(f"  - 「{alias}」→「{target}」")
        lines.append("")
        lines.append("## 5. 新增图谱分期")
        lines.append("")
        for era in self.new_eras:
            lines.append(
                f"- **{era['label']}**（`{era['id']}`）：{len(era['eventIds'])} 条事件 / "
                f"朝代 {era['dynasties']} / 默认中心 {era['defaultCenterPersonId']} / "
                f"名人堂 {self.key_figures.get(era['label'], [])}"
            )
        lines.append("")
        if self.warnings:
            lines.append(f"## 6. 警告（{len(self.warnings)} 条）")
            lines.append("")
            for message in self.warnings:
                lines.append(f"- {message}")
            lines.append("")
        else:
            lines.append("## 6. 警告")
            lines.append("")
            lines.append("- 无")
            lines.append("")
        lines.append("## 7. 后续流水线")
        lines.append("")
        lines.append("```bash")
        lines.append("node scripts/build-persons.mjs")
        lines.append("node scripts/extract-sources.mjs")
        lines.append("node scripts/export-snapshot.mjs")
        lines.append("node scripts/validate-data.mjs")
        lines.append("python scripts/check_consistency.py")
        lines.append("```")
        lines.append("")
        report = "\n".join(lines) + "\n"
        report_path = Path(self.args.report) if self.args.report else DEFAULT_REPORT
        if not report_path.is_absolute():
            report_path = ROOT / report_path
        if self.args.dry_run or self.args.check:
            log(f"   报告（未写盘）：{report_path.relative_to(ROOT) if report_path.is_relative_to(ROOT) else report_path}")
        else:
            report_path.parent.mkdir(parents=True, exist_ok=True)
            report_path.write_text(report, encoding="utf-8")
            log(f"   已写入 {report_path.relative_to(ROOT) if report_path.is_relative_to(ROOT) else report_path}")

    # -- 流水线 -------------------------------------------------------------
    def run_pipeline(self) -> None:
        log("[6/7] 运行 Node 数据流水线（persons → sources → snapshot → validate）…")
        steps = [
            ("build-persons", [str(ROOT / "scripts" / "build-persons.mjs")]),
            ("extract-sources", [str(ROOT / "scripts" / "extract-sources.mjs")]),
            ("export-snapshot", [str(ROOT / "scripts" / "export-snapshot.mjs")]),
            ("validate-data", [str(ROOT / "scripts" / "validate-data.mjs")]),
        ]
        for label, args in steps:
            log(f"   ▶ node {Path(args[0]).name}")
            output = self.runner.run(args)
            for line in output.strip().splitlines()[-6:]:
                log(f"     {line}")
        if not self.args.skip_consistency:
            log("   ▶ python scripts/check_consistency.py")
            process = subprocess.run(
                [sys.executable, str(CONSISTENCY_SCRIPT)],
                cwd=str(ROOT),
                capture_output=True,
                text=True,
                encoding="utf-8",
                errors="replace",
            )
            for line in (process.stdout or "").strip().splitlines()[-14:]:
                log(f"     {line}")
            if process.returncode != 0:
                raise IngestError(
                    "RAG / 图谱一致性检查未通过：\n"
                    f"{process.stdout.strip()}\n{process.stderr.strip()}"
                )

    # -- 入口 ---------------------------------------------------------------
    def run(self) -> int:
        self.load_index()
        self.parse_documents()
        self.merge_events()
        self.merge_relations()
        self.build_eras()
        self.build_aliases()
        self.build_person_pins()
        self.generated_content = self.render_generated_ts()
        log("[5.5/7] 生成物渲染完成")
        if self.args.dry_run:
            self.write_report()
            log("\n[DRY-RUN] 未写盘、未运行流水线。汇总：")
            log(
                f"  新事件 {len(self.new_events)} / 复用增补 {sum(1 for item in self.merged_events if item.base_id)} / "
                f"新关系 {len(self.new_relations)} / 新分期 {len(self.new_eras)} / 新人物 "
                f"{len(set(self.person_pins) - self.base_participants)}"
            )
            return 0
        self.check_or_write()
        self.write_report()
        if self.args.check:
            log("[7/7] --check 通过：生成物与文档一致。")
            return 0
        if not self.args.skip_node:
            self.run_pipeline()
        log("[7/7] 入库完成。")
        if self.warnings:
            log(f"\n⚠ 警告 {len(self.warnings)} 条（详见报告）：")
            for message in self.warnings:
                log(f"  - {message}")
        return 0


def build_arg_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="《史脉》图谱扩充数据全自动清洗与合并脚本（V1.0.5.4）",
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    parser.add_argument("--pattern", help="覆盖 config.json 的 doc_globs（相对 docs/ 的 glob）")
    parser.add_argument("--report", help="入库报告输出路径（默认 docs/图谱数据入库报告.md）")
    parser.add_argument("--dry-run", action="store_true", help="只解析并打印汇总，不写盘、不跑流水线")
    parser.add_argument("--check", action="store_true", help="只校验生成物是否最新（CI 用）")
    parser.add_argument("--skip-node", action="store_true", help="只写生成物，不运行 Node 流水线")
    parser.add_argument(
        "--skip-consistency", action="store_true", help="跳过 scripts/check_consistency.py"
    )
    return parser


def main(argv: list[str] | None = None) -> int:
    args = build_arg_parser().parse_args(argv)
    if args.check and (args.dry_run or args.skip_node):
        print("✖ --check 不能与 --dry-run / --skip-node 同时使用。", file=sys.stderr)
        return 2
    try:
        ingestor = GraphIngestor(args)
        return ingestor.run()
    except IngestError as exc:
        print(f"\n✖ 入库失败：{exc}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())