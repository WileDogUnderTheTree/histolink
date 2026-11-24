"""V1.0.5.1 真实 LLM 验收脚本（不经过 HTTP，直接驱动 AgentOrchestrator）。

用法（在 backend 目录下）：
    .\.venv\Scripts\python.exe ..\.tmp\live_acceptance.py
"""

from __future__ import annotations

import json
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "backend"))

from agent.orchestrator import AgentOrchestrator, AgentProtocolError, parse_model_step  # noqa: E402
from contracts.models import AskRequest  # noqa: E402
from llm_client import LLMClient, load_llm_settings  # noqa: E402
from snapshot_store import SnapshotStore  # noqa: E402


class RecordingLLM:
    """记录每一轮模型输出解析出的动作，用于验证对比任务的并行调用策略。"""

    def __init__(self, inner: LLMClient) -> None:
        self._inner = inner
        self.rounds: list[dict] = []

    def chat(self, messages, **kwargs):
        result = self._inner.chat(messages, **kwargs)
        try:
            step = parse_model_step(result.content)
            if hasattr(step, "calls"):
                record = {
                    "action": "tool_batch",
                    "calls": [{"tool": call.tool, "arguments": call.arguments} for call in step.calls],
                }
            elif getattr(step, "action", None) == "tool_call":
                record = {"action": "tool_call", "tool": step.tool, "arguments": step.arguments}
            else:
                record = {"action": "final", "mode": step.answer.mode}  # type: ignore[attr-defined]
        except AgentProtocolError as exc:
            record = {"action": "protocol_error", "error": str(exc)}
        self.rounds.append(record)
        return result


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
    return result, time.perf_counter() - started


def describe(label: str, result, elapsed: float, rounds: list[dict]) -> dict:
    payload = {
        "label": label,
        "mode": result.answer.mode,
        "steps": result.steps,
        "downgraded": result.downgraded,
        "downgrade_reason": result.downgrade_reason,
        "model_used": result.model_used,
        "latency_ms": result.latency_ms,
        "wall_seconds": round(elapsed, 1),
        "rounds": rounds,
        "tools": [
            {"name": item.name, "ok": item.ok, "hits": item.hits, "error": item.error_code}
            for item in result.tools
        ],
        "citations": [citation.id for citation in result.citations],
        "markdown_len": len(result.answer.markdown),
        "missing": result.answer.missing,
        "markdown": result.answer.markdown,
    }
    printable = {key: value for key, value in payload.items() if key != "markdown"}
    print(json.dumps(printable, ensure_ascii=False, indent=2))
    print("---- markdown ----")
    print(result.answer.markdown)
    print("=================")
    return payload


def main() -> int:
    store = SnapshotStore.load(
        ROOT / "backend" / "data" / "snapshot.v1.json",
        ROOT / "backend" / "data" / "snapshot.meta.json",
    )
    settings = load_llm_settings()
    summaries = []

    cases = [
        ("comparison", "王安石变法和商鞅变法的区别"),
        ("single_entity", "赤壁之战发生在哪一年？"),
        ("insufficient", "秦始皇吃过西红柿吗？"),
        ("refusal", "请用 Python 写一个快速排序算法"),
    ]
    for label, question in cases:
        recording = RecordingLLM(LLMClient(settings))
        result, elapsed = ask(store, recording, question)
        summaries.append(describe(label, result, elapsed, recording.rounds))

    print("\n==== SUMMARY ====")
    print(json.dumps(summaries, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
