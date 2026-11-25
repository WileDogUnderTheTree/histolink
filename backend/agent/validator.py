"""证据校验器（V1.0.3 安全加固 / 审查报告 P0-1、P0-2、P0-3、P1-2；V1.0.5.2 双数据源分节）。

职责：在模型给出最终回答后，回到**本轮工具真实返回的信封**做核对。
V1.0.3 安全加固前的实现只把工具结果里的 ID 合并成 `set[str]`，无法区分
「实体类型 / 来源字段 / 是否事实可用 / 是否与 citation 绑定」，因此
「真实但无关的 ID + 真实 citation」可以骗过校验（P0-1）。

V1.0.5.2 起，grounded 正文按**双数据源**分节输出：`**[人物关系图]**`（person / relation）与
`**[时间轴·大事记]**`（event / RAG 史料细节），节序由问题类型决定；人物/关系类问题必须有
关系图证据、事件类问题必须有时间轴证据（硬校验，违反即降级），并在 trace 里回填双源覆盖状态。

现在的模型是**带类型、来源、可用性与绑定的证据图**：

- `ObservedEntity`：`(kind, entity_id)` 唯一，记录来源工具、出现形态
  （`detail` / `structured` / `citation` / `list`）、是否 `fact_usable`、
  关联事件/人物、以及**可支持它的 citation id**；
- `ObservedCitation`：引用 + 来源工具 + 是否事实可用；
- `absorb()` 只吸收 `ok is True` 的成功信封；失败信封即使被篡改出 citations 也不进证据图；
- ground 校验：evidence 必须是「有事实详情、fact_usable、且被 citation 绑定」的实体；
  claim 的每条 citation 必须能绑定到该 claim 的某个 evidence 实体；彩蛋事件、
  `fact_usable=false`、`source_status=easter_egg` 一律不得作为史实证据；
- **服务端重写（P0-2）**：grounded 回答的 `claims[].text` 与 `markdown` 不再信任模型文本，
  而是由服务端用工具返回值（citation 摘要 / 实体详情）重新生成。提示词注入最多让模型
  “选错事实”，但无法把工具里不存在的内容写进最终回答；
- **全模式固定文案（P0-3）**：`insufficient` 用服务端固定模板 + `missing_reasons` 枚举映射，
  `refusal` 按 `reason_code` 使用绝对固定文案；`certainty` 与 `missing` 也由服务端写死，
  模型提供的 `markdown` 在所有模式下都被完全废弃；
- UI 动作（P1-2）：仅 grounded 保留；最多 3 个；类型 ∈ V1 白名单且与 `target.surface`
  匹配；payload / target.params 中的 person / event / relation 引用必须在本轮真实出现；
  降级、拒答、资料不足统一清空。

降级不是异常：Orchestrator 会带着 `AgentResult.downgraded=True` 正常返回，便于观测与评测。
"""

from __future__ import annotations

import re
from collections.abc import Iterable, Mapping
from dataclasses import dataclass, field
from typing import Any, Literal

from pydantic import ValidationError

from agent.schemas import (
    MISSING_REASON_TEXT,
    Certainty,
    FinalAnswer,
    ModelAnswer,
    ModelUIAction,
    UIAction,
)
from contracts.action_types import ACTION_LABEL, ACTION_SURFACE, V1_AVAILABLE_ACTIONS
from contracts.models import Citation, Claim

EntityKind = Literal["event", "person", "relation", "rag"]

#: 实体出现形态（决定能否作为证据）：detail > structured > citation > list。
_EXPOSURE_RANK: dict[str, int] = {
    "detail": 3,
    "structured": 2,
    "citation": 1,
    "list": 0,
}
_ENTITY_KIND_LABEL = {"event": "事件", "person": "人物", "relation": "关系", "rag": "史料"}

#: ID 列表字段 → 实体类型。只有「在列表中顺带出现」的实体，不能直接作为证据。
_LIST_ID_FIELDS: dict[str, str] = {
    "person_ids": "person",
    "event_ids": "event",
    "co_occurring_person_ids": "person",
    "shared_event_ids": "event",
    "basis_event_ids": "event",
    "representative_event_ids": "event",
}
#: UI Action payload / target.params 中需要核验类型的字段。
_ACTION_ENTITY_FIELDS: dict[str, str] = {
    "person_id": "person",
    "person": "person",
    "event_id": "event",
    "event": "event",
    "person_id_a": "person",
    "person_id_b": "person",
    "relation_id": "relation",
    "pair_key": "relation",
}
#: 各动作的字段级 policy：payload / target.params 合并后必须提供的字段（P1-2）。
_ACTION_REQUIRED_FIELDS: dict[str, tuple[str, ...]] = {
    "timeline.focus_event": ("event_id",),
    "timeline.focus_dynasty": ("dynasty",),
    "graph.focus_person": ("person_id",),
    "graph.focus_relation": ("person_id_a", "person_id_b"),
}

_EVENT_DETAIL_FIELDS = (
    "event_id",
    "title",
    "dynasty",
    "year",
    "description",
    "importance",
    "is_special",
    "person_ids",
    "source_refs",
    "source_status",
    "surface",
)
_PERSON_DETAIL_FIELDS = (
    "person_id",
    "display_name",
    "romanized",
    "disambiguator",
    "aliases",
    "primary_dynasty",
    "dynasties",
    "era_ids",
    "scope_ids",
    "first_year",
    "last_year",
    "event_ids",
)
_RELATION_DETAIL_FIELDS = (
    "person_id_a",
    "person_id_b",
    "label",
    "description",
    "shared_event_ids",
    "basis_event_ids",
    "attribution",
)
#: V1.0.5：RAG 史料 chunk 的详情字段（工具 items / citations 双写，合并吸收）。
_RAG_DETAIL_FIELDS = (
    "chunk_id",
    "event_name",
    "title",
    "text",
    "record_type",
    "section",
    "source",
    "source_label",
    "book",
    "chapter",
    "event_id",
    "year_min",
    "year_max",
    "score",
)

_MAX_EVIDENCE = 50
_MAX_CLAIMS = 50
_MAX_CITATIONS = 50
_MAX_CLAIM_CITATIONS = 20
_MAX_ACTIONS = 3
_MAX_CLAIM_CHARS = 1000

_GROUNDED_LEAD = "根据本轮工具返回的可核验资料："
#: V1.0.5.2 双数据源的来源前缀（服务端写死，模型无法改写；所有引用内容都归属到对应前缀之下）。
_SOURCE_GRAPH_LABEL = "[人物关系图]"
_SOURCE_TIMELINE_LABEL = "[时间轴·大事记]"
_SOURCE_GRAPH_HEADING = f"**{_SOURCE_GRAPH_LABEL}**"
_SOURCE_TIMELINE_HEADING = f"**{_SOURCE_TIMELINE_LABEL}**"
#: 双源覆盖观测的稳定键名（trace.sources 与内部 source_coverage 共用）。
SOURCE_GRAPH = "graph"
SOURCE_TIMELINE = "timeline"
#: 传说 chunk 的句首标签（产品要求：神话传说必须显式标注）。
_LEGEND_TAG = "[传说]"
_LEGEND_RECORD_TYPE = "传说"

_DOWNGRADE_MARKDOWN = (
    "资料不足：模型给出的回答无法在当前工具结果中找到可核验的证据，"
    "因此这里不作结论。你可以换一种问法，或指定具体人物/时期后再试。"
)

#: insufficient 的固定正文模板（P0-3）：只插入服务端枚举映射出的缺失原因。
_INSUFFICIENT_MARKDOWN_TEMPLATE = "抱歉，现有的历史数据无法完整回答您的问题。缺少的信息：{missing}。"
_INSUFFICIENT_MISSING_FALLBACK = "工具结果没有覆盖问题所需的完整信息"

