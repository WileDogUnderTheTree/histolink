"""本地持久化向量库（chromadb）+ RAG 检索入口（V1.0.5）。

职责：
- 打开 ``backend/data/chroma_db/`` 下的持久化 chromadb collection（默认集合 ``histolink_rag_v1``）；
- 读取同目录 ``manifest.json``，严格按入库时的 embedding provider 重建 embedder（防止向量空间错配）；
- ``search(query, top_k)`` 返回有界结果（≤3 条、每条正文 ≤300 字由工具层再做一次截断）。

线程模型：Chroma client 进程内单例；默认本地持久化，可通过环境变量切换到 HTTP 服务端。
测试可 ``reset_rag_store()`` 清除缓存；工具层也允许注入 fake store 做单测。
"""

from __future__ import annotations

import json
import logging
import os
import threading
from dataclasses import dataclass
from pathlib import Path
from typing import Any

logger = logging.getLogger("histolink.rag.store")

BACKEND_DIR = Path(__file__).resolve().parents[1]
#: 默认持久化目录（相对 backend/）；可用 RAG_CHROMA_DIR 覆盖。
DEFAULT_RAG_DIR = BACKEND_DIR / "data" / "chroma_db"
DEFAULT_COLLECTION = "histolink_rag_v1"
MANIFEST_FILENAME = "manifest.json"
MANIFEST_SCHEMA = "histolink-rag-v1"
#: 检索上限（产品要求：最多 3 条）。
MAX_TOP_K = 3
#: 单条检索正文展示上限（字符）。
MAX_CHUNK_DISPLAY_CHARS = 300

#: RAG 引用署名（写入 Citation.attribution）。
RAG_ATTRIBUTION = "史脉 RAG 史料库（WorkBuddy 整理；古文引自正史原典，CC BY-NC-SA 4.0）"


class RagError(RuntimeError):
    """RAG 检索错误基类。"""


class RagUnavailableError(RagError):
    """向量库 / embedding 尚未就绪（未入库、模型不可用等）。"""


@dataclass(frozen=True)
class RetrievedChunk:
    """一次检索命中的 chunk（工具层据此组装 items + citations）。"""

    chunk_id: str
    text: str
    event_name: str
    title: str
    record_type: str
    section: str
    source: str
    source_label: str
    book: str
    chapter: str | None
    event_id: str | None
    year_min: int | None
    year_max: int | None
    score: float

    @property
    def is_legend(self) -> bool:
        return self.record_type == "传说"

    def display_text(self, max_chars: int = MAX_CHUNK_DISPLAY_CHARS) -> str:
        """Token 控制：每条最多 ``max_chars`` 字（含截断省略号）。"""

        text = (self.text or "").strip()
        if len(text) <= max_chars:
            return text
        return text[: max(max_chars - 1, 0)].rstrip() + "…"


def rag_dir() -> Path:
    raw = os.environ.get("RAG_CHROMA_DIR", "").strip()
    return Path(raw).expanduser() if raw else DEFAULT_RAG_DIR


def create_chroma_client(directory: Path | None = None) -> Any:
    """Create a local persistent client, or an HTTP client when configured."""

    import chromadb

    host = os.environ.get("RAG_CHROMA_HTTP_HOST", "").strip()
    if host:
        port = int(os.environ.get("RAG_CHROMA_HTTP_PORT", "8000"))
        return chromadb.HttpClient(host=host, port=port)
    path = directory or rag_dir()
    return chromadb.PersistentClient(path=str(path))


def manifest_path(directory: Path | None = None) -> Path:
    return (directory or rag_dir()) / MANIFEST_FILENAME


def load_manifest(directory: Path | None = None) -> dict[str, Any]:
    """读取入库 manifest；缺失 / 非法 → ``RagUnavailableError``。"""

    path = manifest_path(directory)
    if not path.is_file():
        raise RagUnavailableError(
            f"RAG 向量库未入库：缺少 {path}（请运行 python scripts/ingest_rag.py）"
        )
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        raise RagUnavailableError(f"RAG 向量库 manifest 不可读：{exc}") from exc
    if payload.get("schema") != MANIFEST_SCHEMA:
        raise RagUnavailableError(
            f"RAG 向量库版本不匹配（期望 {MANIFEST_SCHEMA}，实际 {payload.get('schema')!r}）"
        )
    return payload


def rag_status_text() -> str:
    """给 System Prompt 用的一句话状态（只读 manifest，不加载模型）。"""

    try:
        manifest = load_manifest()
    except RagUnavailableError:
        return "未就绪（需要先运行 backend/scripts/ingest_rag.py 构建向量库）"
    return (
        f"已就绪：{manifest.get('document_count', 0)} 篇史料 / {manifest.get('chunk_count', 0)} 条 chunk"
        f"（embedding={manifest.get('embedding_provider')}:{manifest.get('embedding_model')}）"
    )


def _to_optional_int(value: Any) -> int | None:
    if isinstance(value, bool) or not isinstance(value, int):
        return None
    return value if value != 0 else None


def _to_optional_str(value: Any) -> str:
    return value if isinstance(value, str) else ""


