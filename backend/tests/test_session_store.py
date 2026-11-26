"""`SessionStore` 单元测试（V1.0.6：多轮记忆 / 历史记录真实持久化）。

覆盖：
- SQLite 持久化（关闭后重开仍可读）+ 内存库（`:memory:`）；
- 会话 CRUD：创建 / 幂等创建 / 列表排序（置顶优先）/ 重命名 / 置顶 / 删除；
- 轮次追加：标题从首问生成、`updated_at` 刷新、轮次数与顺序、实体记忆合并；
- 长对话截断：只保留最近 N 条消息、单条字符裁剪、总预算裁剪；
- 客户端历史迁移（`bootstrap_history`）只在空会话生效；
- 单会话最多保留 `MAX_STORED_TURNS` 条（旧轮次被裁剪）。
"""

from __future__ import annotations

from pathlib import Path

import pytest

from session_store import (
    DEFAULT_SESSION_TITLE,
    ENTITY_MEMORY_MAX_PERSONS,
    HISTORY_MAX_MESSAGE_CHARS,
    HISTORY_MAX_MESSAGES,
    HISTORY_MAX_TOTAL_CHARS,
    MAX_STORED_TURNS,
    SessionStore,
    merge_entity_memory,
    normalize_entity_memory,
    title_from_question,
    truncate_history,
)


def _exchange(
    store: SessionStore, session_id: str, question: str, answer: str = "回答正文"
) -> None:
    store.append_exchange(
        session_id,
        question=question,
        answer_markdown=answer,
        answer_payload={"answer": {"mode": "grounded", "markdown": answer}},
        entity_memory=None,
    )


# ---------------------------------------------------------------------------
# 纯函数：标题 / 实体记忆 / 截断
# ---------------------------------------------------------------------------


def test_title_from_question_压缩空白并截断() -> None:
    assert (
        title_from_question("  曹操   和 刘备 是什么关系？ ")
        == "曹操 和 刘备 是什么关系？"
    )
    long = title_from_question("问" * 100)
    assert long.endswith("…") and len(long) == 29
    assert title_from_question("") == DEFAULT_SESSION_TITLE


def test_normalize_entity_memory_去重与上限() -> None:
    memory = normalize_entity_memory(
        {
            "person_ids": ["p-a", "p-b", "p-a", 123, ""],
            "person_names": {"p-a": "曹操", "p-b": "刘备", "p-x": "无关"},
            "event_ids": ["e-1", "e-1", None],
        }
    )
    assert memory["person_ids"] == ["p-a", "p-b"]
    assert memory["person_names"] == {"p-a": "曹操", "p-b": "刘备"}
    assert memory["event_ids"] == ["e-1"]
    assert normalize_entity_memory(None) == {
        "person_ids": [],
        "person_names": {},
        "event_ids": [],
    }


def test_merge_entity_memory_最近一轮优先且去重() -> None:
    merged = merge_entity_memory(
        {"person_ids": ["p-a", "p-b"], "person_names": {"p-a": "A", "p-b": "B"}},
        {"person_ids": ["p-b", "p-c"], "person_names": {"p-b": "B新", "p-c": "C"}},
    )
    assert merged["person_ids"] == ["p-b", "p-c", "p-a"]
    assert merged["person_names"]["p-b"] == "B新"
    # 上限保护：人物 ID 不超过 ENTITY_MEMORY_MAX_PERSONS。
    big = merge_entity_memory(
        None,
        {
            "person_ids": [
                f"p-{index}" for index in range(ENTITY_MEMORY_MAX_PERSONS + 5)
            ]
        },
    )
    assert len(big["person_ids"]) == ENTITY_MEMORY_MAX_PERSONS


def test_truncate_history_只保留最近N条并裁剪超长单条() -> None:
    turns = [
        {"role": "user" if index % 2 == 0 else "assistant", "content": f"消息{index}"}
        for index in range(20)
    ]
    history = truncate_history(turns, max_messages=HISTORY_MAX_MESSAGES)
    assert len(history) == HISTORY_MAX_MESSAGES
    assert [item["content"] for item in history] == [
        f"消息{index}" for index in range(20 - HISTORY_MAX_MESSAGES, 20)
    ]

    long_turn = [
        {"role": "assistant", "content": "史" * (HISTORY_MAX_MESSAGE_CHARS + 500)}
    ]
    truncated = truncate_history(long_turn)
    assert len(truncated) == 1
    assert truncated[0]["content"].endswith("已截断）")
    assert len(truncated[0]["content"]) < HISTORY_MAX_MESSAGE_CHARS + 50


