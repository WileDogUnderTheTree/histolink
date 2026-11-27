# 三份契约（V1.0 冻结）

> 状态：待评审（V1.0.1 / TC-04）
> 评审人：待评审（V1.0.1 评审会）
> 最后更新：2026-11-23

本目录是 V1.0 的**对外协议冻结物**。后端 `backend/contracts/` 是唯一手写事实源，
本目录下的文件除 `action-policy.json`、`samples/` 与本 README 外全部由脚本生成，
**禁止手改**；CI/门禁用 `--check` 防止过期。

## 1. 文件清单

| 文件 | 类型 | 生成方式 | 说明 |
|---|---|---|---|
| `api-v1.openapi.json` | 生成 | `cd backend; .\.venv\Scripts\python scripts\export_contracts.py` | OpenAPI 3.1，`info.version=1.0`；9 条路径 |
| `actions-v1.schema.json` | 生成 | 同上 | 动作信封 `UIAction` JSON Schema + `x-action-types` / `x-surfaces` / `x-availability` / `x-action-surface` 元数据 |
| `tools-v1.schema.json` | 生成 | 同上 | 9 个只读工具的入参/出参 JSON Schema |
| `action-policy.json` | **人工** | 手改 | 动作类型 → surface / 可用性 / 自动策略；`validate-contract.mjs` 校验覆盖 |
| `samples/*.json` | **人工** | 手改 | 契约样例：请求 / grounded 回答 / 错误 / 澄清 / 动作信封 / ping_llm；`validate-contract.mjs` 逐个校验 |
| `README.md` | **人工** | 手改 | 本文件：冻结规则、升级规则、字段清单 |

## 2. 生成与校验

```powershell
# 后端契约（在 backend 目录、使用 .venv）
cd backend
.\.venv\Scripts\python scripts\export_contracts.py
.\.venv\Scripts\python scripts\export_contracts.py --check

# 前端类型（仓库根目录）
node scripts/gen-frontend-types.mjs
node scripts/gen-frontend-types.mjs --check

# 契约测试（Node：schema / 策略覆盖 / 样例）
node scripts/validate-contract.mjs

# 后端 Pydantic 契约测试
cd backend
.\.venv\Scripts\python -m pytest
```

## 3. 版本规则（冻结）

1. V1.0 内只允许**新增可选字段**（`optional` / `default`），不得删改必填字段与枚举值；
2. 任何破坏性变更必须升 `SCHEMA_VERSION = "2.0"`（`backend/contracts/models.py`），
   同步改契约测试、`action-policy.json` 与评测夹具；
3. OpenAPI `info.version` 在 V1.0 内固定为 `1.0`，与 `API_VERSION`（实现版本）解耦；
4. 动作枚举的 `available` / `planned` 边界只能移动一次：V1.0.4 起 `planned` 转 `available`
   必须同步 `action-policy.json` 与前端策略单测；
5. 错误码冻结：`ENTITY_NOT_FOUND` / `AMBIGUOUS_ENTITY` / `INSUFFICIENT_EVIDENCE` /
   `OUT_OF_SCOPE` / `LLM_TIMEOUT` / `SNAPSHOT_MISMATCH` / `INTERNAL`；
   V1.0.1 只读 API 层（TC-06）追加 4 个统一 envelope 码：
   `INVALID_REQUEST`（400）/ `METHOD_NOT_ALLOWED`（405）/ `ROUTE_NOT_FOUND`（404）/
   `SNAPSHOT_NOT_LOADED`（503），均属新增枚举值，不改变既有语义。

## 4. 字段清单（V1.0 全量）

### 4.1 请求 `AskRequest`

- `question`、`session_id`、`history[]`（≤20 轮）、`client_schema_version="1.0"`；
- `context`：`route`（必填，`/` 开头）、`mode`（browse/detail/compare）、`dynasty`、
  `era_id`、`person_id`、`event_id`；
- 澄清回传：`clarification_id` + `selected_person_id`（必须成对，无状态实现）。

### 4.2 回答 `AnswerEnvelope`（`ok=true`）

- `request_id`、`schema_version`、`snapshot{version,hash,events?,persons?}`；
- `answer`：`markdown`、`mode`（`grounded` / `insufficient` / `refusal`）、
  `claims[]`（grounded 必填，每条至少绑定 1 个 citation）、`missing[]`（insufficient）、
  `reason_code`（refusal）、`related_event_ids[]`；
- `citations[]`：`kind`（event/relation/person）、`event_id/person_id/relation_id`、
  `title`、`year`、`quote`、`source_label`、`source_ref{label,book,chapter?,raw}`、
  **`attribution` 与 `license` 必填**（Q6）；
