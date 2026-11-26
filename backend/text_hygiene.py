"""模型输出「重复段落 / 循环复述」治理（V1.0.6.2 专项修复）。

背景
----
本地小模型（`XiaoHong-v1` / 8B）在「逐字回答」直答模式下会陷入自我重复循环：

    1. 依据一…… 2. 依据二…… 3. 依据三……
    <结论句>
    <结论句 又一遍>
    1. 依据一…… 2. 依据二…… 3. 依据三……

同一事实在一轮回答里被复述 3–4 遍；更严重的是重复正文会被写进会话库，
下一轮再作为历史注入模型，小模型会**模仿上一轮的重复结构**，循环逐轮放大。
「服务端 markdown + 模型正文拼接重叠」是表象，实际是模型生成层在循环。

治理分三层（本模块提供可复用的确定性原语，全部为纯函数、不调用模型）：

1. **流式生成期**（`llm_stream.StreamChatClient.stream`）：
   `find_repetition_cut()` 在 token 到达过程中识别「整句已在本轮出现过」的循环信号，
   立即停止生成并截断到第一次循环开始处，避免继续消耗算力 / 拖长回答；
2. **最终正文 / 历史注入前**（`llm_stream`、`routers.agent`、`orchestrator`、`validator`）：
   `sanitize_model_answer()` 折叠完全重复行、近似重复行（`依据一/二/三` 的改写版）、
   句内重复句，保证同一事实只出现一次；
3. **证据管线的模型正文**（`validator.EvidenceValidator.adopt_model_body`）：
   重复比例过高（`REPEATED_BODY_RATIO`）时**丢弃模型正文**，回退服务端用工具原文拼装的
   事实实证正文——用户可见气泡永远只有一个正文来源，绝不出现「模型废话 + 系统总结」拼接。

阈值全部偏保守：正常回答（并列结构 / 对比列表 / 表格）不会被误删。
"""

from __future__ import annotations

import re
import unicodedata
from difflib import SequenceMatcher

__all__ = [
    "REPEATED_BODY_RATIO",
    "find_repetition_cut",
    "is_repetitive",
    "normalize_repeat_text",
    "sanitize_model_answer",
]

#: 判定「模型正文循环复述严重、应整体丢弃」的删除字符比例阈值。
#: 实测截图中的回答（约 900 字）重复段占 55%–70%，远超该阈值；正常回答接近 0。
REPEATED_BODY_RATIO = 0.15

#: 近似重复行判定的最小归一化长度（短行只做「完全相同」判重，避免误删并列短语）。
_NEAR_DUPLICATE_MIN_CHARS = 16
#: 行级近似重复阈值（0.82：`依据一：…` 与 `据…` 的改写版实测约 0.85–0.95）。
_NEAR_DUPLICATE_RATIO = 0.82
#: 句级近似重复阈值（比行级更严：只合并几乎逐字相同的结论复述）。
_NEAR_DUPLICATE_SENTENCE_RATIO = 0.88
#: 参与循环检测的最小句子长度（归一化后字符数）：太短的句子（`是。`）不参与。
_MIN_LOOP_SENTENCE_CHARS = 12

