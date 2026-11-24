"""三份契约的 Pydantic 事实源（冻结于 V1.0.1 / TC-04）。

本模块是 API / 动作 / 工具三份契约的**唯一手写事实源**：
- `contracts/api-v1.openapi.json` 由 `backend/scripts/export_contracts.py` 从这里导出；
- `contracts/actions-v1.schema.json` 由 `UIAction` 的 JSON Schema 导出；
- 前端 `frontend/lib/api-types.ts` 由 OpenAPI 生成（openapi-typescript），不手写。

版本规则（冻结）：
- V1.0 内只允许**新增可选字段**；
- 任何破坏性变更必须升 `SCHEMA_VERSION = "2.0"`，并同步契约测试与导出物。

字段来源：审核报告 §5.3（请求/回答/错误/澄清草案）+ §8.1（Q1–Q6 决策）。
"""

from __future__ import annotations

from enum import Enum
from typing import Annotated, Any, Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator

from contracts.action_types import UIActionType, UISurface

#: 当前 API 契约版本；`AskRequest.client_schema_version` 必须与之一致。
SCHEMA_VERSION = "1.0"
#: API 版本（与 backend/main.py 的 APP_VERSION 对应关系见 contracts/README.md）。
API_VERSION = "1.0.5.2"

#: 引用许可（Q6）：非商用，沿用 shiji-kb 的 CC BY-NC-SA。
ATTRIBUTION_TEXT = "史脉事件摘要（依据 shiji-kb，CC BY-NC-SA 4.0）"
LICENSE_TEXT = "CC BY-NC-SA 4.0"


class StrictModel(BaseModel):
    """契约基类：禁止未声明字段，避免前后端拼写错误被静默接受。"""

    model_config = ConfigDict(
        extra="forbid",
        str_strip_whitespace=True,
    )


# ---------------------------------------------------------------------------
# 请求：上下文 / 会话 / 澄清回传
# ---------------------------------------------------------------------------


class AskMode(str, Enum):
    """当前页面模式（由前端按视图推导后放入 context）。"""

    BROWSE = "browse"
    DETAIL = "detail"
    COMPARE = "compare"


class AskContext(StrictModel):
    """页面上下文；服务端只据此做实体收敛与动作判定，不据此渲染。"""

    route: str = Field(
        min_length=1,
        max_length=512,
        pattern=r"^/",
        description="当前页面路由，例如 /timeline；Q1 的深链接与 Q5 的实体收敛都依赖它。",
    )
    mode: AskMode | None = None
    dynasty: str | None = Field(default=None, max_length=50)
    era_id: str | None = Field(default=None, max_length=64)
    person_id: str | None = Field(default=None, max_length=128)
    event_id: str | None = Field(default=None, max_length=128)


class ConversationTurn(StrictModel):
    role: Literal["user", "assistant"]
    content: str = Field(min_length=1, max_length=4000)


class AskRequest(StrictModel):
    """POST /api/agent/ask 的请求体。"""

    question: str = Field(min_length=1, max_length=2000)
    session_id: str = Field(min_length=1, max_length=128)
    history: list[ConversationTurn] = Field(default_factory=list, max_length=20)
    context: AskContext
    client_schema_version: Literal["1.0"] = "1.0"
    #: Q5：用户从候选列表选择后回传，服务端无需缓存澄清会话（无状态）。
    clarification_id: str | None = Field(default=None, max_length=128)
    selected_person_id: str | None = Field(default=None, max_length=128)
    #: V1.0.5.2：请求级模型选择（`GET /api/agent/models` 返回的 id）；为空时使用主模型。
    #: 手动选择后自动降级仍生效（所选模型异常时切换到另一款模型）。
    model_id: str | None = Field(default=None, max_length=200)

    @model_validator(mode="after")
    def validate_clarification_reply(self) -> AskRequest:
        if self.clarification_id is None and self.selected_person_id is not None:
            raise ValueError("selected_person_id 必须与 clarification_id 一起提交")
        return self


# ---------------------------------------------------------------------------
# 快照 / 引用 / 回答
# ---------------------------------------------------------------------------


class SnapshotMeta(StrictModel):
    """回答里携带的快照版本；前端据此判断是否降级为纯文字。"""

    version: str = Field(min_length=1, max_length=64)
    hash: str = Field(pattern=r"^sha256:[0-9a-f]{64}$")
    events: int | None = Field(default=None, ge=0)
    persons: int | None = Field(default=None, ge=0)


class SourceRefModel(StrictModel):
    """结构化引用（与 frontend/data/source-types.ts 对齐）。"""

    label: str = Field(min_length=1, max_length=200)
    book: str = Field(min_length=1, max_length=100)
    chapter: str | None = Field(default=None, max_length=200)
    raw: str = Field(min_length=1, max_length=500)