#: refusal 的固定服务端文案（按 reason_code 写死，模型文本一律废弃）。
_REFUSAL_MARKDOWN: dict[str, str] = {
    "OUT_OF_SCOPE": "抱歉，这个问题超出了史脉历史数据的回答范围，我无法给出可靠回答。",
    "UNSAFE_REQUEST": "抱歉，这个请求我不能处理。",
    "NO_RELIABLE_BASIS": "抱歉，现有史料不足以给出可靠结论，我不能凭推测回答。",
}
_REFUSAL_MARKDOWN_FALLBACK = "抱歉，这个问题我无法给出可靠回答。"

#: 工具文本 / 模型文本里常见的「越狱指令」标记；作为数据引用前先脱敏成中性标注。
#: 这里只做展示层中和，不代表把工具文本当指令（服务端从不执行工具文本）。
_INJECTION_PATTERN = re.compile(
    r"(?:忽略|无视|跳过)(?:[^。；;，,\n]{0,16}?)(?:指令|规则|提示|设定|约束)"
    r"|系统\s*提示词?"
    r"|ignore\s+(?:all\s+)?(?:the\s+)?(?:previous\s+)?instructions?"
    r"|you\s+are\s+now",
    re.IGNORECASE,
)
_INJECTION_REDACTION = "［已忽略可疑指令文本］"

# ---------------------------------------------------------------------------
# V1.0.5.2 双数据源：问题类型判定 + 覆盖校验
# ---------------------------------------------------------------------------

QuestionFocus = Literal["person", "relation", "event", "comparison"]

#: 问题类型线索（确定性关键词匹配，只决定分节顺序与双源覆盖校验，不影响证据门槛）。
_RELATION_CUES = (
    "关系",
    "如何认识",
    "怎么认识",
    "朋友",
    "师徒",
    "兄弟",
    "父子",
    "夫妻",
    "恩怨",
    "交往",
    "往来",
    "共同",
    "同现",
    "关联",
    "有谁",
    "和谁",
    "认识谁",
    "有哪些人",
)
_PERSON_CUES = (
    "是谁",
    "人物",
    "生平",
    "介绍",
    "哪个朝代",
    "什么朝代",
    "身份",
    "字号",
    "其人",
    "经历",
)
#: 对比类线索（显式 + 隐式），**同时**用于问题类型判定与二次归纳触发（V1.0.5.4 修复一）。
#:
#: 需求要求覆盖的问法：
#: - 显式：对比 / 区别 / 异同 / 比较 / 异同点 / 差异 / 差别 / 相同点 / 不同点；
#: - 隐式：A 和 B 一样吗？A 和 B 有什么不同？A 和 B 谁的影响更大？
#: 之前的白名单只有 `对比/区别/异同/有什么不同/比较/异同点`，导致
#: 「刘邦...和秦始皇...一样吗」这类隐式对比完全漏判、不触发二次归纳。
_COMPARISON_CUES = (
    # 显式对比词
    "对比",
    "比较",
    "相比",
    "相较",
    "区别",
    "差别",
    "差异",
    "异同",
    "异同点",
    "相同点",
    "不同点",
    "共同点",
    "不同之处",
    "有何不同",
    "有什么不同",
    "有哪些不同",
    "不一样",
    "不同在哪",
    "差别在哪",
    "差异在哪",
    "有何区别",
    "有什么区别",
    "有何差异",
    "有什么差异",
    "有什么差别",
)
#: 隐式对比句式（正则）：`A 和 B 一样吗` / `A 和 B 谁的影响更大` / `不同在哪` 等。
#: 只做确定性匹配，不引入模型调用；与双源覆盖校验共用同一判定。
_COMPARISON_PATTERNS = (
    # 「A 和 B 一样吗 / 相同吗 / 相似吗」这类「是否相同」问法。
    re.compile(r"(?:一样|相同|相似|类似)\s*(?:吗|么|嘛)"),
    # 「A 和 B 谁 / 哪个 … 更（大 / 强 / 重要 / 深远 …）」这类「谁更」问法。
    re.compile(
        r"(?:谁|哪个|哪一个|哪一位|哪位|哪种|哪方)"
        r"[^。！？?]{0,24}?更(?:大|多|强|厉害|重要|高|好|优|突出|明显|深远)"
    ),
    # 「不同 / 差异 / 区别 在哪（里）」的倒装问法。
    re.compile(r"(?:不同|差异|区别|差别)(?:在哪|在哪里|是什么|何在)"),
    # 「有什么区别 / 有什么不一样」等「有」字分离写法。
    re.compile(r"有(?:什么|何|哪些)[^。！？?]{0,8}?(?:不同|差异|区别|差别|不一样)"),
)
#: V1.0.5.4 二次归纳（对比分析）的额外触发线索：总结 / 归纳类也算对比归纳问题。
_COMPARISON_SUMMARY_CUES = (*_COMPARISON_CUES, "总结", "归纳")
_EVENT_CUES = ("哪一年", "发生在", "经过", "经过与影响", "事件", "战役", "之变", "之乱", "变法")


def _matches_comparison_cues(text: str) -> bool:
    """文本是否命中显式对比词或隐式对比句式（确定性匹配）。"""

    if any(cue in text for cue in _COMPARISON_CUES):
        return True
    return any(pattern.search(text) for pattern in _COMPARISON_PATTERNS)


def detect_comparison_intent(question: str) -> bool:
    """判定问题是否属于「对比 / 区别 / 异同 / 总结」类（V1.0.5.4 二次归纳触发条件）。

    纯函数、确定性匹配（显式关键词 + 隐式句式），**不设硬编码白名单**：
    只要命中 `_COMPARISON_CUES` / `_COMPARISON_PATTERNS` / 总结归纳线索之一即返回 True。

    只是二次归纳的**触发开关**：不改变三态语义、不影响双源覆盖校验，
    调用方在 grounded 之前 / 收尾兜底时都可用它决定是否必须尝试二次归纳。
    """

    text = (question or "").strip()
    if not text:
        return False
    if any(cue in text for cue in _COMPARISON_SUMMARY_CUES):
        return True
    return any(pattern.search(text) for pattern in _COMPARISON_PATTERNS)


def detect_question_focus(
    question: str, entities: Iterable[ObservedEntity] | None = None
) -> QuestionFocus:
    """确定性问题类型判定（V1.0.5.2）。

    顺序：对比 > 关系 > 人物 > 事件；只有关键词都没有命中时，才用证据里是否有人物实体兜底。
    该函数是纯函数、可单测，不读取任何外部状态。
    """

    text = (question or "").strip()
    if _matches_comparison_cues(text):
        return "comparison"
    if any(cue in text for cue in _RELATION_CUES):
        return "relation"
    if any(cue in text for cue in _PERSON_CUES):
        return "person"
    if any(cue in text for cue in _EVENT_CUES):
        return "event"
    observed_entities = list(entities or [])
    if any(entity.kind == "person" for entity in observed_entities):
        return "person"
    if any(entity.kind == "relation" for entity in observed_entities):
        return "relation"
    return "event"


def check_dual_source_coverage(
    entities: Iterable[ObservedEntity], focus: QuestionFocus
) -> str | None:
    """双数据源覆盖校验（服务端硬校验，模型无法绕过）。

    - 人物 / 关系类：必须有「人物关系图」证据（person / relation）；
    - 事件类：必须有「时间轴·大事记」证据（event / rag）；
    - 对比类：两边都可缺，但正文只输出命中节（不虚构另一源）。
    """

    observed_entities = list(entities)
    has_graph = any(entity.kind in ("person", "relation") for entity in observed_entities)
    has_timeline = any(entity.kind in ("event", "rag") for entity in observed_entities)
    if focus in ("person", "relation") and not has_graph:
        return "人物/关系类问题缺少人物关系图证据：必须提交 person 或 relation evidence"
    if focus == "event" and not has_timeline:
        return "事件类问题缺少时间轴证据：必须提交 event 或 rag evidence"
    return None


