"""Embedding 提供方（V1.0.5）。

设计目标：**入库与检索必须使用同一个向量模型**，否则余弦距离没有意义。因此：

- 入库时由 ``scripts/ingest_rag.py`` 选择 provider，并把 ``provider / model / dim`` 写进
  ``backend/data/chroma_db/manifest.json``；
- 运行时 ``backend/rag/store.py`` 只按 manifest 严格重建**同一个** provider，不做静默降级。

三种 provider（按 ``RAG_EMBEDDING_PROVIDER`` 环境变量选择，默认 ``auto``）：

1. ``modelscope``：ModelScope OpenAI 兼容 ``/embeddings`` API，模型 ``BAAI/bge-small-zh-v1.5``。
   这是设计首选（不依赖本地算力）；但当前账号的推理 API 只开放对话模型，
   ``/embeddings`` 返回 ``Invalid model id``，``auto`` 会自动探测并降级；
2. ``local``：``fastembed`` 的 ONNX 版 ``BAAI/bge-small-zh-v1.5``（512 维，CPU 推理，
   首次使用会自动下载 ~95MB 模型；不依赖 torch / GPU）；
3. ``hash``：纯 Python 字符 n-gram 哈希向量（512 维），完全离线兜底。
   检索质量明显弱于 bge，只在无法下载模型时保证「链路可跑通」，manifest 会记录供审计。

所有 provider 都实现同一协议：``embed_documents(texts) -> list[list[float]]``、
``embed_query(text) -> list[float]``、``provider`` / ``model`` / ``dim``。
"""

from __future__ import annotations

import hashlib
import logging
import math
import os
import re
from collections.abc import Sequence
from typing import Any, Protocol, runtime_checkable

logger = logging.getLogger("histolink.rag.embedding")

#: 首选模型：BAAI/bge-small-zh-v1.5（512 维，中文短文本检索常用）。
DEFAULT_EMBEDDING_MODEL = "BAAI/bge-small-zh-v1.5"
#: fastembed 的默认缓存目录（由 HF_HOME / 内置默认值决定，这里仅用于提示）。
DEFAULT_EMBEDDING_DIM = 512
#: `auto` 探测顺序。
AUTO_PROVIDER_ORDER = ("modelscope", "local", "hash")
VALID_PROVIDERS = ("auto", "modelscope", "local", "hash")

MODELSCOPE_PROVIDER = "modelscope"
LOCAL_PROVIDER = "local"
HASH_PROVIDER = "hash"

#: 默认把 HuggingFace 下载切到国内镜像（仅当用户没有显式设置 HF_ENDPOINT）。
DEFAULT_HF_MIRROR = "https://hf-mirror.com"
#: ModelScope API 单次请求的文本条数上限（保守值）。
MODELSCOPE_BATCH_SIZE = 16
MAX_EMBEDDING_TEXT_CHARS = 2000


class RagEmbeddingError(RuntimeError):
    """Embedding 不可用 / 调用失败。"""


@runtime_checkable
class Embedder(Protocol):
    provider: str
    model: str
    dim: int

    def embed_documents(self, texts: Sequence[str]) -> list[list[float]]: ...

    def embed_query(self, text: str) -> list[float]: ...

    @property
    def label(self) -> str: ...


def _clean_text(text: str) -> str:
    return (text or "").strip()[:MAX_EMBEDDING_TEXT_CHARS]


# ---------------------------------------------------------------------------
# ModelScope API
# ---------------------------------------------------------------------------


class ModelScopeEmbedder:
    """ModelScope OpenAI 兼容 ``/embeddings``（有 API key 时优先尝试）。"""

    provider = MODELSCOPE_PROVIDER

    def __init__(
        self, *, model: str = DEFAULT_EMBEDDING_MODEL, dim: int = DEFAULT_EMBEDDING_DIM
    ) -> None:
        self.model = model
        self.dim = dim
        self._settings = _modelscope_settings()

    @property
    def label(self) -> str:
        return f"{self.provider}:{self.model}"

    def _request(self, texts: Sequence[str]) -> list[list[float]]:
        import httpx

        settings = self._settings
        url = f"{settings.base_url.rstrip('/')}/embeddings"
        headers = {
            "Authorization": f"Bearer {settings.api_key}",
            "Content-Type": "application/json",
        }
        vectors: list[list[float]] = []
        with httpx.Client(timeout=60.0) as client:
            for start in range(0, len(texts), MODELSCOPE_BATCH_SIZE):
                batch = list(texts[start : start + MODELSCOPE_BATCH_SIZE])
                response = client.post(
                    url, headers=headers, json={"model": self.model, "input": batch}
                )
                if response.status_code != 200:
                    raise RagEmbeddingError(
                        f"ModelScope embeddings 失败（{response.status_code}）：{response.text[:200]}"
                    )
                payload = response.json()
                data = payload.get("data")
                if not isinstance(data, list) or len(data) != len(batch):
                    raise RagEmbeddingError("ModelScope embeddings 返回结构异常")
                ordered = sorted(data, key=lambda item: int(item.get("index", 0)))
                for item in ordered:
                    vector = [float(value) for value in item.get("embedding") or []]
                    if not vector:
                        raise RagEmbeddingError("ModelScope embeddings 返回空向量")
                    vectors.append(vector)
        return vectors

    def embed_documents(self, texts: Sequence[str]) -> list[list[float]]:
        if not texts:
            return []
        return self._request([_clean_text(text) for text in texts])

    def embed_query(self, text: str) -> list[float]:
        return self._request([_clean_text(text)])[0]


