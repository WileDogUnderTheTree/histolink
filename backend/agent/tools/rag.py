"""RAG 史料检索工具：``search_historical_text``（V1.0.5）。

定位：图谱（结构化事实）之外的**长文史料层**。检索本地向量库里的 51 篇
WorkBuddy 语料 chunk，返回正文 + 元数据 + 统一 ``citations``。

产品约束（Token 控制）：
- 单次最多返回 **3 条**（``MAX_TOP_K``，参数 ``top_k`` 上限也是 3）；
- 每条正文最多 **300 字**（``MAX_CHUNK_CHARS``，超出截断并加省略号）；
- 单次结果字符预算 ≈ 3 × (300 + 元数据)，不会撑爆模型上下文。

安全：工具只读本地向量库，不接收 URL / SQL 等任意指令；查询串按严格参数校验，
失败（未入库 / 模型不可用）返回统一失败信封，由规划器继续换工具或走 insufficient。

向量库的加载（chromadb + embedding 模型）发生在**首次调用**，避免拖慢服务启动；
测试可 monkeypatch ``get_rag_store`` 注入 fake store。
"""

from __future__ import annotations

from typing import Any

from agent.tools.base import (
    ToolContext,
    ToolInputError,
    failure,
    parse_text,
    success,
    tool,
)
from contracts.models import Citation, ErrorCode, SourceRefModel
from rag.store import (
    MAX_CHUNK_DISPLAY_CHARS,
    MAX_TOP_K,
    RAG_ATTRIBUTION,
    RagError,
    RagUnavailableError,
    RetrievedChunk,
    get_rag_store,
)

#: 单次返回 chunk 数上限（产品硬约束：最多 3 条）。
MAX_RESULTS = MAX_TOP_K
#: 单条正文展示上限（产品硬约束：每条 ≤300 字）。
MAX_CHUNK_CHARS = MAX_CHUNK_DISPLAY_CHARS
#: 查询串上限（与 prompt / 工具契约一致）。
MAX_QUERY_CHARS = 200
#: RAG 工具名。
TOOL_NAME = "search_historical_text"


def parse_top_k(value: Any) -> int:
    """``top_k`` 严格校验：1..3（不静默截断，避免调用方误以为拿到了更多）。"""

    if value is None:
        return MAX_RESULTS
    if isinstance(value, bool) or not isinstance(value, int):
        raise ToolInputError("top_k 必须是整数")
    if value < 1 or value > MAX_RESULTS:
        raise ToolInputError(f"top_k 必须在 1..{MAX_RESULTS} 之间")
    return value


def _display_text(chunk: RetrievedChunk) -> str:
    return chunk.display_text(MAX_CHUNK_CHARS)


def _chunk_item(chunk: RetrievedChunk) -> dict[str, Any]:
    """工具 ``items`` / ``data.chunks`` 的单条结构（均为可展示、可审计的标量）。"""

    item: dict[str, Any] = {
        "chunk_id": chunk.chunk_id,
        "event_name": chunk.event_name,
        "title": chunk.title,
        "text": _display_text(chunk),
        "type": chunk.record_type,
        "record_type": chunk.record_type,
        "section": chunk.section,
        "source": chunk.source,
        "score": chunk.score,
    }
    if chunk.source_label:
        item["source_label"] = chunk.source_label
    if chunk.book:
        item["book"] = chunk.book
    if chunk.chapter:
        item["chapter"] = chunk.chapter
    if chunk.event_id:
        item["event_id"] = chunk.event_id
    if chunk.year_min is not None:
        item["year_min"] = chunk.year_min
    if chunk.year_max is not None:
        item["year_max"] = chunk.year_max
    return item


def _citation(chunk: RetrievedChunk) -> Citation:
    """chunk → 统一引用：id 即 chunk_id（模型 evidence / claims 直接引用它）。"""

    quote = _display_text(chunk)
    source_label = chunk.source_label or (
        f"《{chunk.book}》" if chunk.book else chunk.source
    )
    book = chunk.book or chunk.source or "史脉 RAG 语料库"
    source_ref = SourceRefModel(
        label=(source_label or "史脉 RAG 语料库")[:200],
        book=book[:100],
        chapter=(chunk.chapter or None),
        raw=(source_label or f"{book}·{chunk.title}")[:500],
    )
    return Citation(
        id=chunk.chunk_id,
        kind="rag",
        event_id=chunk.event_id or None,
        title=(chunk.title or chunk.event_name or "史料")[:300],
        quote=quote or None,
        source_label=(source_label or None),
        source_ref=source_ref,
        attribution=RAG_ATTRIBUTION,
        record_type=chunk.record_type
        if chunk.record_type in ("正史", "传说")
        else None,
    )


@tool(TOOL_NAME)
def search_historical_text(
    ctx: ToolContext,
    query: str,
    top_k: int = MAX_RESULTS,
) -> dict[str, Any]:
    """按语义检索史脉 RAG 史料库，返回 chunk 正文 + 元数据 + 统一 citations。

    - ``query``：检索词。混合路由下由「用户问题 + 图谱实体 / 年份」拼接而成；
    - ``top_k``：1..3，默认 3；超过 3 直接拒绝（Token 控制是产品硬约束）；
    - 空结果返回 ``ok=true`` + ``total=0``（「查无」是明确语义，不是错误）；
    - 向量库未入库 / embedding 不可用返回 ``ok=false`` + ``INSUFFICIENT_EVIDENCE``。
    """

    text = parse_text(query, "query", max_length=MAX_QUERY_CHARS)
    limit = parse_top_k(top_k)

    try:
        store = get_rag_store()
    except RagUnavailableError as exc:
        return failure(ctx, TOOL_NAME, ErrorCode.INSUFFICIENT_EVIDENCE, str(exc))
    except Exception as exc:  # noqa: BLE001 - 加载失败统一给安全文案
        return failure(
            ctx,
            TOOL_NAME,
            ErrorCode.INSUFFICIENT_EVIDENCE,
            f"RAG 向量库加载失败：{exc}"[:500],
        )

    try:
        hits = store.search(text, top_k=limit)
    except RagError as exc:
        return failure(ctx, TOOL_NAME, ErrorCode.INSUFFICIENT_EVIDENCE, str(exc)[:500])
    except Exception as exc:  # noqa: BLE001
        return failure(
            ctx,
            TOOL_NAME,
            ErrorCode.INTERNAL,
            f"RAG 检索内部错误：{exc}"[:500],
        )

    items = [_chunk_item(hit) for hit in hits]
    citations = [_citation(hit) for hit in hits]
    return success(
        ctx,
        TOOL_NAME,
        data={
            "chunks": items,
            "total": len(items),
            "query": text,
        },
        items=items,
        citations=citations,
        truncated=False,
        meta={
            "total": len(items),
            "limit": limit,
            "chunk_max_chars": MAX_CHUNK_CHARS,
            "embedding_provider": getattr(store, "provider", None),
            "embedding_model": getattr(store, "model", None),
            "source": "rag",
        },
    )


__all__ = [
    "MAX_CHUNK_CHARS",
    "MAX_QUERY_CHARS",
    "MAX_RESULTS",
    "TOOL_NAME",
    "parse_top_k",
    "search_historical_text",
]
