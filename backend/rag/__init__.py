"""史脉 RAG 混合检索（V1.0.5）。

模块划分：

- ``rag.corpus``：Markdown 语料解析 + 切分（纯函数，可单测）；
- ``rag.embedding``：embedding provider（ModelScope API / 本地 fastembed / 离线 hash）；
- ``rag.store``：chromadb 持久化向量库 + 检索入口 + manifest 状态。

入库脚本：``backend/scripts/ingest_rag.py``；
Agent 工具：``backend/agent/tools/rag.py`` 的 ``search_historical_text``。
"""

from __future__ import annotations

__all__: list[str] = []
