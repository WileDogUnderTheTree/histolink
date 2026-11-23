"""证据校验器（V1.0.3 安全加固 / 审查报告 P0-1、P0-2、P0-3、P1-2）。

职责：在模型给出最终回答后，回到**本轮工具真实返回的信封**做核对。
V1.0.3 安全加固前的实现只把工具结果里的 ID 合并成 `set[str]`，无法区分
「实体类型 / 来源字段 / 是否事实可用 / 是否与 citation 绑定」，因此
「真实但无关的 ID + 真实 citation」可以骗过校验（P0-1）。

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

EntityKind = Literal["event", "person", "relation"]

#: 实体出现形态（决定能否作为证据）：detail > structured > citation > list。
_EXPOSURE_RANK: dict[str, int] = {
    "detail": 3,
    "structured": 2,
    "citation": 1,
    "list": 0,
}
_ENTITY_KIND_LABEL = {"event": "事件", "person": "人物", "relation": "关系"}

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

_MAX_EVIDENCE = 50
_MAX_CLAIMS = 50
_MAX_CITATIONS = 50
_MAX_CLAIM_CITATIONS = 20
_MAX_ACTIONS = 3
_MAX_CLAIM_CHARS = 1000
_MAX_MARKDOWN_CHARS = 10000

_GROUNDED_LEAD = "根据本轮工具返回的可核验资料："

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


@dataclass(frozen=True)
class ValidationOutcome:
    """校验后的最终回答 + 可下发引用 + 降级原因。"""

    answer: FinalAnswer
    citations: list[Citation]
    downgraded: bool
    reason: str | None
    observed_entity_count: int
    observed_citation_count: int


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

    def validate(self, answer: ModelAnswer, observed: ObservedEvidence) -> ValidationOutcome:
        related_event_ids = self._related_event_ids(answer.related_event_ids, observed)
        if answer.mode == "grounded":
            return self._validate_grounded(answer, observed, related_event_ids)
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
    ) -> ValidationOutcome:
        if not answer.evidence:
            return self._downgrade(related_event_ids, observed, "grounded 回答没有提供 evidence")

        evidence_entities, reason = self._resolve_evidence(answer, observed)
        if reason is not None:
            return self._downgrade(related_event_ids, observed, reason)

        reason = self._validate_claim_citations(answer, observed, evidence_entities)
        if reason is not None:
            return self._downgrade(related_event_ids, observed, reason)

        composed = self._compose_grounded(observed, evidence_entities)
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
        return self._outcome(final, observed, citations=citations, downgraded=False)

    def _outcome(
        self,
        final: FinalAnswer,
        observed: ObservedEvidence,
        *,
        citations: list[Citation],
        downgraded: bool,
        reason: str | None = None,
    ) -> ValidationOutcome:
        return ValidationOutcome(
            answer=final,
            citations=citations,
            downgraded=downgraded,
            reason=reason,
            observed_entity_count=len(observed.entities),
            observed_citation_count=len(observed.citations),
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
    ) -> tuple[list[Claim], list[Citation], str] | None:
        """用工具返回的真实数据重写 claims / markdown（不信任模型文本）。"""

        claims: list[Claim] = []
        used_citation_ids: list[str] = []
        seen_citations: set[str] = set()
        seen_entities: set[tuple[str, str]] = set()
        for entity in evidence_entities:
            key = (entity.kind, entity.entity_id)
            if key in seen_entities:
                continue
            seen_entities.add(key)
            citation_ids = [
                citation_id
                for citation_id, observed_citation in observed.citations.items()
                if citation_id in entity.citation_ids and observed_citation.fact_usable
            ][:_MAX_CLAIM_CITATIONS]
            if not citation_ids:
                return None
            text = _compose_entity_text(entity, observed)
            if not text:
                return None
            claims.append(
                Claim(
                    id=f"c{len(claims) + 1}",
                    text=_neutralize_instruction_text(text)[:_MAX_CLAIM_CHARS],
                    citation_ids=citation_ids,
                )
            )
            for citation_id in citation_ids:
                if citation_id not in seen_citations:
                    seen_citations.add(citation_id)
                    used_citation_ids.append(citation_id)
            if len(claims) >= _MAX_CLAIMS:
                break
        if not claims or not used_citation_ids:
            return None
        citations = [
            observed.citations[citation_id].citation
            for citation_id in used_citation_ids
            if citation_id in observed.citations
        ][:_MAX_CITATIONS]
        markdown = _compose_markdown(claims)
        return claims, citations, markdown

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


def _compose_markdown(claims: list[Claim]) -> str:
    body = "\n\n".join(claim.text for claim in claims)
    return f"{_GROUNDED_LEAD}\n\n{body}"[:_MAX_MARKDOWN_CHARS]


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
    "EvidenceValidator",
    "ObservedCitation",
    "ObservedEntity",
    "ObservedEvidence",
    "ValidationOutcome",
]
