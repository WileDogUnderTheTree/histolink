/**
 * Agent 数据层（V1.0.4；V1.0.5.2 模型注册表 + 请求级模型选择；V1.0.5.4 对比分析块；
 * V1.0.6.1 markdown 生成权解绑 + 双重事实核查观测）。
 *
 * 只做「纯函数 + 一次 fetch」，不依赖 React：
 * - 把页面上下文 / transcript / 选中模型组装成 `POST /api/agent/ask` 请求体；
 * - 调用同源代理（`next.config.ts` 已把 `/api/*` 转发到 FastAPI）；
 * - 读取 `GET /api/agent/models` 模型注册表，供输入框左上角的模型切换窗口使用；
 * - 把 `AnswerEnvelope` 归一化成抽屉可直接渲染的 `AgentAnswerView`（含可选对比分析块）。
 *
 * 安全约定：前端只展示服务端返回的 `answer.markdown` / 结构化字段，不拼接、不改写回答文本。
 * V1.0.6.1 起 `markdown` 由模型生成，服务端已做**双重事实核查**（证据级 + 文本级 FactCheck）后
 * 才会下发；`trace.fact_check` 仅用于展示核查状态，不参与任何文本改写。
 */
import type { components } from "@/lib/api-types";

export type AskRequest = components["schemas"]["AskRequest"];
export type AskContext = components["schemas"]["AskContext"];
export type AskMode = components["schemas"]["AskMode"];
export type ConversationTurn = components["schemas"]["ConversationTurn"];
export type Answer = components["schemas"]["Answer"];
export type Citation = components["schemas"]["Citation"];
export type Entity = components["schemas"]["Entity"];
export type UIAction = components["schemas"]["UIAction"];
/** V1.0.5.4：二次归纳对比分析块（V1.0.6.1 起后端恒为 null，保留兼容）。 */
export type ComparisonAnalysis = components["schemas"]["ComparisonAnalysis"];
/** V1.0.6.1：文本级事实核查观测（`trace.fact_check`）。 */
export type FactCheckTrace = components["schemas"]["FactCheckTrace"];
/** V1.0.5.2：模型注册表条目（`GET /api/agent/models`）。 */
export type ModelOption = components["schemas"]["ModelOptionResponse"];
export type ModelsResponse = components["schemas"]["ModelsResponse"];

/** 生成物把 `const true` 误生成为字符串字面量，这里按运行时真实形状重新声明。 */
export type AnswerEnvelope = Omit<components["schemas"]["AnswerEnvelope"], "ok"> & {
  ok: true;
};
export type ErrorEnvelope = Omit<components["schemas"]["ErrorEnvelope"], "ok"> & {
  ok: false;
};
export type AgentResponse = AnswerEnvelope | ErrorEnvelope;

/** 双数据源覆盖观测（V1.0.5.2，来自 `trace.sources`）。 */
export interface AnswerSources {
  timeline: boolean;
  graph: boolean;
}

/** V1.0.6.1：文本级事实核查状态（来自 `trace.fact_check`）。 */
export interface AgentFactCheckView {
  status: FactCheckTrace["status"];
  /** blocking 问题列表（触发重写 / 回退的原因）；正常通过时为空。 */
  issues: string[];
}

/** 抽屉渲染所需的回答视图（已从信封中归一化）。 */
export interface AgentAnswerView {
  mode: Answer["mode"];
  markdown: string;
  certainty: Answer["certainty"] | null;
  missing: string[];
  reasonCode: Answer["reason_code"] | null;
  citations: Citation[];
  entities: Entity[];
  uiActions: UIAction[];
  snapshotVersion: string;
  requestId: string;
  /** V1.0.5 高可用补丁：最终完成回答的模型名（null 表示后端未上报）。 */
  modelUsed: string | null;
  /** V1.0.5.2：本次请求手动选择的模型 id（null 表示使用默认主模型）。 */
  modelRequested: string | null;
  /** V1.0.5.2：双数据源覆盖观测（null 表示后端未上报）。 */
  sources: AnswerSources | null;
  /**
   * V1.0.5.4：服务端二次归纳产出的对比分析块（V1.0.6.1 起恒为 null，仅保留兼容）。
   *
   * 与 `markdown`（V1.0.6.1 起为模型生成 + 双重核查后的正文）严格分离；
   * 后端校验失败 / 二次模型调用失败时该字段为 null（前端不显示分析块）。
   */
  comparisonAnalysis: ComparisonAnalysis | null;
  /**
   * V1.0.6.1：文本级事实核查状态（可选，旧快照 / 旧后端没有该字段）。
   *
   * - `passed`：模型正文通过文本级核查，已原样展示；
   * - `fallback` / `server_fallback`：已回退服务端事实实证正文（正文仍可信，但无分析深度）；
   * - `skipped` / 缺省：本轮未做文本级核查（insufficient / refusal / 旧数据）。
   */
  factCheck?: AgentFactCheckView | null;
  /**
   * V1.0.6.2：是否「逐字回答」直答链路的回答（可选）。
   *
   * 直答不跑工具 / 不做证据校验，因此：
   * - 不展示「已核验 / N 条可核验来源」徽标，改为「逐字直答」；
   * - `uiActions` 由服务端**意图后置推断**（快照实体匹配）补出，用于自动展开右侧史引；
   * - 刷新后服务端按纯 Markdown 消息恢复（该字段只存在于本标签页 transcript）。
   */
  streamed?: boolean;
}