class Citation(StrictModel):
    """引用条目；Q6 要求每条都带 attribution 与 license。

    V1.0.5 起新增可选 ``kind="rag"``（RAG 史料 chunk）与 ``record_type``：
    - ``id`` 即 RAG chunk_id；``event_id`` 为对齐到的图谱事件（可能为空）；
    - ``quote`` 为 chunk 正文（工具层已截断到 ≤300 字）；
    - ``record_type`` 区分「正史 / 传说」，供前端与 Agent 标注 ``[传说]``；
    - 对既有 event / relation / person 引用完全向后兼容（新增字段均可选）。
    """

    id: str = Field(min_length=1, max_length=64)
    kind: Literal["event", "relation", "person", "rag"]
    event_id: str | None = Field(default=None, max_length=128)
    person_id: str | None = Field(default=None, max_length=128)
    relation_id: str | None = Field(default=None, max_length=256)
    title: str = Field(min_length=1, max_length=300)
    year: int | None = None
    dynasty: str | None = Field(default=None, max_length=50)
    quote: str | None = Field(default=None, max_length=2000)
    source_label: str | None = Field(default=None, max_length=200)
    source_ref: SourceRefModel | None = None
    attribution: str = Field(min_length=1, max_length=300)
    license: Literal["CC BY-NC-SA 4.0"] = "CC BY-NC-SA 4.0"
    #: RAG 史料专用（V1.0.5 新增可选）：正史 / 传说；其它引用为 null。
    record_type: Literal["正史", "传说"] | None = None


class Claim(StrictModel):
    """回答中的单条事实陈述；grounded 模式下必须绑定引用。"""

    id: str = Field(min_length=1, max_length=64)
    text: str = Field(min_length=1, max_length=1000)
    citation_ids: list[str] = Field(min_length=1, max_length=20)


class AnswerMode(str, Enum):
    """Q4：三态回答。"""

    GROUNDED = "grounded"
    INSUFFICIENT = "insufficient"
    REFUSAL = "refusal"


class Answer(StrictModel):
    markdown: str = Field(min_length=1, max_length=10000)
    mode: AnswerMode
    claims: list[Claim] = Field(default_factory=list, max_length=50)
    certainty: Literal["high", "medium", "low"] | None = None
    #: insufficient 专用：缺什么资料。
    missing: list[str] = Field(default_factory=list, max_length=10)
    #: refusal 专用：固定拒答码。
    reason_code: Literal["OUT_OF_SCOPE", "UNSAFE_REQUEST", "NO_RELIABLE_BASIS"] | None = None
    #: insufficient 专用：相关但不是答案的条目（前端须明确标注）。
    related_event_ids: list[str] = Field(default_factory=list, max_length=5)

    @model_validator(mode="after")
    def validate_mode_fields(self) -> Answer:
        if self.mode == AnswerMode.GROUNDED:
            if not self.claims:
                raise ValueError("grounded 回答必须至少包含 1 条 claim")
            if self.reason_code is not None:
                raise ValueError("grounded 回答不应携带 reason_code")
        if self.mode == AnswerMode.INSUFFICIENT:
            if self.reason_code is not None:
                raise ValueError("insufficient 回答不应携带 reason_code")
            if not self.missing:
                raise ValueError("insufficient 回答必须说明 missing")
        if self.mode == AnswerMode.REFUSAL:
            if self.reason_code is None:
                raise ValueError("refusal 回答必须提供 reason_code")
            if self.claims:
                raise ValueError("refusal 回答不应包含 claim")
        return self


# ---------------------------------------------------------------------------
# 实体 / 澄清
# ---------------------------------------------------------------------------


class Entity(StrictModel):
    kind: Literal["person", "event", "relation"]
    person_id: str | None = Field(default=None, max_length=128)
    event_id: str | None = Field(default=None, max_length=128)
    name: str | None = Field(default=None, max_length=100)
    title: str | None = Field(default=None, max_length=300)
    disambiguator: str | None = Field(default=None, max_length=100)
    era_ids: list[str] = Field(default_factory=list, max_length=10)


class ClarificationCandidate(StrictModel):
    """Q5 候选；前端不得默认选中第一条。"""

    person_id: str = Field(min_length=1, max_length=128)
    name: str = Field(min_length=1, max_length=100)
    disambiguator: str = Field(min_length=1, max_length=100)
    era_ids: list[str] = Field(default_factory=list, max_length=10)
    hint: str | None = Field(default=None, max_length=200)


