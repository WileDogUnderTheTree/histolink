#!/usr/bin/env python
"""清空史脉 SessionStore 历史记录（V1.0.6.2 收尾 · 用户正式库清理）。

背景
----
早前的自动化验收 / 探针直接通过真实后端提问，把「赤壁之战发生在哪一年？」这类
测试对话写进了用户正式历史库（`backend/data/sessions.v1.sqlite`），侧边栏因此堆积
大量重复假数据。本脚本负责**一次性清空**这些脏数据；此后自动化测试一律使用
`test_` / `e2e_` 前缀的独立测试库（见 `session_store.py` 的测试隔离说明），
不会再写入正式历史。

用法
----
    cd backend
    .\\.venv\\Scripts\\python scripts\\clean_sessions.py                  # 试运行（只统计，不删除）
    .\\.venv\\Scripts\\python scripts\\clean_sessions.py --yes            # 备份后清空正式库
    .\\.venv\\Scripts\\python scripts\\clean_sessions.py --yes --no-backup
    .\\.venv\\Scripts\\python scripts\\clean_sessions.py --db D:\\data\\sessions.v1.sqlite --json

安全设计
--------
- **默认只试运行**：不传 `--yes` 绝不删除任何数据；
- 删除前默认用 SQLite 在线备份 API 生成 `<db>.bak-<时间戳>`（`--no-backup` 可关闭）；
- 只清空 `sessions` / `session_turns` 两张历史表，不触碰快照、RAG 等其他数据；
- 走 `SessionStore` 自身实现（与后端完全同一套语义 / 表结构），不会误删未知表。
"""

from __future__ import annotations

import argparse
import json
import os
import sqlite3
import sys
from datetime import datetime
from pathlib import Path
from typing import Any
from urllib.parse import quote

BACKEND_DIR = Path(__file__).resolve().parents[1]
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

from session_store import DEFAULT_DB_PATH, SessionStore

ZERO_COUNTS = {"sessions": 0, "turns": 0}


def resolve_db_path(raw: str | None) -> Path:
    """解析要清理的数据库路径（显式参数 > SESSION_DB_PATH > 后端默认路径）。"""

    if raw:
        return Path(raw).expanduser()
    env_path = os.environ.get("SESSION_DB_PATH")
    if env_path and env_path != ":memory:":
        return Path(env_path).expanduser()
    return Path(DEFAULT_DB_PATH)


def database_counts(db_path: str | Path) -> dict[str, int]:
    """只读统计历史表数量；库 / 表不存在时返回 0。"""

    path = Path(db_path)
    if not path.is_file():
        return dict(ZERO_COUNTS)
    uri = f"file:{quote(path.resolve().as_posix(), safe='/:')}?mode=ro"
    conn = sqlite3.connect(uri, uri=True, timeout=5.0)
    try:
        tables = {
            row[0]
            for row in conn.execute(
                "SELECT name FROM sqlite_master WHERE type = 'table'"
            ).fetchall()
        }
        sessions = (
            int(conn.execute("SELECT COUNT(*) FROM sessions").fetchone()[0])
            if "sessions" in tables
            else 0
        )
        turns = (
            int(conn.execute("SELECT COUNT(*) FROM session_turns").fetchone()[0])
            if "session_turns" in tables
            else 0
        )
        return {"sessions": sessions, "turns": turns}
    finally:
        conn.close()


def backup_database(db_path: str | Path, backup_path: str | Path) -> Path:
    """用 SQLite 在线备份 API 生成一致快照（WAL 写入也会包含在内）。"""

    source = sqlite3.connect(str(db_path), timeout=10.0)
    target = sqlite3.connect(str(backup_path))
    try:
        source.backup(target)
    finally:
        target.close()
        source.close()
    return Path(backup_path)


def clean_database(
    db_path: str | Path,
    *,
    dry_run: bool = True,
    backup: bool = True,
    now: datetime | None = None,
) -> dict[str, Any]:
    """清空历史表；返回统计结果（便于脚本输出 / 单测断言）。

    - `dry_run=True` 只统计，不创建备份、不删除；
    - `backup=True` 且真正删除时，先写出 `<db>.bak-<时间戳>`。
    """

    path = Path(db_path)
    if not path.is_file():
        return {
            "db_path": str(path),
            "exists": False,
            "dry_run": dry_run,
            "before": dict(ZERO_COUNTS),
            "after": dict(ZERO_COUNTS),
            "backup_path": None,
        }

    before = database_counts(path)
    if dry_run:
        return {
            "db_path": str(path),
            "exists": True,
            "dry_run": True,
            "before": before,
            "after": before,
            "backup_path": None,
        }

    backup_path: Path | None = None
    if backup and (before["sessions"] > 0 or before["turns"] > 0):
        stamp = (now or datetime.now()).strftime("%Y%m%d-%H%M%S")
        backup_path = path.with_name(f"{path.name}.bak-{stamp}")
        backup_database(path, backup_path)

    store = SessionStore(path)
    try:
        cleared = store.clear()
        after = store.counts()
    finally:
        store.close()

    # clear() 返回清理前的正式库数量；与独立只读统计互相校验，防止路径解析错位。
    return {
        "db_path": str(path),
        "exists": True,
        "dry_run": False,
        "before": before,
        "cleared": cleared,
        "after": after,
        "backup_path": str(backup_path) if backup_path is not None else None,
    }


def _print_human(result: dict[str, Any]) -> None:
    if not result.get("exists"):
        print(f"[i] 数据库不存在，无需清理：{result['db_path']}")
        return
    before = result["before"]
    if result["dry_run"]:
        print("[i] 试运行（未删除任何数据）")
        print(f"    数据库：{result['db_path']}")
        print(f"    会话数：{before['sessions']}，轮次消息数：{before['turns']}")
        print("    确认无误后加 --yes 真正清空（默认先自动备份）。")
        return
    print("[ok] 历史记录已清空")
    print(f"    数据库：{result['db_path']}")
    print(
        f"    清理前：{before['sessions']} 个会话 / {before['turns']} 条轮次消息"
        f" → 清理后：{result['after']['sessions']} / {result['after']['turns']}"
    )
    if result.get("backup_path"):
        print(f"    备份：{result['backup_path']}")


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="clean_sessions.py",
        description="清空史脉 SessionStore 历史记录（默认试运行；--yes 才真正删除）。",
    )
    parser.add_argument(
        "--db",
        default=None,
        help="SQLite 路径（默认 backend/data/sessions.v1.sqlite 或 SESSION_DB_PATH）",
    )
    parser.add_argument(
        "--yes",
        action="store_true",
        help="真正删除数据（不传则只试运行 / 统计）",
    )
    parser.add_argument(
        "--no-backup",
        action="store_true",
        help="删除前不生成 <db>.bak-<时间戳> 备份（不建议）",
    )
    parser.add_argument(
        "--json",
        action="store_true",
        help="以 JSON 输出结果（便于脚本 / 验收）",
    )
    return parser


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    db_path = resolve_db_path(args.db)
    try:
        result = clean_database(
            db_path,
            dry_run=not args.yes,
            backup=not args.no_backup,
        )
    except (sqlite3.Error, OSError) as exc:  # pragma: no cover - 磁盘 / 权限异常
        print(f"[fail] 清理失败：{exc}", file=sys.stderr)
        return 1

    if args.json:
        print(json.dumps(result, ensure_ascii=False, indent=2))
    else:
        _print_human(result)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
