"""V1.0.5 真实 LLM 回归（商鞅变法单题，验证 claims 长度约束修复）。"""

from __future__ import annotations

import json
import sys
import time
from pathlib import Path

BACKEND = Path(__file__).resolve().parents[1] / "backend"
sys.path.insert(0, str(BACKEND))

from agent.orchestrator import AgentOrchestrator  # noqa: E402
from contracts.models import AskRequest  # noqa: E402
from llm_client import LLMClient  # noqa: E402
from snapshot_store import SnapshotStore  # noqa: E402

QUESTION = "商鞅变法为什么能成功？"


class LoggingLLM:
    def __init__(self, inner: LLMClient) -> None:
        self._inner = inner
        self._index = 0
        self.settings = inner.settings

    def chat(self, messages, **kwargs):  # type: ignore[no-untyped-def]
        self._index += 1
        result = self._inner.chat(messages, **kwargs)
        Path(__file__).resolve().parent.joinpath(f"llm_fix_{self._index}.json").write_text(
            json.dumps({"content": result.content}, ensure_ascii=False, indent=2), encoding="utf-8"
        )
        return result


def main() -> int:
    store = SnapshotStore.load(
        BACKEND / "data" / "snapshot.v1.json",
        BACKEND / "data" / "snapshot.meta.json",
    )
    llm = LoggingLLM(LLMClient.from_env())
    orchestrator = AgentOrchestrator(store, llm)
    request = AskRequest.model_validate(
        {"question": QUESTION, "session_id": "live-test", "context": {"route": "/ask"}}
    )
    started = time.perf_counter()
    result = orchestrator.run(request)
    print(f"elapsed={round(time.perf_counter() - started, 1)}s")
    print(f"mode={result.answer.mode} downgraded={result.downgraded} steps={result.steps}")
    print("tools:", [(record.name, record.ok, record.hits) for record in result.tools])
    print(
        "citations:",
        [(citation.id, citation.kind, citation.record_type) for citation in result.citations],
    )
    print("missing:", result.answer.missing)
    print("markdown:\n" + result.answer.markdown)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