def source_coverage(entities: Iterable[ObservedEntity]) -> dict[str, bool]:
    """计算双源覆盖观测值：``{"timeline": bool, "graph": bool}``。"""

    observed_entities = list(entities)
    return {
        SOURCE_TIMELINE: any(entity.kind in ("event", "rag") for entity in observed_entities),
        SOURCE_GRAPH: any(entity.kind in ("person", "relation") for entity in observed_entities),
    }


@dataclass(frozen=True)
class ValidationOutcome:
    """校验后的最终回答 + 可下发引用 + 降级原因 + 双源覆盖观测。"""

    answer: FinalAnswer
    citations: list[Citation]
    downgraded: bool
    reason: str | None
    observed_entity_count: int
    observed_citation_count: int
    #: V1.0.5.2：``{"timeline": bool, "graph": bool}``，由最终证据类型计算，回填 trace.sources。
    source_coverage: dict[str, bool] = field(default_factory=dict)
    #: V1.0.5.4：最终通过校验的 evidence 实体（二次归纳构建事实块时复用，避免重复核验）。
    evidence_entities: list[ObservedEntity] = field(default_factory=list)


@dataclass(frozen=True)
class ObservedCitation:
    """本轮工具结果里真实出现过的引用（带来源工具与事实可用性）。"""

    citation: Citation
    source_tool: str
    fact_usable: bool = True

    @property
    def id(self) -> str:
        return self.citation.id


@dataclass
class ObservedEntity:
    """本轮工具结果里出现过的实体（带类型、来源、可用性与 citation 绑定）。"""

    kind: EntityKind
    entity_id: str
    source_tool: str
    exposure: str
    fact_usable: bool = True
    detail: dict[str, Any] = field(default_factory=dict)
    fact_texts: set[str] = field(default_factory=set)
    related_event_ids: set[str] = field(default_factory=set)
    related_person_ids: set[str] = field(default_factory=set)
    citation_ids: set[str] = field(default_factory=set)

    @property
    def eligible_as_evidence(self) -> bool:
        """能否作为史实回答的证据：事实可用 + 不是裸 ID + 被 citation 绑定。"""

        return (
            self.fact_usable
            and self.exposure != "list"
            and bool(self.citation_ids)
        )


class ObservedEvidence:
    """本轮所有工具结果构成的证据图（实体 + 引用）。"""

    def __init__(self) -> None:
        self.entities: dict[tuple[str, str], ObservedEntity] = {}
        self.citations: dict[str, ObservedCitation] = {}

    # -- 兼容旧测试 / 观测用的只读视图 --------------------------------
    @property
    def entity_ids(self) -> set[str]:
        return {entity.entity_id for entity in self.entities.values()}

    @property
    def citation_ids(self) -> set[str]:
        return set(self.citations)

    # -- 构造 ---------------------------------------------------------
    @classmethod
    def from_results(cls, results: Iterable[Mapping[str, Any]]) -> ObservedEvidence:
        observed = cls()
        for result in results:
            observed.absorb(result)
        return observed

    def absorb(self, tool_result: Mapping[str, Any]) -> None:
        """吸收一个工具统一信封（ok / data / items / citations / meta）。"""

        if not isinstance(tool_result, Mapping):
            return
        # 最前置防御：只有明确 ok=True 的成功信封才允许进入证据图。
        # 失败信封即使被篡改出 citations/items 也不得成为证据。
        if tool_result.get("ok") is not True:
            return
        tool = str(tool_result.get("tool") or "unknown")
        data = tool_result.get("data")
        raw_meta = tool_result.get("meta")
        meta: Mapping[str, Any] = raw_meta if isinstance(raw_meta, Mapping) else {}
        usable = _result_fact_usable(data, meta)

        result_citations: list[ObservedCitation] = []
        raw_citations = tool_result.get("citations")
        if isinstance(raw_citations, list):
            for raw in raw_citations:
                try:
                    citation = Citation.model_validate(raw)
                except ValidationError:  # pragma: no cover - 工具层已保证合法
                    continue
                existing = self.citations.get(citation.id)
                if existing is None:
                    observed = ObservedCitation(
                        citation=citation, source_tool=tool, fact_usable=usable
                    )
                else:
                    observed = ObservedCitation(
                        citation=existing.citation,
                        source_tool=existing.source_tool,
                        fact_usable=existing.fact_usable and usable,
                    )
                self.citations[citation.id] = observed
                result_citations.append(observed)
                self._absorb_citation(observed)

        if isinstance(data, Mapping):
            self._absorb_detail(tool, data, result_citations, usable)
        self._absorb_value(data, tool, usable, result_citations)
        self._absorb_value(tool_result.get("items"), tool, usable, result_citations)

    # -- 内部：引用 ---------------------------------------------------
    def _absorb_citation(self, observed: ObservedCitation) -> None:
        citation = observed.citation
        refs: tuple[tuple[str, str | None], ...] = (
            ("event", citation.event_id),
            ("person", citation.person_id),
            ("relation", citation.relation_id),
        )
        texts = _citation_fact_texts(citation)
        for kind, entity_id in refs:
            if isinstance(entity_id, str) and entity_id:
                self._touch(
                    kind,
                    entity_id,
                    observed.source_tool,
                    "citation",
                    observed.fact_usable,
                    fact_texts=texts,
                    # citation 天然绑定它自己指向的实体；这是「真实 citation」的基线。
                    citation_ids=(citation.id,),
                )
        # V1.0.5：RAG 史料引用本身就是一条「可作证据的 chunk」，
        # entity_id = citation.id（chunk_id），证据与引用一一对应。
        if citation.kind == "rag":
            related_event_ids = (
                (citation.event_id,) if isinstance(citation.event_id, str) and citation.event_id else ()
            )
            self._touch(
                "rag",
                citation.id,
                observed.source_tool,
                "citation",
                observed.fact_usable,
                detail={
                    "chunk_id": citation.id,
                    "event_name": citation.title,
                    "title": citation.title,
                    "text": citation.quote or "",
                    "record_type": citation.record_type,
                    "source_label": citation.source_label,
                    "event_id": citation.event_id,
                },
                fact_texts=texts,
                related_event_ids=related_event_ids,
                citation_ids=(citation.id,),
            )

    # -- 内部：工具专属详情 -------------------------------------------
    def _absorb_detail(
        self,
        tool: str,
        data: Mapping[str, Any],
        citations: list[ObservedCitation],
        usable: bool,
    ) -> None:
        if tool == "get_event":
            event_id = data.get("event_id")
            if isinstance(event_id, str) and event_id:
                self._touch(
                    "event",
                    event_id,
                    tool,
                    "detail",
                    usable,
                    detail=_pick(data, _EVENT_DETAIL_FIELDS),
                    fact_texts=_event_fact_texts(data),
                    related_person_ids=_strings(data.get("person_ids")),
                    citation_ids=[
                        item.id
                        for item in citations
                        if item.citation.event_id == event_id
                    ],
                )
            return

        if tool == "get_person":
            person_id = data.get("person_id")
            if isinstance(person_id, str) and person_id:
                event_ids = _strings(data.get("event_ids"))
                related_events = set(event_ids)
                self._touch(
                    "person",
                    person_id,
                    tool,
                    "detail",
                    usable,
                    detail=_pick(data, _PERSON_DETAIL_FIELDS),
                    fact_texts=_person_fact_texts(data),
                    related_event_ids=event_ids,
                    citation_ids=[
                        item.id
                        for item in citations
                        if item.citation.event_id in related_events
                    ],
                )
            return

        if tool == "get_relation":
            person_a = data.get("person_id_a")
            person_b = data.get("person_id_b")
            if not (isinstance(person_a, str) and isinstance(person_b, str)):
                return
            related_events = set(
                _strings(data.get("shared_event_ids")) + _strings(data.get("basis_event_ids"))
            )
            event_citation_ids = [
                item.id
                for item in citations
                if item.citation.event_id in related_events
            ]
            for item in citations:
                relation_id = item.citation.relation_id
                if item.citation.kind != "relation" or not isinstance(relation_id, str):
                    continue
                if not relation_id:
                    continue
                self._touch(
                    "relation",
                    relation_id,
                    tool,
                    "detail",
                    usable,
                    detail={
                        **_pick(data, _RELATION_DETAIL_FIELDS),
                        "pair_key": relation_id,
                    },
                    fact_texts=_relation_fact_texts(data),
                    related_event_ids=related_events,
                    related_person_ids=(person_a, person_b),
                    citation_ids=[item.id, *event_citation_ids],
                )
            # 关系两端的人物只在字段里出现，本身没有人物详情，不能作为证据。
            for person_id in (person_a, person_b):
                self._touch("person", person_id, tool, "list", usable)

    # -- 内部：通用结构 -----------------------------------------------
    def _absorb_value(
        self,
        value: Any,
        tool: str,
        usable: bool,
        citations: list[ObservedCitation],
    ) -> None:
        if isinstance(value, Mapping):
            self._absorb_mapping(value, tool, usable, citations)
            for nested in value.values():
                self._absorb_value(nested, tool, usable, citations)
        elif isinstance(value, list):
            for nested in value:
                self._absorb_value(nested, tool, usable, citations)

    def _absorb_mapping(
        self,
        mapping: Mapping[str, Any],
        tool: str,
        usable: bool,
        citations: list[ObservedCitation],
    ) -> None:
        # 列表型 ID：只在 *_ids 里顺带出现，记成 list，不能当证据。
        for key, kind in _LIST_ID_FIELDS.items():
            value = mapping.get(key)
            if isinstance(value, list):
                for entry in _strings(value):
                    self._touch(kind, entry, tool, "list", usable)

        event_id = mapping.get("event_id")
        if isinstance(event_id, str) and event_id:
            facts = _event_fact_texts(mapping)
            self._touch(
                "event",
                event_id,
                tool,
                "structured" if facts else "list",
                usable,
                detail=_pick(mapping, _EVENT_DETAIL_FIELDS),
                fact_texts=facts,
                related_person_ids=_strings(mapping.get("person_ids")),
                citation_ids=[
                    item.id
                    for item in citations
                    if item.citation.event_id == event_id
                ],
            )

        person_id = mapping.get("person_id")
        if isinstance(person_id, str) and person_id:
            facts = _person_fact_texts(mapping)
            event_ids = _strings(mapping.get("event_ids"))
            related_events = set(event_ids)
            self._touch(
                "person",
                person_id,
                tool,
                "structured" if facts else "list",
                usable,
                detail=_pick(mapping, _PERSON_DETAIL_FIELDS),
                fact_texts=facts,
                related_event_ids=event_ids,
                citation_ids=(
                    [
                        item.id
                        for item in citations
                        if item.citation.event_id in related_events
                    ]
                    if related_events
                    else []
                ),
            )

        for key in ("person_id_a", "person_id_b"):
            value = mapping.get(key)
            if isinstance(value, str) and value:
                self._touch("person", value, tool, "list", usable)

        # V1.0.5：RAG 工具 items / data.chunks 的单条 chunk（结构化详情，优先于 citation 形态）。
        chunk_id = mapping.get("chunk_id")
        if isinstance(chunk_id, str) and chunk_id:
            facts = {
                value
                for key in ("text", "event_name", "title", "source_label", "record_type", "source")
                if isinstance((value := mapping.get(key)), str) and value
            }
            event_id = mapping.get("event_id")
            related_event_ids = (
                (event_id,) if isinstance(event_id, str) and event_id else ()
            )
            self._touch(
                "rag",
                chunk_id,
                tool,
                "structured",
                usable,
                detail=_pick(mapping, _RAG_DETAIL_FIELDS),
                fact_texts=facts,
                related_event_ids=related_event_ids,
                citation_ids=[item.id for item in citations if item.id == chunk_id],
            )

    # -- 内部：合并 ---------------------------------------------------
    def _touch(
        self,
        kind: str,
        entity_id: str,
        tool: str,
        exposure: str,
        usable: bool,
        *,
        detail: Mapping[str, Any] | None = None,
        fact_texts: Iterable[str] = (),
        related_event_ids: Iterable[str] = (),
        related_person_ids: Iterable[str] = (),
        citation_ids: Iterable[str] = (),
    ) -> None:
        if kind not in _ENTITY_KIND_LABEL or not isinstance(entity_id, str) or not entity_id:
            return
        if exposure not in _EXPOSURE_RANK:
            return
        key = (kind, entity_id)
        entity = self.entities.get(key)
        if entity is None:
            entity = ObservedEntity(
                kind=kind,  # type: ignore[arg-type]
                entity_id=entity_id,
                source_tool=tool,
                exposure=exposure,
                fact_usable=bool(usable),
            )
            self.entities[key] = entity
        else:
            if _EXPOSURE_RANK[exposure] > _EXPOSURE_RANK[entity.exposure]:
                entity.exposure = exposure
                entity.source_tool = tool
            entity.fact_usable = entity.fact_usable and bool(usable)
        if detail:
            entity.detail.update(
                {field_name: value for field_name, value in detail.items() if value is not None}
            )
        entity.fact_texts.update(text for text in fact_texts if isinstance(text, str) and text)
        entity.related_event_ids.update(
            value for value in related_event_ids if isinstance(value, str) and value
        )
        entity.related_person_ids.update(
            value for value in related_person_ids if isinstance(value, str) and value
        )
        entity.citation_ids.update(
            value for value in citation_ids if isinstance(value, str) and value
        )