def test_truncate_history_总预算超限时从最旧开始丢弃() -> None:
    turns = [
        {"role": "user" if index % 2 == 0 else "assistant", "content": "史" * 1000}
        for index in range(10)
    ]
    history = truncate_history(
        turns,
        max_messages=10,
        max_message_chars=1200,
        max_total_chars=HISTORY_MAX_TOTAL_CHARS,
    )
    assert len(history) >= 1
    assert sum(len(item["content"]) for item in history) <= HISTORY_MAX_TOTAL_CHARS


def test_truncate_history_过滤非法输入() -> None:
    assert truncate_history([]) == []
    assert truncate_history([{"role": "system", "content": "x"}]) == []
    assert truncate_history([{"role": "user", "content": "   "}]) == []


# ---------------------------------------------------------------------------
# 会话 CRUD
# ---------------------------------------------------------------------------


def test_内存库_创建与幂等(tmp_path: Path) -> None:
    store = SessionStore(":memory:", clock=lambda: 1000)
    try:
        created = store.create(session_id="session-a")
        assert created.session_id == "session-a"
        assert created.title == DEFAULT_SESSION_TITLE
        assert created.turns == []
        # 相同 session_id 幂等返回，不报错、不重建。
        again = store.create(session_id="session-a")
        assert again.created_at == 1000
        assert store.get("missing") is None
    finally:
        store.close()


def test_sqlite_持久化_关闭后重开仍可读(tmp_path: Path) -> None:
    db_path = tmp_path / "sessions.sqlite"
    store = SessionStore(db_path)
    store.create(session_id="session-persist", title="持久化会话")
    _exchange(store, "session-persist", "曹操和刘备是什么关系？", "两人是政治对手。")
    store.rename("session-persist", "三国人物关系")
    store.set_pinned("session-persist", True)
    store.close()

    reopened = SessionStore(db_path)
    try:
        record = reopened.get("session-persist")
        assert record is not None
        assert record.title == "三国人物关系"
        assert record.pinned is True
        assert [turn.role for turn in record.turns] == ["user", "assistant"]
        assert record.turns[0].content == "曹操和刘备是什么关系？"
        assert record.turns[1].content == "两人是政治对手。"
        # 结构化答案快照也要能取回（前端恢复富文本渲染依赖它）。
        assert record.turns[1].answer == {
            "answer": {"mode": "grounded", "markdown": "两人是政治对手。"}
        }
    finally:
        reopened.close()