class Clarification(StrictModel):
    id: str = Field(min_length=1, max_length=128)
    type: Literal["entity"] = "entity"
    question: str = Field(min_length=1, max_length=500)
    candidates: list[ClarificationCandidate] = Field(min_length=2, max_length=5)


# ---------------------------------------------------------------------------
# 动作信封
# ---------------------------------------------------------------------------


class UIActionTarget(StrictModel):
    """动作目标；前端据此判定同页 / 跨页（Q2），不信任后端 auto。"""

    surface: UISurface
    params: dict[str, str | int | float | bool | None] = Field(default_factory=dict, max_length=30)


class UIAction(StrictModel):
    """动作信封（冻结字段：id/type/payload/target/auto/label/reason）。"""

    id: str = Field(min_length=1, max_length=128, description="幂等键：同一次 request_id 内只执行一次")
    type: UIActionType
    payload: dict[str, Any] = Field(default_factory=dict)
    target: UIActionTarget
    auto: bool = Field(default=False, description="仅建议值；跨页由前端强制覆盖为需确认")
    label: str = Field(min_length=1, max_length=200)
    reason: str | None = Field(default=None, max_length=300)


# ---------------------------------------------------------------------------
# 回答信封 / 错误信封
# ---------------------------------------------------------------------------


class ToolTrace(StrictModel):
    name: str = Field(min_length=1, max_length=100)
    args: dict[str, Any] = Field(default_factory=dict)
    hits: int | None = Field(default=None, ge=0)
    ms: int | None = Field(default=None, ge=0)


class Trace(StrictModel):
    tools: list[ToolTrace] = Field(default_factory=list, max_length=20)
    model: str | None = Field(default=None, max_length=100)
    #: V1.0.5 高可用补丁（只增可选）：最终完成回答的模型名。
    #: 主模型（Qwen3.5-35B-A3B）遇到 429/502/504/超时会自动切换备用轻量模型，
    #: 前端据此在回答下方提示「已切换至轻量模型」；正常情况等于主模型名。
    model_used: str | None = Field(default=None, max_length=200)
    #: V1.0.5.2 请求级模型选择（只增可选）：用户手动选择的模型 id；null 表示使用默认主模型。
    model_requested: str | None = Field(default=None, max_length=200)
    #: V1.0.5.2 双数据源覆盖（只增可选）：`{"timeline": bool, "graph": bool}`。
    #: grounded 回答据此证明「时间轴·大事记」与「人物关系图」两源各覆盖到哪些；
    #: insufficient / refusal / 兜底降级时为 false。
    sources: dict[str, bool] | None = None
    latency_ms: int | None = Field(default=None, ge=0)


class AnswerEnvelope(StrictModel):
    """成功响应；`answer` 与 `clarification` 恰好一个非空。"""

    ok: Literal[True] = True
    request_id: str = Field(min_length=1, max_length=128)
    schema_version: Literal["1.0"] = SCHEMA_VERSION
    snapshot: SnapshotMeta
    answer: Answer | None = None
    clarification: Clarification | None = None
    citations: list[Citation] = Field(default_factory=list, max_length=50)
    entities: list[Entity] = Field(default_factory=list, max_length=20)
    ui_actions: list[UIAction] = Field(default_factory=list, max_length=20)
    trace: Trace | None = None

    @model_validator(mode="after")
    def validate_envelope(self) -> AnswerEnvelope:
        if self.answer is None and self.clarification is None:
            raise ValueError("answer 与 clarification 至少提供一个")
        if self.answer is not None and self.clarification is not None:
            raise ValueError("answer 与 clarification 互斥，不能同时出现")
        if self.answer is not None and self.answer.mode == AnswerMode.GROUNDED:
            if not self.citations:
                raise ValueError("grounded 回答必须至少包含 1 条 citation")
            citation_ids = {citation.id for citation in self.citations}
            for claim in self.answer.claims:
                missing = [citation_id for citation_id in claim.citation_ids if citation_id not in citation_ids]
                if missing:
                    raise ValueError(f"claim {claim.id} 引用了不存在的 citation：{missing}")
        if self.clarification is not None and not self.ui_actions:
            # 澄清不是页面动作，ui_actions 应保持为空；留此分支只为显式允许空列表。
            pass
        return self