class EvidenceValidator:
    """三态回答的证据 / 引用 / UI 动作校验、服务端重写与降级。

    P0-3：`validate()` 接收模型提议的 `ModelAnswer`，返回**服务端生成**的 `FinalAnswer`。
    insufficient / refusal 的正文、`certainty`、`missing` 全部由服务端写死，
    模型提供的 `markdown` 文本在任何模式下都不会进入最终回答。
    """

    def validate(
        self,
        answer: ModelAnswer,
        observed: ObservedEvidence,
        *,
        question: str = "",
    ) -> ValidationOutcome:
        related_event_ids = self._related_event_ids(answer.related_event_ids, observed)
        if answer.mode == "grounded":
            return self._validate_grounded(answer, observed, related_event_ids, question)
        if answer.mode == "refusal":
            return self._refuse(answer, observed, related_event_ids)
        return self._insufficient(answer, observed, related_event_ids)

    # ------------------------------------------------------------------
    # insufficient / refusal：固定服务端文案（P0-3）
    # ------------------------------------------------------------------
    def _insufficient(
        self,
        answer: ModelAnswer,
        observed: ObservedEvidence,
        related_event_ids: list[str],
    ) -> ValidationOutcome:
        """insufficient：废弃模型 markdown；missing 由枚举映射，正文由固定模板生成。"""

        missing = [
            MISSING_REASON_TEXT.get(reason, _INSUFFICIENT_MISSING_FALLBACK)
            for reason in answer.missing_reasons
        ][:10]
        if not missing:
            missing = [_INSUFFICIENT_MISSING_FALLBACK]
        final = FinalAnswer(
            mode="insufficient",
            markdown=_INSUFFICIENT_MARKDOWN_TEMPLATE.format(missing="；".join(missing)),
            certainty="low",
            claims=[],
            evidence=[],
            related_event_ids=related_event_ids,
            missing=missing,
            reason_code=None,
            ui_actions=[],
        )
        return self._outcome(final, observed, citations=[], downgraded=False)

    def _refuse(
        self,
        answer: ModelAnswer,
        observed: ObservedEvidence,
        related_event_ids: list[str],
    ) -> ValidationOutcome:
        """refusal：按 reason_code 使用绝对固定的服务端文案，模型文本一律废弃。"""

        assert answer.reason_code is not None  # Schema 已保证
        markdown = _REFUSAL_MARKDOWN.get(answer.reason_code, _REFUSAL_MARKDOWN_FALLBACK)
        final = FinalAnswer(
            mode="refusal",
            markdown=markdown,
            certainty=None,
            claims=[],
            evidence=[],
            related_event_ids=related_event_ids,
            missing=[],
            reason_code=answer.reason_code,
            ui_actions=[],
        )
        return self._outcome(final, observed, citations=[], downgraded=False)

    # ------------------------------------------------------------------
    # grounded
    # ------------------------------------------------------------------
    def _validate_grounded(
        self,
        answer: ModelAnswer,
        observed: ObservedEvidence,
        related_event_ids: list[str],
        question: str = "",
    ) -> ValidationOutcome:
        if not answer.evidence:
            return self._downgrade(related_event_ids, observed, "grounded 回答没有提供 evidence")

        evidence_entities, reason = self._resolve_evidence(answer, observed)
        if reason is not None:
            return self._downgrade(related_event_ids, observed, reason)

        reason = self._validate_claim_citations(answer, observed, evidence_entities)
        if reason is not None:
            return self._downgrade(related_event_ids, observed, reason)

        # V1.0.5.2：双数据源覆盖硬校验（人物/关系类必须有关系图证据，事件类必须有时间轴证据）。
        focus = detect_question_focus(question, evidence_entities)
        coverage_error = check_dual_source_coverage(evidence_entities, focus)
        if coverage_error is not None:
            return self._downgrade(related_event_ids, observed, coverage_error)

        composed = self._compose_grounded(observed, evidence_entities, focus)
        if composed is None:
            return self._downgrade(
                related_event_ids,
                observed,
                "grounded 回答没有可核验的 citation 可生成最终正文",
            )
        claims, citations, markdown = composed
        final = FinalAnswer(
            mode="grounded",
            markdown=markdown,
            certainty=_grounded_certainty(evidence_entities, observed),
            claims=claims,
            evidence=list(answer.evidence),
            related_event_ids=related_event_ids,
            missing=[],
            reason_code=None,
            ui_actions=self._filter_ui_actions(answer.ui_actions, observed),
        )
        return self._outcome(
            final,
            observed,
            citations=citations,
            downgraded=False,
            source_coverage=source_coverage(evidence_entities),
            evidence_entities=evidence_entities,
        )

    def _outcome(
        self,
        final: FinalAnswer,
        observed: ObservedEvidence,
        *,
        citations: list[Citation],
        downgraded: bool,
        reason: str | None = None,
        source_coverage: dict[str, bool] | None = None,
        evidence_entities: list[ObservedEntity] | None = None,
    ) -> ValidationOutcome:
        return ValidationOutcome(
            answer=final,
            citations=citations,
            downgraded=downgraded,
            reason=reason,
            observed_entity_count=len(observed.entities),
            observed_citation_count=len(observed.citations),
            source_coverage=source_coverage
            if source_coverage is not None
            else {SOURCE_TIMELINE: False, SOURCE_GRAPH: False},
            evidence_entities=list(evidence_entities or []),
        )

    def _resolve_evidence(
        self, answer: ModelAnswer, observed: ObservedEvidence
    ) -> tuple[list[ObservedEntity], str | None]:
        """校验 evidence 的类型、来源、可用性与 citation 绑定，返回去重后的实体。"""

        resolved: list[ObservedEntity] = []
        seen: set[tuple[str, str]] = set()
        for evidence in answer.evidence:
            key = (evidence.entity_type, evidence.entity_id)
            if key in seen:
                continue
            seen.add(key)
            entity = observed.entities.get(key)
            if entity is None:
                other_kinds = [
                    kind
                    for (kind, entity_id) in observed.entities
                    if entity_id == evidence.entity_id
                ]
                if other_kinds:
                    actual = _ENTITY_KIND_LABEL.get(other_kinds[0], other_kinds[0])
                    return [], (
                        "evidence.entity_type 与工具返回的实体类型不一致："
                        f"{evidence.entity_id} 实际是{actual}"
                    )
                return [], f"evidence.entity_id 不在工具结果中：{evidence.entity_id}"
            if not entity.fact_usable:
                return [], (
                    "evidence 指向不可用于史实回答的结果（彩蛋 / fact_usable=false / "
                    f"source_status=easter_egg）：{evidence.entity_id}"
                )
            if entity.exposure == "list":
                return [], (
                    "evidence.entity_id 仅在 ID 列表中顺带出现，没有事实详情，"
                    f"不能作为可引用证据：{evidence.entity_id}"
                )
            if not entity.citation_ids:
                return [], f"evidence 实体没有可核验的 citation：{evidence.entity_id}"
            resolved.append(entity)
            if len(resolved) >= _MAX_EVIDENCE:
                break
        return resolved, None

    def _validate_claim_citations(
        self,
        answer: ModelAnswer,
        observed: ObservedEvidence,
        evidence_entities: list[ObservedEntity],
    ) -> str | None:
        claimed_ids = [
            citation_id
            for claim in answer.claims
            for citation_id in claim.citation_ids
        ]
        missing = [
            citation_id
            for citation_id in claimed_ids
            if citation_id not in observed.citations
        ]
        if missing:
            sample = "、".join(missing[:3])
            return f"claims.citation_ids 不在工具结果中：{sample}"

        for citation_id in claimed_ids:
            if not observed.citations[citation_id].fact_usable:
                return (
                    "claims.citation_ids 指向不可用于史实回答的工具结果："
                    f"{citation_id}"
                )

        for claim in answer.claims:
            for citation_id in claim.citation_ids:
                observed_citation = observed.citations[citation_id]
                if not any(
                    _citation_supports(observed_citation, entity)
                    for entity in evidence_entities
                ):
                    return (
                        f"claims[{claim.id}].citation_ids 与 evidence 不是同一实体："
                        f"{citation_id}"
                    )
        return None

    def _compose_grounded(
        self,
        observed: ObservedEvidence,
        evidence_entities: list[ObservedEntity],
        focus: QuestionFocus = "event",
    ) -> tuple[list[Claim], list[Citation], str] | None:
        """用工具返回的真实数据重写 claims / markdown（不信任模型文本）。

        V1.0.5.2 双数据源：证据按来源拆成两节——
        - ``**[人物关系图]**``：person / relation 证据（人物主数据、关系定性、共同事件）；
        - ``**[时间轴·大事记]**``：event 证据 + RAG 史料 chunk（事件详情、史料细节、``[传说]``、
          以及图谱与 RAG 的年份冲突提示）。

        节序由问题类型决定（人物/关系类关系图在前，事件类时间轴在前）；只有单源证据时
        只输出命中节，绝不虚构另一源。
        """

        graph_entities, timeline_entities = _split_evidence_by_source(evidence_entities)
        graph_part = (
            _claims_from_entities(graph_entities, observed) if graph_entities else None
        )
        timeline_part = (
            _claims_from_entities(timeline_entities, observed)
            if timeline_entities
            else None
        )
        if graph_entities and graph_part is None:
            return None
        if timeline_entities and timeline_part is None:
            return None
        if graph_part is None and timeline_part is None:
            return None

        graph_claims = graph_part[0] if graph_part else []
        timeline_claims = timeline_part[0] if timeline_part else []
        if not graph_claims and not timeline_claims:
            return None

        rag_entities = (
            [entity for entity in timeline_entities if entity.kind == "rag"]
            if timeline_entities
            else []
        )
        conflicts = _detect_year_conflicts(observed, rag_entities)
        markdown = _compose_dual_source_markdown(
            graph_claims,
            timeline_claims,
            conflicts=conflicts,
            focus=focus,
        )
        if not markdown:
            return None

        # claims 顺序与正文分节顺序保持一致，并重新编号 c1..cN。
        graph_first = focus in ("person", "relation")
        ordered_claims = (
            [*graph_claims, *timeline_claims]
            if graph_first
            else [*timeline_claims, *graph_claims]
        )
        claims = [
            claim.model_copy(update={"id": f"c{index}"})
            for index, claim in enumerate(ordered_claims, start=1)
        ]

        used_citation_ids: list[str] = []
        seen_citations: set[str] = set()
        for part in (graph_part, timeline_part):
            if part is None:
                continue
            for citation_id in part[1]:
                if citation_id not in seen_citations:
                    seen_citations.add(citation_id)
                    used_citation_ids.append(citation_id)
        citations = [
            observed.citations[citation_id].citation
            for citation_id in used_citation_ids
            if citation_id in observed.citations
        ][:_MAX_CITATIONS]
        if not citations:
            return None
        return claims, citations, markdown

    # ------------------------------------------------------------------
    # V1.0.5.4 对比兜底：模型 insufficient / 被降级时的服务端 grounded 重合成
    # ------------------------------------------------------------------
    def compose_rescue_grounded(
        self,
        observed: ObservedEvidence,
        evidence_entities: Iterable[ObservedEntity],
        question: str = "",
    ) -> tuple[list[Claim], list[Citation], str, QuestionFocus] | None:
        """用本轮真实图谱事实重新合成服务端 grounded 正文（V1.0.5.4 修复二）。

        背景：对比类问题只要图谱返回了 A / B 的实体数据，就不允许因为「模型没选好
        evidence / 没拿到 RAG 史料」而直接判定 insufficient。此时由服务端从本轮
        **真实工具返回**里挑出可用实体，复用 `_compose_grounded` 的双源分节规则重新
        生成正文与 claims / citations；模型随后只需基于事实块做二次归纳。

        与正常 grounded 路径同口径：只使用 `fact_usable`、非 list 形态、且被 citation
        绑定的实体，不放过任何未核验内容。无法合成正文时返回 None（调用方保持原三态）。
        """

        usable = [
            entity
            for entity in _unique_observed(evidence_entities)
            if entity.fact_usable and entity.exposure != "list" and entity.citation_ids
        ]
        if not usable:
            return None
        focus = detect_question_focus(question, usable)
        composed = self._compose_grounded(observed, usable, focus)
        if composed is None:
            return None
        claims, citations, markdown = composed
        if not markdown or not claims or not citations:
            return None
        return claims, citations, markdown, focus

    @staticmethod
    def grounded_certainty(
        evidence_entities: Iterable[ObservedEntity], observed: ObservedEvidence
    ) -> Certainty:
        """服务端写死 grounded 的 certainty（对比兜底路径复用同一规则）。"""

        return _grounded_certainty(list(evidence_entities), observed)

    # ------------------------------------------------------------------
    # 降级 / 过滤
    # ------------------------------------------------------------------
    def _downgrade(
        self,
        related_event_ids: Iterable[str],
        observed: ObservedEvidence,
        reason: str,
    ) -> ValidationOutcome:
        fallback = FinalAnswer(
            mode="insufficient",
            markdown=_DOWNGRADE_MARKDOWN,
            certainty="low",
            claims=[],
            evidence=[],
            related_event_ids=self._related_event_ids(related_event_ids, observed),
            missing=[reason[:300]],
            reason_code=None,
            ui_actions=[],
        )
        return ValidationOutcome(
            answer=fallback,
            citations=[],
            downgraded=True,
            reason=reason,
            observed_entity_count=len(observed.entities),
            observed_citation_count=len(observed.citations),
        )

    @staticmethod
    def _related_event_ids(
        related_event_ids: Iterable[str], observed: ObservedEvidence
    ) -> list[str]:
        """related_event_ids 只接受本轮真实返回、事实可用的事件 ID。"""

        filtered: list[str] = []
        seen: set[str] = set()
        for event_id in related_event_ids:
            if event_id in seen:
                continue
            entity = observed.entities.get(("event", event_id))
            if entity is None or not entity.fact_usable:
                continue
            seen.add(event_id)
            filtered.append(event_id)
            if len(filtered) >= 5:
                break
        return filtered

    @staticmethod
    def _filter_ui_actions(
        actions: Iterable[ModelUIAction], observed: ObservedEvidence
    ) -> list[UIAction]:
        """模型动作 → 服务端动作：白名单 + surface/字段/实体校验，label 由服务端写死。"""

        allowed_types = {action.value for action in V1_AVAILABLE_ACTIONS}
        filtered: list[UIAction] = []
        seen_ids: set[str] = set()
        for action in actions:
            if len(filtered) >= _MAX_ACTIONS:
                break
            if action.id in seen_ids:
                continue
            if action.type.value not in allowed_types:
                continue
            expected_surface = ACTION_SURFACE.get(action.type)
            if expected_surface is None or action.target.surface != expected_surface:
                continue
            if not _action_has_required_fields(action):
                continue
            if not _action_targets_observed_entities(action, observed):
                continue
            seen_ids.add(action.id)
            filtered.append(
                UIAction(
                    id=action.id,
                    type=action.type,
                    payload=action.payload,
                    target=action.target,
                    auto=action.auto,
                    label=ACTION_LABEL.get(action.type, "在页面中查看"),
                    reason=action.reason,
                )
            )
        return filtered


