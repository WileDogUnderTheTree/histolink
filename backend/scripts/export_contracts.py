#!/usr/bin/env python
"""导出三份契约生成物（V1.0.1 / TC-04）。

用法（在 backend 目录、使用 backend/.venv）：
    .\\.venv\\Scripts\\python scripts\\export_contracts.py
    .\\.venv\\Scripts\\python scripts\\export_contracts.py --check

生成物（提交入库，禁止手改）：
- contracts/api-v1.openapi.json    （OpenAPI 3.1，info.version=1.0）
- contracts/actions-v1.schema.json （动作信封 + 枚举 + target surface）
- contracts/tools-v1.schema.json   （9 个只读工具的入参/出参）

`contracts/action-policy.json` 是人工维护文件，不由本脚本生成；
它的覆盖校验在 `scripts/validate-contract.mjs`（Node 侧）里完成。

确定性约定：JSON 一律 `sort_keys=True, indent=2, ensure_ascii=False`，末尾补换行；
同一份代码连续执行两次字节级一致。
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

for _stream in (sys.stdout, sys.stderr):
    # 控制台可能是 GBK；显式用 UTF-8，避免中文/符号输出乱码或 UnicodeEncodeError。
    if hasattr(_stream, "reconfigure"):
        _stream.reconfigure(encoding="utf-8")

BACKEND_DIR = Path(__file__).resolve().parents[1]
REPO_ROOT = BACKEND_DIR.parent
CONTRACTS_DIR = REPO_ROOT / "contracts"
sys.path.insert(0, str(BACKEND_DIR))

from contracts.action_types import (  # noqa: E402
    ACTION_AVAILABILITY,
    ACTION_SURFACE,
    action_type_values,
    surface_values,
)
from contracts.models import API_VERSION, SCHEMA_VERSION, UIAction  # noqa: E402
from contracts.tools import TOOLS_SCHEMA  # noqa: E402


def _dump(payload: object) -> str:
    return json.dumps(payload, ensure_ascii=False, indent=2, sort_keys=True) + "\n"


def build_openapi() -> dict:
    from contracts.openapi_app import app  # 延迟导入：导入即建 app，避免 --check 之外的副作用

    spec = app.openapi()
    spec["info"]["version"] = SCHEMA_VERSION
    spec["info"]["title"] = "史脉 HistoLink API（V1.0 契约）"
    spec["info"]["description"] = (
        "V1.0 契约冻结物（TC-04）。由 backend/contracts 的 Pydantic 模型导出，"
        "前端类型由 openapi-typescript 生成（scripts/gen-frontend-types.mjs）。"
    )
    # OpenAPI 3.1 的 servers 留空：前端一律同源 /api 代理。
    spec["servers"] = []
    return spec


def build_actions_schema() -> dict:
    schema = UIAction.model_json_schema(ref_template="#/$defs/{model}")
    return {
        "$schema": "https://json-schema.org/draft/2020-12/schema",
        "$id": "https://histolink.local/contracts/actions-v1.schema.json",
        "title": "史脉 V1.0 UI Action 信封",
        "description": (
            "动作信封（id/type/payload/target/auto/label/reason）；auto 仅为建议值，"
            "前端按 target.surface === 当前路由判定同页自动、跨页确认（Q2）。"
        ),
        "version": SCHEMA_VERSION,
        "x-action-types": action_type_values(),
        "x-surfaces": surface_values(),
        "x-availability": {
            action.value: ACTION_AVAILABILITY[action] for action in ACTION_AVAILABILITY
        },
        "x-action-surface": {
            action.value: (surface.value if surface is not None else None)
            for action, surface in ACTION_SURFACE.items()
        },
        **schema,
    }


def main(argv: list[str]) -> int:
    check_mode = "--check" in argv

    outputs = {
        CONTRACTS_DIR / "api-v1.openapi.json": _dump(build_openapi()),
        CONTRACTS_DIR / "actions-v1.schema.json": _dump(build_actions_schema()),
        CONTRACTS_DIR / "tools-v1.schema.json": _dump(TOOLS_SCHEMA),
    }

    if check_mode:
        diffs: list[str] = []
        for path, content in outputs.items():
            name = path.name
            if not path.exists():
                diffs.append(f"{name}：文件缺失")
            elif path.read_text(encoding="utf-8") != content:
                diffs.append(f"{name}：内容与导出结果不一致")
        if diffs:
            print("[fail] 契约导出校验失败（生成物过期或手改）：", file=sys.stderr)
            for message in diffs:
                print(f"  - {message}", file=sys.stderr)
            print("  修复：cd backend; .\\.venv\\Scripts\\python scripts\\export_contracts.py", file=sys.stderr)
            return 1
        print("[ok] 契约一致：api-v1.openapi.json / actions-v1.schema.json / tools-v1.schema.json")
        return 0

    CONTRACTS_DIR.mkdir(parents=True, exist_ok=True)
    for path, content in outputs.items():
        path.write_text(content, encoding="utf-8")
        print(f"  写出 {path.relative_to(REPO_ROOT)}（{len(content.encode('utf-8'))} bytes）")

    actions = build_actions_schema()
    tool_count = len(TOOLS_SCHEMA["tools"])
    print(
        f"✓ 契约导出完成：OpenAPI {API_VERSION} / schema {SCHEMA_VERSION}；"
        f"动作 {len(actions['x-action-types'])} 种、工具 {tool_count} 个"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
