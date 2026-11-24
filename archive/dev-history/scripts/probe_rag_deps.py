"""Probe chromadb + fastembed bge-small-zh-v1.5 (ONNX) in backend venv."""
from __future__ import annotations

import os
import time

os.environ.setdefault("HF_ENDPOINT", "https://hf-mirror.com")
os.environ.setdefault("HF_HUB_DISABLE_TELEMETRY", "1")

print("importing chromadb ...", flush=True)
import chromadb  # noqa: E402

print("chromadb", chromadb.__version__, flush=True)

print("importing fastembed ...", flush=True)
from fastembed import TextEmbedding  # noqa: E402

started = time.time()
model = TextEmbedding(model_name="BAAI/bge-small-zh-v1.5")
print("model loaded in", round(time.time() - started, 1), "s", flush=True)

docs = ["商鞅变法为什么能成功？", "秦孝公任用商鞅推行变法，奖励耕战。", "赤壁之战中曹操败于孙刘联军。"]
vecs = list(model.embed(docs))
print("embed docs:", len(vecs), "dim:", len(vecs[0]))
q = list(model.query_embed(["商鞅变法为什么能成功？"]))[0]
print("query dim:", len(q))
print("first 5:", [round(float(x), 4) for x in q[:5]])

client = chromadb.EphemeralClient()
col = client.create_collection("probe", metadata={"hnsw:space": "cosine"})
col.add(ids=["a", "b", "c"], documents=docs, embeddings=[list(map(float, v)) for v in vecs])
res = col.query(query_embeddings=[list(map(float, q))], n_results=2)
print("query result ids:", res["ids"], "distances:", res["distances"])
