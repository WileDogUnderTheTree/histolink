"""V1.0.5 HTTP 验收：经前端同源代理 POST /api/agent/ask（与前端真实调用链一致）。"""

from __future__ import annotations

import json
import time

import httpx

URL = "http://localhost:3000/api/agent/ask"
QUESTIONS = ["商鞅变法为什么能成功？", "秦始皇吃过西红柿吗？", "秦始皇吃过西红柿吗？"]

for question in QUESTIONS:
    body = {
        "question": question,
        "session_id": "http-live-test",
        "history": [],
        "context": {"route": "/ask"},
    }
    started = time.perf_counter()
    try:
        response = httpx.post(URL, json=body, timeout=180.0)
    except Exception as exc:  # noqa: BLE001
        print("=" * 80)
        print("Q:", question, "REQUEST FAILED:", exc)
        continue
    elapsed = round(time.perf_counter() - started, 1)
    print("=" * 80)
    print("Q:", question, "status:", response.status_code, "elapsed:", elapsed, "s")
    if response.status_code != 200:
        print(response.text[:800])
        continue
    payload = response.json()
    answer = payload.get("answer") or {}
    print("mode:", answer.get("mode"), "certainty:", answer.get("certainty"))
    print("tools:", [(t["name"], t.get("hits")) for t in (payload.get("trace") or {}).get("tools", [])])
    print(
        "citations:",
        [(c["id"], c["kind"], c.get("record_type")) for c in payload.get("citations", [])],
    )
    print("missing:", answer.get("missing"))
    print("markdown:\n" + (answer.get("markdown") or "")[:1200])
