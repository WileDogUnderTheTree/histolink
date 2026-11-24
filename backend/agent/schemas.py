"""Agent Core 的 Pydantic 数据结构（V1.0.3）。

这些模型是**模型输出 / 工具调用 / 最终回答**之间唯一的数据契约：
- 模型只能输出 `ToolCallStep` 或 `FinalStep` 两种 JSON，最终回答用 `ModelAnswer`；
- `FinalAnswer` 是**服务端生成的输出结构**（markdown / certainty / missing / UIAction.label 均由服务端写死），
  模型无法直接提供；`EvidenceValidator` 负责把 `ModelAnswer` 转换成 `FinalAnswer`；
- `Evidence` 的 `entity_id` 必须能在工具结果中找到（由 `validator.EvidenceValidator` 校验）；
- `UIAction` 直接复用冻结的 `contracts.models.UIAction`，不另造协议。

严格性：全部 `extra="forbid"`，模型多想/多写的字段会被拒绝并进入修复轮。
"""

from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator

from contracts.action_types import UIActionType
from contracts.models import (
    Citation,
    Claim,
    UIActionTarget,
)
from contracts.models import (
    UIAction as ContractUIAction,
)

AnswerMode = Literal["grounded", "insufficient", "refusal"]
Certainty = Literal["high", "medium", "low"]
RefusalReason = Literal["OUT_OF_SCOPE", "UNSAFE_REQUEST", "NO_RELIABLE_BASIS"]
#: V1.0.5：新增 `rag` —— RAG 史料 chunk（entity_id = chunk_id / citation id）。
EvidenceKind = Literal["event", "person", "relation", "rag"]
#: insufficient 的结构化缺失原因：模型只能从枚举里选，展示文案由服务端映射（P0-3）。
MissingReason = Literal[
    "NO_MATCHING_ENTITY",
    "AMBIGUOUS_ENTITY",
    "NO_RELATION_RECORD",
    "NO_EVENT_DETAIL",
    "NO_RELIABLE_SOURCE",
    "INSUFFICIENT_DATA",
]
#: 缺失原因 → 服务端固定文案（模型不能自由书写 missing）。
MISSING_REASON_TEXT: dict[str, str] = {
    "NO_MATCHING_ENTITY": "没有检索到与问题匹配的人物或事件",
    "AMBIGUOUS_ENTITY": "人物存在歧义，需要用户指定具体是哪一位",
    "NO_RELATION_RECORD": "关系库没有该人物关系的定性记录",
    "NO_EVENT_DETAIL": "只检索到事件列表，缺少可用于回答的事件详情",
    "NO_RELIABLE_SOURCE": "缺少可核验的史料书目",
    "INSUFFICIENT_DATA": "工具结果没有覆盖问题所需的完整信息",
}


class AgentModel(BaseModel):
    """Agent 模型基类：禁止多余字段、字符串自动去首尾空白。"""

    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)


class ToolCall(AgentModel):
    """模型提出的一次工具调用；`arguments` 还需经 `ToolRegistry` 的严格 Schema 校验。"""

    tool: str = Field(min_length=1, max_length=100)
    arguments: dict[str, Any] = Field(default_factory=dict)


class ToolCallStep(AgentModel):
    """模型单轮输出：调用工具。"""

    action: Literal["tool_call"] = "tool_call"
    thought: str | None = Field(default=None, max_length=1000)
    tool: str = Field(min_length=1, max_length=100)
    arguments: dict[str, Any] = Field(default_factory=dict)


class ToolBatchStep(AgentModel):
    """模型单轮输出：并行调用彼此独立的只读工具。"""

    action: Literal["tool_batch"] = "tool_batch"
    thought: str | None = Field(default=None, max_length=1000)
    calls: list[ToolCall] = Field(min_length=2, max_length=4)