class ErrorCode(str, Enum):
    """冻结错误码（审核报告 §5.7 + TC-06 只读 API 层补充）。"""

    ENTITY_NOT_FOUND = "ENTITY_NOT_FOUND"
    AMBIGUOUS_ENTITY = "AMBIGUOUS_ENTITY"
    INSUFFICIENT_EVIDENCE = "INSUFFICIENT_EVIDENCE"
    OUT_OF_SCOPE = "OUT_OF_SCOPE"
    LLM_TIMEOUT = "LLM_TIMEOUT"
    SNAPSHOT_MISMATCH = "SNAPSHOT_MISMATCH"
    INTERNAL = "INTERNAL"

    # ---- V1.0.1 只读 API 层（TC-06）：统一 envelope 需要显式区分 ----
    INVALID_REQUEST = "INVALID_REQUEST"
    METHOD_NOT_ALLOWED = "METHOD_NOT_ALLOWED"
    ROUTE_NOT_FOUND = "ROUTE_NOT_FOUND"
    SNAPSHOT_NOT_LOADED = "SNAPSHOT_NOT_LOADED"

    # ---- V1.0.1 LLM 连通性探测（TC-10） ----
    LLM_NOT_CONFIGURED = "LLM_NOT_CONFIGURED"
    LLM_UPSTREAM_ERROR = "LLM_UPSTREAM_ERROR"


class ErrorInfo(StrictModel):
    code: ErrorCode
    message: str = Field(min_length=1, max_length=500)
    retryable: bool = False
    details: dict[str, Any] | None = None


class ErrorEnvelope(StrictModel):
    ok: Literal[False] = False
    request_id: str = Field(min_length=1, max_length=128)
    error: ErrorInfo


#: 对外响应联合：`ok` 为判别字段。
AgentResponse = Annotated[
    AnswerEnvelope | ErrorEnvelope,
    Field(discriminator="ok"),
]


# ---------------------------------------------------------------------------
# 只读数据接口（TC-06 使用；V1.0.1 先冻结字段）
# ---------------------------------------------------------------------------


class HealthResponse(StrictModel):
    ok: Literal[True] = True
    version: str = API_VERSION


class PingLLMResponse(StrictModel):
    """LLM 连通性探测结果（TC-10）：只用于验证网关/模型可用性，不进入问答链路。"""

    ok: Literal[True] = True
    message: str = Field(min_length=1, max_length=200, description="发给模型的测试语句")
    reply: str = Field(min_length=1, max_length=2000, description="模型真实回复")
    model: str = Field(min_length=1, max_length=200, description="实际使用的模型名")
    latency_ms: int = Field(ge=0, description="端到端耗时（毫秒）")
    usage: dict[str, int] | None = Field(default=None, description="上游返回的 token 用量（若有）")


class ModelOptionResponse(StrictModel):
    """模型注册表条目（V1.0.5.2 新增，只增可选接口）。

    - `id`：前端切换后随 `AskRequest.model_id` 回传的模型标识（与上游模型名逐字一致）；
    - `name`：展示用模型全称；
    - `role`：`primary`（默认主模型）/ `fallback`（备用降级模型）；
    - `description`：下拉项副标题说明。
    """

    id: str = Field(min_length=1, max_length=200)
    name: str = Field(min_length=1, max_length=200)
    role: Literal["primary", "fallback"]
    description: str | None = Field(default=None, max_length=300)


class ModelsResponse(StrictModel):
    """`GET /api/agent/models`：供前端模型切换窗口渲染，无需配置 API key 即可读取。"""

    ok: Literal[True] = True
    schema_version: Literal["1.0"] = SCHEMA_VERSION
    api_version: str = API_VERSION
    default_model_id: str = Field(min_length=1, max_length=200)
    models: list[ModelOptionResponse] = Field(min_length=1, max_length=2)


class MetaCounts(StrictModel):
    events: int = Field(ge=0)
    persons: int = Field(ge=0)
    relations: int = Field(ge=0)
    eras: int = Field(ge=0)
    scopes: int = Field(ge=0)
    groups: int = Field(ge=0)
    aliases: int = Field(ge=0)


class MetaSnapshot(StrictModel):
    version: str = Field(min_length=1, max_length=64)
    hash: str = Field(pattern=r"^sha256:[0-9a-f]{64}$")
    counts: MetaCounts


class Capabilities(StrictModel):
    actions: list[UIActionType] = Field(default_factory=list)
    clarification: bool = True


class MetaResponse(StrictModel):
    ok: Literal[True] = True
    schema_version: Literal["1.0"] = SCHEMA_VERSION
    api_version: str = API_VERSION
    snapshot: MetaSnapshot
    capabilities: Capabilities


class EventSummary(StrictModel):
    event_id: str = Field(min_length=1, max_length=128)
    title: str = Field(min_length=1, max_length=300)
    dynasty: str = Field(min_length=1, max_length=50)
    year: int
    importance: int | None = Field(default=None, ge=1, le=3)


