"""pytest 公共夹具（V1.0.1 / TC-04 起）。"""

from __future__ import annotations

import json
import sys
from pathlib import Path
from typing import Any, Callable

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