class Evidence(AgentModel):
    """一条证据：把最终回答绑定到工具真实返回过的实体上。

    `entity_id` 可以是 `person_id` / `event_id` / 关系 `relation_id`（工具 citation 里的
    `relation_id` 即关系 pair_key），V1.0.5 起也可以是 **RAG chunk_id**（`entity_type="rag"`，
    chunk_id 即 citation id）。V1.0.3 安全加固后，`EvidenceValidator` 不只看 ID 是否
    出现过，还会校验：类型一致、有事实详情（不能只在 *_ids 列表里出现）、`fact_usable`
    为真（彩蛋事件不可用）、且被 claim 引用的 citation 绑定到同一实体。
    """

    entity_type: EvidenceKind
    entity_id: str = Field(min_length=1, max_length=256)
    note: str | None = Field(default=None, max_length=500)


#: 复用冻结的动作信封（id/type/payload/target/auto/label/reason）。
class UIAction(ContractUIAction):
    """**服务端生成**的 UI 动作（label 由服务端按类型写死；可用类型由白名单过滤）。"""


class ModelUIAction(AgentModel):
    """**模型提议**的 UI 动作：不提供 `label`（由服务端按 `action.type` 写死）。"""

    id: str = Field(min_length=1, max_length=128)
    type: UIActionType
    payload: dict[str, Any] = Field(default_factory=dict)
    target: UIActionTarget
    auto: bool = Field(default=False)
    reason: str | None = Field(default=None, max_length=300)


class ModelClaim(AgentModel):
    """**模型提议**的 claim：只声明引用绑定，不写用户可见文本。"""

    id: str = Field(min_length=1, max_length=64)
    citation_ids: list[str] = Field(min_length=1, max_length=20)


class ModelAnswer(AgentModel):
    """**模型提议**的最终回答（三态）。

    V1.0.3 复审整改（P0-3）与放行后清理后，模型不再能决定任何用户可见文本：

    - 没有 `markdown`（服务端按模式生成正文）；
    - 没有 `certainty`（服务端按模式 / 证据形态写死）；
    - 没有 `missing` 自由文本，改为枚举 `missing_reasons`；
    - `claims` 只保留 `id + citation_ids`（不写 claim 文本）；
    - `ui_actions` 不提供 `label`（服务端按动作类型写死）。
    """

    mode: AnswerMode
    claims: list[ModelClaim] = Field(default_factory=list, max_length=50)
    evidence: list[Evidence] = Field(default_factory=list, max_length=50)
    related_event_ids: list[str] = Field(default_factory=list, max_length=5)
    missing_reasons: list[MissingReason] = Field(default_factory=list, max_length=10)
    reason_code: RefusalReason | None = None
    #: P1-2：Prompt 约定“最多 3 个动作”，Schema 同步收紧到 3（Validator 还会二次过滤）。
    ui_actions: list[ModelUIAction] = Field(default_factory=list, max_length=3)

    @model_validator(mode="after")
    def validate_mode_fields(self) -> ModelAnswer:
        if self.mode == "grounded":
            if not self.claims:
                raise ValueError("grounded 回答必须至少包含 1 条 claim")
            if self.reason_code is not None:
                raise ValueError("grounded 回答不应携带 reason_code")
            if self.missing_reasons:
                raise ValueError("grounded 回答不应携带 missing_reasons")
        if self.mode == "insufficient":
            if not self.missing_reasons:
                raise ValueError("insufficient 回答必须给出至少一个 missing_reasons")
            if self.reason_code is not None:
                raise ValueError("insufficient 回答不应携带 reason_code")
            if self.claims:
                raise ValueError("insufficient 回答不应包含 claim")
        if self.mode == "refusal":
            if self.reason_code is None:
                raise ValueError("refusal 回答必须提供 reason_code")
            if self.claims:
                raise ValueError("refusal 回答不应包含 claim")
            if self.missing_reasons:
                raise ValueError("refusal 回答不应携带 missing_reasons")
        return self


