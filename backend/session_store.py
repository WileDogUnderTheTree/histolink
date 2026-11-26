"""服务端会话存储（V1.0.6：多轮记忆 + 前端历史记录真实持久化）。

职责
----
1. **会话持久化**：`session_id → 标题 / 创建时间 / 最后消息时间 / 置顶 / 实体记忆 / 轮次列表`，
   落盘 SQLite（标准库 `sqlite3`，默认 `backend/data/sessions.v1.sqlite`）；
2. **多轮上下文**：`history_turns()` 返回「最近 N 轮」消息，供 `AgentOrchestrator`
   作为 messages 数组注入 Qwen；
3. **长对话截断**：保留最近的 N 条消息（默认 6 条 = 3 轮），单条 content 截断到
   1200 字、总预算 6000 字；System Prompt 由服务端每轮重新生成、不参与截断；
4. **实体状态**：`entity_memory` 记录上一轮真实工具结果里出现过的人物 / 事件 ID，
   供「他们 / 这两人 / 双方」等代词解析（`agent.session_memory`）。

实现选择
--------
- FastAPI 同步路由在线程池执行，SQLite 连接默认不能跨线程：这里 `check_same_thread=False`
  + 进程内 `RLock` 串行化全部读写（单后端进程、低并发场景足够，且不引入额外依赖）；
- 测试可用 `SESSION_DB_PATH=:memory:` 启内存库；此时连接不落盘，随进程 / lifespan 结束销毁；
- 每个会话最多保留 `MAX_STORED_TURNS` 条消息（默认 200），超出后从最旧开始裁剪，
  防止单会话无限增长撑爆磁盘。

测试隔离（V1.0.6.2 收尾）
------------------------
- **可丢弃会话**：`session_id` 命中 `DISPOSABLE_SESSION_PREFIXES`（默认
  `test_` / `e2e_` / `pytest_` / `smoke_` / `probe-`）时，读写全部路由到**独立测试库**
  （`SESSION_TEST_DB_PATH`，默认 `:memory:`），既不会出现在侧边栏列表，
  也永远不会写入用户的正式历史 `sessions.v1.sqlite`；
- 用户真实会话 id 由前端生成（`session_<uuid>`），不会命中上述前缀；
- 清理正式库请用 `backend/scripts/clean_sessions.py`（默认试运行，`--yes` 才真正删除）。

安全
----
- 本模块只存服务端生成 / 校验后的内容：assistant 轮次的 `content` 是服务端写死的
  `Answer.markdown`，`answer_json` 是 `AnswerEnvelope` 的结构化快照；
- 用户问题按纯文本原样存储，不执行、不拼接进 System Prompt 的指令区。
"""

from __future__ import annotations

import json
import logging
import os
import sqlite3
import threading
import time
import uuid
from collections.abc import Iterable, Mapping, Sequence
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

logger = logging.getLogger("histolink.session_store")

BASE_DIR = Path(__file__).resolve().parent
DEFAULT_DB_PATH = BASE_DIR / "data" / "sessions.v1.sqlite"

#: 自动化测试 / 探针会话 id 前缀：命中后读写路由到独立测试库，绝不进入用户正式历史。
DISPOSABLE_SESSION_PREFIXES: tuple[str, ...] = (
    "test_",
    "e2e_",
    "pytest_",
    "smoke_",
    "probe-",
)
#: 测试库路径环境变量（默认 `:memory:`：不落盘，随进程销毁）。
TEST_DB_ENV = "SESSION_TEST_DB_PATH"
#: 测试会话前缀环境变量（逗号分隔，覆盖默认前缀列表）。
DISPOSABLE_PREFIXES_ENV = "SESSION_DISPOSABLE_PREFIXES"


