#!/usr/bin/env python
"""RAG 语料入库脚本（V1.0.5）。

流程：
1. 解析 ``docs/史脉_RAG语料库_核心历史事件.md``（21 篇）与 ``docs/史脉_RAG语料库_第二批30篇.md``（30 篇）；
2. 以 ``## 事件名`` 为锚点切分，白话文 / 古文摘录切成 ≤500 字 chunk（目标 300–500 字）；
3. 抽取元数据（event_name / record_type=正史|传说 / section / source / year 区间），
   并把事件名对齐到图谱 ``event_id``（对齐不到不影响检索，只是 citation 不挂时间轴深链）；
4. 选择 embedding provider（ModelScope API → 本地 fastembed bge-small-zh-v1.5 → 离线 hash），
   向量化后写入本地持久化 chromadb：``backend/data/chroma_db/``；
5. 写出 ``manifest.json``（provider / model / dim / chunk 数 / 语料指纹），并跑一次自检检索。

用法（在 backend 目录、使用 backend/.venv）：

    .\\.venv\\Scripts\\python scripts\\ingest_rag.py            # 重建（默认先删旧集合）
    .\\.venv\\Scripts\\python scripts\\ingest_rag.py --dry-run  # 只解析 / 切分并打印统计，不写库
    .\\.venv\\Scripts\\python scripts\\ingest_rag.py --stats    # 入库后打印各事件 chunk 分布
    .\\.venv\\Scripts\\python scripts\\ingest_rag.py --provider local

自检问题（入库结束自动跑）：商鞅变法为什么能成功？ / 赤壁之战 / 黄帝战蚩尤。
"""

from __future__ import annotations

import argparse
import json
import sys
import time
from datetime import UTC, datetime
from pathlib import Path

for _stream in (sys.stdout, sys.stderr):
    if hasattr(_stream, "reconfigure"):
        _stream.reconfigure(encoding="utf-8")

BACKEND_DIR = Path(__file__).resolve().parents[1]
REPO_ROOT = BACKEND_DIR.parent
sys.path.insert(0, str(BACKEND_DIR))

from rag.corpus import (
    DEFAULT_CORPUS_FILES,
    EXPECTED_DOCUMENT_COUNT,
    MAX_CHUNK_CHARS,
    build_chunks,
    corpus_fingerprint,
    parse_corpus,
    resolve_event_ids,
    summarize,
)
from rag.embedding import (
    DEFAULT_EMBEDDING_MODEL,
    LOCAL_PROVIDER,
    build_embedder,
    manifest_fields,
)
from rag.store import (
    DEFAULT_COLLECTION,
    MANIFEST_FILENAME,
    MANIFEST_SCHEMA,
    RAG_ATTRIBUTION,
    rag_dir,
)

SNAPSHOT_PATH = BACKEND_DIR / "data" / "snapshot.v1.json"
#: 入库时每批写库条数（chroma add 的批量建议 ≤ 1000）。
BATCH_SIZE = 64
#: 入库自检问题。
SANITY_QUERIES = ("商鞅变法为什么能成功？", "赤壁之战", "黄帝战蚩尤")


def log(message: str) -> None:
    print(f"  {message}")


def _load_snapshot_events() -> list[dict]:
    if not SNAPSHOT_PATH.is_file():
        log("! 未找到数据快照，跳过 event_id 对齐（citation 不挂时间轴深链）")
        return []
    payload = json.loads(SNAPSHOT_PATH.read_text(encoding="utf-8"))
    events = payload.get("events")
    return events if isinstance(events, list) else []


def _build_dataset(corpus_files: list[Path]):
    documents = parse_corpus(corpus_files)
    if len(documents) != EXPECTED_DOCUMENT_COUNT:
        raise SystemExit(
            f"[fail] 语料篇数不符：期望 {EXPECTED_DOCUMENT_COUNT} 篇，实际 {len(documents)} 篇"
        )
    chunks = build_chunks(documents)
    chunks = resolve_event_ids(chunks, _load_snapshot_events())
    too_long = [chunk for chunk in chunks if len(chunk.text) > MAX_CHUNK_CHARS]
    if too_long:  # pragma: no cover - 切分逻辑的硬性自检
        raise SystemExit(
            f"[fail] 有 {len(too_long)} 个 chunk 超过 {MAX_CHUNK_CHARS} 字"
        )
    return documents, chunks


