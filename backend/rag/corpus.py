"""RAG 语料解析与切分（V1.0.5）。

输入是 WorkBuddy 整理的两份 Markdown 长文语料：

- ``docs/史脉_RAG语料库_核心历史事件.md``（21 篇）
- ``docs/史脉_RAG语料库_第二批30篇.md``（30 篇）

格式约定（两份语料保持一致）：

```
## 事件名【传说】          ← 二级标题是切分锚点；【传说】标记神话传说
### 白话文详述             ← 白话叙述
### 古文原典摘录            ← **出处：《史记·商君列传》** + > 古文引文
```

本模块只做**纯文本解析 / 切分**，不依赖 chromadb、不发网络请求，便于单测：

- ``parse_corpus()``：按 ``## 事件名`` 切出 51 篇 ``RagDocument``；
- ``chunk_document()``：把白话文 / 古文摘录切成不超过 500 字（目标 300–500 字）的 chunk；
- ``build_chunks()``：解析 + 切分 + 统计的便捷入口。

元数据口径（写入向量库，供检索结果与引用使用）：

- ``event_name`` / ``title``：事件名（去掉【传说】后的干净标题）；
- ``record_type``：``正史`` / ``传说``（来源：标题【传说】标记）；
- ``section``：``白话文详述`` / ``古文原典摘录``；
- ``source`` / ``source_label`` / ``book`` / ``chapter``：古文出处（如 史记 / 《史记·商君列传》/ 商君列传），
  白话文 chunk 的 ``source`` 记为「史脉综述」；
- ``year_min`` / ``year_max``：白话文里出现的年份区间（史书纪年，公元前为负），用于与图谱交叉校验。
"""

from __future__ import annotations

import hashlib
import re
from collections.abc import Iterable, Sequence
from dataclasses import dataclass, field
from pathlib import Path

#: 单个 chunk 的硬上限（字符数，含标点）。
MAX_CHUNK_CHARS = 500
#: 打包目标：累计超过该长度即封口，避免所有 chunk 都贴到 500 字。
TARGET_CHUNK_CHARS = 320

#: 传说标记（标题内）。
LEGEND_MARKER = "【传说】"
RECORD_TYPE_LEGEND = "传说"
RECORD_TYPE_HISTORY = "正史"

#: 白话文 chunk 的「来源」占位（古文 chunk 用真实书名）。
VERNACULAR_SOURCE = "史脉综述"

#: 默认语料文件（相对 ``docs/`` 目录的文件名）。
DEFAULT_CORPUS_FILES: tuple[str, ...] = (
    "史脉_RAG语料库_核心历史事件.md",
    "史脉_RAG语料库_第二批30篇.md",
)
#: 语料篇数（21 + 30）；用于入库时做一次完整性校验。
EXPECTED_DOCUMENT_COUNT = 51

_HEADING_RE = re.compile(r"^## (?P<title>.+?)\s*$")
_SECTION_RE = re.compile(r"^### (?P<section>.+?)\s*$")
_SOURCE_RE = re.compile(r"^\*\*出处：(?P<raw>.+?)\*\*\s*$")
_SENTENCE_SPLIT_RE = re.compile(r"(?<=[。！？；!?;：:])")
#: 「公元前841年」「前356年」「208年」「1905年」；中文数字纪年（如「二十二年」）不抽取。
_YEAR_RE = re.compile(r"(?:公元前|前)(?P<bc>\d{1,4})年|(?P<ad>\d{3,4})年")
_PAREN_RE = re.compile(r"[（(][^）)]*[）)]")
_BRACKET_RE = re.compile(r"【[^】]*】")
_PUNCT_RE = re.compile(r"[\s，。、；：？！“”‘’《》【】（）·—…,.;:?!\"'()\[\]<>/|~`]+")


@dataclass(frozen=True)
class SourceExcerpt:
    """一段古文原典摘录及其出处。"""

    source_label: str
    book: str
    chapter: str | None
    text: str


@dataclass(frozen=True)
class RagDocument:
    """一篇语料（一个 ``## 事件名``）。"""

    doc_index: int
    event_name: str
    title: str
    record_type: str
    source_file: str
    vernacular: str
    excerpts: tuple[SourceExcerpt, ...] = field(default_factory=tuple)
    years: tuple[int, ...] = field(default_factory=tuple)

    @property
    def year_min(self) -> int | None:
        return min(self.years) if self.years else None

    @property
    def year_max(self) -> int | None:
        return max(self.years) if self.years else None

    @property
    def is_legend(self) -> bool:
        return self.record_type == RECORD_TYPE_LEGEND