class FinalAnswer(AgentModel):
    """**服务端生成**的最终回答（进入 `AgentResult` / `AnswerEnvelope`）。

    与 `ModelAnswer` 的关键区别：

    - `markdown` 由服务端写死：grounded 用工具原文重写，insufficient / refusal 用固定模板；
    - `certainty` 由服务端按模式写死（grounded high/medium、insufficient low、refusal null）；
    - `missing` 由服务端生成（insufficient 用枚举映射文案，降级用服务端诊断原因）。

    模型无法构造这个结构，也就无法把任意历史陈述带进用户可见回答（P0-3）。
    """

    mode: AnswerMode
    markdown: str = Field(min_length=1, max_length=10000)
    certainty: Certainty | None = None
    claims: list[Claim] = Field(default_factory=list, max_length=50)
    evidence: list[Evidence] = Field(default_factory=list, max_length=50)
    related_event_ids: list[str] = Field(default_factory=list, max_length=5)
    missing: list[str] = Field(default_factory=list, max_length=10)
    reason_code: RefusalReason | None = None
    ui_actions: list[UIAction] = Field(default_factory=list, max_length=3)

    @model_validator(mode="after")
    def validate_mode_fields(self) -> FinalAnswer:
        if self.mode == "grounded":
            if not self.claims:
                raise ValueError("grounded 回答必须至少包含 1 条 claim")
            if self.reason_code is not None:
                raise ValueError("grounded 回答不应携带 reason_code")
            if self.missing:
                raise ValueError("grounded 回答不应携带 missing")
        if self.mode == "insufficient":
            if not self.missing:
                raise ValueError("insufficient 回答必须说明 missing")
            if self.reason_code is not None:
                raise ValueError("insufficient 回答不应携带 reason_code")
            if self.claims:
                raise ValueError("insufficient 回答不应包含 claim")
        if self.mode == "refusal":
            if self.reason_code is None:
                raise ValueError("refusal 回答必须提供 reason_code")
            if self.claims:
                raise ValueError("refusal 回答不应包含 claim")
        return self


class FinalStep(AgentModel):
    """模型单轮输出：给出最终回答（`ModelAnswer`，服务端再审）。"""

    action: Literal["final"] = "final"
    thought: str | None = Field(default=None, max_length=1000)
    answer: ModelAnswer


class ToolCallRecord(AgentModel):
    """一次工具执行的审计记录（进入 API 的 `trace.tools[]`）。"""

    name: str = Field(min_length=1, max_length=100)
    arguments: dict[str, Any] = Field(default_factory=dict)
    ok: bool
    hits: int | None = Field(default=None, ge=0)
    ms: int | None = Field(default=None, ge=0)
    error_code: str | None = Field(default=None, max_length=64)


class AgentResult(AgentModel):
    """Orchestrator 的最终产物；由 API 路由转换为 `AnswerEnvelope`。"""

    question: str = Field(min_length=1, max_length=2000)
    answer: FinalAnswer
    citations: list[Citation] = Field(default_factory=list, max_length=50)
    tools: list[ToolCallRecord] = Field(default_factory=list, max_length=10)
    model: str | None = Field(default=None, max_length=200)
    #: V1.0.5 高可用补丁：最终完成回答的模型（主模型降级时为备用轻量模型）。
    model_used: str | None = Field(default=None, max_length=200)
    #: V1.0.5.2：请求级手动选择的模型（None 表示使用后端默认主模型）。
    model_requested: str | None = Field(default=None, max_length=200)
    #: V1.0.5.2 双源覆盖观测：``{"timeline": bool, "graph": bool}``，映射到 `trace.sources`。
    source_coverage: dict[str, bool] | None = None
    latency_ms: int | None = Field(default=None, ge=0)
    steps: int = Field(default=0, ge=0, le=10)
    downgraded: bool = False
    downgrade_reason: str | None = Field(default=None, max_length=500)
    usage: dict[str, int] | None = None


__all__ = [
    "MISSING_REASON_TEXT",
    "AgentModel",
    "AgentResult",
    "AnswerMode",
    "Certainty",
    "Evidence",
    "EvidenceKind",
    "FinalAnswer",
    "FinalStep",
    "MissingReason",
    "ModelAnswer",
    "ModelClaim",
    "ModelUIAction",
    "RefusalReason",
    "ToolBatchStep",
    "ToolCall",
    "ToolCallRecord",
    "ToolCallStep",
    "UIAction",
]
