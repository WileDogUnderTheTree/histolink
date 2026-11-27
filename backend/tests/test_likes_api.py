"""点赞计数（V1.0.8）：`LikesStore` 持久化 + `GET/POST /api/likes` 接口测试。

覆盖：
- 文件不存在时自动创建 `backend/data/likes.json`（`{"count": 0}`）；
- GET 返回当前总数，POST 自增并返回最新总数；
- 计数跨 Store 实例持久化（服务重启后点赞数不丢）；
- 损坏 / 非法 JSON、异常 count 值的安全归一化；
- 只读闸门：`POST /api/likes` 放行（不再是 405），其余 `/api` 写方法仍 405。
"""

from __future__ import annotations

import json
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from likes_store import LikesStore, normalize_like_count
from routers.deps import get_likes_store


@pytest.fixture
def tmp_likes_path(tmp_path: Path) -> Path:
    return tmp_path / "data" / "likes.json"


@pytest.fixture
def override_likes(client: TestClient, tmp_likes_path: Path):
    """把接口依赖替换成临时目录里的独立 LikesStore（不写用户真实 likes.json）。"""

    store = LikesStore(tmp_likes_path)

    def _install() -> LikesStore:
        client.app.dependency_overrides[get_likes_store] = lambda: store
        return store

    _install()
    yield store
    client.app.dependency_overrides.pop(get_likes_store, None)


# ---------------------------------------------------------------------------
# LikesStore 单元测试
# ---------------------------------------------------------------------------


def test_store_creates_file_with_zero_count(tmp_likes_path: Path) -> None:
    assert not tmp_likes_path.exists()
    store = LikesStore(tmp_likes_path)
    assert store.count() == 0
    assert tmp_likes_path.exists()
    assert json.loads(tmp_likes_path.read_text(encoding="utf-8")) == {"count": 0}


def test_store_increment_persists_across_instances(tmp_likes_path: Path) -> None:
    first = LikesStore(tmp_likes_path)
    assert first.increment() == 1
    assert first.increment() == 2

    # 模拟服务重启：新实例从文件恢复计数。
    second = LikesStore(tmp_likes_path)
    assert second.count() == 2
    assert second.increment() == 3
    assert json.loads(tmp_likes_path.read_text(encoding="utf-8")) == {"count": 3}


def test_store_recovers_from_corrupted_file(tmp_likes_path: Path) -> None:
    tmp_likes_path.parent.mkdir(parents=True, exist_ok=True)
    tmp_likes_path.write_text("{not-json", encoding="utf-8")
    store = LikesStore(tmp_likes_path)
    assert store.count() == 0
    assert json.loads(tmp_likes_path.read_text(encoding="utf-8")) == {"count": 0}
    assert store.increment() == 1


def test_store_normalizes_invalid_count_values(tmp_likes_path: Path) -> None:
    tmp_likes_path.parent.mkdir(parents=True, exist_ok=True)
    tmp_likes_path.write_text(json.dumps({"count": -5}), encoding="utf-8")
    assert LikesStore(tmp_likes_path).count() == 0

    tmp_likes_path.write_text(json.dumps({"count": "abc"}), encoding="utf-8")
    assert LikesStore(tmp_likes_path).count() == 0

    assert normalize_like_count(True) == 0  # bool 不是合法计数
    assert normalize_like_count(3.7) == 0
    assert normalize_like_count(10**12) == 1_000_000_000


def test_store_memory_mode_does_not_touch_disk() -> None:
    store = LikesStore(":memory:")
    assert store.is_memory is True
    assert store.path == ":memory:"
    assert store.increment() == 1
    assert store.count() == 1


# ---------------------------------------------------------------------------
# HTTP 接口
# ---------------------------------------------------------------------------


def test_likes_api_get_then_post(client: TestClient, override_likes) -> None:
    response = client.get("/api/likes")
    assert response.status_code == 200
    payload = response.json()
    assert payload["ok"] is True
    assert payload["count"] == 0
    assert payload["api_version"] == "1.0.8"

    first = client.post("/api/likes")
    assert first.status_code == 200
    assert first.json()["count"] == 1

    second = client.post("/api/likes")
    assert second.json()["count"] == 2

    assert client.get("/api/likes").json()["count"] == 2
    # 计数写入注入的临时文件（不是用户真实 backend/data/likes.json）。
    on_disk = override_likes.path
    assert json.loads(Path(on_disk).read_text(encoding="utf-8"))["count"] == 2


def test_likes_post_is_allowlisted_in_read_only_gate(client: TestClient) -> None:
    """`POST /api/likes` 已加入写白名单：不再返回 405（依赖覆盖由 override fixture 完成）。"""

    path = "/api/likes"
    response = client.post(path)
    # 未覆盖依赖时使用应用启动时创建的 LikesStore（测试进程固定 :memory:）。
    assert response.status_code == 200
    assert response.json()["ok"] is True
    # 其余 /api 写方法仍被只读闸门拦截。
    blocked = client.post("/api/meta")
    assert blocked.status_code == 405
    assert blocked.json()["error"]["code"] == "METHOD_NOT_ALLOWED"