def test_未配置环境变量时默认落盘到默认数据库路径(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    """V1.0.6.1 修复：默认路径必须是 DEFAULT_DB_PATH，而不是静默退化成 :memory:。

    否则后端重启后会话历史全部丢失（前端刷新恢复依赖同进程内存库会「看起来正常」，
    但重启即丢数据，与「真实持久化」承诺不符）。
    """

    import session_store as session_store_module

    monkeypatch.delenv("SESSION_DB_PATH", raising=False)
    default_path = tmp_path / "data" / "sessions.v1.sqlite"
    monkeypatch.setattr(session_store_module, "DEFAULT_DB_PATH", default_path)

    store = SessionStore()
    try:
        assert store.db_path == str(default_path)
        store.create(session_id="session-default-path")
        _exchange(store, "session-default-path", "赤壁之战发生在哪一年？", "208 年。")
    finally:
        store.close()

    reopened = SessionStore()
    try:
        assert reopened.db_path == str(default_path)
        record = reopened.get("session-default-path")
        assert record is not None
        assert [turn.role for turn in record.turns] == ["user", "assistant"]
    finally:
        reopened.close()


def test_列表_置顶优先其余按最后消息时间倒序(tmp_path: Path) -> None:
    ticks = iter([100, 200, 300, 400, 500, 600])

    def clock() -> int:
        return next(ticks)

    store = SessionStore(":memory:", clock=clock)
    try:
        store.create(session_id="old")
        store.create(session_id="new")
        store.create(session_id="pinned")
        # append_exchange 会刷新 updated_at：old 变成最新。
        _exchange(store, "old", "旧会话有新消息")
        store.set_pinned("pinned", True)
        order = [record.session_id for record in store.list_sessions()]
        assert order == ["pinned", "old", "new"]
    finally:
        store.close()


def test_追加轮次_标题与实体记忆与轮次数(tmp_path: Path) -> None:
    store = SessionStore(":memory:", clock=lambda: 1000)
    try:
        store.ensure("session-x", question="曹操和刘备是什么关系？")
        _exchange(store, "session-x", "曹操和刘备是什么关系？", "两人是政治对手。")
        record = store.append_exchange(
            "session-x",
            question="他们打过什么仗？",
            answer_markdown="赤壁之战。",
            answer_payload={"answer": {"mode": "grounded", "markdown": "赤壁之战。"}},
            entity_memory={
                "person_ids": ["p-caocao", "p-liubei"],
                "person_names": {"p-caocao": "曹操", "p-liubei": "刘备"},
                "event_ids": ["handong-chibi"],
            },
        )
        assert record.session_id == "session-x"
        assert record.title == "曹操和刘备是什么关系？", "标题只由首问生成，后续不覆盖"
        assert record.turn_count == 4
        assert record.entity_memory["person_ids"] == ["p-caocao", "p-liubei"]
        assert record.entity_memory["person_names"] == {
            "p-caocao": "曹操",
            "p-liubei": "刘备",
        }
        assert record.entity_memory["event_ids"] == ["handong-chibi"]
        assert store.history_turns("session-x")[-2:] == [
            {"role": "user", "content": "他们打过什么仗？"},
            {"role": "assistant", "content": "赤壁之战。"},
        ]
    finally:
        store.close()


def test_客户端历史迁移只在空会话生效(tmp_path: Path) -> None:
    store = SessionStore(":memory:", clock=lambda: 1000)
    try:
        migrated = store.bootstrap_history(
            "session-migrate",
            [
                {"role": "user", "content": "孔子是谁？"},
                {"role": "assistant", "content": "孔子是春秋时期的思想家。"},
            ],
        )
        assert migrated == 2
        record = store.get("session-migrate")
        assert record is not None
        assert record.turns[0].content == "孔子是谁？"
        assert record.title == "孔子是谁？"

        # 已有服务端历史后再次迁移：不得重复写入。
        again = store.bootstrap_history(
            "session-migrate",
            [{"role": "user", "content": "重复的问题"}],
        )
        assert again == 0
        assert store.get("session-migrate").turn_count == 2  # type: ignore[union-attr]
    finally:
        store.close()


def test_重命名锁定后追加轮次不覆盖标题(tmp_path: Path) -> None:
    store = SessionStore(":memory:")
    try:
        store.create(session_id="session-rename")
        store.rename("session-rename", "我的自定义标题")
        _exchange(store, "session-rename", "第一个问题")
        assert store.get("session-rename").title == "我的自定义标题"  # type: ignore[union-attr]
        # 空标题重命名 / 不存在会话：安全失败。
        assert store.rename("session-rename", "   ") is None
        assert store.rename("missing", "标题") is None
    finally:
        store.close()


def test_删除会话连同轮次一起删除(tmp_path: Path) -> None:
    store = SessionStore(":memory:")
    try:
        store.create(session_id="session-del")
        _exchange(store, "session-del", "问题")
        assert store.delete("session-del") is True
        assert store.get("session-del") is None
        assert store.delete("session-del") is False
        assert store.history_turns("session-del") == []
    finally:
        store.close()


def test_轮次数超过上限时从最旧开始裁剪(tmp_path: Path) -> None:
    store = SessionStore(":memory:")
    try:
        for index in range(MAX_STORED_TURNS // 2 + 10):
            _exchange(store, "session-many", f"问题 {index}")
        record = store.get("session-many")
        assert record is not None
        assert record.turn_count <= MAX_STORED_TURNS
        # 最新的问题一定还在。
        assert record.turns[-2].content == f"问题 {MAX_STORED_TURNS // 2 + 9}"
    finally:
        store.close()


def test_append_exchange_拒绝空问题或空回答(tmp_path: Path) -> None:
    store = SessionStore(":memory:")
    try:
        with pytest.raises(ValueError):
            store.append_exchange("session-bad", question="   ", answer_markdown="回答")
        with pytest.raises(ValueError):
            store.append_exchange("session-bad", question="问题", answer_markdown="  ")
    finally:
        store.close()


def test_超大结构化回答快照被裁剪为可序列化小对象(tmp_path: Path) -> None:
    store = SessionStore(":memory:")
    try:
        huge_citations = [
            {"id": f"cite-{index}", "title": "引文" + "史" * 1000}
            for index in range(80)
        ]
        store.append_exchange(
            "session-big",
            question="问题",
            answer_markdown="回答正文",
            answer_payload={
                "answer": {"mode": "grounded", "markdown": "回答正文"},
                "citations": huge_citations,
                "request_id": "req_x",
            },
            entity_memory=None,
        )
        record = store.get("session-big")
        assert record is not None
        answer = record.turns[1].answer
        assert answer is not None
        # 超限时退化为只保留正文 / 模型信息，不再携带巨型 citations。
        assert "citations" not in answer
        assert answer["answer"]["markdown"] == "回答正文"
    finally:
        store.close()