def load_disposable_session_prefixes(
    env: Mapping[str, str] | None = None,
) -> tuple[str, ...]:
    """读取「可丢弃会话」id 前缀（V1.0.6.2 测试隔离）。

    - 未配置 / 配置为空 → 默认前缀（`test_` / `e2e_` / `pytest_` / `smoke_` / `probe-`）；
    - 配置为逗号分隔字符串 → 逐项 strip + 去重（保持顺序）；空项被忽略。
    """

    source = os.environ if env is None else env
    raw = (source.get(DISPOSABLE_PREFIXES_ENV) or "").strip()
    if not raw:
        return DISPOSABLE_SESSION_PREFIXES
    prefixes: list[str] = []
    for item in raw.split(","):
        value = item.strip()
        if value and value not in prefixes:
            prefixes.append(value)
    return tuple(prefixes) if prefixes else DISPOSABLE_SESSION_PREFIXES


def is_disposable_session_id(
    session_id: str | None,
    prefixes: Sequence[str] | None = None,
) -> bool:
    """`session_id` 是否属于自动化测试 / 探针会话（应写入独立测试库）。"""

    if not isinstance(session_id, str) or not session_id:
        return False
    candidates = DISPOSABLE_SESSION_PREFIXES if prefixes is None else prefixes
    return any(session_id.startswith(prefix) for prefix in candidates if prefix)


#: 新建会话的默认标题（与前端「新建对话」展示一致）。
DEFAULT_SESSION_TITLE = "新的历史对话"
#: 单个会话最多保留的轮次消息数（超出后从最旧裁剪）。
MAX_STORED_TURNS = 200
#: 侧边栏列表最多返回的会话数。
MAX_LIST_SESSIONS = 100
#: 注入 Agent 的历史消息条数上限（6 条 = 最近 3 轮问答）。
HISTORY_MAX_MESSAGES = 6
#: 注入 Agent 的**单条**历史消息字符上限（assistant 正文可能接近万字符，必须裁剪）。
HISTORY_MAX_MESSAGE_CHARS = 1200
#: 注入 Agent 的历史消息**总**字符预算。
HISTORY_MAX_TOTAL_CHARS = 6000
#: 会话标题最大展示长度（与前端 `MAX_CONVERSATION_TITLE_LENGTH` 保持一致）。
TITLE_MAX_CHARS = 28
#: 实体记忆保留的人物 / 事件数量。
ENTITY_MEMORY_MAX_PERSONS = 8
ENTITY_MEMORY_MAX_EVENTS = 8
#: 单条 assistant 结构化回答快照的最大 JSON 字符数（超限时退化为只保留正文 / 引用）。
ANSWER_JSON_MAX_CHARS = 60_000

_TRUNCATED_SUFFIX = "…（历史消息过长，已截断）"


def _now_ms() -> int:
    return int(time.time() * 1000)


def new_session_id() -> str:
    """生成服务端会话 id（前端也可自带 id 以保证刷新后一致）。"""

    return f"session_{uuid.uuid4().hex}"


def title_from_question(question: str, *, fallback: str = DEFAULT_SESSION_TITLE) -> str:
    """用首条用户问题生成会话标题（压缩空白 + 超长截断，与前端口径一致）。"""

    compact = " ".join((question or "").split()).strip()
    if not compact:
        return fallback
    return (
        f"{compact[:TITLE_MAX_CHARS]}…" if len(compact) > TITLE_MAX_CHARS else compact
    )


# ---------------------------------------------------------------------------
# 数据结构
# ---------------------------------------------------------------------------


@dataclass
class StoredTurn:
    """持久化单轮消息。"""

    role: str
    content: str
    created_at: int
    answer: dict[str, Any] | None = None

    def to_history_message(self) -> dict[str, str]:
        return {"role": self.role, "content": self.content}


@dataclass
class SessionRecord:
    """一个完整会话（含全部轮次与实体记忆）。"""

    session_id: str
    title: str
    created_at: int
    updated_at: int
    pinned: bool = False
    title_locked: bool = False
    turns: list[StoredTurn] = field(default_factory=list)
    entity_memory: dict[str, Any] = field(default_factory=dict)

    @property
    def turn_count(self) -> int:
        return len(self.turns)

    def summary_dict(self) -> dict[str, Any]:
        return {
            "session_id": self.session_id,
            "title": self.title,
            "created_at": self.created_at,
            "updated_at": self.updated_at,
            "pinned": self.pinned,
            "turn_count": self.turn_count,
        }

    def detail_dict(self) -> dict[str, Any]:
        payload = self.summary_dict()
        payload["entity_memory"] = normalize_entity_memory(self.entity_memory)
        payload["turns"] = [
            {
                "role": turn.role,
                "content": turn.content,
                "created_at": turn.created_at,
                "answer": turn.answer,
            }
            for turn in self.turns
        ]
        return payload