class RagStore:
    """一个已打开的 chromadb collection + 对应 embedder。"""

    def __init__(
        self, collection: Any, embedder: Any, manifest: dict[str, Any]
    ) -> None:
        self._collection = collection
        self._embedder = embedder
        self._manifest = manifest

    @property
    def provider(self) -> str:
        return str(self._manifest.get("embedding_provider") or "")

    @property
    def model(self) -> str:
        return str(self._manifest.get("embedding_model") or "")

    @property
    def dim(self) -> int:
        return int(self._manifest.get("embedding_dim") or 0)

    @property
    def chunk_count(self) -> int:
        return int(self._manifest.get("chunk_count") or 0)

    @property
    def manifest(self) -> dict[str, Any]:
        return dict(self._manifest)

    @classmethod
    def open(cls, directory: Path | None = None) -> RagStore:
        manifest = load_manifest(directory)
        path = directory or rag_dir()
        try:
            import chromadb  # noqa: F401 - 仅用于探测依赖是否安装，实际客户端由 create_chroma_client 创建
        except ImportError as exc:  # pragma: no cover - 依赖缺失
            raise RagUnavailableError(
                "未安装 chromadb，无法检索 RAG 向量库；请 pip install -r requirements.txt"
            ) from exc

        from rag.embedding import rebuild_embedder

        embedder = rebuild_embedder(manifest)
        collection_name = str(manifest.get("collection") or DEFAULT_COLLECTION)
        try:
            client = create_chroma_client(path)
            collection = client.get_collection(collection_name)
        except Exception as exc:
            raise RagUnavailableError(f"打开 RAG 向量库失败（{path}）：{exc}") from exc

        count = int(collection.count())
        if count == 0:
            raise RagUnavailableError(
                "RAG 向量库为空（collection.count()=0），请重新运行 ingest_rag.py"
            )
        logger.info(
            "RAG 向量库已加载：collection=%s count=%d provider=%s",
            collection_name,
            count,
            embedder.label,
        )
        return cls(collection=collection, embedder=embedder, manifest=manifest)

    def search(self, query: str, top_k: int = MAX_TOP_K) -> list[RetrievedChunk]:
        """向量检索；结果按相似度降序、最多 ``MAX_TOP_K`` 条。"""

        text = (query or "").strip()
        if not text:
            return []
        limit = max(1, min(int(top_k or 1), MAX_TOP_K))
        vector = self._embedder.embed_query(text)
        try:
            result = self._collection.query(
                query_embeddings=[vector],
                n_results=limit,
                include=["metadatas", "distances", "documents"],
            )
        except Exception as exc:
            raise RagError(f"RAG 向量检索失败：{exc}") from exc

        ids = (result.get("ids") or [[]])[0]
        metadatas = (result.get("metadatas") or [[]])[0]
        distances = (result.get("distances") or [[]])[0]
        documents = (result.get("documents") or [[]])[0]

        chunks: list[RetrievedChunk] = []
        for index, chunk_id in enumerate(ids):
            metadata = metadatas[index] if index < len(metadatas) else {}
            metadata = metadata if isinstance(metadata, dict) else {}
            distance = distances[index] if index < len(distances) else 1.0
            document = documents[index] if index < len(documents) else ""
            text_value = (
                metadata.get("text")
                if isinstance(metadata.get("text"), str)
                else document
            )
            if not text_value:
                # 兼容只存 documents 的旧库；正常入库两份都写。
                text_value = document
            chunks.append(
                RetrievedChunk(
                    chunk_id=str(chunk_id),
                    text=str(text_value or ""),
                    event_name=_to_optional_str(metadata.get("event_name")),
                    title=_to_optional_str(metadata.get("title"))
                    or _to_optional_str(metadata.get("event_name")),
                    record_type=_to_optional_str(metadata.get("record_type")) or "正史",
                    section=_to_optional_str(metadata.get("section")),
                    source=_to_optional_str(metadata.get("source")),
                    source_label=_to_optional_str(metadata.get("source_label")),
                    book=_to_optional_str(metadata.get("book")),
                    chapter=_to_optional_str(metadata.get("chapter")) or None,
                    event_id=_to_optional_str(metadata.get("event_id")) or None,
                    year_min=_to_optional_int(metadata.get("year_min")),
                    year_max=_to_optional_int(metadata.get("year_max")),
                    score=round(1.0 - float(distance or 0.0), 4),
                )
            )
        return chunks[:MAX_TOP_K]


_STORE_LOCK = threading.Lock()
_STORE_CACHE: RagStore | None = None


def get_rag_store() -> RagStore:
    """进程内单例；首次调用才加载 chromadb + embedding 模型（避免拖慢服务启动）。"""

    global _STORE_CACHE
    if _STORE_CACHE is not None:
        return _STORE_CACHE
    with _STORE_LOCK:
        if _STORE_CACHE is None:
            _STORE_CACHE = RagStore.open()
    return _STORE_CACHE


def reset_rag_store() -> None:
    """清除单例（测试 / 重新入库后使用）。"""

    global _STORE_CACHE
    with _STORE_LOCK:
        _STORE_CACHE = None


__all__ = [
    "DEFAULT_COLLECTION",
    "DEFAULT_RAG_DIR",
    "MANIFEST_FILENAME",
    "MANIFEST_SCHEMA",
    "MAX_CHUNK_DISPLAY_CHARS",
    "MAX_TOP_K",
    "RAG_ATTRIBUTION",
    "RagError",
    "RagStore",
    "RagUnavailableError",
    "RetrievedChunk",
    "create_chroma_client",
    "get_rag_store",
    "load_manifest",
    "manifest_path",
    "rag_dir",
    "rag_status_text",
    "reset_rag_store",
]
