"""V1.0.5.1 真实 LLM 验收脚本（不经过 HTTP，直接驱动 AgentOrchestrator）。

用法（在 backend 目录下）：
    .\.venv\Scripts\python.exe ..\.tmp\live_compare.py
"""

from __future__ import annotations

import json
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "backend"))

from agent.orchestrator import AgentOrchestrator  # noqa: E402
from contracts.models import AskRequest  # noqa: E402
from llm_client import LLMClient, load_llm_settings  # noqa: E402
from snapshot_store import SnapshotStore  # noqa: E402


def ask(store, llm, question: str, *, max_steps: int = 6):
    request = AskRequest.model_validate(
        {
            "question": question,
            "session_id": "live-acceptance",
            "context": {"route": "/ask", "mode": "browse"},
            "history": [],
        }
    )
    orchestrator = AgentOrchestrator(store, llm, max_steps=max_steps)
    started = time.perf_counter()
    result = orchestrator.run(request)
    elapsed = time.perf_counter() - started
    return result, elapsed


def describe(label: str, result, elapsed: float) -> dict:
    payload = {
        "label": label,
        "mode": result.answer.mode,
        "steps": result.steps,
        "downgraded": result.downgraded,
        "downgrade_reason": result.downgrade_reason,
        "model_used": result.model_used,
        "latency_ms": result.latency_ms,
        "wall_seconds": round(elapsed, 1),
        "tools": [
            {"name": item.name, "ok": item.ok, "hits": item.hits, "error": item.error_code}
            for item in result.tools
        ],
        "citations": [citation.id for citation in result.citations],
        "markdown_len": len(result.answer.markdown),
        "missing": result.answer.missing,
    }
    print(json.dumps(payload, ensure_ascii=False, indent=2))
    print("---- markdown ----")
    print(result.answer.markdown[:1800])
    print("=================")
    return payload


def main() -> int:
    store = SnapshotStore.load(
        ROOT / "backend" / "data" / "snapshot.v1.json",
        ROOT / "backend" / "data" / "snapshot.meta.json",
    )
    llm = LLMClient(load_llm_settings())
    summaries = []

    comparison, elapsed = ask(store, llm, "王安石变法和商鞅变法的区别")
    summaries.append(describe("comparison", comparison, elapsed))

    single, elapsed = ask(store, llm, "赤壁之战发生在哪一年？")
    summaries.append(describe("single_entity", single, elapsed))

    print("\n==== SUMMARY ====")
    print(json.dumps(summaries, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
