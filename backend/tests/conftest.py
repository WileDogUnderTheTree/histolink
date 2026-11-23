"""pytest 公共夹具（V1.0.1 / TC-04 起）。"""

from __future__ import annotations

import json
import sys
from collections.abc import Callable
from pathlib import Path
from typing import Any

import pytest

BACKEND_DIR = Path(__file__).resolve().parents[1]
REPO_ROOT = BACKEND_DIR.parent

# 让测试可以直接 `from contracts import ...`
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))


@pytest.fixture(scope="session")
def repo_root() -> Path:
    """仓库根目录。"""

    return REPO_ROOT


@pytest.fixture(scope="session")
def contracts_dir(repo_root: Path) -> Path:
    """契约目录（生成物 + 人工策略 + 样例）。"""

    return repo_root / "contracts"


@pytest.fixture(scope="session")
def load_json(contracts_dir: Path) -> Callable[[str], Any]:
    """按相对 contracts/ 的路径读取 JSON。"""

    def _load(relative_path: str) -> Any:
        return json.loads((contracts_dir / relative_path).read_text(encoding="utf-8"))

    return _load


@pytest.fixture(scope="session")
def load_sample(load_json: Callable[[str], Any]) -> Callable[[str], Any]:
    """读取 contracts/samples/<name>。"""

    def _load(name: str) -> Any:
        return load_json(f"samples/{name}")

    return _load


@pytest.fixture(scope="session")
def client():
    """启动真实 lifespan（加载真实快照）的 TestClient。"""

    from fastapi.testclient import TestClient

    from main import app

    with TestClient(app) as test_client:
        yield test_client


@pytest.fixture(scope="session")
def snapshot_store():
    """直接加载真实快照（不经过 HTTP），供 V1.0.2 工具层测试使用。"""

    from snapshot_store import SnapshotStore

    return SnapshotStore.load(
        BACKEND_DIR / "data" / "snapshot.v1.json",
        BACKEND_DIR / "data" / "snapshot.meta.json",
    )


@pytest.fixture(scope="session")
def store(snapshot_store):
    """V1.0.3 测试的简写 fixture：真实快照。"""

    return snapshot_store


@pytest.fixture(scope="session")
def tool_context(snapshot_store):
    """工具层只读上下文（构造一次，全部工具测试复用）。"""

    from agent.tools import ToolContext

    return ToolContext.from_store(snapshot_store)


@pytest.fixture(scope="session")
def toolkit(snapshot_store):
    """工具层门面（按名分发的入口，V1.0.3 规划器同一入口）。"""

    from agent.tools import Toolkit

    return Toolkit(snapshot_store)


@pytest.fixture(scope="session")
def tool_contracts(contracts_dir: Path) -> dict[str, dict[str, Any]]:
    """按工具名索引的冻结出参 JSON Schema（读导出物，不读实现）。"""

    schema = json.loads((contracts_dir / "tools-v1.schema.json").read_text(encoding="utf-8"))
    return {tool["name"]: tool for tool in schema["tools"]}


@pytest.fixture(scope="session")
def assert_tool_contract(tool_contracts: dict[str, dict[str, Any]], snapshot_store):
    """断言统一信封完整、`data` 符合冻结契约、快照版本正确。"""

    from jsonschema import Draft202012Validator

    def _assert(result: dict[str, Any], tool_name: str) -> None:
        assert set(result) == {
            "ok",
            "tool",
            "data",
            "error",
            "meta",
            "items",
            "citations",
            "truncated",
            "snapshot_version",
        }, f"{tool_name} 统一信封字段不完整"
        assert result["tool"] == tool_name
        assert result["snapshot_version"] == snapshot_store.meta["snapshot_version"]
        assert isinstance(result["items"], list)
        assert isinstance(result["citations"], list)
        assert isinstance(result["truncated"], bool)
        if result["ok"]:
            assert result["error"] is None
        else:
            assert result["data"] is None
            assert result["error"] is not None
            assert result["items"] == []
            assert result["citations"] == []
        # V1.0.2 起 output 是统一信封（成功/失败 oneOf），直接校验整个返回。
        Draft202012Validator(tool_contracts[tool_name]["output"]).validate(result)

    return _assert


@pytest.fixture(scope="session")
def openapi_spec(contracts_dir: Path) -> dict[str, Any]:
    """OpenAPI 契约（用于校验 API 响应符合冻结 schema）。"""

    return json.loads((contracts_dir / "api-v1.openapi.json").read_text(encoding="utf-8"))