/** transcript 里可参与历史的最小结构（与 React 状态解耦）。 */
export interface AgentTranscriptTurn {
  role: "user" | "assistant";
  content: string;
  /** 欢迎语 / 错误提示不进入下一轮 history。 */
  skipHistory?: boolean;
}

export const WELCOME_TURN_ID = "turn-welcome";
export const MAX_HISTORY_TURNS = 10;
export const MAX_HISTORY_CONTENT = 4000;
export const MAX_QUESTION_LENGTH = 2000;
export const RATE_LIMIT_MESSAGE = "史令查阅太频繁啦，请稍等几秒再问哦～";

/**
 * V1.0.5 高可用补丁 / V1.0.5.2 双向降级：所选模型被限流 / 网关错误 / 超时后，
 * 后端会自动切换另一款模型完成回答，并在 `trace.model_used` 里标明最终模型。
 * 前端识别到「实际模型 ≠ 所选模型」时，在回答下方补一行轻提示。
 */
export const MODEL_FALLBACK_HINT = "当前网络繁忙，史令已切换至另一款模型回答";
/** 主模型名（Qwen3.5-35B-A3B）的特征标记；未手动选择模型时用它判断是否降级。 */
const PRIMARY_MODEL_MARKER = /35B/i;

/**
 * 是否需要展示「已切换模型」提示（V1.0.5.2）。
 *
 * - 传了 `requestedModel`（用户手动选择的模型）：实际模型与之不同即提示；
 * - 未传（默认主模型）：沿用 V1.0.5 的 35B 特征标记判断。
 */
export function shouldShowModelFallbackHint(
  modelUsed: string | null | undefined,
  requestedModel?: string | null,
): boolean {
  const name = modelUsed?.trim();
  if (!name) return false;
  const requested = requestedModel?.trim();
  if (requested) return name !== requested;
  return !PRIMARY_MODEL_MARKER.test(name);
}

/**
 * 服务端不可达时的静态模型注册表（V1.0.5.2 兜底）。
 *
 * 只用于「后端未启动 / 接口暂时失败」时仍能渲染切换按钮，不改变任何降级逻辑；
 * 与 `backend/llm_client.py` 的 `DEFAULT_MODEL` / `DEFAULT_FALLBACK_MODEL` 保持一致。
 */
export const FALLBACK_MODEL_OPTIONS: ModelOption[] = [
  {
    id: "Qwen/Qwen3.5-35B-A3B",
    name: "Qwen/Qwen3.5-35B-A3B",
    role: "primary",
    description: "主模型：推理能力更强，默认使用",
  },
  {
    id: "Qwen/Qwen3.5-8B-Instruct",
    name: "Qwen/Qwen3.5-8B-Instruct",
    role: "fallback",
    description: "备用降级模型：限流 / 超时时自动接管",
  },
];

/** 模型注册表读取结果（`fromFallback=true` 表示后端不可达，用了静态兜底表）。 */
export interface AgentModelsState {
  models: ModelOption[];
  defaultModelId: string;
  fromFallback: boolean;
}

const MAX_CONTEXT_ID_LENGTH = 128;

export class AgentClientError extends Error {
  readonly status: number | null;

