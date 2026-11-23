/**
 * Agent 数据层（V1.0.4）。
 *
 * 只做「纯函数 + 一次 fetch」，不依赖 React：
 * - 把页面上下文 / transcript 组装成 `POST /api/agent/ask` 请求体；
 * - 调用同源代理（`next.config.ts` 已把 `/api/*` 转发到 FastAPI）；
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

/** 生成物把 `const true` 误生成为字符串字面量，这里按运行时真实形状重新声明。 */
export type AnswerEnvelope = Omit<components["schemas"]["AnswerEnvelope"], "ok"> & {
  ok: true;
};
export type ErrorEnvelope = Omit<components["schemas"]["ErrorEnvelope"], "ok"> & {
  ok: false;
};
export type AgentResponse = AnswerEnvelope | ErrorEnvelope;

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
  return {
    question,
    session_id: params.sessionId,
    history: historyFromTranscript(params.history),
    context: readPageContext(params.pathname, params.search),
    client_schema_version: "1.0",
  };
}

/** 同源代理地址；允许用 `NEXT_PUBLIC_API_BASE` 覆盖（例如直连 8000 端口）。 */
export function agentAskEndpoint(): string {
  const base = (process.env.NEXT_PUBLIC_API_BASE ?? "").replace(/\/$/, "");
  return `${base}/api/agent/ask`;
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
export function answerViewFromEnvelope(envelope: AnswerEnvelope): AgentAnswerView | null {
  const answer = envelope.answer;
  if (!answer) return null;
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