@dataclass(frozen=True)
class RagChunk:
    """一个可入库的 chunk（≤ ``MAX_CHUNK_CHARS`` 字）。"""

    chunk_id: str
    doc_index: int
    order_in_document: int
    event_name: str
    title: str
    record_type: str
    section: str
    source_file: str
    text: str
    source: str = VERNACULAR_SOURCE
    source_label: str = ""
    book: str = ""
    chapter: str | None = None
    year_min: int | None = None
    year_max: int | None = None
    #: 与图谱事件的对齐（入库时由快照标题解析；解析不到为 None）。
    event_id: str | None = None

    @property
    def char_count(self) -> int:
        return len(self.text)

    def embedding_text(self) -> str:
        """喂给 embedding 的文本：带事件名做上下文，提升「问事件名」的召回。"""

        return f"{self.title}\n{self.text}"

    def metadata(self) -> dict[str, str | int | float | bool]:
        """chromadb 元数据（只允许标量；None 统一落成空串 / -0 哨兵）。"""

        return {
            "chunk_id": self.chunk_id,
            "doc_index": self.doc_index,
            "order_in_document": self.order_in_document,
            "event_name": self.event_name,
            "title": self.title,
            "record_type": self.record_type,
            "section": self.section,
            "source_file": self.source_file,
            "source": self.source,
            "source_label": self.source_label,
            "book": self.book,
            "chapter": self.chapter or "",
            "year_min": self.year_min if self.year_min is not None else 0,
            "year_max": self.year_max if self.year_max is not None else 0,
            "event_id": self.event_id or "",
            "char_count": self.char_count,
        }


# ---------------------------------------------------------------------------
# 解析
# ---------------------------------------------------------------------------


def normalize_title(title: str) -> str:
    """把语料标题 / 图谱事件标题归一成可比较的键（去括号、去标记、去标点）。"""

    text = _BRACKET_RE.sub("", title or "")
    text = _PAREN_RE.sub("", text)
    if "·" in text:
        # 「卧薪尝胆·吴越争霸」这类并列标题取第一段，避免匹配失败。
        text = text.split("·", 1)[0]
    text = _PUNCT_RE.sub("", text)
    return text.casefold()


def extract_years(text: str) -> tuple[int, ...]:
    """抽取文本里出现的年份（去重、升序），用于与图谱纪年交叉校验。"""

    years: set[int] = set()
    for match in _YEAR_RE.finditer(text or ""):
        if match.group("bc"):
            year = -int(match.group("bc"))
        else:
            year = int(match.group("ad"))
        # 过滤明显不是纪年的数字（如「三十六郡」不会命中，但「1000年」这类未来年份要排除）。
        if -3000 <= year <= 2100:
            years.add(year)
    return tuple(sorted(years))


def _parse_source(raw: str) -> tuple[str, str, str | None]:
    """解析 ``**出处：...**`` 为 ``(label, book, chapter)``。"""

    label = raw.strip()
    match = re.search(r"《(?P<inner>[^》]+)》", label)
    if match is None:
        return label[:200], label[:100], None
    inner = match.group("inner").strip()
    if "·" in inner:
        book, chapter = inner.split("·", 1)
        return label[:200], book.strip()[:100], chapter.strip()[:200] or None
    return label[:200], inner[:100], None


def _clean_title(event_name: str) -> str:
    text = event_name.replace(LEGEND_MARKER, "").strip()
    return text or event_name.strip()


