#!/usr/bin/env python
"""TC-10 模型连通性探针（独立脚本，不被应用导入）。

用法（在 backend 目录、使用 .venv）：
    .\\.venv\\Scripts\\python scripts\\spike_llm.py
    .\\.venv\\Scripts\\python scripts\\spike_llm.py --message "请回复 OK"

读取 backend/.env 或同名环境变量（MODELSCOPE_API_KEY / MODELSCOPE_BASE_URL / MODELSCOPE_MODEL），
发送一句测试话并打印模型真实回复（JSON）。密钥不会出现在输出中（仅打印脱敏后的 key）。

退出码：0 = 成功；2 = 配置缺失/非法；3 = 上游错误；4 = 超时。
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path
from typing import Any

BACKEND_DIR = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(BACKEND_DIR))

# Windows 控制台默认可能是 GBK；显式 UTF-8，避免中文 JSON 输出乱码。
for _stream in (sys.stdout, sys.stderr):
    if hasattr(_stream, "reconfigure"):
        _stream.reconfigure(encoding="utf-8")

from llm_client import (
    DEFAULT_PING_MESSAGE,
    LLMClient,
    LLMConfigError,
    LLMSettings,
    LLMTimeoutError,
    LLMUpstreamError,
    load_llm_settings,
)


def emit(payload: dict[str, Any]) -> None:
    print(json.dumps(payload, ensure_ascii=False, indent=2))


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="史脉 V1.0.1 / TC-10 LLM 连通性探针")
    parser.add_argument(
        "--message",
        default=DEFAULT_PING_MESSAGE,
        help="发给模型的测试语句（默认：请回复 OK）",
    )
    args = parser.parse_args(argv)

    try:
        settings: LLMSettings = load_llm_settings()
    except LLMConfigError as exc:
        emit({"ok": False, "stage": "config", "error": str(exc)})
        return 2

    client = LLMClient(settings)
    try:
        result = client.ping(args.message)
    except LLMTimeoutError as exc:
        emit(
            {
                "ok": False,
                "stage": "timeout",
                "model": settings.model,
                "error": str(exc),
            }
        )
        return 4
    except LLMUpstreamError as exc:
        emit(
            {
                "ok": False,
                "stage": "upstream",
                "model": settings.model,
                "upstream_status": exc.upstream_status,
                "retryable": exc.retryable,
                "error": str(exc),
            }
        )
        return 3

    emit(
        {
            "ok": True,
            "message": args.message,
            "reply": result.reply,
            "model": result.model,
            "latency_ms": result.latency_ms,
            "usage": result.usage,
            "base_url": settings.base_url,
            "api_key": settings.masked_key,
        }
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