class ApiPerson(StrictModel):
    person_id: str = Field(min_length=1, max_length=128)
    display_name: str = Field(min_length=1, max_length=100)
    romanized: str = Field(min_length=1, max_length=100)
    disambiguator: str = Field(min_length=1, max_length=100)
    aliases: list[str] = Field(default_factory=list, max_length=20)
    primary_dynasty: str = Field(min_length=1, max_length=50)
    dynasties: list[str] = Field(default_factory=list, max_length=10)
    era_ids: list[str] = Field(default_factory=list, max_length=20)
    scope_ids: list[str] = Field(default_factory=list, max_length=10)
    first_year: int
    last_year: int
    events: list[EventSummary] = Field(default_factory=list, max_length=50)


class PersonResponse(StrictModel):
    ok: Literal[True] = True
    schema_version: Literal["1.0"] = SCHEMA_VERSION
    snapshot: SnapshotMeta
    person: ApiPerson


class EventSurface(StrictModel):
    timeline: bool
    graph: bool


class ApiEvent(StrictModel):
    event_id: str = Field(min_length=1, max_length=128)
    title: str = Field(min_length=1, max_length=300)
    dynasty: str = Field(min_length=1, max_length=50)
    year: int
    description: str = Field(min_length=1, max_length=4000)
    importance: int | None = Field(default=None, ge=1, le=3)
    is_special: bool = False
    person_ids: list[str] = Field(default_factory=list, max_length=50)
    source_refs: list[SourceRefModel] = Field(default_factory=list, max_length=10)
    source_status: Literal["cited", "easter_egg"] = "cited"
    surface: EventSurface


class EventResponse(StrictModel):
    ok: Literal[True] = True
    schema_version: Literal["1.0"] = SCHEMA_VERSION
    snapshot: SnapshotMeta
    event: ApiEvent


class PersonCandidate(StrictModel):
    person_id: str = Field(min_length=1, max_length=128)
    display_name: str = Field(min_length=1, max_length=100)
    disambiguator: str = Field(min_length=1, max_length=100)
    primary_dynasty: str = Field(min_length=1, max_length=50)
    era_ids: list[str] = Field(default_factory=list, max_length=20)
    hint: str | None = Field(default=None, max_length=200)


class PersonCandidatesResponse(StrictModel):
    ok: Literal[True] = True
    schema_version: Literal["1.0"] = SCHEMA_VERSION
    snapshot: SnapshotMeta
    query: str = Field(min_length=1, max_length=100)
    candidates: list[PersonCandidate] = Field(default_factory=list, max_length=20)


class EventSearchResponse(StrictModel):
    ok: Literal[True] = True
    schema_version: Literal["1.0"] = SCHEMA_VERSION
    snapshot: SnapshotMeta
    query: str = Field(min_length=1, max_length=200)
    results: list[ApiEvent] = Field(default_factory=list, max_length=50)


# ---------------------------------------------------------------------------
# 工具契约（V1.0.2 实现；TC-04 先冻结入参/出参）
# ---------------------------------------------------------------------------


class ToolError(StrictModel):
    code: ErrorCode
    message: str = Field(min_length=1, max_length=500)


class ToolResult(StrictModel):
    """工具统一返回：只读、有界、返回 ID、空结果有明确语义。

    V1.0.2（工具层）在冻结信封上**只新增可选字段**（`contracts/README.md` §3 版本规则）：
    - `items`：主结果列表（与 `data` 中的主结果一致，便于规划器统一消费）；
    - `citations`：本次结果可用的结构化引用（`Citation`，关系类引用只指向共同事件书目）；
    - `truncated`：主结果是否因 `limit` / 图谱上限被裁剪；
    - `snapshot_version`：结果对应的快照版本（内容寻址，可回查）。
    以上字段对 V1.0.1 既有调用方均为可选，不构成破坏性变更。
    """

    ok: bool
    tool: str = Field(min_length=1, max_length=100)
    data: Any = None
    error: ToolError | None = None
    meta: dict[str, Any] = Field(default_factory=dict)

    # ---- V1.0.2 新增可选字段：统一返回格式 ----
    items: list[Any] = Field(default_factory=list, max_length=80)
    citations: list[Citation] = Field(default_factory=list, max_length=50)
    truncated: bool = False
    snapshot_version: str | None = Field(default=None, max_length=64)

    @model_validator(mode="after")
    def validate_tool_result(self) -> ToolResult:
        if not self.ok and self.error is None:
            raise ValueError("ok=false 的 ToolResult 必须提供 error")
        if self.ok and self.error is not None:
            raise ValueError("ok=true 的 ToolResult 不应携带 error")
        return self