def parse_document(block: str, *, doc_index: int, source_file: str) -> RagDocument:
    """解析单个 ``##`` 区块。"""

    lines = block.splitlines()
    event_name = lines[0].strip()
    if event_name.startswith("## "):
        event_name = event_name[3:].strip()
    body = "\n".join(lines[1:])

    sections: dict[str, list[str]] = {}
    current = ""
    for line in body.splitlines():
        heading = _SECTION_RE.match(line)
        if heading:
            current = heading.group("section").strip()
            sections.setdefault(current, [])
            continue
        if not current:
            continue
        sections[current].append(line)

    vernacular = _join_paragraphs(sections.get("白话文详述", []))
    excerpts = _collect_excerpts(sections.get("古文原典摘录", []))
    years = extract_years(vernacular)
    return RagDocument(
        doc_index=doc_index,
        event_name=event_name,
        title=_clean_title(event_name),
        record_type=RECORD_TYPE_LEGEND
        if LEGEND_MARKER in event_name
        else RECORD_TYPE_HISTORY,
        source_file=source_file,
        vernacular=vernacular,
        excerpts=tuple(excerpts),
        years=years,
    )


def _join_paragraphs(lines: Sequence[str]) -> str:
    """把 Markdown 段落行拼成带空行分隔的纯文本。"""

    paragraphs: list[str] = []
    buffer: list[str] = []
    for line in lines:
        stripped = line.strip()
        if not stripped:
            if buffer:
                paragraphs.append("\n".join(buffer).strip())
                buffer = []
            continue
        buffer.append(stripped)
    if buffer:
        paragraphs.append("\n".join(buffer).strip())
    return "\n\n".join(paragraph for paragraph in paragraphs if paragraph)


def _collect_excerpts(lines: Sequence[str]) -> list[SourceExcerpt]:
    """提取 ``**出处：X**`` + ``> 引文`` 组合；同一出处下多段引文拆成多条。"""

    excerpts: list[SourceExcerpt] = []
    source: tuple[str, str, str | None] | None = None
    buffer: list[str] = []

    def flush() -> None:
        nonlocal buffer
        text = _join_paragraphs(buffer)
        buffer = []
        if not text:
            return
        label, book, chapter = source if source is not None else ("", "", None)
        excerpts.append(
            SourceExcerpt(source_label=label, book=book, chapter=chapter, text=text)
        )

    for line in lines:
        stripped = line.strip()
        source_line = _SOURCE_RE.match(stripped)
        if source_line:
            flush()
            source = _parse_source(source_line.group("raw"))
            continue
        if stripped.startswith(">"):
            buffer.append(stripped.lstrip(">").strip())
            continue
        if not stripped:
            # 引文之间的空行：视为两条独立引文的分隔（同一出处下可能有多段引文）。
            flush()
            continue
        flush()

    flush()
    return [excerpt for excerpt in excerpts if excerpt.text]


def parse_corpus(paths: Iterable[Path | str]) -> list[RagDocument]:
    """按 ``## 事件名`` 切分所有语料文件，返回文档列表（顺序即入库顺序）。"""

    documents: list[RagDocument] = []
    for path_like in paths:
        path = Path(path_like)
        text = path.read_text(encoding="utf-8")
        blocks = re.split(r"(?m)^## ", text)[1:]
        for block in blocks:
            documents.append(
                parse_document(
                    block,
                    doc_index=len(documents),
                    source_file=path.name,
                )
            )
    return documents


# ---------------------------------------------------------------------------
# 切分
# ---------------------------------------------------------------------------


def _hard_split(text: str, max_chars: int) -> list[str]:
    return [text[index : index + max_chars] for index in range(0, len(text), max_chars)]


def _split_long_paragraph(paragraph: str, max_chars: int) -> list[str]:
    """按句号等切句；仍超长的句子再硬切。"""

    pieces: list[str] = []
    buffer = ""
    for sentence in _SENTENCE_SPLIT_RE.split(paragraph):
        if not sentence:
            continue
        candidate = buffer + sentence
        if len(candidate) <= max_chars:
            buffer = candidate
            continue
        if buffer:
            pieces.append(buffer.strip())
            buffer = ""
        if len(sentence) <= max_chars:
            buffer = sentence
        else:
            pieces.extend(part.strip() for part in _hard_split(sentence, max_chars))
    if buffer.strip():
        pieces.append(buffer.strip())
    return [piece for piece in pieces if piece]