#: 行首的 Markdown 列表标记 / 编号 / `依据X：` / 「先给直接结论：」等引导语：
#: 比较前剥掉，避免编号与套话差异干扰判重（例：`先给直接结论：赤壁之战发生在208年。`
#: 归一化后与结尾复述句 `赤壁之战发生在公元208年……` 的核心内容可取子串关系）。
_LINE_PREFIX_RE = re.compile(
    r"^\s*(?:[-*+>]\s+|\d+\s*[.、)）]\s*|依据[一二三四五六七八九十百]+[:：]?\s*|"
    r"\*\*依据[一二三四五六七八九十百]+[:：]?\*\*\s*|"
    r"(?:先给|给出|先说)?(?:直接)?结论\s*[:：]\s*|"
    r"(?:补充|关键|主要)?依据\s*[:：]\s*|"
    r"(?:简单)?回答\s*[:：]\s*)"
)
#: 归一化时丢弃的空白与标点（中文标点 + Markdown 语法标记）。
_PUNCT_STRIP_RE = re.compile(
    r"[\s，。；：、！？（）()【】\[\]{}<>《》“”‘’\"'「」『』·—\-…,.!?:;|/\\~`$%^&*+=_#]+"
)
#: 句子边界（保留边界符本身，拼接回去时正文不丢标点）。
_SENTENCE_BOUNDARY_RE = re.compile(r"[。！？!?；;\n]")
_SENTENCE_SPLIT_RE = re.compile(r"(?<=[。！？!?；;])")
#: 「小节重复标记」：模型循环复述时会把同一套「依据一 / 依据二 / 依据三」小节
#: 再输出一遍（措辞常有改动，句子级判重抓不住）。同一标记第二次出现即为循环起点。
_SECTION_MARKER_RE = re.compile(
    r"(?:^|\n)[ \t]*(?:\d+[ \t]*[.、)）][ \t]*)?"
    r"(?:\*\*)?(依据[一二三四五六七八九十]|依据[ \t]*\d+|"
    r"第[一二三四五六七八九十]+点|论点[一二三四五六七八九十])(?:\*\*)?[ \t]*[:：]",
    re.MULTILINE,
)
#: 模型「先列一份编号事实，再用依据一/二/三重写一遍」的常见结构：列表行判定。
_LIST_LINE_RE = re.compile(r"^(?:\d+[.、)）]|[-*+]\s)")
_SENTENCE_END_RE = re.compile(r"[。！？!?]")


def normalize_repeat_text(text: str) -> str:
    """把一行 / 一句文本归一化成「判重用」形式。

    - NFKC 全半角统一；
    - 去掉行首列表标记、编号、`依据X：` 前缀；
    - 去掉空白、标点与 Markdown 语法字符。

    只用于比较，不用于展示。
    """

    if not isinstance(text, str) or not text:
        return ""
    normalized = unicodedata.normalize("NFKC", text)
    normalized = _LINE_PREFIX_RE.sub("", normalized)
    return _PUNCT_STRIP_RE.sub("", normalized)


def _similarity(left: str, right: str) -> float:
    """两个归一化文本的相似度（0–1）；任一为空返回 0。"""

    if not left or not right:
        return 0.0
    if left == right:
        return 1.0
    return SequenceMatcher(None, left, right, autojunk=False).ratio()


def _is_duplicate_line(normalized: str, kept: list[str]) -> bool:
    """当前行是否与已保留行重复（完全相同，或足够长的近似重复）。"""

    if not normalized:
        return False
    for previous in kept:
        if not previous:
            continue
        if normalized == previous:
            return True
        if (
            len(normalized) >= _NEAR_DUPLICATE_MIN_CHARS
            and len(previous) >= _NEAR_DUPLICATE_MIN_CHARS
            and _similarity(normalized, previous) >= _NEAR_DUPLICATE_RATIO
        ):
            return True
    return False


def _collapse_duplicate_lines(text: str) -> str:
    """按行折叠重复内容：完全重复行 / 近似重复行（`依据一/二/三` 改写版）只保留第一次出现。"""

    kept_raw: list[str] = []
    kept_norm: list[str] = []
    for line in text.split("\n"):
        stripped = line.strip()
        if not stripped:
            # 空行只做「连续空行去重」，避免把正常段落分隔吃掉。
            if kept_raw and not kept_raw[-1].strip():
                continue
            kept_raw.append("")
            kept_norm.append("")
            continue
        normalized = normalize_repeat_text(stripped)
        if normalized and _is_duplicate_line(normalized, kept_norm):
            continue
        if not normalized and kept_raw and kept_raw[-1].strip() == stripped:
            # 纯符号行（`---` / `***`）：只折叠连续重复。
            continue
        kept_raw.append(line)
        kept_norm.append(normalized)
    return "\n".join(kept_raw)


