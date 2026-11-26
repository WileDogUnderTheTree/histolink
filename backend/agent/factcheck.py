"""文本级事实核查 `FactCheck`（V1.0.6.1：双重事实核查的第二重）。

背景
----
V1.0.6.1 把用户可见正文（`markdown`）的生成权交还模型。为了在「让模型写分析」的同时
**绝对不产生幻觉**，服务端保留两道彼此独立的核查：

1. **证据级核查**（第一重，`agent.validator.EvidenceValidator`）：evidence / citation 必须
   来自本轮工具真实返回、类型一致、有事实详情、citation 与 evidence 同源，且满足双数据源覆盖；
2. **文本级核查**（第二重，本模块）：对模型 `markdown` 做确定性复核——
   - **年份**：正文出现的每个年份必须能在本轮工具结果中找到同一纪年
     （`前221年` / `公元前221年` / `221年` 按绝对值视为同一纪年）；
   - **人物**：正文出现的已知历史人物名必须在本轮工具结果（人物详情 / 事件描述 / 参与者 /
     史料文本）中出现过，允许正名与别名；
   - **书名**：正文中的《…》必须来自本轮工具结果的书目 / 史料出处（或史料原文中出现过）；
   - **引文**：正文中较长的「…」/“…”直接引文必须能在本轮工具结果文本中逐字找到
     （忽略空白与标点差异）；
   - **结构**：grounded 正文必须包含「史料实证」「史令分析」两节且长度在约束范围内；
   - **量化史实**：工具结果中没有的具体数字（兵力 / 粮食 / 人口等）记为 warning，
     不阻断，但会进入 `trace.fact_check` 供观测（提示词要求估算必须带「约 / 估计」等限定词）。

处理策略（由 `AgentOrchestrator` 执行）
--------------------------------------
- 核查通过 → 采用模型正文作为 `FinalAnswer.markdown`；
- 核查不通过 → 把问题清单发回模型，只重写正文（最多 `MAX_FACT_CHECK_REPAIRS` 次）；
- 连续不通过 / 模型未提供 markdown → 回退服务端用工具原文拼装的「事实实证」正文，
  保证**未核验文本永不展示给用户**（安全兜底，不产生幻觉）。

本模块是纯函数集合，不依赖 FastAPI / 网络 / 模型调用，可单独单测。
"""

from __future__ import annotations

import re
from collections.abc import Iterable, Mapping
from dataclasses import dataclass, field
from typing import Any, Literal

from agent.comparison import (
    ComparisonFacts,
    build_comparison_facts,
    extract_year_tokens,
    find_unverified_person_names,
    observed_graph_person_names,
)
from agent.validator import (
    ObservedEntity,
    ObservedEvidence,
    _neutralize_instruction_text,
)

#: grounded 正文的最小 / 最大字符数（提示词要求 300–1200 字；这里留出宽松余量，
#: 只拦截「空正文 / 明显超长（会被 LLMClient 截断）」两类异常）。
MIN_MARKDOWN_CHARS = 80
MAX_MARKDOWN_CHARS = 6000
#: 需要逐字核验的直接引文最小长度（去掉标点后的有效字符数）。
#: 长度 < 8 的「引号词」多为术语 / 强调（如“千古一帝”“战时体制重构”），不做逐字校验。
MIN_QUOTE_CHARS = 8
#: 单条问题描述的最大字符数（进入修复消息 / trace 前截断）。
MAX_ISSUE_MESSAGE_CHARS = 200
#: 正文中的量化表述：数字 + 量词（年份由年份规则单独处理）。
_NUMBER_RE = re.compile(
    r"(?<![\d.])(\d+(?:\.\d+)?)\s*(万|千|百|吨|石|件|公里|里|人|次|倍|天|亩|斤|两|文|户)"
)
#: 需要写「约 / 估计」等限定词的估算语境（同一句内出现即视为合理估算）。
_HEDGE_WORDS = (
    "约",
    "大约",
    "估计",
    "推算",
    "大致",
    "可能",
    "左右",
    "上下",
    "不足",
    "超过",
    "余",
    "近",
    "将近",
    "数以",
)
#: 书名表达式《…》（不含嵌套 / 换行）。
_BOOK_RE = re.compile(r"《([^》\n]{1,40})》")
#: 中文直接引文表达式：“…”“…”“…”“…”、『…』（长度由 `MIN_QUOTE_CHARS` 再过滤）。
_QUOTE_RE = re.compile(r"[“「『]([^”」』\n]{1,400})[”」』]")
#: 控制字符 / 零宽字符（模型偶尔会带出来，展示前清掉）。
_CONTROL_CHARS_RE = re.compile(
    r"[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f\u200b-\u200f\u2060\ufeff]"
)
#: Markdown 围栏（模型误把正文包进代码块时剥掉）。
_FENCE_RE = re.compile(
    r"^\s*```(?:markdown|md)?\s*(.*?)\s*```\s*$", re.DOTALL | re.IGNORECASE
)
#: 归一化引文 / 文本时丢弃的标点与空白（用于「忽略标点差异」的逐字比对）。
_PUNCT_STRIP_RE = re.compile(
    r"[\s，。；：、！？（）()【】\[\]{}<>《》“”‘’\"'「」『』·—\-…,.!?:;|/\\~`$%^&*+=_]"
)