# ---------------------------------------------------------------------------
# 绑定 / 文本生成
# ---------------------------------------------------------------------------


def _citation_supports(
    observed_citation: ObservedCitation, entity: ObservedEntity
) -> bool:
    """citation 是否能支持该 evidence 实体（同一事件/人物/关系）。"""

    citation = observed_citation.citation
    if entity.kind == "event":
        return citation.event_id == entity.entity_id
    if entity.kind == "person":
        if citation.person_id == entity.entity_id:
            return True
        return bool(citation.event_id and citation.event_id in entity.related_event_ids)
    if entity.kind == "relation":
        if citation.relation_id == entity.entity_id:
            return True
        return bool(citation.event_id and citation.event_id in entity.related_event_ids)
    if entity.kind == "rag":
        # RAG 证据 = 一个 chunk，citation id 就是 chunk_id，天然一一对应。
        return citation.kind == "rag" and citation.id == entity.entity_id
    return False


def _action_has_required_fields(action: ModelUIAction) -> bool:
    """按动作 policy 校验必填字段（payload 与 target.params 合并判断）。"""

    required = _ACTION_REQUIRED_FIELDS.get(action.type.value, ())
    if not required:
        return True
    merged: dict[str, Any] = {**(action.payload or {}), **(action.target.params or {})}
    for field_name in required:
        value = merged.get(field_name)
        if not isinstance(value, str) or not value.strip():
            return False
    return True


