"""V1.0.5 真实 LLM 回归（重点：商鞅变法图谱先行 + 西红柿 insufficient）。"""

from __future__ import annotations

import sys
import time
from pathlib import Path

BACKEND = Path(__file__).resolve().parents[1] / "backend"
sys.path.insert(0, str(BACKEND))

from agent.orchestrator import AgentOrchestrator  # noqa: E402
from contracts.models import AskRequest  # noqa: E402
from llm_client import LLMClient  # noqa: E402
from snapshot_store import SnapshotStore  # noqa: E402

QUESTIONS = [
    "商鞅变法为什么能成功？",
    "秦始皇吃过西红柿吗？",
]


def main() -> int:
    store = SnapshotStore.load(
        BACKEND / "data" / "snapshot.v1.json",
        BACKEND / "data" / "snapshot.meta.json",
    )
    client = LLMClient.from_env()
    orchestrator = AgentOrchestrator(store, client)
    for question in QUESTIONS:
        request = AskRequest.model_validate(
            {"question": question, "session_id": "live-test", "context": {"route": "/ask"}}
        )
        started = time.perf_counter()
        result = orchestrator.run(request)
        elapsed = round(time.perf_counter() - started, 1)
        print("=" * 90)
        print("Q:", question)
        print(
            f"mode={result.answer.mode} downgraded={result.downgraded} steps={result.steps} "
            f"elapsed={elapsed}s"
        )
        print("tools:", [(record.name, record.ok, record.hits) for record in result.tools])
        print(
            "citations:",
            [(citation.id, citation.kind, citation.title, citation.record_type) for citation in result.citations],
        )
        print("missing:", result.answer.missing)
        print("markdown:\n" + result.answer.markdown, flush=True)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
