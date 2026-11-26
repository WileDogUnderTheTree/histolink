"""会话测试隔离（V1.0.6.2 收尾 · 痛点 1）。

背景：早前的自动化验收直接对真实后端提问，把「赤壁之战发生在哪一年？」这类测试对话
写进了用户正式历史库。本轮要求：
1. 清理脚本能一次清空历史表；
2. **以后的自动化测试不得再写入正式历史**：
   - pytest 进程强制 `SESSION_DB_PATH=:memory:`；
   - `test_` / `e2e_` 等前缀的会话只写独立测试库（默认 `:memory:`）。

覆盖：
- `is_disposable_session_id()` 前缀判定；
- 可丢弃会话读写路由到测试库、正式库统计保持 0、重新打开正式库也查不到；
- 正常会话仍然写正式库；
- `clean_sessions.clean_database()` 试运行不删除、`--yes` 才会备份 + 清空；
- pytest 运行期应用使用的 SessionStore 必须是 `:memory:`（绝不碰真实库）。
"""

from __future__ import annotations

import json
import sqlite3
from pathlib import Path

import pytest

from scripts.clean_sessions import clean_database, database_counts, resolve_db_path
from session_store import (
    DISPOSABLE_SESSION_PREFIXES,
    SessionStore,
    is_disposable_session_id,
    load_disposable_session_prefixes,
)


def _exchange(
    store: SessionStore, session_id: str, question: str = "赤壁之战发生在哪一年？"
) -> None:
    store.append_exchange(
        session_id,
        question=question,
        answer_markdown="赤壁之战发生在公元 208 年。",
        answer_payload=None,
        entity_memory=None,
    )


# ---------------------------------------------------------------------------
# 前缀判定
# ---------------------------------------------------------------------------


def test_默认测试会话前缀覆盖常见自动化入口() -> None:
    for prefix in DISPOSABLE_SESSION_PREFIXES:
        assert is_disposable_session_id(f"{prefix}chat-1") is True
    # 用户真实会话 id（前端生成）绝不能被判定为测试会话。
    assert (
        is_disposable_session_id("session_7e9dccc6-105c-45fa-83b4-41cd86fabf32")
        is False
    )
    assert is_disposable_session_id("stream-session-1") is False
    assert is_disposable_session_id("") is False
    assert is_disposable_session_id(None) is False


def test_测试前缀可由环境变量覆盖() -> None:
    prefixes = load_disposable_session_prefixes(
        {"SESSION_DISPOSABLE_PREFIXES": "qa_, tmp- "}
    )
    assert prefixes == ("qa_", "tmp-")
    assert is_disposable_session_id("qa_case_1", prefixes) is True
    assert is_disposable_session_id("e2e_1", prefixes) is False
    # 空配置回退默认列表。
    assert load_disposable_session_prefixes({"SESSION_DISPOSABLE_PREFIXES": " , "}) == (
        DISPOSABLE_SESSION_PREFIXES
    )


# ---------------------------------------------------------------------------
# 读写路由：可丢弃会话绝不进入正式库
# ---------------------------------------------------------------------------


def test_可丢弃会话只写测试库且不进入正式历史(tmp_path: Path) -> None:
    main_db = tmp_path / "sessions.v1.sqlite"
    store = SessionStore(main_db, disposable_prefixes=("test_", "e2e_"))
    try:
        # 测试会话：能读能写（同一进程内），但正式库统计始终为 0。
        _exchange(store, "e2e_chat_1", "这是 E2E 测试问题")
        assert store.get("e2e_chat_1") is not None
        assert store.counts() == {"sessions": 0, "turns": 0}
        assert store.list_sessions() == []
        assert database_counts(main_db) == {"sessions": 0, "turns": 0}

        # 用户正常会话：进入正式库。
        _exchange(store, "session_real_1", "曹操和刘备是什么关系？")
        assert store.counts() == {"sessions": 1, "turns": 2}
        assert [record.session_id for record in store.list_sessions()] == [
            "session_real_1"
        ]
    finally:
        store.close()

    # 测试库默认 :memory:：进程内可见、进程结束后消失，不会在磁盘留下测试数据。
    reopened = SessionStore(main_db, disposable_prefixes=("test_", "e2e_"))
    try:
        assert reopened.get("e2e_chat_1") is None
        assert reopened.get("session_real_1") is not None
        assert reopened.counts() == {"sessions": 1, "turns": 2}
    finally:
        reopened.close()


def test_测试库可配置为独立文件且与正式库物理隔离(tmp_path: Path) -> None:
    main_db = tmp_path / "main.sqlite"
    test_db = tmp_path / "test-only.sqlite"
    store = SessionStore(
        main_db,
        disposable_prefixes=("test_",),
        # 直接构造时用环境变量切换测试库路径（与后端 / E2E 用法一致）。
    )
    store.close()

    import os

    previous = os.environ.get("SESSION_TEST_DB_PATH")
    os.environ["SESSION_TEST_DB_PATH"] = str(test_db)
    try:
        store = SessionStore(main_db, disposable_prefixes=("test_",))
        try:
            assert store.test_db_path == str(test_db)
            _exchange(store, "test_file_case", "测试会话")
            assert database_counts(test_db) == {"sessions": 1, "turns": 2}
            assert database_counts(main_db) == {"sessions": 0, "turns": 0}
        finally:
            store.close()
    finally:
        if previous is None:
            os.environ.pop("SESSION_TEST_DB_PATH", None)
        else:
            os.environ["SESSION_TEST_DB_PATH"] = previous


# ---------------------------------------------------------------------------
# 清理脚本
# ---------------------------------------------------------------------------


