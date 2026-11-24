"""Probe ModelScope inference API model list + embedding/task endpoints."""
from __future__ import annotations

import json
import os
from pathlib import Path

import httpx
from dotenv import load_dotenv

ROOT = Path(__file__).resolve().parents[1]
load_dotenv(ROOT / "backend" / ".env")

key = os.environ.get("MODELSCOPE_API_KEY", "")
base = os.environ.get("MODELSCOPE_BASE_URL", "https://api-inference.modelscope.cn/v1").rstrip("/")
headers = {"Authorization": f"Bearer {key}", "Content-Type": "application/json"}

with httpx.Client(timeout=60) as client:
    r = client.get(f"{base}/models", headers=headers)
    ids = [m.get("id") for m in r.json().get("data", [])]
    print("ALL MODELS:")
    for i in sorted(ids):
        print(" -", i)

    print("\nTRY EMBEDDING MODEL IDS:")
    candidates = [
        "BAAI/bge-m3",
        "BAAI/bge-large-zh-v1.5",
        "BAAI/bge-small-zh-v1.5",
        "damo/nlp_corom_sentence-embedding_chinese-base",
        "iic/nlp_gte_sentence-embedding_chinese-base",
        "AI-ModelScope/bge-small-zh-v1.5",
    ]
    for model in candidates:
        rr = client.post(f"{base}/embeddings", headers=headers, json={"model": model, "input": ["测试"]})
        print(model, "->", rr.status_code, rr.text[:160].replace("\n", " "))
