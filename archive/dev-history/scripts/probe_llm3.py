"""补充探针：thinking 开关 + 服务端点真实调用（临时脚本，不入库）。"""

from __future__ import annotations

import json
import sys
import time
from pathlib import Path

BACKEND = Path(__file__).resolve().parents[1] / "backend"
sys.path.insert(0, str(BACKEND))

import httpx  # noqa: E402

from llm_client import load_llm_settings  # noqa: E402

settings = load_llm_settings()
url = settings.chat_completions_url
headers = {"Authorization": f"Bearer {settings.api_key}", "Content-Type": "application/json"}
out: dict = {}


def post(payload: dict) -> dict:
    started = time.perf_counter()
    with httpx.Client(timeout=180.0, follow_redirects=True) as client:
        response = client.post(url, headers=headers, json=payload)
    elapsed = round((time.perf_counter() - started) * 1000)
    try:
        body = response.json()
    except ValueError:
        body = {"raw": response.text[:300]}
    reply = ""
    try:
        reply = body["choices"][0]["message"].get("content") or ""
    except Exception:
        pass
    return {
        "status": response.status_code,
        "latency_ms": elapsed,
        "reply": reply,
        "usage": body.get("usage"),
        "error": body.get("error"),
    }


base = {
    "model": settings.model,
    "messages": [{"role": "user", "content": "请回复 OK"}],
    "temperature": 0.0,
    "max_tokens": 64,
    "stream": False,
}
variants = {
    "baseline": {},
    "enable_thinking_false_top": {"enable_thinking": False},
    "chat_template_kwargs": {"chat_template_kwargs": {"enable_thinking": False}},
    "extra_body": {"extra_body": {"enable_thinking": False}},
    "reasoning_effort_none": {"reasoning_effort": "none"},
}
for name, extra in variants.items():
    payload = {**base, **extra}
    try:
        out[name] = post(payload)
    except Exception as exc:  # noqa: BLE001
        out[name] = {"error": f"{type(exc).__name__}: {exc}"}

# 服务端点真实调用（FastAPI TestClient）
try:
    from fastapi.testclient import TestClient

    from main import create_app

    app = create_app()
    with TestClient(app) as client:
        started = time.perf_counter()
        response = client.get("/api/agent/ping_llm")
        elapsed = round((time.perf_counter() - started) * 1000)
        out["endpoint"] = {"status": response.status_code, "body": response.json(), "wall_ms": elapsed}
except Exception as exc:  # noqa: BLE001
    out["endpoint"] = {"error": f"{type(exc).__name__}: {exc}"}

Path(__file__).with_name("llm-thinking-probe.json").write_text(
    json.dumps(out, ensure_ascii=False, indent=2), encoding="utf-8"
)
print(json.dumps(out, ensure_ascii=False, indent=2)[:6000])