def _action_targets_observed_entities(
    action: ModelUIAction, observed: ObservedEvidence
) -> bool:
    """动作 payload / target.params 里的实体引用必须是本轮真实出现、事实可用的实体。"""

    sources: tuple[Mapping[str, Any], ...] = (
        action.payload or {},
        action.target.params or {},
    )
    for source in sources:
        for key, value in source.items():
            kind = _ACTION_ENTITY_FIELDS.get(key)
            if kind is None:
                continue
            if not isinstance(value, str) or not value:
                return False
            entity = observed.entities.get((kind, value))
            if entity is None or not entity.fact_usable:
                return False
    return True


def _unique_observed(entities: Iterable[ObservedEntity]) -> list[ObservedEntity]:
    """按 ``(kind, entity_id)`` 去重并保持顺序（对比兜底重合成证据时使用）。"""

    seen: set[tuple[str, str]] = set()
    ordered: list[ObservedEntity] = []
    for entity in entities:
        key = (entity.kind, entity.entity_id)
        if key in seen:
            continue
        seen.add(key)
        ordered.append(entity)
    return ordered


def _split_evidence_by_source(
    evidence_entities: Iterable[ObservedEntity],
) -> tuple[list[ObservedEntity], list[ObservedEntity]]:
    """按数据来源拆分证据：graph = person/relation；timeline = event 在前、RAG chunk 在后。"""

    entities = list(evidence_entities)
    graph = [entity for entity in entities if entity.kind in ("person", "relation")]
    events = [entity for entity in entities if entity.kind == "event"]
    rag = [entity for entity in entities if entity.kind == "rag"]
    return graph, [*events, *rag]


