"""V1.0.5 真实 LLM 回归（记录每轮原始输出，便于诊断 JSON 协议失败）。"""

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

QUESTIONS = [
    "商鞅变法为什么能成功？",
    "秦始皇吃过西红柿吗？",
    "黄帝战蚩尤的传说讲了什么？",
]


class LoggingLLM:
    def __init__(self, inner: LLMClient, tag: str) -> None:
        self._inner = inner
        self._tag = tag
        self._index = 0
        self.settings = inner.settings

    def chat(self, messages, **kwargs):  # type: ignore[no-untyped-def]
        self._index += 1
        result = self._inner.chat(messages, **kwargs)
        path = Path(__file__).resolve().parent / f"llm_{self._tag}_{self._index}.json"
        path.write_text(
            json.dumps({"content": result.content}, ensure_ascii=False, indent=2),
            encoding="utf-8",
        )
        return result


def main() -> int:
    store = SnapshotStore.load(
        BACKEND / "data" / "snapshot.v1.json",
        BACKEND / "data" / "snapshot.meta.json",
    )
    base = LLMClient.from_env()
    for index, question in enumerate(QUESTIONS):
        llm = LoggingLLM(base, f"q{index}")
        orchestrator = AgentOrchestrator(store, llm)
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
            [(citation.id, citation.kind, citation.record_type) for citation in result.citations],
        )
        print("missing:", result.answer.missing)
        print("markdown:\n" + result.answer.markdown, flush=True)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
