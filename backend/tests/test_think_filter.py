"""`think_filter` 流式思考标签过滤器单测（V1.0.6.2，全离线）。

覆盖：
- 整段清洗（非流式 `strip_think_tags`）：完整 / 多段 / 未闭合 / 零散结束标签；
- 流式安全：开启 / 结束标签被拆到多个 chunk 时不漏字，正文不混入思考内容；
- 非标签 `<` 不被误吞（"1 < 2"、"a <b" 等）；
- `filtered_chars` 只统计被丢弃的字符（含思考正文与标签）。

注意：标签字符串在运行时用变量拼接（`_OPEN` / `_CLOSE`），避免源码里出现完整的
「思考标签」字面量（部分工具链会把它们当成隐藏推理标记过滤掉）。
"""

from __future__ import annotations

import pytest

from think_filter import ThinkTagFilter, strip_think_tags

#: 完整标签字面量由片段拼接，避免被工具链误当推理块处理。
_OPEN = "<" + "think" + ">"
_CLOSE = "<" + "/" + "think" + ">"
_OPEN_LONG = "<" + "thinking" + ">"
_CLOSE_LONG = "<" + "/" + "thinking" + ">"
_OPEN_REASONING = "<" + "reasoning" + ">"
_CLOSE_REASONING = "<" + "/" + "reasoning" + ">"


# ---------------------------------------------------------------------------
# strip_think_tags（非流式整段清洗）
# ---------------------------------------------------------------------------


def test_strip_removes_complete_think_block() -> None:
    raw = f"前言\n{_OPEN}用户在问赤壁之战，需要先想年份……{_CLOSE}\n赤壁之战发生在公元 208 年。"
    assert strip_think_tags(raw) == "前言\n\n赤壁之战发生在公元 208 年。"


def test_strip_removes_multiple_think_blocks() -> None:
    raw = f"{_OPEN}思考一{_CLOSE}答案一\n{_OPEN_LONG}思考二{_CLOSE_LONG}答案二"
    assert strip_think_tags(raw) == "答案一\n答案二"


def test_strip_supports_tag_variants_and_attributes() -> None:
    raw = f'< {_OPEN[1:-1].upper()} mode="x" >秘密< {_CLOSE[1:-1].upper()} >最终答案'
    assert strip_think_tags(raw) == "最终答案"
    raw = f"{_OPEN_REASONING}思考{_CLOSE_REASONING}最终答案"
    assert strip_think_tags(raw) == "最终答案"


def test_strip_unclosed_think_drops_rest() -> None:
    """未闭合的思考块：其后的内容一律丢弃，避免把思考正文当答案展示。"""

    assert strip_think_tags(f"答案一\n{_OPEN}还没想完……") == "答案一"


def test_strip_removes_dangling_close_tag() -> None:
    assert strip_think_tags(f"答案一{_CLOSE}答案二") == "答案一答案二"


def test_strip_keeps_plain_text_and_collapses_blank_lines() -> None:
    raw = "第一段\n\n\n\n第二段"
    assert strip_think_tags(raw) == "第一段\n\n第二段"
    assert strip_think_tags("1 < 2 且 a <b> c") == "1 < 2 且 a <b> c"


def test_strip_empty_inputs() -> None:
    assert strip_think_tags("") == ""
    assert strip_think_tags(None) == ""  # type: ignore[arg-type]


# ---------------------------------------------------------------------------
# ThinkTagFilter（流式）
# ---------------------------------------------------------------------------


def _feed_all(chunks: list[str]) -> tuple[str, ThinkTagFilter]:
    tag_filter = ThinkTagFilter()
    visible = "".join(tag_filter.feed(chunk) for chunk in chunks)
    visible += tag_filter.flush()
    return visible, tag_filter


def test_stream_tag_split_across_chunks() -> None:
    """`<thi` + `nk>` 这种被切断的开启标签绝不能被当成正文发出去。"""

    visible, tag_filter = _feed_all(
        ["答案前", "<thi", "nk>这是思考", "</thi", "nk>答案后"]
    )
    assert visible == "答案前答案后"
    assert tag_filter.filtered_chars > 0
    assert not tag_filter.in_think


def test_stream_content_split_inside_thinking_block() -> None:
    visible, _ = _feed_all([_OPEN, "思", "考过程", _CLOSE, "最终", "答案"])
    assert visible == "最终答案"


def test_stream_partial_less_than_sign_is_held_then_released() -> None:
    """普通文本里的 `<` 在 chunk 末尾会短暂保留，下一个 chunk 确认不是标签后原样输出。"""

    tag_filter = ThinkTagFilter()
    first = tag_filter.feed("1 <")
    second = tag_filter.feed(" 2 成立")
    assert first == "1 "
    assert second == "< 2 成立"


def test_stream_unclosed_think_drops_tail() -> None:
    visible, tag_filter = _feed_all(["答案", _OPEN_LONG, "没想完", "……"])
    assert visible == "答案"
    assert tag_filter.in_think


def test_stream_plain_text_passthrough() -> None:
    visible, tag_filter = _feed_all(["赤壁", "之战", "发生在", "208 年"])
    assert visible == "赤壁之战发生在208 年"
    assert tag_filter.filtered_chars == 0


@pytest.mark.parametrize(
    "chunks",
    [
        ["<", "think>", "x", "</", "think>", "y"],
        ["<think", ">x</think>y"],
        ["a<th", "ink>x</think>c"],
    ],
)
def test_stream_various_split_positions(chunks: list[str]) -> None:
    visible, _ = _feed_all(chunks)
    assert "think" not in visible
    assert "x" not in visible
    assert visible in {"y", "ay", "ac"}
