"""pytest 公共夹具（V1.0.1 / TC-04 起；V1.0.6 会话库隔离）。"""

from __future__ import annotations

import json
import os
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

# 测试确定性（V1.0.6.2）：开发者本机 backend/.env 现在可能指向本地 Ollama
# （MODELSCOPE_MODEL=hf.co/...），而 /api/agent/models 等端点会读取真实配置。
# 这里在导入 main 之前钉死测试期望的「云端默认模型」配置（setdefault 不覆盖 CI 注入值），
# 避免本机 .env 污染断言；需要验证缺失配置的用例会自行 monkeypatch.delenv。
os.environ.setdefault("MODELSCOPE_API_KEY", "sk-test-local")
os.environ.setdefault("MODELSCOPE_BASE_URL", "https://api-inference.modelscope.cn/v1")
os.environ.setdefault("MODELSCOPE_MODEL", "Qwen/Qwen3.5-35B-A3B")
os.environ.setdefault("MODELSCOPE_FALLBACK_MODEL", "Qwen/Qwen3.5-8B-Instruct")
os.environ.setdefault("LLM_TIMEOUT_SECONDS", "30")
os.environ.setdefault("LLM_REASONING_EFFORT", "")
# 模型展示名（V1.0.6.2）：不让本机 .env 的 XiaoHong-v1 展示名污染「默认 Qwen 模型」断言。
os.environ.setdefault("LLM_MODEL_DISPLAY_NAME", "")
os.environ.setdefault("LLM_FALLBACK_MODEL_DISPLAY_NAME", "")
os.environ.setdefault("ENABLE_STREAM_CHAT", "1")

# V1.0.6：测试一律用内存会话库，避免把测试会话写进 backend/data/sessions.v1.sqlite。
# 必须在导入 main / session_store 之前设置（conftest 最先被 pytest 加载）。
# 这里**强制覆盖**（不用 setdefault）：即使开发者 shell / CI 注入了真实库路径，
# 测试进程也绝不能写用户正式历史。
os.environ["SESSION_DB_PATH"] = ":memory:"
# V1.0.6.2：可丢弃会话（test_ / e2e_ 前缀）单独写测试库；单测同样固定为内存库，
# 防止开发者本机 .env 配了 SESSION_TEST_DB_PATH 时测试写出落盘文件。
os.environ["SESSION_TEST_DB_PATH"] = ":memory:"


@pytest.fixture(autouse=True)
def _reset_session_store() -> Any:
    """每个用例前清空服务端会话库（V1.0.6 会话历史是跨请求的服务端状态）。

    只清理**已经启动**的应用（`client` fixture 是 session 级，lifespan 首次使用时才创建
    SessionStore）；不主动启动应用，因此纯单元测试不受影响。
    """

    from main import app

    store = getattr(app.state, "session_store", None)
    if store is not None:
        store.clear()
    yield


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

    schema = json.loads(
        (contracts_dir / "tools-v1.schema.json").read_text(encoding="utf-8")
    )
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

    return json.loads(
        (contracts_dir / "api-v1.openapi.json").read_text(encoding="utf-8")
    )