def _claims_from_entities(
    entities: list[ObservedEntity], observed: ObservedEvidence
) -> tuple[list[Claim], list[str], list[ObservedEntity]] | None:
    """把一组同源证据转成服务端 claim（沿用 V1.0.5.1 的 citation 收集规则）。

    返回 ``(claims, citation_ids, rag_entities)``；任一实体拿不到可用 citation 或正文时返回 None，
    由调用方按「该源不可合成」处理（不得跳过证据静默拼正文）。
    """

    claims: list[Claim] = []
    citation_ids: list[str] = []
    rag_entities: list[ObservedEntity] = []
    seen_citations: set[str] = set()
    seen_entities: set[tuple[str, str]] = set()
    for entity in entities:
        key = (entity.kind, entity.entity_id)
        if key in seen_entities:
            continue
        seen_entities.add(key)
        usable_citations = [
            citation_id
            for citation_id, observed_citation in observed.citations.items()
            if citation_id in entity.citation_ids and observed_citation.fact_usable
        ][:_MAX_CLAIM_CITATIONS]
        if not usable_citations:
            return None
        text = _compose_entity_text(entity, observed)
        if not text:
            return None
        claims.append(
            Claim(
                id=f"c{len(claims) + 1}",
                text=_neutralize_instruction_text(text)[:_MAX_CLAIM_CHARS],
                citation_ids=usable_citations,
            )
        )
        if entity.kind == "rag":
            rag_entities.append(entity)
        for citation_id in usable_citations:
            if citation_id not in seen_citations:
                seen_citations.add(citation_id)
                citation_ids.append(citation_id)
        if len(claims) >= _MAX_CLAIMS:
            break
    return claims, citation_ids, rag_entities


def _compose_timeline_body(claims: list[Claim], conflicts: list[str]) -> str:
    """时间轴节正文：事件 / RAG claim + 年份冲突提示（``[传说]`` 已在 chunk 文本中标注）。"""

    if not claims and not conflicts:
        return ""
    parts = [claim.text for claim in claims]
    if conflicts:
        parts.insert(
            0,
            "史料记载有异："
            + "；".join(conflicts)
            + "。年份存在出入时以图谱为准，上列史料细节仅供对照。",
        )
    return "\n\n".join(parts)


def _compose_dual_source_markdown(
    graph_claims: list[Claim],
    timeline_claims: list[Claim],
    *,
    conflicts: list[str],
    focus: QuestionFocus,
) -> str:
    """按问题类型输出双源分节；空节省略，绝不虚构另一源（V1.0.5.2）。"""

    graph_body = "\n\n".join(claim.text for claim in graph_claims)
    timeline_body = _compose_timeline_body(timeline_claims, conflicts)

    graph_section = (
        f"{_SOURCE_GRAPH_HEADING}\n{graph_body}" if graph_body else ""
    )
    timeline_section = (
        f"{_SOURCE_TIMELINE_HEADING}\n{timeline_body}" if timeline_body else ""
    )

    sections: list[str] = []
    if focus in ("person", "relation"):
        # 人物 / 关系类：人物关系图在前，时间轴事件作背景补充。
        sections = [section for section in (graph_section, timeline_section) if section]
    else:
        # 事件 / 对比类：时间轴在前，人物关系图补充。
        sections = [section for section in (timeline_section, graph_section) if section]
    if not sections:
        return ""
    return f"{_GROUNDED_LEAD}\n\n" + "\n\n".join(sections)


def _compose_rag_chunk_text(entity: ObservedEntity) -> str:
    """RAG chunk → 正文行：传说加 ``[传说]`` 句首标签，末尾标注出处。"""

    detail = entity.detail
    text = _first_text(detail.get("text"))
    if not text:
        return ""
    record_type = detail.get("record_type")
    prefix = f"{_LEGEND_TAG} " if record_type == _LEGEND_RECORD_TYPE else ""
    source_label = _first_text(detail.get("source_label"), detail.get("book"), detail.get("source"))
    section = _first_text(detail.get("section"))
    suffix_parts = [part for part in (source_label, section) if part]
    suffix = f"（{'·'.join(suffix_parts)}）" if suffix_parts else ""
    return f"{prefix}{text}{suffix}"


def _detect_year_conflicts(
    observed: ObservedEvidence,
    rag_entities: Iterable[ObservedEntity],
) -> list[str]:
    """交叉校验：RAG 史料记载的年份区间与图谱纪年不一致时，生成「史料记载有异」标注。

    规则（确定性、可服务端复核）：
    - 只比较本轮**真实取到详情**的图谱事件（``get_event`` / ``search_events`` 等）；
    - 只比较 chunk 已对齐到该事件（``event_id``）且语料里抽到了年份区间的情况；
    - 图谱年份落在语料年份区间内 → 视为不冲突（多年度叙事，如「贞观之治 627—649」）；
    - 图谱年份在区间外 → 以图谱为准并标注（如商鞅变法图谱 -359、语料首见 -356/-350）。
    """

    graph_years: dict[str, tuple[int, str]] = {}
    for (kind, entity_id), entity in observed.entities.items():
        if kind != "event" or entity.exposure not in ("detail", "structured"):
            continue
        year = entity.detail.get("year")
        if not isinstance(year, int) or isinstance(year, bool) or year == 0:
            continue
        title = _first_text(entity.detail.get("title"), entity_id)
        graph_years[entity_id] = (year, title)

    notes: list[str] = []
    seen: set[tuple[str, int, int]] = set()
    for entity in rag_entities:
        event_id = entity.detail.get("event_id")
        if not isinstance(event_id, str) or event_id not in graph_years:
            continue
        year_min = entity.detail.get("year_min")
        year_max = entity.detail.get("year_max")
        if not _is_year(year_min) or not _is_year(year_max):
            continue
        if year_min > year_max:
            year_min, year_max = year_max, year_min
        graph_year, title = graph_years[event_id]
        if year_min <= graph_year <= year_max:
            continue
        key = (event_id, year_min, year_max)
        if key in seen:
            continue
        seen.add(key)
        if year_min == year_max:
            recorded = _year_label(year_min)
        else:
            recorded = f"{_year_label(year_min)}—{_year_label(year_max)}"
        notes.append(f"图谱系「{title}」于{_year_label(graph_year)}，RAG 史料记载涉及{recorded}")
    return notes


def _is_year(value: Any) -> bool:
    return isinstance(value, int) and not isinstance(value, bool) and value != 0


def _neutralize_instruction_text(text: str) -> str:
    """把文本中的「忽略指令 / 系统提示词」等越狱标记替换为中性标注。"""

    if not text:
        return text
    return _INJECTION_PATTERN.sub(_INJECTION_REDACTION, text)


def _grounded_certainty(
    evidence_entities: list[ObservedEntity], observed: ObservedEvidence
) -> Certainty:
    """服务端写死 grounded 的 certainty（P0-3：模型不参与）。

    全部证据都是详情实体、且引用的 citation 都带结构化书目 → `high`；
    否则（摘要级证据 / 关系库引用等）→ `medium`。
    """

    if not evidence_entities:
        return "medium"
    if any(entity.exposure != "detail" for entity in evidence_entities):
        return "medium"
    cited_ids = {
        citation_id
        for entity in evidence_entities
        for citation_id in entity.citation_ids
        if citation_id in observed.citations
    }
    if not cited_ids:
        return "medium"
    if any(
        observed.citations[citation_id].citation.source_ref is None
        for citation_id in cited_ids
    ):
        return "medium"
    return "high"


