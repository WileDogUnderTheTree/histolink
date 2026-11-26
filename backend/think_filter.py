"""流式思考标签过滤器（V1.0.6.2）。

背景
----
部分推理模型（Qwen3 / DeepSeek-R1 等及其微调版）会把「思考过程」写在回答正文里：

    <think
    用户问的是赤壁之战……需要先确认年份。
    >
    赤壁之战发生在公元 208 年。

前端只应看到最终答案，因此后端必须把 ``thinking`` 标签及其中的内容过滤掉。
难点在于**流式输出**：标签可能被拆到多个 chunk 里（例如 ``"<thi"`` + ``"nk>……"``），
如果逐 chunk 直接做正则替换，半截标签或思考正文就会漏给前端。

本模块提供两套入口：

- `ThinkTagFilter`：**增量**过滤器，``feed()`` 任意切分的 chunk，只返回可以安全展示的正文；
- `strip_think_tags()`：非流式整段文本清洗（/api/agent/ask 等一次性场景的兜底）。

行为约定
--------
- 支持标签：``think`` / ``thinking`` / ``reasoning``，大小写不敏感；
  允许 ``< think >`` 这类带空格写法，也允许 ``<think attr="x">`` 这类属性；
- **未闭合**的开启标签：其后的内容一律视为思考过程丢弃（绝不把思考正文当答案展示）；
- 文本里零散的 ```` 也会被移除；
- `filtered_chars` 记录被丢弃的字符数（含标签与思考正文），只用于日志 / 观测，
  不会写入回答，也不会暴露给前端；
- 非标签的 ``<``（例如 "1 < 2"）不会被误吞：只有确实命中标签语法才进入过滤状态。

该模块不依赖第三方库，供 `llm_stream.py`（流式）与 `llm_client.py`（非流式兜底）共用。
"""

from __future__ import annotations

import re

__all__ = ["ThinkTagFilter", "strip_think_tags"]

#: 支持的思考标签名（小写）。
_THINK_TAG_NAMES = ("think", "thinking", "reasoning")

#: 开启标签：`<think>` / `<thinking >` / `<think attr="x">` / `<THINK>`。
_OPEN_TAG_RE = re.compile(
    r"<\s*(?:" + "|".join(_THINK_TAG_NAMES) + r")\b[^>]*>",
    re.IGNORECASE,
)
#: 结束标签：`` / `</thinking >` 等。
_CLOSE_TAG_RE = re.compile(
    r"<\s*/\s*(?:" + "|".join(_THINK_TAG_NAMES) + r")\s*>",
    re.IGNORECASE,
)
#: 判断缓冲区末尾的 ``<`` 是否可能是「被 chunk 切断的半截标签」。
#: 只匹配 `<` + 可选空格 / 可选斜杠 + 标签名的前缀（不含 `>`），最长 24 字符。
_MAYBE_TAG_TAIL_RE = re.compile(r"<\s*/?\s*[a-z]*\s*$", re.IGNORECASE)
#: 单个标签片段保留上限：超过则视为普通文本，避免缓冲无限增长。
_MAX_TAG_CHARS = 24


def _tag_prefix_start(text: str) -> int:
    """返回「可能是不完整标签」的起始下标；没有则不完整标签时返回 ``len(text)``。

    - 缓冲区里没有 ``<`` → 整段都是普通文本（``len(text)``）；
    - 末尾 ``<`` 之后已经出现 ``>`` → 标签已完整，交给正则处理（``len(text)``）；
    - 末尾片段可能是标签前缀（如 ``"<thi"`` / ``"</think"``）→ 返回该 ``<`` 的下标，
      由调用方把这段留在缓冲区里等下一个 chunk。
    """

    index = text.rfind("<")
    if index < 0:
        return len(text)
    tail = text[index:]
    if len(tail) > _MAX_TAG_CHARS or ">" in tail:
        return len(text)
    if not _MAYBE_TAG_TAIL_RE.fullmatch(tail):
        return len(text)
    lowered = tail.lower().lstrip("<").lstrip("/").strip()
    if not lowered:
        # 只有 "<" 或 "</"：可能是任意标签的开头，先留一个 chunk。
        return index
    for name in _THINK_TAG_NAMES:
        if name.startswith(lowered) or lowered.startswith(name):
            return index
    return len(text)


class ThinkTagFilter:
    """流式思考标签过滤器（``feed`` 后只把返回文本发给前端）。"""

    def __init__(self) -> None:
        self._buffer = ""
        self._in_think = False
        self._filtered_chars = 0

    @property
    def filtered_chars(self) -> int:
        """已过滤（丢弃）的字符数：包含标签本身与思考正文。"""

        return self._filtered_chars

    @property
    def in_think(self) -> bool:
        """当前是否处于思考块内（调试 / 观测用）。"""

        return self._in_think

    def feed(self, chunk: str) -> str:
        """喂入一个流式 chunk，返回可以安全展示的正文（可能为空字符串）。"""

        if not chunk:
            return ""
        self._buffer += chunk
        visible: list[str] = []

        while True:
            if self._in_think:
                match = _CLOSE_TAG_RE.search(self._buffer)
                if match is not None:
                    self._filtered_chars += match.end()
                    self._buffer = self._buffer[match.end() :]
                    self._in_think = False
                    continue
                # 还没等到结束标签：丢掉「确定是思考正文」的部分，保留可能是半截标签的尾巴。
                keep_from = _tag_prefix_start(self._buffer)
                self._filtered_chars += keep_from
                self._buffer = self._buffer[keep_from:]
                break

            match = _OPEN_TAG_RE.search(self._buffer)
            if match is not None:
                visible.append(self._buffer[: match.start()])
                self._buffer = self._buffer[match.end() :]
                self._in_think = True
                continue
            # 普通文本：把可能是半截标签的尾巴留在缓冲区，等下一个 chunk 再判断。
            emit_until = _tag_prefix_start(self._buffer)
            visible.append(self._buffer[:emit_until])
            self._buffer = self._buffer[emit_until:]
            break

        return "".join(visible)

    def flush(self) -> str:
        """流结束：吐出缓冲区剩余文本；未闭合的思考块整体丢弃。"""

        if self._in_think:
            self._filtered_chars += len(self._buffer)
            self._buffer = ""
            return ""
        text = self._buffer
        self._buffer = ""
        return text


def strip_think_tags(text: str) -> str:
    """一次性清洗整段文本：删除思考标签及其内容，保留最终答案。

    - 未闭合的开启标签 → 后续内容全部丢弃（未完成的思考不展示）；
    - 多余的空白行压成至多一个空行，并去掉首尾空白；
    - 输入不是字符串 / 为空时返回空串。
    """

    if not isinstance(text, str) or not text:
        return ""
    tag_filter = ThinkTagFilter()
    cleaned = tag_filter.feed(text) + tag_filter.flush()
    # 兜底：移除没有配对开启标签的零散结束标签。
    cleaned = _CLOSE_TAG_RE.sub("", cleaned)
    # 连续空行最多保留一个空行（思考块删除后经常留下 3+ 个换行）。
    cleaned = re.sub(r"\n{3,}", "\n\n", cleaned)
    return cleaned.strip()