def _write_collection(
    chunks, embedder, *, collection_name: str, directory: Path
) -> None:
    import chromadb

    directory.mkdir(parents=True, exist_ok=True)
    client = chromadb.PersistentClient(path=str(directory))
    try:
        client.delete_collection(collection_name)
        log(f"已删除旧集合 {collection_name}")
    except Exception as exc:  # noqa: BLE001 - 集合不存在时 delete 会抛错，忽略即可
        log(f"未删除旧集合（首次入库属正常）：{type(exc).__name__}")

    collection = client.create_collection(
        name=collection_name,
        metadata={
            "hnsw:space": "cosine",
            "description": "史脉 RAG 史料 chunk（V1.0.5）",
            "embedding_provider": embedder.provider,
            "embedding_model": embedder.model,
        },
    )

    total = len(chunks)
    started = time.perf_counter()
    for start in range(0, total, BATCH_SIZE):
        batch = chunks[start : start + BATCH_SIZE]
        texts = [chunk.embedding_text() for chunk in batch]
        vectors = embedder.embed_documents(texts)
        metadatas = []
        for chunk in batch:
            metadata = chunk.metadata()
            # chroma metadata 不能放 None；正文同时写 documents + metadata，检索端无需二次查库。
            metadata["text"] = chunk.text
            metadatas.append(metadata)
        collection.add(
            ids=[chunk.chunk_id for chunk in batch],
            documents=[chunk.text for chunk in batch],
            metadatas=metadatas,
            embeddings=vectors,
        )
        elapsed = time.perf_counter() - started
        log(f"已写入 {min(start + BATCH_SIZE, total)}/{total} chunk（{elapsed:.1f}s）")

    count = collection.count()
    if count != total:
        raise SystemExit(f"[fail] 写库条数不符：期望 {total}，实际 {count}")
    log(
        f"✓ chromadb collection {collection_name} 写入完成：{count} 条（目录 {directory}）"
    )


def _write_manifest(
    *,
    directory: Path,
    embedder,
    documents,
    chunks,
    corpus_files: list[Path],
    fingerprint: str,
) -> dict:
    stats = summarize(documents, chunks)
    manifest = {
        "schema": MANIFEST_SCHEMA,
        "collection": DEFAULT_COLLECTION,
        "built_at": datetime.now(UTC).astimezone().isoformat(timespec="seconds"),
        "corpus_files": [path.name for path in corpus_files],
        "corpus_sha256": fingerprint,
        "document_count": stats.documents,
        "chunk_count": stats.chunks,
        "vernacular_chunks": stats.vernacular_chunks,
        "excerpt_chunks": stats.excerpt_chunks,
        "legend_documents": stats.legend_documents,
        "legend_chunks": stats.legend_chunks,
        "events_linked": stats.events_linked,
        "min_chars": stats.min_chars,
        "max_chars": stats.max_chars,
        "avg_chars": round(stats.avg_chars, 1),
        "embedding_model_default": DEFAULT_EMBEDDING_MODEL,
        "attribution": RAG_ATTRIBUTION,
        **manifest_fields(embedder),
        "chroma_version": _chroma_version(),
    }
    path = directory / MANIFEST_FILENAME
    path.write_text(
        json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )
    log(f"✓ manifest 已写出：{path}")
    return manifest


def _chroma_version() -> str:
    try:
        import chromadb
    except ImportError:  # pragma: no cover - 依赖缺失
        return "unknown"
    return str(getattr(chromadb, "__version__", "unknown"))


def _print_stats(documents, chunks) -> None:
    stats = summarize(documents, chunks)
    log(stats.summary())
    counts: dict[str, int] = {}
    for chunk in chunks:
        counts[chunk.event_name] = counts.get(chunk.event_name, 0) + 1
    log("各事件 chunk 数：")
    for event_name, count in counts.items():
        log(f"    {event_name}: {count}")