def _collapse_duplicate_sentences(text: str) -> str:
    """句内重复句折叠：同一句话在后续再次出现时只保留第一次。

    只处理普通正文行；Markdown 表格 / 标题 / 代码块 / 引用块原样保留（正常内容不与重复循环混淆）。
    """

    collapsed_lines: list[str] = []
    for line in text.split("\n"):
        stripped = line.strip()
        if (
            not stripped
            or stripped.startswith(("#", "|", "```", ">"))
            or "|" in stripped
        ):
            collapsed_lines.append(line)
            continue
        sentences = [segment for segment in _SENTENCE_SPLIT_RE.split(line) if segment]
        if len(sentences) < 2:
            collapsed_lines.append(line)
            continue
        kept: list[str] = []
        kept_norm: list[str] = []
        for sentence in sentences:
            normalized = normalize_repeat_text(sentence)
            if len(normalized) >= _MIN_LOOP_SENTENCE_CHARS and any(
                normalized == previous
                or (
                    len(previous) >= _MIN_LOOP_SENTENCE_CHARS
                    and _similarity(normalized, previous)
                    >= _NEAR_DUPLICATE_SENTENCE_RATIO
                )
                for previous in kept_norm
            ):
                continue
            kept.append(sentence)
            kept_norm.append(normalized)
        collapsed_lines.append("".join(kept))
    return "\n".join(collapsed_lines)


def _char_bigrams(text: str) -> set[str]:
    """归一化后的字符二元组集合（用于判断「结尾总结是不是把前文又复述了一遍」）。"""

    normalized = normalize_repeat_text(text)
    if len(normalized) < 2:
        return set()
    return {normalized[index : index + 2] for index in range(len(normalized) - 1)}


def _drop_restated_tail(text: str) -> str:
    """丢掉结尾「把前文又总结一遍」的段落（V1.0.6.2 直答链路）。

    小模型常见输出结构：结论 + 1–3 条依据 + **再把结论/依据合成一段复述一遍**。
    判定条件（任一命中即删除最后一段）：

    1. 最后一段的字符二元组 ≥60% 都已在前文出现（整段复述）；
    2. 最后一段的首句与更早的某句「几乎逐字相同」（相似度 ≥0.70）——覆盖
       「结论句换个说法再当总结开头」的情况（例：`先给直接结论：赤壁之战发生在208年。` 与
       `赤壁之战发生在公元208年，也就是建安十三年。`）。

    正常「史令分析」等新增分析段落包含大量新表述，不会被误删。
    """

    paragraphs = [
        paragraph.strip() for paragraph in text.split("\n\n") if paragraph.strip()
    ]
    if len(paragraphs) < 2:
        return text
    tail = paragraphs[-1]
    earlier_text = "\n\n".join(paragraphs[:-1])

    tail_bigrams = _char_bigrams(tail)
    if len(tail_bigrams) >= 15:
        earlier_bigrams = _char_bigrams(earlier_text)
        if earlier_bigrams:
            overlap = len(tail_bigrams & earlier_bigrams) / len(tail_bigrams)
            if overlap >= 0.6:
                return earlier_text

    # 首句复述检测：结论换个说法再当总结开头。
    tail_sentences = [
        sentence.strip()
        for sentence in re.split(r"(?<=[。！？!?；;])", tail)
        if sentence.strip()
    ]
    earlier_sentences = [
        sentence.strip()
        for sentence in re.split(r"(?<=[。！？!?；;])", earlier_text)
        if sentence.strip()
    ]
    if tail_sentences:
        head = normalize_repeat_text(tail_sentences[0])
        if len(head) >= 10:
            for previous in earlier_sentences:
                normalized_previous = normalize_repeat_text(previous)
                if len(normalized_previous) < 10:
                    continue
                # 子串包含（去掉引导套话后核心结论完全相同）或高相似度 → 认定为首句复述。
                if (
                    normalized_previous in head
                    or head in normalized_previous
                    or _similarity(head, normalized_previous) >= 0.65
                ):
                    return earlier_text
    return text


