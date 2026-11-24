"""Probe ModelScope inference API: models list + embeddings support."""
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
print("base:", base, "key_len:", len(key))

headers = {"Authorization": f"Bearer {key}", "Content-Type": "application/json"}

with httpx.Client(timeout=30) as client:
    r = client.get(f"{base}/models", headers=headers)
    print("models status:", r.status_code)
    try:
        data = r.json()
        ids = [m.get("id") for m in data.get("data", [])]
        print("model count:", len(ids))
        print("bge/embedding models:", [i for i in ids if "bge" in (i or "").lower() or "embed" in (i or "").lower()][:20])
    except Exception as exc:
        print("models parse error:", exc, r.text[:300])

    for model in ("BAAI/bge-small-zh-v1.5", "Qwen/Qwen3-Embedding-0.6B"):
        payload = {"model": model, "input": ["商鞅变法为什么能成功？", "秦孝公任用商鞅推行变法"]}
        try:
            rr = client.post(f"{base}/embeddings", headers=headers, json=payload)
            print(f"\nembeddings[{model}] status:", rr.status_code)
            body = rr.text[:500]
            print("body:", body)
            if rr.status_code == 200:
                obj = rr.json()
                vecs = obj.get("data") or []
                print("count:", len(vecs), "dim:", len(vecs[0]["embedding"]) if vecs else None)
                break
        except Exception as exc:
            print(f"embeddings[{model}] error:", exc)