FactCheckStatus = Literal["passed", "failed"]


@dataclass(frozen=True)
class FactCheckIssue:
    """一条核查问题（blocking 会触发重写 / 回退；warning 只进 trace 观测）。"""

    code: str
    message: str
    severity: Literal["blocking", "warning"] = "blocking"


@dataclass(frozen=True)
class FactCheckFacts:
    """文本级核查所需的白名单与语料（全部来自本轮工具真实返回）。

    - `comparison`：复用 `agent.comparison.build_comparison_facts` 生成的事实块 +
      年份 / 人物白名单（同口径，避免两套实现漂移）；
    - `years`：允许出现的年份集合（含主语料文本里抽到的年份）；
    - `person_names`：允许出现的人物名（正名 + 别名 + 本轮图谱人物 + 工具文本中出现的已知人名）；
    - `book_names`：允许出现的书名（工具引用书目 + 史料出处 + 文本中出现的《…》）；
    - `corpus_text` / `quote_corpus`：本轮工具结果的可核验文本（原样 / 去标点归一化两份）。
    """

    comparison: ComparisonFacts
    years: frozenset[int]
    person_names: frozenset[str]
    book_names: frozenset[str]
    corpus_text: str
    quote_corpus: str
    known_person_names: frozenset[str]


@dataclass
class FactCheckReport:
    """一次文本级核查的结果（可直接序列化进 `trace.fact_check`）。"""

    issues: list[FactCheckIssue] = field(default_factory=list)
    checked_years: int = 0
    checked_persons: int = 0
    checked_books: int = 0
    checked_quotes: int = 0
    checked_numbers: int = 0

    @property
    def blocking_issues(self) -> list[FactCheckIssue]:
        return [issue for issue in self.issues if issue.severity == "blocking"]

    @property
    def warnings(self) -> list[FactCheckIssue]:
        return [issue for issue in self.issues if issue.severity == "warning"]

    @property
    def passed(self) -> bool:
        return not self.blocking_issues

    @property
    def status(self) -> FactCheckStatus:
        return "passed" if self.passed else "failed"

    def blocking_messages(self) -> list[str]:
        """给模型看的修复清单（最多 8 条，避免修复消息过长）。"""

        return [issue.message for issue in self.blocking_issues][:8]

    def to_trace(self, status: str | None = None) -> dict[str, Any]:
        """转成 `AgentResult.fact_check` / API `trace.fact_check` 的字典。"""

        return {
            "status": status or self.status,
            "issues": [issue.message for issue in self.blocking_issues][:10],
            "warnings": [issue.message for issue in self.warnings][:10],
            "checked_years": self.checked_years,
            "checked_persons": self.checked_persons,
            "checked_books": self.checked_books,
            "checked_quotes": self.checked_quotes,
            "checked_numbers": self.checked_numbers,
        }


def clean_markdown(markdown: Any) -> str:
    """清洗模型正文：去控制字符 / 剥代码围栏 / 还原字面量 `\\n` / 中和越狱标记。"""

    if not isinstance(markdown, str):
        return ""
    text = _CONTROL_CHARS_RE.sub("", markdown)
    fence = _FENCE_RE.match(text)
    if fence:
        text = fence.group(1)
    # 模型偶尔把换行写成字面量「\n」：整段都没有真实换行时才还原，避免误伤代码块里的转义。
    if "\n" not in text and "\\n" in text:
        text = text.replace("\\n", "\n")
    text = _neutralize_instruction_text(text)
    text = re.sub(r"\n{3,}", "\n\n", text)
    return text.strip()