def _drop_duplicate_paragraphs(text: str) -> str:
    """删掉「整段把前文重写一遍」的后续段落（直答链路）。

    小模型循环时可能把答案从头再写一遍（句子措辞有改动、没有 `依据一` 标记，
    句子级判重抓不住）。逐段比较：若该段二元组 ≥55% 已在前文出现，判定为复述段并删除。
    只对直答链路开启（证据管线的正文会包含真正的新分析段落）。
    """

    paragraphs = [
        paragraph.strip() for paragraph in text.split("\n\n") if paragraph.strip()
    ]
    if len(paragraphs) < 2:
        return text
    kept: list[str] = []
    kept_bigrams: set[str] = set()
    for paragraph in paragraphs:
        bigrams = _char_bigrams(paragraph)
        if (
            kept
            and len(bigrams) >= 20
            and kept_bigrams
            and len(bigrams & kept_bigrams) / len(bigrams) >= 0.55
        ):
            continue
        kept.append(paragraph)
        kept_bigrams |= bigrams
    return "\n\n".join(kept)


def _drop_duplicated_trailing_lines(text: str) -> str:
    """删掉结尾「与前文重复」的独立复述行（直答链路）。

    例：正文已有「先给直接结论：赤壁之战发生在208年。」，模型结尾又单独写一行
    「赤壁之战发生在208年。」——该行归一化后是前文的子串，属于同一事实的第二次复述，
    直接删除；只处理**最后一行**、且归一化长度 ≥10，避免误删「谢谢」「以上」这类短句。
    """

    lines = text.split("\n")
    while lines:
        index = len(lines) - 1
        while index >= 0 and not lines[index].strip():
            index -= 1
        if index < 0:
            break
        line = lines[index].strip()
        normalized = normalize_repeat_text(line)
        if len(normalized) < 10:
            break
        earlier = normalize_repeat_text("\n".join(lines[:index]))
        if not earlier or normalized not in earlier:
            break
        lines = lines[:index]
    return "\n".join(lines).strip()


def sanitize_model_answer(
    text: str, *, drop_restated_tail: bool = False
) -> tuple[str, int]:
    """折叠模型正文中的重复内容，返回 ``(清洗后正文, 删除的字符数)``。

    调用方（`llm_stream` / `routers.agent` / `validator`）据此决定：
    - 删除比例很小：采用清洗后的模型正文（同一事实只出现一次）；
    - 删除比例 ≥ `REPEATED_BODY_RATIO`：判定为循环复述，改用服务端事实实证正文。

    ``drop_restated_tail=True``（直答链路使用）额外丢弃结尾「把前文再总结一遍」的段落；
    证据管线的模型正文默认关闭该规则（避免误删「史令分析」这类真正的分析段落）。

    正常回答（并列结构 / 对比列表 / 表格 / 列表分点）基本不受影响；
    输入为空 / 非字符串时原样返回且删除数为 0。
    """

    if not isinstance(text, str) or not text.strip():
        return (text or ""), 0
    original = text
    # 1) 「先列一份编号事实，再用依据一/二/三整段重写」：保留第一份，丢弃重写段。
    restatement_cut = _find_restatement_block_cut(text)
    if restatement_cut is not None:
        text = text[:restatement_cut]
    # 1b) 小节重开（依据一/二/三 整套被写第二遍）：直接从第二份开始截断，保留第一份完整回答。
    section_cut = _find_repeated_section_cut(text)
    if section_cut is not None:
        text = text[:section_cut]
    # 1c) 整句循环（结论又被复述一遍）：同样从第二次出现处截断。
    loop_cut = find_repetition_cut(text)
    if loop_cut is not None:
        text = text[:loop_cut]
    # 2) 直答链路：丢掉结尾复述段落 / 整段重写 / 重复行。
    if drop_restated_tail:
        text = _drop_restated_tail(text)
        text = _drop_duplicate_paragraphs(text)
        text = _drop_duplicated_trailing_lines(text)
    # 3) 重复行（依据一/二/三 的改写版、复述结论）只保留第一次出现。
    cleaned = _collapse_duplicate_lines(text)
    # 4) 句内重复句折叠。
    cleaned = _collapse_duplicate_sentences(cleaned)
    cleaned = re.sub(r"\n{3,}", "\n\n", cleaned).strip()
    removed = max(0, len(original) - len(cleaned))
    return cleaned, removed