def test_清理脚本_默认试运行不删除_确认后备份并清空(tmp_path: Path) -> None:
    db_path = tmp_path / "sessions.v1.sqlite"
    store = SessionStore(db_path)
    try:
        _exchange(store, "session_dirty_1", "赤壁之战发生在哪一年？")
        _exchange(store, "session_dirty_2", "玄武门之变发生在哪一年？")
        _exchange(store, "session_dirty_3", "武则天是哪个朝代的人物？")
    finally:
        store.close()
    assert database_counts(db_path) == {"sessions": 3, "turns": 6}

    # 1) 试运行：只统计，不删除、不产生备份。
    preview = clean_database(db_path, dry_run=True)
    assert preview["dry_run"] is True
    assert preview["before"] == {"sessions": 3, "turns": 6}
    assert preview["backup_path"] is None
    assert database_counts(db_path) == {"sessions": 3, "turns": 6}
    assert list(tmp_path.glob("sessions.v1.sqlite.bak-*")) == []

    # 2) 真正删除：先备份，再清空。
    result = clean_database(db_path, dry_run=False, backup=True)
    assert result["after"] == {"sessions": 0, "turns": 0}
    assert result["backup_path"] is not None
    backup = Path(result["backup_path"])
    assert backup.is_file()
    # 备份里保留清理前的数据（可回滚恢复）。
    assert database_counts(backup) == {"sessions": 3, "turns": 6}
    assert database_counts(db_path) == {"sessions": 0, "turns": 0}

    # 3) 清理后重开正式库：列表为空、不残留任何轮次。
    store = SessionStore(db_path)
    try:
        assert store.list_sessions() == []
        assert store.counts() == {"sessions": 0, "turns": 0}
    finally:
        store.close()


def test_清理脚本_库不存在时安全返回(tmp_path: Path) -> None:
    missing = tmp_path / "missing.sqlite"
    result = clean_database(missing, dry_run=False)
    assert result["exists"] is False
    assert result["after"] == {"sessions": 0, "turns": 0}
    assert not missing.exists()


def test_清理脚本_解析路径优先级(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    from scripts import clean_sessions

    default_path = tmp_path / "default.sqlite"
    monkeypatch.setattr(clean_sessions, "DEFAULT_DB_PATH", default_path)
    monkeypatch.delenv("SESSION_DB_PATH", raising=False)
    assert resolve_db_path(None) == default_path
    monkeypatch.setenv("SESSION_DB_PATH", str(tmp_path / "env.sqlite"))
    assert resolve_db_path(None) == tmp_path / "env.sqlite"
    assert (
        resolve_db_path(str(tmp_path / "explicit.sqlite"))
        == tmp_path / "explicit.sqlite"
    )


# ---------------------------------------------------------------------------
# pytest 运行期隔离
# ---------------------------------------------------------------------------


def test_pytest运行期会话库必须是内存库(client) -> None:
    """防止本机 / CI 环境变量把测试进程指向用户正式库。"""

    from main import app

    store = app.state.session_store
    assert store is not None
    assert store.db_path == ":memory:"
    assert store.test_db_path == ":memory:"

    # 真实快照问答写入的会话也应只存在于内存库（磁盘正式库路径未被使用）。
    from session_store import DEFAULT_DB_PATH

    assert Path(store.db_path) != DEFAULT_DB_PATH


def test_测试会话不会通过sessions接口进入侧边栏(client) -> None:
    created = client.post(
        "/api/sessions", json={"session_id": "e2e_sidebar_guard", "title": "测试会话"}
    )
    assert created.status_code == 200
    listed = client.get("/api/sessions").json()
    assert all(
        session["session_id"] != "e2e_sidebar_guard" for session in listed["sessions"]
    )
    # 但测试会话本身仍可被读取 / 删除（E2E 恢复流程依赖）。
    detail = client.get("/api/sessions/e2e_sidebar_guard")
    assert detail.status_code == 200
    assert detail.json()["session"]["session_id"] == "e2e_sidebar_guard"
    assert client.delete("/api/sessions/e2e_sidebar_guard").status_code == 200


def test_正式会话仍可正常持久化(client) -> None:
    response = client.post(
        "/api/sessions",
        json={"session_id": "session_isolation_real", "title": "真实会话"},
    )
    assert response.status_code == 200
    listed = client.get("/api/sessions").json()
    assert any(
        session["session_id"] == "session_isolation_real"
        for session in listed["sessions"]
    )
    client.delete("/api/sessions/session_isolation_real")


def test_json输出结构包含清理前后计数(
    tmp_path: Path, capsys: pytest.CaptureFixture[str]
) -> None:
    from scripts import clean_sessions

    db_path = tmp_path / "json.sqlite"
    store = SessionStore(db_path)
    try:
        _exchange(store, "session_json_1")
    finally:
        store.close()

    code = clean_sessions.main(["--db", str(db_path), "--yes", "--json", "--no-backup"])
    assert code == 0
    payload = json.loads(capsys.readouterr().out)
    assert payload["before"] == {"sessions": 1, "turns": 2}
    assert payload["after"] == {"sessions": 0, "turns": 0}
    assert payload["backup_path"] is None


def test_sqlite文件没有测试前缀会话残留(tmp_path: Path) -> None:
    """清理 + 隔离之后，正式库文件里不应出现任何 test_ / e2e_ 前缀的行。"""

    db_path = tmp_path / "sessions.v1.sqlite"
    store = SessionStore(db_path, disposable_prefixes=("test_", "e2e_"))
    try:
        _exchange(store, "test_ghost")
        _exchange(store, "session_real_ok")
    finally:
        store.close()

    conn = sqlite3.connect(db_path)
    try:
        ids = [
            row[0]
            for row in conn.execute(
                "SELECT session_id FROM sessions ORDER BY session_id"
            )
        ]
    finally:
        conn.close()
    assert ids == ["session_real_ok"]