- `entities[]`、`ui_actions[]`、`trace{tools[],model,latency_ms}`；
- `answer` 与 `clarification` **恰好一个非空**；grounded 至少 1 条 citation，
  且 claim 的 `citation_ids` 必须在 `citations[].id` 中存在。

### 4.3 澄清 `Clarification`

- `id`、`type="entity"`、`question`、`candidates[2..5]`；
- 每个候选：`person_id`、`name`、`disambiguator`、`era_ids[]`、`hint`；
- 前端禁止默认选中第一条；用户选择后带 `clarification_id` + `selected_person_id` 重发。

### 4.4 错误 `ErrorEnvelope`（`ok=false`）

- `request_id`、`error{code,message,retryable,details?}`；`code` 见 §3 冻结列表。

### 4.5 动作 `UIAction`

- 信封：`id`（幂等键）、`type`、`payload`、`target{surface,params?}`、`auto`、`label`、`reason?`；
- `target.surface` 仅允许 `timeline | graph | ask`；
- V1.0 可用：`timeline.focus_event`、`timeline.focus_dynasty`、`graph.focus_person`、
  `graph.focus_relation`、`ask.suggest`；planned：`timeline.highlight_events`、
  `graph.highlight_persons`、`open.event_card`、`open.person_card`；
- 同页自动 / 跨页确认由**前端**按 `target.surface === 当前路由` 强制判定，
  服务端 `auto` 只是建议值（Q2）。

### 4.6 只读数据接口（V1.0.1 实现）

`GET /api/health`、`GET /api/meta`、`GET /api/entities/person/{person_id}`、
`GET /api/entities/event/{event_id}`、`GET /api/entities/persons?name=&era_id=&limit=`、
`POST /api/agent/ask`、`GET /api/agent/models`（V1.0.5.2 模型注册表）、
`GET /api/agent/ping_llm?message=`（TC-10 连通性探测，返回 `PingLLMResponse`；模型未配置 503
`LLM_NOT_CONFIGURED`，上游错误 502 `LLM_UPSTREAM_ERROR`，超时 504 `LLM_TIMEOUT`）。
> 注：`GET /api/search/events` 目前仅存在于冻结契约 / 契约桩中，运行实现未挂载
> （V1.0.5.3 体检 finding F-14，排期 V1.0.6 补齐或从契约移除）。
所有响应带 `ok`、`request_id`（ask）或 `schema_version` 与 `snapshot`（数据接口）。

V1.0.6 起新增会话管理（`GET/POST /api/sessions`、`GET/PATCH/DELETE /api/sessions/{session_id}`）
与流式直答 `POST /api/agent/chat_stream`（SSE）；V1.0.8 起新增点赞计数
`GET /api/likes`（读取总数）与 `POST /api/likes`（+1 并返回最新总数，`LikeCountResponse`，
持久化 `backend/data/likes.json`）。以上均为只增不改的可选接口。

### 4.7 工具契约

9 个只读工具：`resolve_entity`、`search_events`、`get_event`、`get_person`、
`get_person_events`、`get_relation`、`get_era_graph`、`timeline_span`、
`search_historical_text`（V1.0.5 RAG 混合检索）；
只读、有界（`limit` 上限）、返回 ID、空结果有明确语义。工具不暴露给浏览器（除 dev 调试）。

V1.0.2 起（产品批复），工具契约的 `output` 升级为 `ToolResult` **统一返回信封**：
`ok/tool/items/citations/truncated/snapshot_version/data/error/meta`，成功 / 失败用 `oneOf`
表达；V1.0.1 的工具专属出参原样收进 `data`，因此**数据字段零丢失**。
`items/citations/truncated/snapshot_version` 是 V1.0.2 新增字段；实现侧同步在
`contracts/models.py::ToolResult` 上以可选字段落地。该变更已按产品批复重新导出
`tools-v1.schema.json`（见 `export_contracts.py --check`）。
详细口径见 [../docs/V1.0.2-工具层设计.md](../docs/V1.0.2-工具层设计.md)。

## 5. 与任务卡的差异记录

- `actions-v1.schema.json` 顶层对象直接是 `UIAction` 的 JSON Schema（可逐个校验动作样例），
  枚举与可用性以 `x-*` 扩展字段附带，避免另造一层不能直接校验的包装；
- `tools-v1.schema.json` 使用 `tools[]` 数组承载 9 个工具，每个工具内嵌 `input` / `output`
  JSON Schema，便于逐工具校验；
- `contracts/samples/` 为 TC-04 新增的契约样例目录（任务卡未列，属于验收所需）。