# ---------------------------------------------------------------------------
# 纯函数：实体记忆 / 截断（便于单测）
# ---------------------------------------------------------------------------


def normalize_entity_memory(memory: Mapping[str, Any] | None) -> dict[str, Any]:
    """把任意输入规整成 `{person_ids, person_names, event_ids}` 三字段结构。"""

    if not isinstance(memory, Mapping):
        return {"person_ids": [], "person_names": {}, "event_ids": []}

    person_ids: list[str] = []
    for value in memory.get("person_ids") or []:
        if isinstance(value, str) and value and value not in person_ids:
            person_ids.append(value)
    names: dict[str, str] = {}
    raw_names = memory.get("person_names")
    if isinstance(raw_names, Mapping):
        for key, value in raw_names.items():
            if isinstance(key, str) and key and isinstance(value, str) and value:
                names[key] = value
    event_ids: list[str] = []
    for value in memory.get("event_ids") or []:
        if isinstance(value, str) and value and value not in event_ids:
            event_ids.append(value)
    return {
        "person_ids": person_ids[:ENTITY_MEMORY_MAX_PERSONS],
        "person_names": {
            person_id: name
            for person_id, name in names.items()
            if person_id in person_ids[:ENTITY_MEMORY_MAX_PERSONS]
        },
        "event_ids": event_ids[:ENTITY_MEMORY_MAX_EVENTS],
    }


def merge_entity_memory(
    previous: Mapping[str, Any] | None,
    update: Mapping[str, Any] | None,
) -> dict[str, Any]:
    """把本轮实体记忆合并进会话状态：**新出现的排前面**（最近一轮优先）。"""

    old = normalize_entity_memory(previous)
    new = normalize_entity_memory(update)
    person_ids: list[str] = []
    person_names: dict[str, str] = {}
    for person_id in [*new["person_ids"], *old["person_ids"]]:
        if person_id in person_ids:
            continue
        person_ids.append(person_id)
    for person_id in person_ids:
        name = new["person_names"].get(person_id) or old["person_names"].get(person_id)
        if name:
            person_names[person_id] = name
    event_ids: list[str] = []
    for event_id in [*new["event_ids"], *old["event_ids"]]:
        if event_id not in event_ids:
            event_ids.append(event_id)
    return normalize_entity_memory(
        {"person_ids": person_ids, "person_names": person_names, "event_ids": event_ids}
    )


def truncate_history(
    turns: Iterable[Mapping[str, str]],
    *,
    max_messages: int = HISTORY_MAX_MESSAGES,
    max_message_chars: int = HISTORY_MAX_MESSAGE_CHARS,
    max_total_chars: int = HISTORY_MAX_TOTAL_CHARS,
) -> list[dict[str, str]]:
    """长对话截断策略（V1.0.6）。

    规则（按顺序执行）：
    1. 只保留最近 ``max_messages`` 条消息（默认 6 条 = 3 轮问答）；
    2. 单条 content 超过 ``max_message_chars`` 时截断并标注；
    3. 若总字符仍超过 ``max_total_chars``，从**最旧**的消息开始丢弃，直到满足预算；
       极端情况下至少保留最新 1 条（当前问题本身不在历史里，由 user message 单独发送）。

    System Prompt 不在此函数内：它由 `agent.prompts.build_system_prompt` 每轮重新生成，
    永远保留在最前面，不参与历史截断。
    """

    cleaned: list[dict[str, str]] = []
    for turn in turns:
        role = turn.get("role")
        content = turn.get("content")
        if role not in ("user", "assistant") or not isinstance(content, str):
            continue
        text = content.strip()
        if not text:
            continue
        if len(text) > max_message_chars:
            text = text[:max_message_chars] + _TRUNCATED_SUFFIX
        cleaned.append({"role": role, "content": text})

    if max_messages > 0:
        cleaned = cleaned[-max_messages:]
    while (
        len(cleaned) > 1
        and sum(len(item["content"]) for item in cleaned) > max_total_chars
    ):
        cleaned.pop(0)
    return cleaned