def split_text(
    text: str,
    *,
    max_chars: int = MAX_CHUNK_CHARS,
    target_chars: int = TARGET_CHUNK_CHARS,
) -> list[str]:
    """把一段长文切成 ``≤ max_chars`` 的若干 chunk（段落优先、句子兜底）。"""

    paragraphs = [
        paragraph.strip()
        for paragraph in re.split(r"\n\s*\n", text or "")
        if paragraph.strip()
    ]
    pieces: list[str] = []
    for paragraph in paragraphs:
        if len(paragraph) <= max_chars:
            pieces.append(paragraph)
        else:
            pieces.extend(_split_long_paragraph(paragraph, max_chars))

    chunks: list[str] = []
    buffer = ""
    for piece in pieces:
        if not buffer:
            buffer = piece
            continue
        candidate = f"{buffer}\n{piece}"
        if len(candidate) <= max_chars and len(buffer) < target_chars:
            buffer = candidate
            continue
        chunks.append(buffer.strip())
        buffer = piece
    if buffer.strip():
        chunks.append(buffer.strip())
    return [chunk for chunk in chunks if chunk]


def _make_chunk_id(doc_index: int, order: int) -> str:
    """稳定 chunk id：``rag-<doc 两位>-<文档内序号两位>``（也用作 citation id）。"""

    return f"rag-{doc_index:02d}-{order:02d}"


def chunk_document(document: RagDocument) -> list[RagChunk]:
    """把一篇 ``RagDocument`` 切成 chunk 列表（白话文在前、古文摘录在后）。"""

    chunks: list[RagChunk] = []
    for text in split_text(document.vernacular):
        chunks.append(
            RagChunk(
                chunk_id=_make_chunk_id(document.doc_index, len(chunks)),
                doc_index=document.doc_index,
                order_in_document=len(chunks),
                event_name=document.event_name,
                title=document.title,
                record_type=document.record_type,
                section="白话文详述",
                source_file=document.source_file,
                text=text,
                year_min=document.year_min,
                year_max=document.year_max,
            )
        )
    for excerpt in document.excerpts:
        for text in split_text(excerpt.text):
            chunks.append(
                RagChunk(
                    chunk_id=_make_chunk_id(document.doc_index, len(chunks)),
                    doc_index=document.doc_index,
                    order_in_document=len(chunks),
                    event_name=document.event_name,
                    title=document.title,
                    record_type=document.record_type,
                    section="古文原典摘录",
                    source_file=document.source_file,
                    text=text,
                    source=excerpt.book or excerpt.source_label,
                    source_label=excerpt.source_label,
                    book=excerpt.book,
                    chapter=excerpt.chapter,
                    year_min=document.year_min,
                    year_max=document.year_max,
                )
            )
    if not chunks:  # pragma: no cover - 语料异常时给出明确错误
        raise ValueError(f"事件「{document.title}」没有可入库的正文")
    return chunks


def build_chunks(documents: Iterable[RagDocument]) -> list[RagChunk]:
    chunks: list[RagChunk] = []
    for document in documents:
        chunks.extend(chunk_document(document))
    return chunks


# ---------------------------------------------------------------------------
# 与图谱事件对齐（V1.0.5 混合检索：RAG chunk → event_id）
# ---------------------------------------------------------------------------


def resolve_event_ids(
    chunks: Sequence[RagChunk],
    events: Sequence[dict],
) -> list[RagChunk]:
    """把 chunk 的事件名对齐到图谱 ``event_id``（解析不到保留 None）。

    匹配策略（从严到宽）：
    1. 归一化标题完全相等；
    2. 一方是另一方子串（处理「葵丘之会，齐桓公称霸」这类图谱标题）；
    3. 多个候选时取重要度高、年份早者。解析不到不影响 RAG 检索，只是 citation 不挂时间轴深链接。
    """

    by_normalized: dict[str, list[dict]] = {}
    for event in events:
        key = normalize_title(str(event.get("title") or ""))
        if key:
            by_normalized.setdefault(key, []).append(event)

    resolved: list[RagChunk] = []
    for chunk in chunks:
        event = _match_event(chunk.title, by_normalized)
        resolved.append(
            RagChunk(
                chunk_id=chunk.chunk_id,
                doc_index=chunk.doc_index,
                order_in_document=chunk.order_in_document,
                event_name=chunk.event_name,
                title=chunk.title,
                record_type=chunk.record_type,
                section=chunk.section,
                source_file=chunk.source_file,
                text=chunk.text,
                source=chunk.source,
                source_label=chunk.source_label,
                book=chunk.book,
                chapter=chunk.chapter,
                year_min=chunk.year_min,
                year_max=chunk.year_max,
                event_id=event.get("event_id") if event else None,
            )
        )
    return resolved