def _sanity_search(embedder, chunks, queries=SANITY_QUERIES) -> None:
    """用入库内存数据做一次余弦自检（不依赖 chromadb，验证 embedding 语义可用）。"""

    import math

    def cosine(left: list[float], right: list[float]) -> float:
        dot = sum(a * b for a, b in zip(left, right))
        left_norm = math.sqrt(sum(value * value for value in left))
        right_norm = math.sqrt(sum(value * value for value in right))
        if not left_norm or not right_norm:
            return 0.0
        return dot / (left_norm * right_norm)

    document_vectors = embedder.embed_documents(
        [chunk.embedding_text() for chunk in chunks]
    )
    for query in queries:
        query_vector = embedder.embed_query(query)
        ranked = sorted(
            zip(chunks, document_vectors),
            key=lambda item: cosine(query_vector, item[1]),
            reverse=True,
        )[:3]
        log(f"自检检索「{query}」→")
        for chunk, _vector in ranked:
            preview = chunk.text.replace("\n", " ")[:60]
            log(
                f"    [{chunk.chunk_id}] {chunk.event_name}（{chunk.record_type}/{chunk.section}）{preview}…"
            )


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="史脉 V1.0.5 RAG 语料入库")
    parser.add_argument(
        "--dry-run", action="store_true", help="只解析 / 切分 / 统计，不写向量库"
    )
    parser.add_argument(
        "--stats", action="store_true", help="入库后打印各事件 chunk 分布"
    )
    parser.add_argument(
        "--provider",
        default=None,
        choices=("auto", "modelscope", "local", "hash"),
        help="embedding provider；默认读 RAG_EMBEDDING_PROVIDER（auto）",
    )
    parser.add_argument(
        "--corpus-dir", default=None, help="语料目录（默认仓库根 docs/）"
    )
    parser.add_argument(
        "--collection", default=DEFAULT_COLLECTION, help="chromadb 集合名"
    )
    parser.add_argument("--no-sanity", action="store_true", help="跳过入库后的自检检索")
    args = parser.parse_args(argv)

    corpus_dir = Path(args.corpus_dir) if args.corpus_dir else REPO_ROOT / "docs"
    corpus_files = [corpus_dir / name for name in DEFAULT_CORPUS_FILES]
    missing = [path for path in corpus_files if not path.is_file()]
    if missing:
        raise SystemExit(f"[fail] 缺少语料文件：{[str(path) for path in missing]}")

    started = time.perf_counter()
    documents, chunks = _build_dataset(corpus_files)
    log(f"✓ 解析完成：{len(documents)} 篇 / {len(chunks)} chunk")
    _print_stats(documents, chunks)
    if args.dry_run:
        log("--dry-run：不写向量库，退出。")
        return 0

    embedder = build_embedder(args.provider)
    log(f"✓ embedding provider = {embedder.label}（dim={embedder.dim}）")
    if embedder.provider == LOCAL_PROVIDER:
        log(
            "  提示：本地 bge-small-zh-v1.5 首次运行会下载 ~95MB ONNX 模型（缓存后约 10s 加载）。"
        )

    directory = rag_dir()
    _write_collection(
        chunks, embedder, collection_name=args.collection, directory=directory
    )
    manifest = _write_manifest(
        directory=directory,
        embedder=embedder,
        documents=documents,
        chunks=chunks,
        corpus_files=corpus_files,
        fingerprint=corpus_fingerprint(corpus_files),
    )

    # 用 chromadb 真正跑一次检索，验证持久化 + manifest 重建链路。
    from rag.store import RagStore, reset_rag_store

    reset_rag_store()
    store = RagStore.open()
    for query in SANITY_QUERIES:
        hits = store.search(query, top_k=3)
        log(f"库内检索「{query}」→ {len(hits)} 条")
        for hit in hits:
            log(
                f"    [{hit.chunk_id}] {hit.event_name} score={hit.score} {hit.text[:50]}…"
            )

    if not args.no_sanity:
        _sanity_search(embedder, chunks)

    elapsed = time.perf_counter() - started
    log(
        f"✓ 入库完成：{manifest['document_count']} 篇 / {manifest['chunk_count']} chunk / "
        f"provider={manifest['embedding_provider']}:{manifest['embedding_model']} / 耗时 {elapsed:.1f}s"
    )
    if args.stats:
        _print_stats(documents, chunks)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