def _compose_entity_text(entity: ObservedEntity, observed: ObservedEvidence) -> str:
    if entity.kind == "rag":
        return _compose_rag_chunk_text(entity)
    citation_ids = [
        citation_id
        for citation_id, observed_citation in observed.citations.items()
        if citation_id in entity.citation_ids and observed_citation.fact_usable
    ]
    citations = [
        observed.citations[citation_id].citation
        for citation_id in citation_ids
        if citation_id in observed.citations
    ]
    event_citations = [citation for citation in citations if citation.kind == "event"]
    detail = entity.detail

    if entity.kind == "event":
        return _compose_event_text(entity, detail, event_citations)
    if entity.kind == "person":
        return _compose_person_text(entity, detail, event_citations)
    return _compose_relation_text(entity, detail, event_citations)


def _compose_event_text(
    entity: ObservedEntity,
    detail: Mapping[str, Any],
    citations: list[Citation],
) -> str:
    citation = citations[0] if citations else None
    title = _first_text(detail.get("title"), citation.title if citation else None, entity.entity_id)
    dynasty = _first_text(detail.get("dynasty"), citation.dynasty if citation else None)
    year = detail.get("year")
    if not isinstance(year, int) or isinstance(year, bool):
        year = citation.year if citation is not None else None
    description = _first_text(
        detail.get("description"), citation.quote if citation else None
    )
    header_parts = [title]
    suffix: list[str] = []
    if dynasty:
        suffix.append(str(dynasty))
    if isinstance(year, int) and not isinstance(year, bool):
        suffix.append(_year_label(year))
    if suffix:
        header_parts.append(f"（{'，'.join(suffix)}）")
    text = "".join(header_parts)
    if description:
        text = f"{text}：{description}"
    source_label = _citation_source_label(citation) if citation is not None else None
    if source_label and source_label not in text:
        text = f"{text}（据《{source_label}》）"
    return text


def _compose_person_text(
    entity: ObservedEntity,
    detail: Mapping[str, Any],
    citations: list[Citation],
) -> str:
    name = _first_text(detail.get("display_name"), entity.entity_id)
    text = name
    disambiguator = detail.get("disambiguator")
    if isinstance(disambiguator, str) and disambiguator:
        text = f"{text}（{disambiguator}）"
    text = f"{text}："
    details: list[str] = []
    dynasty = detail.get("primary_dynasty")
    if isinstance(dynasty, str) and dynasty:
        details.append(f"主要活动于{dynasty}")
    first_year = detail.get("first_year")
    last_year = detail.get("last_year")
    if (
        isinstance(first_year, int)
        and not isinstance(first_year, bool)
        and isinstance(last_year, int)
        and not isinstance(last_year, bool)
    ):
        details.append(
            f"相关年代 {_year_label(first_year)}—{_year_label(last_year)}"
        )
    aliases = _strings(detail.get("aliases"))
    if aliases:
        details.append("别名：" + "、".join(aliases[:5]))
    if details:
        text = f"{text}{'，'.join(details)}。"
    else:
        text = f"{text}工具返回了该人物主数据。"
    event_refs = _event_reference_texts(citations)
    if event_refs:
        text = f"{text}相关事件：{event_refs}。"
    return text


def _compose_relation_text(
    entity: ObservedEntity,
    detail: Mapping[str, Any],
    citations: list[Citation],
) -> str:
    label = _first_text(detail.get("label"), "关系")
    text = f"关系：{label}。"
    description = detail.get("description")
    if isinstance(description, str) and description:
        text = f"{text}{description}"
    attribution = detail.get("attribution")
    if isinstance(attribution, str) and attribution and attribution not in text:
        text = f"{text}（来源：{attribution}）"
    event_refs = _event_reference_texts(citations)
    if event_refs:
        text = f"{text}相关事件：{event_refs}。"
    return text


def _event_reference_texts(citations: list[Citation], *, limit: int = 5) -> str:
    parts: list[str] = []
    for citation in citations[:limit]:
        if citation.kind != "event":
            continue
        title = citation.title
        year = citation.year
        if isinstance(year, int) and not isinstance(year, bool):
            parts.append(f"{title}（{_year_label(year)}）")
        else:
            parts.append(title)
    return "、".join(parts)


def _citation_source_label(citation: Citation) -> str | None:
    if citation.source_label:
        return citation.source_label
    if citation.source_ref is not None:
        return citation.source_ref.label
    return None


# ---------------------------------------------------------------------------
# 工具结果解析辅助
# ---------------------------------------------------------------------------


def _result_fact_usable(data: Any, meta: Mapping[str, Any]) -> bool:
    """结果是否可用于史实回答：过滤彩蛋 / 无事实详情的结果（P0-1）。"""

    if meta.get("fact_usable") is False:
        return False
    if isinstance(data, Mapping):
        if data.get("is_special") is True:
            return False
        if data.get("source_status") == "easter_egg":
            return False
    return True


def _pick(mapping: Mapping[str, Any], fields: Iterable[str]) -> dict[str, Any]:
    return {field_name: mapping[field_name] for field_name in fields if field_name in mapping}


def _strings(value: Any) -> list[str]:
    if not isinstance(value, (list, tuple)):
        return []
    return [entry for entry in value if isinstance(entry, str) and entry]


def _first_text(*values: Any) -> str:
    for value in values:
        if isinstance(value, str) and value:
            return value
    return ""


def _year_label(year: int) -> str:
    return f"前{abs(year)}年" if year < 0 else f"{year}年"


def _citation_fact_texts(citation: Citation) -> set[str]:
    texts: set[str] = set()
    for value in (
        citation.title,
        citation.quote,
        citation.dynasty,
        citation.source_label,
        citation.attribution,
    ):
        if isinstance(value, str) and value:
            texts.add(value)
    if isinstance(citation.year, int) and not isinstance(citation.year, bool):
        texts.add(str(citation.year))
        texts.add(_year_label(citation.year))
    if citation.source_ref is not None:
        for value in (
            citation.source_ref.label,
            citation.source_ref.book,
            citation.source_ref.chapter,
            citation.source_ref.raw,
        ):
            if isinstance(value, str) and value:
                texts.add(value)
    return texts


def _event_fact_texts(mapping: Mapping[str, Any]) -> set[str]:
    texts: set[str] = set()
    for key in ("title", "name", "description", "dynasty", "disambiguator"):
        value = mapping.get(key)
        if isinstance(value, str) and value:
            texts.add(value)
    year = mapping.get("year")
    if isinstance(year, int) and not isinstance(year, bool):
        texts.add(str(year))
        texts.add(_year_label(year))
    for reference in mapping.get("source_refs") or []:
        if isinstance(reference, Mapping):
            for key in ("label", "book", "chapter", "raw"):
                value = reference.get(key)
                if isinstance(value, str) and value:
                    texts.add(value)
    return texts


def _person_fact_texts(mapping: Mapping[str, Any]) -> set[str]:
    texts: set[str] = set()
    for key in (
        "display_name",
        "name",
        "romanized",
        "disambiguator",
        "primary_dynasty",
    ):
        value = mapping.get(key)
        if isinstance(value, str) and value:
            texts.add(value)
    for key in ("dynasties", "aliases"):
        for value in mapping.get(key) or []:
            if isinstance(value, str) and value:
                texts.add(value)
    for key in ("first_year", "last_year"):
        value = mapping.get(key)
        if isinstance(value, int) and not isinstance(value, bool):
            texts.add(str(value))
            texts.add(_year_label(value))
    return texts


def _relation_fact_texts(mapping: Mapping[str, Any]) -> set[str]:
    texts: set[str] = set()
    for key in ("label", "description", "attribution"):
        value = mapping.get(key)
        if isinstance(value, str) and value:
            texts.add(value)
    return texts


__all__ = [
    "SOURCE_GRAPH",
    "SOURCE_TIMELINE",
    "EvidenceValidator",
    "ObservedCitation",
    "ObservedEntity",
    "ObservedEvidence",
    "QuestionFocus",
    "ValidationOutcome",
    "check_dual_source_coverage",
    "detect_comparison_intent",
    "detect_question_focus",
    "source_coverage",
]
