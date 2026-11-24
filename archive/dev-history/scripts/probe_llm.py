"""TC-10 能力探针（临时脚本，不入库）：连通性 / JSON 模式 / tool calling / 流式 / 中文质量 / 确定性。"""

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
results: dict = {"base_url": settings.base_url, "model": settings.model}


def post(payload: dict, *, timeout: float = 180.0) -> tuple[int, dict, float]:
    started = time.perf_counter()
    with httpx.Client(timeout=timeout, follow_redirects=True) as client:
        response = client.post(url, headers=headers, json=payload)
    elapsed = round((time.perf_counter() - started) * 1000)
    try:
        body = response.json()
    except ValueError:
        body = {"raw": response.text[:500]}
    return response.status_code, body, elapsed


def text_of(body: dict) -> str:
    try:
        return body["choices"][0]["message"]["content"]
    except Exception:
        return ""


# --- P1/P7 连通性 + 确定性：同 prompt 连续 4 次 ---
runs = []
for index in range(4):
    status, body, elapsed = post(
        {
            "model": settings.model,
            "messages": [{"role": "user", "content": "请回复 OK"}],
            "temperature": 0.0,
            "max_tokens": 64,
            "stream": False,
        }
    )
    runs.append(
        {
            "run": index + 1,
            "status": status,
            "reply": text_of(body),
            "latency_ms": elapsed,
            "usage": body.get("usage"),
            "model": body.get("model"),
        }
    )
results["ping_runs"] = runs

# --- P2 JSON 模式 ---
status, body, elapsed = post(
    {
        "model": settings.model,
        "messages": [
            {"role": "system", "content": "只输出一个 JSON 对象，不要 Markdown。"},
            {"role": "user", "content": '返回 {"answer":"OK","score":1} 这个 JSON。'},
        ],
        "temperature": 0.0,
        "max_tokens": 200,
        "response_format": {"type": "json_object"},
        "stream": False,
    }
)
raw = text_of(body)
parsed_ok = False
try:
    json.loads(raw)
    parsed_ok = True
except Exception:
    pass
results["json_mode"] = {
    "status": status,
    "latency_ms": elapsed,
    "reply": raw,
    "parsed_json": parsed_ok,
    "usage": body.get("usage"),
    "error": body.get("error"),
}

# --- P3 tool calling ---
tools = [
    {
        "type": "function",
        "function": {
            "name": "get_event",
            "description": "按 event_id 查询史脉事件",
            "parameters": {
                "type": "object",
                "properties": {"event_id": {"type": "string"}},
                "required": ["event_id"],
            },
        },
    }
]
status, body, elapsed = post(
    {
        "model": settings.model,
        "messages": [
            {"role": "user", "content": "秦始皇统一六国是哪个事件？请调用 get_event 工具查询 qin-unify。"}
        ],
        "tools": tools,
        "tool_choice": "auto",
        "temperature": 0.0,
        "max_tokens": 200,
        "stream": False,
    }
)
tool_calls = None
try:
    tool_calls = body["choices"][0]["message"].get("tool_calls")
except Exception:
    pass
results["tool_calling"] = {
    "status": status,
    "latency_ms": elapsed,
    "tool_calls": tool_calls,
    "reply": text_of(body),
    "usage": body.get("usage"),
    "error": body.get("error"),
}

# --- P4 流式 SSE 首字延迟 ---
payload = {
    "model": settings.model,
    "messages": [{"role": "user", "content": "用一句话说明赤壁之战发生在哪一年。"}],
    "temperature": 0.0,
    "max_tokens": 200,
    "stream": True,
}
started = time.perf_counter()
first_chunk_ms = None
chunk_count = 0
content_parts: list[str] = []
finish_reason = None
try:
    with httpx.Client(timeout=60.0, follow_redirects=True) as client:
        with client.stream("POST", url, headers=headers, json=payload) as response:
            status = response.status_code
            for line in response.iter_lines():
                if not line or not line.startswith("data:"):
                    continue
                data = line[5:].strip()
                if data == "[DONE]":
                    break
                chunk_count += 1
                if first_chunk_ms is None:
                    first_chunk_ms = round((time.perf_counter() - started) * 1000)
                try:
                    chunk = json.loads(data)
                except ValueError:
                    continue
                try:
                    choice = chunk["choices"][0]
                    delta = choice.get("delta") or {}
                    if delta.get("content"):
                        content_parts.append(delta["content"])
                    if choice.get("finish_reason"):
                        finish_reason = choice["finish_reason"]
                except Exception:
                    pass
    results["streaming"] = {
        "status": status,
        "first_chunk_ms": first_chunk_ms,
        "total_ms": round((time.perf_counter() - started) * 1000),
        "chunk_count": chunk_count,
        "reply": "".join(content_parts),
        "finish_reason": finish_reason,
    }
except Exception as exc:  # noqa: BLE001
    results["streaming"] = {"error": f"{type(exc).__name__}: {exc}"}

# --- P6 中文 150–400 字回答质量（单题样本） ---
status, body, elapsed = post(
    {
        "model": settings.model,
        "messages": [
            {
                "role": "system",
                "content": "你是中国历史问答助手，只依据可靠史实回答，禁止编造。回答 150–250 字，末尾注明所依据的史书。",
            },
            {
                "role": "user",
                "content": "简述秦始皇统一六国的历史意义。",
            },
        ],
        "temperature": 0.2,
        "max_tokens": 400,
        "stream": False,
    }
)
reply = text_of(body)
results["chinese_answer"] = {
    "status": status,
    "latency_ms": elapsed,
    "reply": reply,
    "chars": len(reply),
    "usage": body.get("usage"),
}

out = Path(__file__).with_name("llm-probe-results.json")
out.write_text(json.dumps(results, ensure_ascii=False, indent=2), encoding="utf-8")
print(f"written {out}")
print(json.dumps({k: (v if k != "chinese_answer" else {kk: vv for kk, vv in v.items() if kk != "reply"}) for k, v in results.items()}, ensure_ascii=False, indent=2)[:4000])