def _bounded_answer_payload(payload: Mapping[str, Any] | None) -> dict[str, Any] | None:
    """限制 assistant 结构化快照的 JSON 体积，避免单会话无限膨胀。"""

    if not isinstance(payload, Mapping):
        return None
    candidate = dict(payload)
    try:
        encoded = json.dumps(candidate, ensure_ascii=False, separators=(",", ":"))
    except (TypeError, ValueError):  # pragma: no cover - 服务端写入的均为可序列化结构
        return None
    if len(encoded) <= ANSWER_JSON_MAX_CHARS:
        return candidate
    # 大对象通常来自 RAG 引用 / 事件描述：先丢引用与实体，只保留正文与模型信息。
    slimmed = {
        key: candidate.get(key)
        for key in ("answer", "request_id", "snapshot_version", "trace")
        if key in candidate
    }
    try:
        encoded = json.dumps(slimmed, ensure_ascii=False, separators=(",", ":"))
    except (TypeError, ValueError):  # pragma: no cover
        return None
    if len(encoded) <= ANSWER_JSON_MAX_CHARS:
        return slimmed
    return None


# ---------------------------------------------------------------------------
# SessionStore
# ---------------------------------------------------------------------------


class SessionStore:
    """轻量级会话存储（SQLite；可传 `:memory:` 用于测试）。

    V1.0.6.2 测试隔离：可丢弃会话（前缀见 `DISPOSABLE_SESSION_PREFIXES`）读写
    独立测试库（`SESSION_TEST_DB_PATH`，默认 `:memory:`），不会混入用户正式历史。
    """

    def __init__(
        self,
        db_path: str | Path | None = None,
        *,
        clock: Any = None,
        disposable_prefixes: Sequence[str] | None = None,
    ) -> None:
        raw_path = db_path if db_path is not None else os.environ.get("SESSION_DB_PATH")
        # V1.0.6.1 修复：未显式传路径且未设置 SESSION_DB_PATH 时必须落盘到
        # `backend/data/sessions.v1.sqlite`（文档承诺的默认值），而不是静默退成 :memory:
        # ——否则后端重启后会话历史全部丢失（「真实持久化」名不副实）。
        if raw_path in (None, ""):
            raw_path = str(DEFAULT_DB_PATH)
        resolved = Path(raw_path).expanduser() if raw_path != ":memory:" else None
        self._db_path: str | Path = resolved if resolved is not None else ":memory:"
        self._clock = clock or _now_ms
        self._lock = threading.RLock()
        self._disposable_prefixes: tuple[str, ...] = (
            tuple(disposable_prefixes)
            if disposable_prefixes is not None
            else load_disposable_session_prefixes()
        )
        if resolved is not None:
            resolved.parent.mkdir(parents=True, exist_ok=True)

        # 测试库：默认 :memory:；若与正式库配成同一个文件则强制退回内存库，避免误写。
        raw_test_path = os.environ.get(TEST_DB_ENV) or ":memory:"
        test_resolved = (
            Path(raw_test_path).expanduser() if raw_test_path != ":memory:" else None
        )
        if (
            test_resolved is not None
            and resolved is not None
            and test_resolved == resolved
        ):
            logger.warning(
                "SESSION_TEST_DB_PATH 与 SESSION_DB_PATH 相同（%s），测试库退回内存库",
                resolved,
            )
            test_resolved = None
        if test_resolved is not None:
            test_resolved.parent.mkdir(parents=True, exist_ok=True)
        self._test_db_path: str = (
            str(test_resolved) if test_resolved is not None else ":memory:"
        )

        self._conn = sqlite3.connect(
            str(self._db_path) if resolved is not None else ":memory:",
            check_same_thread=False,
        )
        self._conn.row_factory = sqlite3.Row
        self._test_conn = sqlite3.connect(
            str(test_resolved) if test_resolved is not None else ":memory:",
            check_same_thread=False,
        )
        self._test_conn.row_factory = sqlite3.Row
        with self._lock:
            self._prepare_connection(self._conn, file_backed=resolved is not None)
            self._prepare_connection(
                self._test_conn, file_backed=test_resolved is not None
            )

    # -- 生命周期 -----------------------------------------------------
    @property
    def db_path(self) -> str:
        return str(self._db_path)

    @property
    def test_db_path(self) -> str:
        return str(self._test_db_path)

    @property
    def disposable_prefixes(self) -> tuple[str, ...]:
        return self._disposable_prefixes

    def close(self) -> None:
        with self._lock:
            self._conn.close()
            self._test_conn.close()

    def counts(self) -> dict[str, int]:
        """正式库当前会话 / 轮次数量（测试库不统计；供清理脚本 / 运维观测）。"""

        with self._lock:
            sessions = self._conn.execute("SELECT COUNT(*) FROM sessions").fetchone()[0]
            turns = self._conn.execute("SELECT COUNT(*) FROM session_turns").fetchone()[
                0
            ]
        return {"sessions": int(sessions), "turns": int(turns)}

    def clear(self) -> dict[str, int]:
        """清空全部会话（测试 + 运维清理用；生产由清理脚本显式调用）。

        返回**正式库**清理前的数量快照；测试库一并清空（内存库随进程销毁，无需统计）。
        """

        with self._lock:
            counts = self.counts()
            for conn in (self._conn, self._test_conn):
                conn.execute("DELETE FROM session_turns")
                conn.execute("DELETE FROM sessions")
                conn.commit()
            return counts

    def _prepare_connection(
        self, conn: sqlite3.Connection, *, file_backed: bool
    ) -> None:
        conn.execute("PRAGMA foreign_keys = ON")
        if file_backed:
            # WAL 提升并发读性能；:memory: 库不支持 / 不需要。
            conn.execute("PRAGMA journal_mode = WAL")
        self._ensure_schema(conn)

    def _ensure_schema(self, conn: sqlite3.Connection) -> None:
        conn.executescript(
            """
            CREATE TABLE IF NOT EXISTS sessions (
                session_id TEXT PRIMARY KEY,
                title TEXT NOT NULL,
                created_at INTEGER NOT NULL,
                updated_at INTEGER NOT NULL,
                pinned INTEGER NOT NULL DEFAULT 0,
                title_locked INTEGER NOT NULL DEFAULT 0,
                entity_memory TEXT NOT NULL DEFAULT '{}'
            );
            CREATE TABLE IF NOT EXISTS session_turns (
                turn_id INTEGER PRIMARY KEY AUTOINCREMENT,
                session_id TEXT NOT NULL,
                role TEXT NOT NULL,
                content TEXT NOT NULL,
                answer_json TEXT,
                created_at INTEGER NOT NULL,
                FOREIGN KEY (session_id) REFERENCES sessions(session_id) ON DELETE CASCADE
            );
            CREATE INDEX IF NOT EXISTS idx_session_turns_session
                ON session_turns (session_id, turn_id);
            """
        )
        conn.commit()

    def _connection_for(self, session_id: str | None) -> sqlite3.Connection:
        """按会话 id 选择连接：可丢弃会话 → 独立测试库；其余 → 正式库。"""

        if is_disposable_session_id(session_id, self._disposable_prefixes):
            return self._test_conn
        return self._conn

    # -- 内部读写 -----------------------------------------------------
    def _row_to_record(
        self, row: sqlite3.Row, turns: Sequence[sqlite3.Row]
    ) -> SessionRecord:
        try:
            memory = json.loads(row["entity_memory"] or "{}")
        except (TypeError, ValueError):  # pragma: no cover - 库内数据由本类写入
            memory = {}
        stored_turns: list[StoredTurn] = []
        for turn in turns:
            answer: dict[str, Any] | None = None
            raw_answer = turn["answer_json"]
            if isinstance(raw_answer, str) and raw_answer:
                try:
                    parsed = json.loads(raw_answer)
                except (TypeError, ValueError):  # pragma: no cover
                    parsed = None
                answer = parsed if isinstance(parsed, dict) else None
            stored_turns.append(
                StoredTurn(
                    role=str(turn["role"]),
                    content=str(turn["content"]),
                    created_at=int(turn["created_at"]),
                    answer=answer,
                )
            )
        return SessionRecord(
            session_id=str(row["session_id"]),
            title=str(row["title"]),
            created_at=int(row["created_at"]),
            updated_at=int(row["updated_at"]),
            pinned=bool(row["pinned"]),
            title_locked=bool(row["title_locked"]),
            turns=stored_turns,
            entity_memory=normalize_entity_memory(memory),
        )

    def _session_row(
        self, conn: sqlite3.Connection, session_id: str
    ) -> sqlite3.Row | None:
        cursor = conn.execute(
            "SELECT * FROM sessions WHERE session_id = ?", (session_id,)
        )
        return cursor.fetchone()

    def _turn_rows(
        self, conn: sqlite3.Connection, session_id: str
    ) -> list[sqlite3.Row]:
        cursor = conn.execute(
            "SELECT * FROM session_turns WHERE session_id = ? ORDER BY turn_id ASC",
            (session_id,),
        )
        return list(cursor.fetchall())

    def _load_record(self, session_id: str) -> SessionRecord | None:
        conn = self._connection_for(session_id)
        row = self._session_row(conn, session_id)
        if row is None:
            return None
        return self._row_to_record(row, self._turn_rows(conn, session_id))

    # -- 会话读写 -----------------------------------------------------
    def create(
        self,
        *,
        session_id: str | None = None,
        title: str | None = None,
        turns: Sequence[Mapping[str, Any]] | None = None,
    ) -> SessionRecord:
        """创建会话；`session_id` 已存在时幂等返回已有记录。"""

        with self._lock:
            if session_id:
                existing = self._load_record(session_id)
                if existing is not None:
                    return existing
            resolved_id = session_id or new_session_id()
            timestamp = self._clock()
            explicit_title = (title or "").strip()
            record = SessionRecord(
                session_id=resolved_id,
                title=title_from_question(explicit_title)
                if explicit_title
                else DEFAULT_SESSION_TITLE,
                created_at=timestamp,
                updated_at=timestamp,
                pinned=False,
                title_locked=bool(explicit_title),
                turns=[],
                entity_memory=normalize_entity_memory(None),
            )
            self._connection_for(record.session_id).execute(
                "INSERT INTO sessions (session_id, title, created_at, updated_at, pinned,"
                " title_locked, entity_memory) VALUES (?, ?, ?, ?, 0, ?, ?)",
                (
                    record.session_id,
                    record.title,
                    record.created_at,
                    record.updated_at,
                    1 if record.title_locked else 0,
                    json.dumps(
                        record.entity_memory, ensure_ascii=False, separators=(",", ":")
                    ),
                ),
            )
            if turns:
                self._insert_turns(record.session_id, turns, timestamp)
            self._connection_for(record.session_id).commit()
            return self._load_record(record.session_id) or record

    def ensure(self, session_id: str, *, question: str | None = None) -> SessionRecord:
        """确保会话存在（ask 首次请求时懒创建，标题取首条问题）。"""

        existing = self.get(session_id)
        if existing is not None:
            return existing
        return self.create(
            session_id=session_id,
            title=title_from_question(question) if question else None,
        )

    def get(self, session_id: str) -> SessionRecord | None:
        with self._lock:
            return self._load_record(session_id)

    def list_sessions(self, *, limit: int = MAX_LIST_SESSIONS) -> list[SessionRecord]:
        with self._lock:
            cursor = self._conn.execute(
                "SELECT * FROM sessions ORDER BY pinned DESC, updated_at DESC, created_at DESC"
                " LIMIT ?",
                (max(1, min(limit, MAX_LIST_SESSIONS)),),
            )
            records: list[SessionRecord] = []
            for row in cursor.fetchall():
                records.append(
                    self._row_to_record(
                        row, self._turn_rows(self._conn, str(row["session_id"]))
                    )
                )
            return records

    def bootstrap_history(
        self,
        session_id: str,
        history: Iterable[Mapping[str, Any]],
        *,
        question: str | None = None,
    ) -> int:
        """把客户端携带的 `history` 迁移进空会话（V1.0.5.4 → V1.0.6 平滑升级）。

        - 只在会话**没有任何轮次**时生效；已有服务端历史时以服务端为准，避免重复；
        - 返回真正写入的轮次数（0 表示未迁移）。
        """

        with self._lock:
            record = self._load_record(session_id)
            if record is not None and record.turns:
                return 0
            if record is None:
                record = self.create(session_id=session_id, title=question)
            normalized: list[dict[str, Any]] = []
            for turn in history:
                role = turn.get("role")
                content = turn.get("content")
                if role not in ("user", "assistant"):
                    continue
                if not isinstance(content, str) or not content.strip():
                    continue
                normalized.append({"role": role, "content": content.strip()})
            if not normalized:
                return 0
            timestamp = self._clock()
            self._insert_turns(session_id, normalized, timestamp)
            first_question = next(
                (turn["content"] for turn in normalized if turn["role"] == "user"), None
            )
            title = record.title
            if not record.title_locked and first_question:
                title = title_from_question(first_question, fallback=record.title)
            conn = self._connection_for(session_id)
            conn.execute(
                "UPDATE sessions SET title = ?, updated_at = ? WHERE session_id = ?",
                (title, timestamp, session_id),
            )
            conn.commit()
            logger.info(
                "会话历史迁移完成：session=%s，迁移 %d 条", session_id, len(normalized)
            )
            return len(normalized)

    def append_exchange(
        self,
        session_id: str,
        *,
        question: str,
        answer_markdown: str,
        answer_payload: Mapping[str, Any] | None = None,
        entity_memory: Mapping[str, Any] | None = None,
    ) -> SessionRecord:
        """追加一轮「用户问题 + 服务端回答」，并更新实体记忆 / 标题 / 排序时间。"""

        with self._lock:
            record = self._load_record(session_id)
            if record is None:
                record = self.create(session_id=session_id, title=question)
            timestamp = self._clock()
            question_text = (question or "").strip()
            markdown = (answer_markdown or "").strip()
            if not question_text or not markdown:
                raise ValueError(
                    "append_exchange 需要非空的 question 与 answer_markdown"
                )
            bounded = _bounded_answer_payload(answer_payload)
            self._insert_turns(
                session_id,
                [
                    {"role": "user", "content": question_text},
                    {
                        "role": "assistant",
                        "content": markdown,
                        "answer": bounded,
                    },
                ],
                timestamp,
            )
            merged_memory = merge_entity_memory(record.entity_memory, entity_memory)
            title = record.title
            if not record.title_locked and record.title in (
                DEFAULT_SESSION_TITLE,
                "",
            ):
                title = title_from_question(question_text, fallback=record.title)
            conn = self._connection_for(session_id)
            conn.execute(
                "UPDATE sessions SET title = ?, updated_at = ?, entity_memory = ?"
                " WHERE session_id = ?",
                (
                    title,
                    timestamp,
                    json.dumps(
                        merged_memory, ensure_ascii=False, separators=(",", ":")
                    ),
                    session_id,
                ),
            )
            self._prune_turns(session_id)
            conn.commit()
            return self._load_record(session_id) or record

    def rename(self, session_id: str, title: str) -> SessionRecord | None:
        trimmed = (title or "").strip()
        if not trimmed:
            return None
        with self._lock:
            record = self._load_record(session_id)
            if record is None:
                return None
            conn = self._connection_for(session_id)
            conn.execute(
                "UPDATE sessions SET title = ?, title_locked = 1 WHERE session_id = ?",
                (title_from_question(trimmed, fallback=trimmed), session_id),
            )
            conn.commit()
            return self._load_record(session_id)

    def set_pinned(self, session_id: str, pinned: bool) -> SessionRecord | None:
        with self._lock:
            record = self._load_record(session_id)
            if record is None:
                return None
            conn = self._connection_for(session_id)
            conn.execute(
                "UPDATE sessions SET pinned = ? WHERE session_id = ?",
                (1 if pinned else 0, session_id),
            )
            conn.commit()
            return self._load_record(session_id)

    def delete(self, session_id: str) -> bool:
        with self._lock:
            conn = self._connection_for(session_id)
            cursor = conn.execute(
                "DELETE FROM sessions WHERE session_id = ?", (session_id,)
            )
            conn.execute(
                "DELETE FROM session_turns WHERE session_id = ?", (session_id,)
            )
            conn.commit()
            return cursor.rowcount > 0

    # -- 多轮上下文 ---------------------------------------------------
    def history_turns(
        self,
        session_id: str,
        *,
        max_messages: int = HISTORY_MAX_MESSAGES,
        max_message_chars: int = HISTORY_MAX_MESSAGE_CHARS,
        max_total_chars: int = HISTORY_MAX_TOTAL_CHARS,
    ) -> list[dict[str, str]]:
        """返回注入 Agent 的历史消息（已按截断策略裁剪）。"""

        record = self.get(session_id)
        if record is None:
            return []
        return truncate_history(
            (turn.to_history_message() for turn in record.turns),
            max_messages=max_messages,
            max_message_chars=max_message_chars,
            max_total_chars=max_total_chars,
        )

    def entity_memory(self, session_id: str) -> dict[str, Any]:
        record = self.get(session_id)
        return normalize_entity_memory(record.entity_memory if record else None)

    # -- 内部：写入 ---------------------------------------------------
    def _insert_turns(
        self,
        session_id: str,
        turns: Iterable[Mapping[str, Any]],
        timestamp: int,
    ) -> None:
        conn = self._connection_for(session_id)
        for turn in turns:
            role = turn.get("role")
            content = turn.get("content")
            if role not in ("user", "assistant"):
                continue
            if not isinstance(content, str) or not content.strip():
                continue
            answer = turn.get("answer")
            answer_json = None
            if isinstance(answer, Mapping) and role == "assistant":
                bounded = _bounded_answer_payload(answer)
                if bounded is not None:
                    answer_json = json.dumps(
                        bounded, ensure_ascii=False, separators=(",", ":")
                    )
            conn.execute(
                "INSERT INTO session_turns (session_id, role, content, answer_json, created_at)"
                " VALUES (?, ?, ?, ?, ?)",
                (session_id, role, content.strip(), answer_json, timestamp),
            )

    def _prune_turns(self, session_id: str) -> None:
        conn = self._connection_for(session_id)
        conn.execute(
            "DELETE FROM session_turns WHERE session_id = ? AND turn_id NOT IN ("
            "  SELECT turn_id FROM session_turns WHERE session_id = ?"
            "  ORDER BY turn_id DESC LIMIT ?"
            ")",
            (session_id, session_id, MAX_STORED_TURNS),
        )


__all__ = [
    "ANSWER_JSON_MAX_CHARS",
    "DEFAULT_DB_PATH",
    "DEFAULT_SESSION_TITLE",
    "DISPOSABLE_PREFIXES_ENV",
    "DISPOSABLE_SESSION_PREFIXES",
    "ENTITY_MEMORY_MAX_EVENTS",
    "ENTITY_MEMORY_MAX_PERSONS",
    "HISTORY_MAX_MESSAGES",
    "HISTORY_MAX_MESSAGE_CHARS",
    "HISTORY_MAX_TOTAL_CHARS",
    "MAX_LIST_SESSIONS",
    "MAX_STORED_TURNS",
    "TEST_DB_ENV",
    "TITLE_MAX_CHARS",
    "SessionRecord",
    "SessionStore",
    "StoredTurn",
    "is_disposable_session_id",
    "load_disposable_session_prefixes",
    "merge_entity_memory",
    "new_session_id",
    "normalize_entity_memory",
    "title_from_question",
    "truncate_history",
]
