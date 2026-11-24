from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path("backend").resolve()))

from rag.corpus import build_chunks, parse_corpus  # noqa: E402

docs = parse_corpus(["docs/史脉_RAG语料库_核心历史事件.md"])
doc = next(d for d in docs if "商鞅" in d.title)
print("doc:", doc.title, "years:", doc.years)
for ex in doc.excerpts:
    print("excerpt:", repr(ex.source_label), repr(ex.book), repr(ex.chapter), ex.text[:40])
chunks = build_chunks([doc])
for ch in chunks:
    print(ch.chunk_id, ch.section, repr(ch.source), repr(ch.source_label), ch.text[:30])