def build_fact_check_facts(
    observed: ObservedEvidence,
    evidence_entities: Iterable[ObservedEntity],
    store: Any | None = None,
) -> FactCheckFacts | None:
    """从本轮工具结果构建文本级核查白名单；没有任何可核验语料时返回 None。

    `store`（`SnapshotStore`）用于补全人物正名 / 别名与「已知人名词典」；
    允许为 None（纯单测场景只使用工具结果里的详情字段）。
    """

    comparison = build_comparison_facts(observed, list(evidence_entities), store)
    if comparison is None:
        return None

    corpus_texts = collect_corpus_texts(observed)
    corpus_text = "\n".join(corpus_texts)
    quote_corpus = normalize_for_quote_match(corpus_text)
    known_names = _known_person_names(store)

    # 年份白名单：事实块年份 ∪ 语料文本里出现的「必须校验」年份 ∪ 详情字段里的结构化年份。
    years = set(comparison.years)
    years.update(
        token.year for token in extract_year_tokens(corpus_text) if token.must_verify
    )
    years.update(_structured_years(observed))

    # 人物白名单：事实块人物 ∪ 本轮图谱人物 ∪ 语料中出现的已知人名（工具文本提到的人可写）。
    allowed_names = set(comparison.person_names)
    allowed_names.update(observed_graph_person_names(observed, store))
    if known_names:
        mentioned = {
            name for name in known_names if len(name) >= 2 and name in corpus_text
        }
        allowed_names.update(mentioned)

    # 书名白名单：《…》形式 + 结构化引用书目（source_ref / source_label / book）。
    book_names = set()
    for match in _BOOK_RE.finditer(corpus_text):
        book_names.add(_normalize_book(match.group(1)))
    book_names.update(_structured_books(observed))

    return FactCheckFacts(
        comparison=comparison,
        years=frozenset(years),
        person_names=frozenset(name for name in allowed_names if name),
        book_names=frozenset(name for name in book_names if name),
        corpus_text=corpus_text,
        quote_corpus=quote_corpus,
        known_person_names=frozenset(known_names),
    )


def collect_corpus_texts(observed: ObservedEvidence) -> list[str]:
    """收集本轮工具结果里所有「可核验文本」（实体事实文本 + 详情字段 + 引用字段）。"""

    texts: list[str] = []

    def add(value: Any) -> None:
        if isinstance(value, str) and value.strip():
            texts.append(value.strip())
        elif isinstance(value, Mapping):
            for nested in value.values():
                add(nested)
        elif isinstance(value, (list, tuple)):
            for nested in value:
                add(nested)

    for entity in observed.entities.values():
        for text in entity.fact_texts:
            add(text)
        add(entity.detail)
    for observed_citation in observed.citations.values():
        citation = observed_citation.citation
        for value in (
            citation.title,
            citation.quote,
            citation.dynasty,
            citation.source_label,
            citation.attribution,
            citation.record_type,
        ):
            add(value)
        if citation.source_ref is not None:
            add(
                [
                    citation.source_ref.label,
                    citation.source_ref.book,
                    citation.source_ref.chapter,
                    citation.source_ref.raw,
                ]
            )
    # 去重但保持顺序（同一段文本只比对一次）。
    seen: set[str] = set()
    ordered: list[str] = []
    for text in texts:
        if text in seen:
            continue
        seen.add(text)
        ordered.append(text)
    return ordered


def normalize_for_quote_match(text: str) -> str:
    """归一化文本用于「忽略空白 / 标点差异」的逐字引文比对。"""

    if not isinstance(text, str):
        return ""
    return _PUNCT_STRIP_RE.sub("", text)