def _match_event(title: str, by_normalized: dict[str, list[dict]]) -> dict | None:
    key = normalize_title(title)
    if not key:
        return None
    exact = by_normalized.get(key)
    if exact:
        return min(exact, key=_event_priority)
    candidates: list[dict] = []
    for graph_key, events in by_normalized.items():
        if len(graph_key) < 2:
            continue
        if key in graph_key or graph_key in key:
            candidates.extend(events)
    if not candidates:
        return None
    # 优先：图谱标题短（更贴近语料标题）、重要度高、年份早。
    normalized_graph = [
        (event, len(normalize_title(str(event.get("title") or ""))))
        for event in candidates
    ]
    normalized_graph.sort(
        key=lambda item: (
            item[1],
            -int(item[0].get("importance") or 2),
            int(item[0].get("year") or 0),
        )
    )
    return normalized_graph[0][0]


def _event_priority(event: dict) -> tuple[int, int, str]:
    return (
        -int(event.get("importance") or 2),
        int(event.get("year") or 0),
        str(event.get("event_id") or ""),
    )


# ---------------------------------------------------------------------------
# 统计
# ---------------------------------------------------------------------------


def corpus_fingerprint(paths: Iterable[Path | str]) -> str:
    """两份语料的内容指纹（入库 manifest 用，便于判断是否需要重建）。"""

    digest = hashlib.sha256()
    for path_like in paths:
        path = Path(path_like)
        digest.update(path.name.encode("utf-8"))
        digest.update(path.read_bytes())
    return digest.hexdigest()


@dataclass(frozen=True)
class ChunkStats:
    documents: int
    chunks: int
    vernacular_chunks: int
    excerpt_chunks: int
    legend_documents: int
    legend_chunks: int
    min_chars: int
    max_chars: int
    avg_chars: float
    events_linked: int
    documents_with_years: int

    def summary(self) -> str:
        return (
            f"文档 {self.documents} 篇 / chunk {self.chunks} 个"
            f"（白话 {self.vernacular_chunks} + 古文 {self.excerpt_chunks}）；"
            f"传说 {self.legend_documents} 篇 / {self.legend_chunks} chunk；"
            f"chunk 字数 min={self.min_chars} max={self.max_chars} avg={self.avg_chars:.1f}；"
            f"已对齐图谱事件 {self.events_linked} 个；含纪年文档 {self.documents_with_years} 篇"
        )


def summarize(
    documents: Sequence[RagDocument], chunks: Sequence[RagChunk]
) -> ChunkStats:
    lengths = [len(chunk.text) for chunk in chunks]
    legend_documents = sum(1 for document in documents if document.is_legend)
    legend_chunks = sum(
        1 for chunk in chunks if chunk.record_type == RECORD_TYPE_LEGEND
    )
    return ChunkStats(
        documents=len(documents),
        chunks=len(chunks),
        vernacular_chunks=sum(1 for chunk in chunks if chunk.section == "白话文详述"),
        excerpt_chunks=sum(1 for chunk in chunks if chunk.section == "古文原典摘录"),
        legend_documents=legend_documents,
        legend_chunks=legend_chunks,
        min_chars=min(lengths) if lengths else 0,
        max_chars=max(lengths) if lengths else 0,
        avg_chars=(sum(lengths) / len(lengths)) if lengths else 0.0,
        events_linked=len({chunk.event_id for chunk in chunks if chunk.event_id}),
        documents_with_years=sum(1 for document in documents if document.years),
    )


__all__ = [
    "DEFAULT_CORPUS_FILES",
    "EXPECTED_DOCUMENT_COUNT",
    "LEGEND_MARKER",
    "MAX_CHUNK_CHARS",
    "RECORD_TYPE_HISTORY",
    "RECORD_TYPE_LEGEND",
    "TARGET_CHUNK_CHARS",
    "VERNACULAR_SOURCE",
    "ChunkStats",
    "RagChunk",
    "RagDocument",
    "SourceExcerpt",
    "build_chunks",
    "chunk_document",
    "corpus_fingerprint",
    "extract_years",
    "normalize_title",
    "parse_corpus",
    "parse_document",
    "resolve_event_ids",
    "split_text",
    "summarize",
]