def _modelscope_settings() -> Any:
    """复用 LLM 配置（api key / base url），避免重复实现 .env 读取。"""

    from llm_client import load_llm_settings

    return load_llm_settings()


def probe_modelscope_embedding(model: str = DEFAULT_EMBEDDING_MODEL) -> bool:
    """探测当前 key 是否支持 embeddings；不支持时静默返回 False（由 auto 降级）。"""

    try:
        embedder = ModelScopeEmbedder(model=model)
        vector = embedder.embed_query("史脉")
    except Exception as exc:  # noqa: BLE001 - 探测失败就是不可用，不向上抛
        logger.info("ModelScope embeddings 不可用，将回退本地模型：%s", exc)
        return False
    return len(vector) == DEFAULT_EMBEDDING_DIM


# ---------------------------------------------------------------------------
# 本地 fastembed（ONNX bge-small-zh-v1.5）


class LocalEmbedder:
    """fastembed ONNX 本地推理；首次加载会下载模型（约 95MB）。"""

    provider = LOCAL_PROVIDER

    def __init__(
        self, *, model: str = DEFAULT_EMBEDDING_MODEL, dim: int = DEFAULT_EMBEDDING_DIM
    ) -> None:
        if not os.environ.get("HF_ENDPOINT"):
            os.environ["HF_ENDPOINT"] = DEFAULT_HF_MIRROR
        os.environ.setdefault("HF_HUB_DISABLE_TELEMETRY", "1")
        self.model = model
        self.dim = dim
        self._embedding = None

    @property
    def label(self) -> str:
        return f"{self.provider}:{self.model}"

    def _model(self) -> Any:
        if self._embedding is None:
            try:
                from fastembed import TextEmbedding
            except ImportError as exc:  # pragma: no cover - 依赖缺失
                raise RagEmbeddingError(
                    "未安装 fastembed，无法使用本地 embedding；请 pip install -r requirements.txt"
                ) from exc
            try:
                self._embedding = TextEmbedding(model_name=self.model)
            except Exception as exc:
                raise RagEmbeddingError(f"加载本地 embedding 模型失败：{exc}") from exc
        return self._embedding

    def embed_documents(self, texts: Sequence[str]) -> list[list[float]]:
        if not texts:
            return []
        model = self._model()
        vectors = [
            list(map(float, vector))
            for vector in model.embed([_clean_text(text) for text in texts])
        ]
        if vectors:
            self.dim = len(vectors[0])
        return vectors

    def embed_query(self, text: str) -> list[float]:
        model = self._model()
        vectors = list(model.query_embed([_clean_text(text)]))
        if not vectors:
            raise RagEmbeddingError("本地 embedding 返回空向量")
        self.dim = len(vectors[0])
        return list(map(float, vectors[0]))


# ---------------------------------------------------------------------------
# 纯 Python 哈希兜底


_CHAR_SPLIT_RE = re.compile(
    r"[\s，。、；：？！“”‘’《》【】（）·—…,.;:?!\"'()\[\]<>/|~`]+"
)


class HashEmbedder:
    """字符 n-gram 有符号哈希向量（512 维）：零依赖、确定性、可离线。"""

    provider = HASH_PROVIDER

    def __init__(
        self, *, model: str = "hash-char-ngram-512", dim: int = DEFAULT_EMBEDDING_DIM
    ) -> None:
        self.model = model
        self.dim = dim

    @property
    def label(self) -> str:
        return f"{self.provider}:{self.model}"

    def _vector(self, text: str) -> list[float]:
        vector = [0.0] * self.dim
        cleaned = _clean_text(text).casefold()
        tokens: list[str] = []
        for segment in _CHAR_SPLIT_RE.split(cleaned):
            segment = segment.strip()
            if not segment:
                continue
            for size in (1, 2, 3):
                for index in range(max(len(segment) - size + 1, 0)):
                    tokens.append(segment[index : index + size])
            if len(segment) <= 6:
                tokens.append(segment)
        # 全局字符 bigram 兜底（跨标点，中文语料里很有效）。
        compact = _CHAR_SPLIT_RE.sub("", cleaned)
        for index in range(len(compact) - 1):
            tokens.append(compact[index : index + 2])
        for token in tokens:
            digest = hashlib.md5(token.encode("utf-8")).digest()
            bucket = int.from_bytes(digest[:4], "big") % self.dim
            sign = 1.0 if digest[4] & 1 else -1.0
            weight = 1.0 + (len(token) - 1) * 0.5
            vector[bucket] += sign * weight
        norm = math.sqrt(sum(value * value for value in vector))
        if norm == 0:
            return vector
        return [value / norm for value in vector]

    def embed_documents(self, texts: Sequence[str]) -> list[list[float]]:
        return [self._vector(text) for text in texts]

    def embed_query(self, text: str) -> list[float]:
        return self._vector(text)