def check_markdown(markdown: str, facts: FactCheckFacts) -> FactCheckReport:
    """对模型正文执行文本级事实核查（确定性、不调用模型）。"""

    report = FactCheckReport()
    text = clean_markdown(markdown)
    if not text:
        report.issues.append(
            FactCheckIssue(
                "MARKDOWN_EMPTY",
                "正文为空：grounded 回答必须提供「史料实证 + 史令分析」两节正文",
            )
        )
        return report
    if len(text) < MIN_MARKDOWN_CHARS:
        report.issues.append(
            FactCheckIssue(
                "MARKDOWN_TOO_SHORT",
                f"正文过短（{len(text)} 字符）：必须同时写清史料实证与史令分析（建议 300–1200 字）",
            )
        )
    elif len(text) > MAX_MARKDOWN_CHARS:
        report.issues.append(
            FactCheckIssue(
                "MARKDOWN_TOO_LONG",
                f"正文过长（{len(text)} 字符 > {MAX_MARKDOWN_CHARS}）：请压缩事实复述，只保留最相关的证据与分析",
            )
        )

    if "史料实证" not in text:
        report.issues.append(
            FactCheckIssue(
                "MARKDOWN_MISSING_EVIDENCE_SECTION",
                "正文缺少「### 📜 史料实证」小节：事实必须单独成节，只写工具结果可核验的内容",
            )
        )
    if "史令分析" not in text:
        report.issues.append(
            FactCheckIssue(
                "MARKDOWN_MISSING_ANALYSIS_SECTION",
                "正文缺少「### 💡 史令分析」小节：必须基于史料实证做归纳、对比或辩证分析",
            )
        )

    _check_years(text, facts, report)
    _check_persons(text, facts, report)
    _check_books(text, facts, report)
    _check_quotes(text, facts, report)
    _check_numbers(text, facts, report)
    return report


def server_fallback_trace(reason: str, *, status: str = "fallback") -> dict[str, Any]:
    """回退服务端事实实证正文时的 trace 记录（安全兜底，明确标注未采用模型正文）。

    `status`：
    - ``fallback``：模型正文未通过文本级核查且重写机会用尽；
    - ``server_fallback``：模型没写正文 / 对比兜底等「本来就走服务端正文」的路径。
    """

    return {
        "status": status,
        "issues": [reason[:MAX_ISSUE_MESSAGE_CHARS]],
        "warnings": [],
        "checked_years": 0,
        "checked_persons": 0,
        "checked_books": 0,
        "checked_quotes": 0,
        "checked_numbers": 0,
    }


# ---------------------------------------------------------------------------
# 单项核查
# ---------------------------------------------------------------------------


def _check_years(text: str, facts: FactCheckFacts, report: FactCheckReport) -> None:
    """年份核查：正文中「必须校验」的年份必须能在工具结果年份集合中核验（纪年模糊匹配）。"""

    observed_years = {abs(year) for year in facts.years if year}
    fresh: list[str] = []
    for token in extract_year_tokens(text):
        if not token.must_verify:
            continue
        report.checked_years += 1
        if abs(token.year) in observed_years:
            continue
        label = token.label
        if label not in fresh:
            fresh.append(label)
    for label in fresh[:5]:
        report.issues.append(
            FactCheckIssue(
                "YEAR_UNVERIFIED",
                f"年份「{label}」不在本轮工具结果中：请删除该年份，或先调用工具补到对应史料的纪年",
            )
        )


def _check_persons(text: str, facts: FactCheckFacts, report: FactCheckReport) -> None:
    """人物核查：正面对照快照人名词典，正文不得引入工具结果以外的已知人物。"""

    # `find_unverified_person_names` 只扫描「已知人名词典」，不做正则猜名（宁漏不误杀）；
    # facts.person_names 已是「本轮工具结果里出现过」的白名单。
    unverified = find_unverified_person_names(
        text,
        facts.comparison,
        facts.known_person_names,
        facts.person_names,
    )
    # 统计正文里出现的白名单人物数（观测用）。
    report.checked_persons = sum(
        1 for name in facts.person_names if len(name) >= 2 and name in text
    )
    for name in unverified[:5]:
        report.issues.append(
            FactCheckIssue(
                "PERSON_UNVERIFIED",
                f"人物「{name}」不在本轮工具结果中：不得引入工具结果以外的历史人物作为论据",
            )
        )


def _check_books(text: str, facts: FactCheckFacts, report: FactCheckReport) -> None:
    """书名核查：正文中的《…》必须来自本轮工具结果的书目 / 史料出处。"""

    seen: set[str] = set()
    for match in _BOOK_RE.finditer(text):
        raw = match.group(1)
        normalized = _normalize_book(raw)
        if not normalized or normalized in seen:
            continue
        seen.add(normalized)
        report.checked_books += 1
        if _book_allowed(normalized, facts):
            continue
        report.issues.append(
            FactCheckIssue(
                "BOOK_UNVERIFIED",
                f"书名《{raw}》不在本轮工具结果的书目 / 史料出处中：请删除该书名，或引用工具返回的史料",
            )
        )


