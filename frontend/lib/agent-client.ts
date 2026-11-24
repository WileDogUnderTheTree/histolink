/**
 * Agent 数据层（V1.0.4；V1.0.5.2 模型注册表 + 请求级模型选择）。
 *
 * 只做「纯函数 + 一次 fetch」，不依赖 React：
 * - 把页面上下文 / transcript / 选中模型组装成 `POST /api/agent/ask` 请求体；
 * - 调用同源代理（`next.config.ts` 已把 `/api/*` 转发到 FastAPI）；
 * - 读取 `GET /api/agent/models` 模型注册表，供输入框左上角的模型切换窗口使用；
 * - 把 `AnswerEnvelope` 归一化成抽屉可直接渲染的 `AgentAnswerView`。
 *
 * 安全约定：前端只展示服务端返回的 `answer.markdown` / 结构化字段；
 * 不拼接、不改写模型文本（服务端已在 V1.0.3 保证 markdown 由固定模板或工具原文生成）。
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
  };
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