  constructor(message: string, options: { status?: number; cause?: unknown } = {}) {
    super(message);
    this.name = "AgentClientError";
    this.status = options.status ?? null;
    if (options.cause !== undefined) {
      this.cause = options.cause;
    }
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function readQuery(search: string, key: string, maxLength = MAX_CONTEXT_ID_LENGTH): string | null {
  const params = new URLSearchParams(search.startsWith("?") ? search.slice(1) : search);
  const value = params.get(key)?.trim();
  if (!value) return null;
  return value.slice(0, maxLength);
}

/**
 * 从「当前路由 + query」推导 `AskContext`。
 *
 * 注意：`person_id` 只在 query 里确实是稳定 ID（`p-` 前缀）时才上报；
 * 图谱 URL 里的 `person` 可能是姓名 / 别名，不能冒充 person_id。
 */
export function readPageContext(pathname: string, search: string): AskContext {
  const route = pathname.trim() || "/";
  const modeParam = readQuery(search, "mode");
  const mode: AskMode = modeParam === "detail" ? "detail" : "browse";
  const context: AskContext = { route, mode };

  const dynasty = readQuery(search, "dynasty");
  if (dynasty) context.dynasty = dynasty;
  const era = readQuery(search, "era");
  if (era) context.era_id = era;
  const event = readQuery(search, "event");
  if (event) context.event_id = event;
  const person = readQuery(search, "person");
  if (person && person.startsWith("p-")) context.person_id = person;

  return context;
}

/** 过滤欢迎语 / 错误提示，截断超长内容，最多保留最近 `maxTurns` 轮。 */
export function historyFromTranscript(
  turns: readonly AgentTranscriptTurn[],
  options: { maxTurns?: number } = {},
): ConversationTurn[] {
  const maxTurns = options.maxTurns ?? MAX_HISTORY_TURNS;
  const history: ConversationTurn[] = [];
  for (const turn of turns) {
    if (turn.skipHistory) continue;
    const content = turn.content.trim();
    if (!content) continue;
    if (turn.role !== "user" && turn.role !== "assistant") continue;
    history.push({ role: turn.role, content: content.slice(0, MAX_HISTORY_CONTENT) });
  }
  return history.slice(-maxTurns);
}

/** 组装 `POST /api/agent/ask` 请求体；问题为空时抛错，由调用方决定是否提示。 */
export function buildAskRequest(params: {
  question: string;
  pathname: string;
  search: string;
  sessionId: string;
  history: readonly AgentTranscriptTurn[];
  /** V1.0.5.2：当前选中的模型 id；为空 / undefined 时由后端使用默认主模型。 */
  modelId?: string | null;
}): AskRequest {
  const question = params.question.trim();
  if (!question) {
    throw new AgentClientError("问题不能为空");
  }
  if (question.length > MAX_QUESTION_LENGTH) {
    throw new AgentClientError(`问题不能超过 ${MAX_QUESTION_LENGTH} 字`);
  }
  if (!params.sessionId.trim()) {
    throw new AgentClientError("sessionId 不能为空");
  }
  const request: AskRequest = {
    question,
    session_id: params.sessionId,
    history: historyFromTranscript(params.history),
    context: readPageContext(params.pathname, params.search),
    client_schema_version: "1.0",
  };
  const modelId = params.modelId?.trim();
  if (modelId) request.model_id = modelId;
  return request;
}

/** 同源代理地址；允许用 `NEXT_PUBLIC_API_BASE` 覆盖（例如直连 8000 端口）。 */
export function agentAskEndpoint(): string {
  const base = (process.env.NEXT_PUBLIC_API_BASE ?? "").replace(/\/$/, "");
  return `${base}/api/agent/ask`;
}

/** V1.0.5.2：模型注册表端点（同源代理，无需 API key 即可访问）。 */
export function agentModelsEndpoint(): string {
  const base = (process.env.NEXT_PUBLIC_API_BASE ?? "").replace(/\/$/, "");
  return `${base}/api/agent/models`;
}

function isModelOption(value: unknown): value is ModelOption {
  return (
    isRecord(value) &&
    typeof value.id === "string" &&
    value.id.trim().length > 0 &&
    typeof value.name === "string" &&
    (value.role === "primary" || value.role === "fallback")
  );
}

/**
 * 解析 `GET /api/agent/models` 响应（V1.0.5.2）。
 *
 * 形状不符返回 `null`，由调用方决定是否回退静态注册表；不抛异常。
 */
export function modelsStateFromPayload(payload: unknown): AgentModelsState | null {
  if (!isRecord(payload) || payload.ok !== true) return null;
  const models = Array.isArray(payload.models) ? payload.models.filter(isModelOption) : [];
  if (models.length === 0) return null;
  const defaultModelId =
    typeof payload.default_model_id === "string" && payload.default_model_id
      ? payload.default_model_id
      : (models.find((model) => model.role === "primary") ?? models[0]).id;
  return { models, defaultModelId, fromFallback: false };
}

export interface FetchModelsOptions {
  fetchImpl?: typeof fetch;
  signal?: AbortSignal;
  endpoint?: string;
}

/**
 * 读取模型注册表；后端不可达 / 响应异常时回退到 `FALLBACK_MODEL_OPTIONS`。
 *
 * 设计原则：模型切换窗口属于「锦上添花」的输入区控件，任何读取失败都不能阻塞提问。
 */
export async function fetchAgentModels(
  options: FetchModelsOptions = {},
): Promise<AgentModelsState> {
  const fetchImpl = options.fetchImpl ?? fetch;
  try {
    const response = await fetchImpl(options.endpoint ?? agentModelsEndpoint(), {
      method: "GET",
      signal: options.signal,
      cache: "no-store",
    });
    if (!response.ok) throw new AgentClientError(`模型注册表 HTTP ${response.status}`);
    const payload: unknown = await response.json();
    const parsed = modelsStateFromPayload(payload);
    if (parsed) return parsed;
    throw new AgentClientError("模型注册表响应结构异常");
  } catch {
    return {
      models: FALLBACK_MODEL_OPTIONS,
      defaultModelId: FALLBACK_MODEL_OPTIONS[0].id,
      fromFallback: true,
    };
  }
}

/** 按 id 找模型全称；找不到返回 null（调用方显示原始 id 或默认文案）。 */
export function findModelName(
  models: readonly ModelOption[],
  modelId: string | null | undefined,
): string | null {
  if (!modelId) return null;
  return models.find((model) => model.id === modelId)?.name ?? null;
}

export function isErrorEnvelope(payload: unknown): payload is ErrorEnvelope {
  return (
    isRecord(payload) &&
    payload.ok === false &&
    isRecord(payload.error) &&
    typeof payload.error.message === "string" &&
    typeof payload.error.code === "string" &&
    typeof payload.request_id === "string"
  );
}

export function isAnswerEnvelope(payload: unknown): payload is AnswerEnvelope {
  return (
    isRecord(payload) &&
    payload.ok === true &&
    typeof payload.request_id === "string" &&
    isRecord(payload.snapshot) &&
    (payload.answer !== undefined || payload.clarification !== undefined)
  );
}

export interface PostAskOptions {
  /** 便于单测注入；默认使用全局 fetch。 */
  fetchImpl?: typeof fetch;
  signal?: AbortSignal;
  endpoint?: string;
}

/**
 * 调用问答接口。
 *
 * - 后端错误统一返回 `ErrorEnvelope`（HTTP 4xx/5xx 也一样），本函数原样返回，不抛异常；
 * - 网络异常 / 非 JSON / 形状不符才抛 `AgentClientError`。
 */
export async function postAsk(
  request: AskRequest,
  options: PostAskOptions = {},
): Promise<AgentResponse> {
  const fetchImpl = options.fetchImpl ?? fetch;
  let response: Response;
  try {
    response = await fetchImpl(options.endpoint ?? agentAskEndpoint(), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(request),
      signal: options.signal,
      cache: "no-store",
    });
  } catch (error) {
    throw new AgentClientError("无法连接史脉服务，请确认后端已启动（默认 127.0.0.1:8000）", {
      cause: error,
    });
  }

  // 429 可能来自反向代理并且不一定返回可解析的 JSON；在读取 body 前统一转成友好提示。
  if (response.status === 429) {
    throw new AgentClientError(RATE_LIMIT_MESSAGE, { status: 429 });
  }

  let payload: unknown;
  try {
    payload = await response.json();
  } catch (error) {
    throw new AgentClientError(`史脉服务返回了非 JSON 响应（HTTP ${response.status}）`, {
      status: response.status,
      cause: error,
    });
  }

  if (isErrorEnvelope(payload)) {
    const errorText = `${payload.error.code} ${payload.error.message}`;
    if (/\b429\b|rate\s*limit|too\s*many\s*requests/i.test(errorText)) {
      throw new AgentClientError(RATE_LIMIT_MESSAGE, { status: response.status });
    }
    return payload;
  }
  if (isAnswerEnvelope(payload)) return payload;
  throw new AgentClientError("史脉服务返回了无法识别的响应结构", {
    status: response.status,
  });
}

/**
 * 归一化 `answer.comparison_analysis`（V1.0.5.4）。
 *
 * 只接受「非空 text 字符串」的合法对象；后端可能返回 null / 缺字段 / 异常结构，
 * 一律回退 null（不显示分析块，也不影响事实实证渲染）。前端不写任何分析文本。
 */
export function normalizeComparisonAnalysis(value: unknown): ComparisonAnalysis | null {
  if (!isRecord(value)) return null;
  const text = value.text;
  if (typeof text !== "string") return null;
  const trimmed = text.trim();
  if (!trimmed) return null;
  return { text: trimmed };
}

/**
 * 归一化 `trace.fact_check`（V1.0.6.1）。
 *
 * 只接受已知状态枚举；issues 只保留字符串。后端未上报 / 结构异常时返回 null
 * （不显示核查状态，也不影响正文渲染——正文是否可信由服务端保证）。
 */
export function normalizeFactCheck(value: unknown): AgentFactCheckView | null {
  if (!isRecord(value)) return null;
  const status = value.status;
  const allowed = ["passed", "failed", "fallback", "server_fallback", "skipped"] as const;
  if (typeof status !== "string" || !allowed.includes(status as (typeof allowed)[number])) {
    return null;
  }
  const issues = Array.isArray(value.issues)
    ? value.issues.filter((item): item is string => typeof item === "string")
    : [];
  return { status: status as AgentFactCheckView["status"], issues };
}

/**
 * 核查状态 → 状态徽标补充文案（V1.0.6.1）。
 *
 * 只有 `passed` / 回退类状态需要展示；insufficient / refusal / 旧数据（skipped）返回 null。
 */
export function factCheckHint(view: AgentFactCheckView | null | undefined): string | null {
  if (!view) return null;
  if (view.status === "passed") return "双重事实核查通过";
  if (view.status === "fallback" || view.status === "server_fallback") {
    return "已回退服务端实证正文";
  }
  return null;
}

/** 把成功信封里的 answer 归一化为抽屉可直接渲染的视图；澄清场景返回 null。 */
export function answerViewFromEnvelope(
  envelope: AnswerEnvelope,
  options: { requestedModel?: string | null } = {},
): AgentAnswerView | null {
  const answer = envelope.answer;
  if (!answer) return null;
  const sources = envelope.trace?.sources;
  return {
    mode: answer.mode,
    markdown: answer.markdown,
    certainty: answer.certainty ?? null,
    missing: answer.missing ?? [],
    reasonCode: answer.reason_code ?? null,
    citations: envelope.citations ?? [],
    entities: envelope.entities ?? [],
    uiActions: envelope.ui_actions ?? [],
    snapshotVersion: envelope.snapshot.version,
    requestId: envelope.request_id,
    modelUsed: envelope.trace?.model_used ?? null,
    modelRequested: envelope.trace?.model_requested ?? options.requestedModel ?? null,
    sources:
      sources && typeof sources.timeline === "boolean" && typeof sources.graph === "boolean"
        ? { timeline: sources.timeline, graph: sources.graph }
        : null,
    comparisonAnalysis: normalizeComparisonAnalysis(answer.comparison_analysis),
    factCheck: normalizeFactCheck(envelope.trace?.fact_check),
  };
}

/**
 * 冷启动 / 刷新恢复时归一化 sessionStorage 里的历史回答（V1.0.5.4 修复三）。
 *
 * 旧版本（或异常中断）写入的 `answer` 可能缺少 `citations` / `uiActions` / `sources` /
 * `comparisonAnalysis` 等字段；直接渲染会访问 undefined 造成「新窗口恢复会话即报错」。
 * 这里只保留结构合法的回答，并把缺失的可选字段补成安全默认值；
 * 事实实证正文（markdown）仍原样保留，不做任何改写。
 */
export function normalizeRestoredAnswerView(value: unknown): AgentAnswerView | null {
  if (!isRecord(value)) return null;
  const markdown = value.markdown;
  if (typeof markdown !== "string" || !markdown.trim()) return null;
  const mode: AgentAnswerView["mode"] =
    value.mode === "grounded" || value.mode === "insufficient" || value.mode === "refusal"
      ? value.mode
      : "insufficient";
  const sources = value.sources;
  return {
    mode,
    markdown,
    certainty:
      value.certainty === "high" || value.certainty === "medium" || value.certainty === "low"
        ? value.certainty
        : null,
    missing: Array.isArray(value.missing)
      ? value.missing.filter((item): item is string => typeof item === "string")
      : [],
    reasonCode:
      value.reasonCode === "OUT_OF_SCOPE" ||
      value.reasonCode === "UNSAFE_REQUEST" ||
      value.reasonCode === "NO_RELIABLE_BASIS"
        ? value.reasonCode
        : null,
    citations: Array.isArray(value.citations) ? (value.citations as Citation[]) : [],
    entities: Array.isArray(value.entities) ? (value.entities as Entity[]) : [],
    uiActions: Array.isArray(value.uiActions) ? (value.uiActions as UIAction[]) : [],
    snapshotVersion: typeof value.snapshotVersion === "string" ? value.snapshotVersion : "",
    requestId: typeof value.requestId === "string" ? value.requestId : "",
    modelUsed: typeof value.modelUsed === "string" ? value.modelUsed : null,
    modelRequested: typeof value.modelRequested === "string" ? value.modelRequested : null,
    sources:
      isRecord(sources) &&
      typeof sources.timeline === "boolean" &&
      typeof sources.graph === "boolean"
        ? { timeline: sources.timeline, graph: sources.graph }
        : null,
    comparisonAnalysis: normalizeComparisonAnalysis(value.comparisonAnalysis),
    factCheck: normalizeFactCheck(value.factCheck),
    // V1.0.6.2：直答回答在本标签页刷新后仍保留「逐字直答」语义（不冒充已核验）。
    streamed: value.streamed === true,
  };
}

/**
 * 冷启动请求的 model_id 选择策略（V1.0.5.4 修复三；V1.0.6.2 收尾加固）。
 *
 * - 已选模型 → 直接使用；
 * - 注册表已就绪（来自后端真实接口）→ 使用后端默认主模型（保证请求始终带上最新 model_id）；
 * - 注册表尚未返回（新窗口首个请求极早期）→ 返回 null，交给后端默认主模型；
 * - **注册表来自前端静态兜底表**（后端冷启动 / 代理抖动导致读取失败）→ 返回 null：
 *   静态兜底 id 可能不在后端白名单（例如本地 Ollama 只注册了 XiaoHong-v1），
 *   硬塞过去会被判「未知模型」400，导致用户首个问题直接失败。
 */
export function resolveRequestModelId(
  selectedModelId: string | null | undefined,
  defaultModelId: string | null | undefined,
  modelsReady: boolean,
  modelsFromFallback = false,
): string | null {
  if (modelsFromFallback) return null;
  const selected = selectedModelId?.trim();
  if (selected) return selected;
  if (!modelsReady) return null;
  const fallback = defaultModelId?.trim();
  return fallback || null;
}

/** 澄清信封的展示文案（V1.0.3 后端暂不返回，保留兼容）。 */
export function clarificationTextFromEnvelope(envelope: AnswerEnvelope): string | null {
  const clarification = envelope.clarification;
  if (!clarification) return null;
  const candidates = (clarification.candidates ?? [])
    .slice(0, 5)
    .map((candidate) => `${candidate.name}（${candidate.disambiguator}）`)
    .join("、");
  return candidates ? `${clarification.question}\n可选：${candidates}` : clarification.question;
}

/** 给动作 id 加请求前缀，避免模型每轮都复用 `act-1` 被幂等键误判为重复。 */
export function namespaceUiActions(actions: readonly UIAction[], requestId: string): UIAction[] {
  const seen = new Set<string>();
  const namespaced: UIAction[] = [];
  for (const action of actions) {
    const id = `${requestId}:${action.id}`.slice(0, 128);
    if (seen.has(id)) continue;
    seen.add(id);
    namespaced.push({ ...action, id });
  }
  return namespaced;
}

/** 错误信封 → 用户可见文案（服务端 message 已是安全文案）。 */
export function errorMessageFromEnvelope(envelope: ErrorEnvelope): string {
  return envelope.error.message || "史脉服务暂时不可用，请稍后重试。";
}

/** 生成浏览器会话 id（`crypto.randomUUID` 不可用时退化为时间戳 + 随机数）。 */
export function createSessionId(now: () => number = Date.now): string {
  const uuid = globalThis.crypto?.randomUUID?.();
  if (uuid) return `session_${uuid}`;
  const random = Math.random().toString(36).slice(2, 10);
  return `session_${now().toString(36)}_${random}`;
}

// ===========================================================================
// V1.0.6.2 本地模型流式直答（SSE）
// ===========================================================================

/** `POST /api/agent/chat_stream` 请求体（契约生成）。 */
export type ChatStreamRequest = components["schemas"]["StreamAskRequest"];

/** 流式直答完成后的结果（服务端 `done` 事件）。 */
export interface ChatStreamDone {
  /** 服务端已过滤思考过程的完整最终答案（已做重复治理）。 */
  answer: string;
  model: string;
  latencyMs: number;
  /** 首字延迟（毫秒）；服务端未上报时为 null。 */
  firstTokenMs: number | null;
  /** 被服务端过滤的思考内容字符数（只上报数量，不包含内容）。 */
  reasoningChars: number;
  /** 被服务端过滤的思考标签字符数。 */
  filteredChars: number;
  usage: Record<string, number> | null;
  /**
   * V1.0.6.2（痛点 1）：服务端「意图后置推断」补出的 UI 联动动作。
   *
   * 直答链路不跑工具，模型不会输出 `ui_actions`；服务端按问题匹配快照里的事件 / 人物，
   * 随 `done` 事件下发 `timeline.focus_event` / `graph.focus_person` /
   * `graph.focus_relation` 等动作，前端据此自动展开右侧史引面板。
   */
  uiActions: UIAction[];
  /** 服务端请求 id（动作幂等键前缀使用）。 */
  requestId: string;
  /** 重复治理删除的字符数（观测值）。 */
  dedupedChars: number;
  /** 是否检测到循环复述并提前停止生成。 */
  repetitionStopped: boolean;
  /** V1.0.6.2：本轮是否请求了「深度思考」（服务端回显）。 */
  enableThinking: boolean;
  /**
   * V1.0.6.2：深度思考只产出 reasoning、没有最终答案时，服务端是否已自动
   * 关闭思考重试；true 表示本轮答案是「快速模式」兜底结果。
   */
  thinkingFallback: boolean;
}

/** 流式直答回调：`full` 为截至目前已累计的答案正文（可直接渲染）。 */
export interface ChatStreamHandlers {
  onStart?: (info: { requestId: string; model: string; sessionId: string | null }) => void;
  onDelta?: (delta: string, full: string) => void;
}

export interface ChatStreamOptions {
  fetchImpl?: typeof fetch;
  signal?: AbortSignal;
  endpoint?: string;
}

/** 流式直答端点（同源代理，与 `/api/agent/ask` 一致）。 */
export function chatStreamEndpoint(): string {
  const base = (process.env.NEXT_PUBLIC_API_BASE ?? "").replace(/\/$/, "");
  return `${base}/api/agent/chat_stream`;
}

/** 组装流式直答请求：问题 + 服务端会话 id + 历史（首次迁移兜底）+ 可选模型 id。 */
export function buildChatStreamRequest(params: {
  question: string;
  sessionId: string;
  history: readonly AgentTranscriptTurn[];
  modelId?: string | null;
  /** V1.0.6.2「深度思考」：默认 false（快速直答）；true 时请求上游先推理再回答。 */
  enableThinking?: boolean;
}): ChatStreamRequest {
  const question = params.question.trim();
  if (!question) {
    throw new AgentClientError("问题不能为空");
  }
  if (question.length > MAX_QUESTION_LENGTH) {
    throw new AgentClientError(`问题不能超过 ${MAX_QUESTION_LENGTH} 字`);
  }
  if (!params.sessionId.trim()) {
    throw new AgentClientError("sessionId 不能为空");
  }
  const request: ChatStreamRequest = {
    question,
    session_id: params.sessionId.trim(),
    history: historyFromTranscript(params.history),
    enable_thinking: params.enableThinking === true,
  };
  const modelId = params.modelId?.trim();
  if (modelId) request.model_id = modelId;
  return request;
}

function isRecordValue(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

/** 可在直答链路驱动「史引副驾驶」的动作类型（与 contracts/action-policy.json 的 available 集合一致）。 */
const STREAM_GUIDE_ACTION_TYPES = new Set<string>([
  "timeline.focus_event",
  "timeline.focus_dynasty",
  "graph.focus_person",
  "graph.focus_relation",
]);

/**
 * 归一化服务端 `done.ui_actions`（V1.0.6.2）。
 *
 * 直答动作由服务端确定性推断，理论上一定合法；前端仍做运行时容错（类型白名单 / surface /
 * 必填 ID），异常动作直接丢弃——宁可不弹面板，也不导航到空白页。
 */
export function normalizeStreamUiActions(value: unknown): UIAction[] {
  if (!Array.isArray(value)) return [];
  const actions: UIAction[] = [];
  const seen = new Set<string>();
  for (const item of value) {
    if (!isRecordValue(item)) continue;
    const id = typeof item.id === "string" ? item.id.trim() : "";
    const type = typeof item.type === "string" ? item.type : "";
    if (!id || !STREAM_GUIDE_ACTION_TYPES.has(type) || seen.has(id)) continue;
    const target = isRecordValue(item.target) ? item.target : null;
    const surface = target && typeof target.surface === "string" ? target.surface : "";
    if (!target || (surface !== "timeline" && surface !== "graph" && surface !== "ask")) {
      continue;
    }
    seen.add(id);
    actions.push({
      id,
      type: type as UIAction["type"],
      payload: isRecordValue(item.payload) ? (item.payload as UIAction["payload"]) : {},
      target: {
        surface,
        params: isRecordValue(target.params)
          ? (target.params as UIAction["target"]["params"])
          : {},
      },
      auto: item.auto === true,
      label: typeof item.label === "string" && item.label ? item.label : "在页面中查看",
      reason: typeof item.reason === "string" ? item.reason : null,
    });
    if (actions.length >= 3) break;
  }
  return actions;
}

/** 从服务端 `done` 事件中归一化结果；结构异常时抛 `AgentClientError`。 */
function chatStreamDoneFromPayload(payload: unknown): ChatStreamDone {
  if (!isRecordValue(payload) || payload.type !== "done") {
    throw new AgentClientError("流式回答缺少结束事件");
  }
  const answer = payload.answer;
  if (typeof answer !== "string" || !answer.trim()) {
    throw new AgentClientError("流式回答为空");
  }
  const usage = isRecordValue(payload.usage)
    ? Object.fromEntries(
        Object.entries(payload.usage).filter(
          (entry): entry is [string, number] =>
            typeof entry[1] === "number" && Number.isFinite(entry[1]),
        ),
      )
    : null;
  return {
    answer,
    model: typeof payload.model === "string" ? payload.model : "",
    latencyMs: typeof payload.latency_ms === "number" ? payload.latency_ms : 0,
    firstTokenMs:
      typeof payload.first_token_ms === "number" ? payload.first_token_ms : null,
    reasoningChars:
      typeof payload.reasoning_chars === "number" ? payload.reasoning_chars : 0,
    filteredChars:
      typeof payload.filtered_chars === "number" ? payload.filtered_chars : 0,
    usage: usage && Object.keys(usage).length > 0 ? usage : null,
    uiActions: normalizeStreamUiActions(payload.ui_actions),
    requestId: typeof payload.request_id === "string" ? payload.request_id : "",
    dedupedChars:
      typeof payload.deduped_chars === "number" && payload.deduped_chars > 0
        ? payload.deduped_chars
        : 0,
    repetitionStopped: payload.repetition_stopped === true,
    enableThinking: payload.enable_thinking === true,
    thinkingFallback: payload.thinking_fallback === true,
  };
}

/**
 * 直答完成 → `AgentAnswerView`（V1.0.6.2）。
 *
 * 直答没有证据 / 引用，只有当服务端推断了可联动动作时才构造 answer view：
 * `resolveGuideFromTranscript` 据此自动展开右侧史引，同时用 `streamed=true`
 * 让气泡显示「逐字直答 / 史引已联动」，而不是「已核验」徽标（避免冒充证据问答）。
 */
export function streamedAnswerView(
  done: ChatStreamDone,
  options: { requestId?: string; modelRequested?: string | null } = {},
): AgentAnswerView | null {
  if (done.uiActions.length === 0) return null;
  return {
    mode: "grounded",
    markdown: done.answer,
    certainty: null,
    missing: [],
    reasonCode: null,
    citations: [],
    entities: [],
    uiActions: done.uiActions,
    snapshotVersion: "",
    requestId: options.requestId ?? done.requestId,
    modelUsed: done.model || null,
    modelRequested: options.modelRequested ?? null,
    sources: null,
    comparisonAnalysis: null,
    factCheck: null,
    streamed: true,
  };
}

/**
 * 调用流式直答接口（SSE）并逐段回调。
 *
 * - 每帧格式为 `data: {json}\n\n`；本函数负责跨 chunk 缓冲，不会把半帧交给调用方；
 * - 服务端已过滤 思考过程，`onDelta` 只收到最终答案正文；
 * - 网络异常 / 非 JSON 错误 / `error` 事件统一抛 `AgentClientError`；
 * - 正常结束返回 `ChatStreamDone`（同时累计完整答案）。
 */
export async function postChatStream(
  request: ChatStreamRequest,
  handlers: ChatStreamHandlers = {},
  options: ChatStreamOptions = {},
): Promise<ChatStreamDone> {
  const fetchImpl = options.fetchImpl ?? fetch;
  let response: Response;
  try {
    response = await fetchImpl(options.endpoint ?? chatStreamEndpoint(), {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "text/event-stream",
      },
      body: JSON.stringify(request),
      signal: options.signal,
      cache: "no-store",
    });
  } catch (error) {
    throw new AgentClientError("无法连接史脉服务，请确认后端已启动（默认 127.0.0.1:8000）", {
      cause: error,
    });
  }

  if (response.status === 429) {
    throw new AgentClientError(RATE_LIMIT_MESSAGE, { status: 429 });
  }
  if (!response.ok) {
    // 流开始前的错误（参数 / 模型白名单 / 配置）是统一 JSON 错误信封。
    let payload: unknown = null;
    try {
      payload = await response.json();
    } catch {
      payload = null;
    }
    if (isErrorEnvelope(payload)) {
      throw new AgentClientError(errorMessageFromEnvelope(payload), {
        status: response.status,
      });
    }
    throw new AgentClientError(`史脉服务返回 HTTP ${response.status}`, {
      status: response.status,
    });
  }

  const body = response.body;
  if (!body || typeof body.getReader !== "function") {
    throw new AgentClientError("当前浏览器不支持流式响应");
  }

  const reader = body.getReader();
  const decoder = new TextDecoder("utf-8");
  let buffer = "";
  let full = "";
  let result: ChatStreamDone | null = null;
  let streamError: AgentClientError | null = null;

  const dispatch = (frame: string): void => {
    const dataLines: string[] = [];
    for (const line of frame.split("\n")) {
      if (line.startsWith("data:")) {
        dataLines.push(line.slice(5).trimStart());
      }
    }
    if (dataLines.length === 0) return;
    let payload: unknown;
    try {
      payload = JSON.parse(dataLines.join("\n"));
    } catch {
      return; // 半帧 / 心跳等非法 JSON：忽略，不打断流。
    }
    if (!isRecordValue(payload)) return;
    const type = payload.type;
    if (type === "start") {
      handlers.onStart?.({
        requestId: typeof payload.request_id === "string" ? payload.request_id : "",
        model: typeof payload.model === "string" ? payload.model : "",
        sessionId: typeof payload.session_id === "string" ? payload.session_id : null,
      });
      return;
    }
    if (type === "delta") {
      const text = payload.text;
      if (typeof text !== "string" || !text) return;
      full += text;
      handlers.onDelta?.(text, full);
      return;
    }
    if (type === "done") {
      result = chatStreamDoneFromPayload(payload);
      full = result.answer;
      return;
    }
    if (type === "error") {
      const message =
        typeof payload.message === "string" && payload.message
          ? payload.message
          : "史脉服务暂时不可用，请稍后重试。";
      streamError = new AgentClientError(message);
    }
  };

  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      buffer = buffer.replace(/\r\n/g, "\n");
      let boundary = buffer.indexOf("\n\n");
      while (boundary >= 0) {
        dispatch(buffer.slice(0, boundary));
        buffer = buffer.slice(boundary + 2);
        boundary = buffer.indexOf("\n\n");
      }
      if (streamError) break;
    }
    if (!streamError) {
      buffer += decoder.decode();
      if (buffer.trim()) dispatch(buffer);
    }
  } finally {
    try {
      await reader.cancel();
    } catch {
      // 已结束的流取消失败可忽略。
    }
  }

  if (streamError) throw streamError;
  if (result === null) {
    throw new AgentClientError("流式回答意外中断，请重试");
  }
  return result;
}