def _check_quotes(text: str, facts: FactCheckFacts, report: FactCheckReport) -> None:
    """引文核查：较长的中文直接引文必须能在工具结果文本中逐字找到（忽略标点 / 空白）。"""

    for match in _QUOTE_RE.finditer(text):
        inner = match.group(1).strip()
        normalized = normalize_for_quote_match(inner)
        if len(normalized) < MIN_QUOTE_CHARS:
            continue
        report.checked_quotes += 1
        if normalized and normalized in facts.quote_corpus:
            continue
        report.issues.append(
            FactCheckIssue(
                "QUOTE_UNVERIFIED",
                f"引文「{inner[:40]}」无法在本轮工具结果中逐字找到：不得凭记忆引用史料原文，请删除或改用工具返回的原文",
            )
        )


def _check_numbers(text: str, facts: FactCheckFacts, report: FactCheckReport) -> None:
    """量化史实：工具结果里没有的具体数字记为 warning（不阻断，但提示补限定词）。"""

    corpus = facts.quote_corpus
    for sentence in re.split(r"[。！？\n]", text):
        if not sentence.strip():
            continue
        for match in _NUMBER_RE.finditer(sentence):
            report.checked_numbers += 1
            number = match.group(1)
            if number in corpus:
                continue
            if any(word in sentence for word in _HEDGE_WORDS):
                continue
            report.issues.append(
                FactCheckIssue(
                    "NUMBER_UNVERIFIED",
                    f"数字「{match.group(0)}」不在本轮工具结果中：若是估算请加「约 / 估计」等限定词，否则删除",
                    severity="warning",
                )
            )


# ---------------------------------------------------------------------------
# 内部工具
# ---------------------------------------------------------------------------


def _book_allowed(normalized: str, facts: FactCheckFacts) -> bool:
    if normalized in facts.book_names:
        return True
    # 允许「《史记》」命中工具结果里的「史记·秦始皇本纪」；也允许工具结果正文里出现过的书名。
    return (
        any(
            normalized in name or name in normalized
            for name in facts.book_names
            if name
        )
        or normalized in facts.quote_corpus
    )


def _normalize_book(raw: str) -> str:
    return normalize_for_quote_match(raw)


def _known_person_names(store: Any | None) -> set[str]:
    """快照全部人物正名 + 别名（已知人名词典；只用于正向白名单校验）。"""

    if store is None:
        return set()
    names = getattr(store, "persons_by_name", None)
    if not isinstance(names, dict):
        return set()
    return {name for name in names if isinstance(name, str) and name}


def _structured_years(observed: ObservedEvidence) -> set[int]:
    """从工具返回的结构化字段里收集年份（year / first_year / last_year / year_min / year_max）。"""

    years: set[int] = set()
    for entity in observed.entities.values():
        for key in ("year", "first_year", "last_year", "year_min", "year_max"):
            value = entity.detail.get(key)
            if isinstance(value, int) and not isinstance(value, bool) and value != 0:
                years.add(value)
    for observed_citation in observed.citations.values():
        year = observed_citation.citation.year
        if isinstance(year, int) and not isinstance(year, bool) and year != 0:
            years.add(year)
    return years


def _structured_books(observed: ObservedEvidence) -> set[str]:
    """从引用结构里收集书目名（source_ref.label/book/chapter、source_label）。"""

    books: set[str] = set()
    for observed_citation in observed.citations.values():
        citation = observed_citation.citation
        if citation.source_label:
            books.add(_normalize_book(citation.source_label))
            # source_label 常为「史记·周本纪」这类「书·篇」形式：同时放行书部分。
            books.add(_normalize_book(citation.source_label.split("·")[0]))
        if citation.source_ref is not None:
            for value in (
                citation.source_ref.label,
                citation.source_ref.book,
                citation.source_ref.chapter,
            ):
                if isinstance(value, str) and value:
                    books.add(_normalize_book(value))
        attribution = citation.attribution or ""
        for match in _BOOK_RE.finditer(attribution):
            books.add(_normalize_book(match.group(1)))
    return {name for name in books if name}


__all__ = [
    "MAX_ISSUE_MESSAGE_CHARS",
    "MAX_MARKDOWN_CHARS",
    "MIN_MARKDOWN_CHARS",
    "MIN_QUOTE_CHARS",
    "FactCheckFacts",
    "FactCheckIssue",
    "FactCheckReport",
    "build_fact_check_facts",
    "check_markdown",
    "clean_markdown",
    "collect_corpus_texts",
    "normalize_for_quote_match",
    "server_fallback_trace",
]