def _find_restatement_block_cut(text: str) -> int | None:
    """检测「先列一份编号事实，再用依据一/二/三整段重写一遍」的结构，返回重写段起点。

    与「同一标记第二次出现」不同：这里的小节标记只出现一次，但它前面已经有一份
    带编号 / 列表的完整事实列举（≥2 条列表行 + 句末标点），说明模型把同样内容换措辞
    又写了一遍——保留第一份、丢弃 `依据…` 重写段。

    只有一个结论句 + 随后 `依据一/二/三` 的正常格式不会命中（前面没有列表行）。
    """

    if not isinstance(text, str) or not text:
        return None
    for marker in _SECTION_MARKER_RE.finditer(text):
        preceding = [
            line.strip() for line in text[: marker.start()].split("\n") if line.strip()
        ]
        list_lines = [line for line in preceding if _LIST_LINE_RE.match(line)]
        if len(list_lines) >= 2 and any(
            _SENTENCE_END_RE.search(line) for line in list_lines
        ):
            return marker.start() + (1 if text.startswith("\n", marker.start()) else 0)
        return None
    return None


def _find_repeated_section_cut(text: str) -> int | None:
    """检测「依据一 / 依据二 / 依据三」小节被重复输出了第二遍，返回应截断的位置。

    循环复述的第二次往往改写了句子（句子级判重抓不住），但小节标记 `依据一：` 会原样再来一遍。
    同一标记第二次出现 → 说明模型从头又写了一遍答案，从该行开始截断即可保留第一份完整回答。
    """

    if not isinstance(text, str) or not text:
        return None
    seen: set[str] = set()
    for marker in _SECTION_MARKER_RE.finditer(text):
        # 标记可能在行首被 `(?:^|\n)` 匹配到，截断点取标记内容起点（保留上一行换行）。
        key = re.sub(r"[\s*:：]", "", marker.group(1))
        if key in seen:
            return marker.start() + (1 if text.startswith("\n", marker.start()) else 0)
        seen.add(key)
    return None


def find_repetition_cut(text: str) -> int | None:
    """检测流式生成中的「整句循环」并返回应截断的位置（字符下标）。

    两类信号（任一命中即返回循环起点）：

    1. **整句复述**：某个已完结句子（归一化后 ≥12 字）与更早的句子几乎逐字相同
       （相似度 ≥ `_NEAR_DUPLICATE_SENTENCE_RATIO`，覆盖「淝水之战中，…谢安。」与
       「前秦的统帅是苻坚，…谢安。」这类只差前缀的复述）；
    2. **小节重开**：`依据一 / 依据二 / 依据三` 这类小节标记第二次出现
       （句子被改写、但模型又把整套依据写了一遍）。

    调用方保留第一次出现的那一段、丢掉从重复处开始的内容。未检测到循环返回 ``None``。
    """

    if not isinstance(text, str) or len(text) < 40:
        return None
    # 「列表 + 依据一/二/三 重写」与「同一小节标记出现两次」都视为循环信号，取最早截断点。
    section_cuts = [
        cut
        for cut in (
            _find_restatement_block_cut(text),
            _find_repeated_section_cut(text),
        )
        if cut is not None
    ]
    if section_cuts:
        return min(section_cuts)
    seen: list[str] = []
    sentence_start = 0
    for boundary in _SENTENCE_BOUNDARY_RE.finditer(text):
        sentence_end = boundary.end()
        sentence = text[sentence_start:sentence_end]
        normalized = normalize_repeat_text(sentence)
        if len(normalized) >= _MIN_LOOP_SENTENCE_CHARS:
            if any(
                normalized == previous
                or _similarity(normalized, previous) >= _NEAR_DUPLICATE_SENTENCE_RATIO
                for previous in seen
            ):
                return sentence_start
            seen.append(normalized)
        sentence_start = sentence_end
    return None


def is_repetitive(text: str) -> bool:
    """流式 / 落盘前快速判定：正文是否已经出现整句循环（供测试与调用方复用）。"""

    return find_repetition_cut(text) is not None