# ---------------------------------------------------------------------------
# 选择 / 重建
# ---------------------------------------------------------------------------


def selected_provider() -> str:
    provider = (os.environ.get("RAG_EMBEDDING_PROVIDER") or "auto").strip().lower()
    return provider if provider in VALID_PROVIDERS else "auto"


def build_embedder(
    provider: str | None = None,
    *,
    model: str = DEFAULT_EMBEDDING_MODEL,
    dim: int = DEFAULT_EMBEDDING_DIM,
    allow_fallback: bool = False,
) -> Embedder:
    """构造 provider。

    - ``provider=None`` / ``auto``：按 ``AUTO_PROVIDER_ORDER`` 探测（仅入库时使用）；
    - 显式指定时严格构造；``allow_fallback=True`` 才允许在失败后回退到 hash（入库用）。
    """

    requested = (provider or selected_provider()).strip().lower()
    if requested not in VALID_PROVIDERS:
        requested = "auto"

    if requested == "auto":
        for candidate in AUTO_PROVIDER_ORDER:
            try:
                embedder = _build_exact(candidate, model=model, dim=dim)
            except Exception as exc:  # noqa: BLE001 - 探测下一个
                logger.info("embedding provider %s 不可用：%s", candidate, exc)
                continue
            logger.info("RAG embedding provider = %s", embedder.label)
            return embedder
        raise RagEmbeddingError(
            "没有可用的 embedding provider（modelscope / local / hash 全部失败）"
        )

    try:
        return _build_exact(requested, model=model, dim=dim)
    except Exception:
        if not allow_fallback or requested == HASH_PROVIDER:
            raise
        logger.warning(
            "embedding provider %s 不可用，回退 hash", requested, exc_info=True
        )
        return HashEmbedder(dim=dim)


def _build_exact(provider: str, *, model: str, dim: int) -> Embedder:
    if provider == MODELSCOPE_PROVIDER:
        if not probe_modelscope_embedding(model):
            raise RagEmbeddingError(
                "ModelScope embeddings 探测失败（当前 key 可能只开放对话模型）"
            )
        return ModelScopeEmbedder(model=model, dim=dim)
    if provider == LOCAL_PROVIDER:
        embedder = LocalEmbedder(model=model, dim=dim)
        # 立刻跑一次，确保模型可下载 / 可推理；同时校准真实维度。
        vector = embedder.embed_query("史脉")
        embedder.dim = len(vector)
        return embedder
    if provider == HASH_PROVIDER:
        return HashEmbedder(dim=dim)
    raise RagEmbeddingError(f"未知 embedding provider：{provider}")


def rebuild_embedder(manifest: dict[str, Any]) -> Embedder:
    """按 manifest 严格重建入库时的同一个 provider（不一致即报错，避免向量空间错配）。"""

    provider = str(manifest.get("embedding_provider") or "")
    model = str(manifest.get("embedding_model") or DEFAULT_EMBEDDING_MODEL)
    dim = int(manifest.get("embedding_dim") or DEFAULT_EMBEDDING_DIM)
    if provider not in (MODELSCOPE_PROVIDER, LOCAL_PROVIDER, HASH_PROVIDER):
        raise RagEmbeddingError(f"manifest 中的 embedding provider 非法：{provider!r}")
    embedder = _build_exact(provider, model=model, dim=dim)
    if embedder.dim != dim:
        raise RagEmbeddingError(
            f"embedding 维度不一致：manifest={dim}，实际={embedder.dim}（请重新入库）"
        )
    return embedder


def manifest_fields(embedder: Embedder) -> dict[str, Any]:
    return {
        "embedding_provider": embedder.provider,
        "embedding_model": embedder.model,
        "embedding_dim": embedder.dim,
    }


__all__ = [
    "AUTO_PROVIDER_ORDER",
    "DEFAULT_EMBEDDING_DIM",
    "DEFAULT_EMBEDDING_MODEL",
    "DEFAULT_HF_MIRROR",
    "HASH_PROVIDER",
    "LOCAL_PROVIDER",
    "MODELSCOPE_PROVIDER",
    "VALID_PROVIDERS",
    "Embedder",
    "HashEmbedder",
    "LocalEmbedder",
    "ModelScopeEmbedder",
    "RagEmbeddingError",
    "build_embedder",
    "manifest_fields",
    "probe_modelscope_embedding",
    "rebuild_embedder",
    "selected_provider",
]
