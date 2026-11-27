/**
 * 会话管理 API 客户端（V1.0.6：前端历史记录真实持久化 + 多轮记忆）。
 *
 * 只做「纯函数 + fetch」，不依赖 React：
 * - `GET    /api/sessions`              列表（侧边栏数据源）；
 * - `POST   /api/sessions`              新建会话（session_id 由前端生成，刷新后 id 稳定）；
 * - `GET    /api/sessions/{id}`         详情（刷新 / 点击历史时恢复聊天记录）；
 * - `PATCH  /api/sessions/{id}`         重命名 / 置顶；
 * - `DELETE /api/sessions/{id}`         删除。
 *
 * 两类归一化（后端 snake_case → 前端渲染模型）：
 * 1. `SessionSummary` → `RemoteSessionSummary`（列表用，轻量）；
 * 2. `SessionDetail.turns[].answer`（assistant 结构化回答快照）→ `AgentAnswerView`，
 *    让刷新后的历史消息仍能恢复引用 / 实体 / 联动动作 / 对比分析块。
 *
 * 失败策略（不阻塞页面）：
 * - 读取类（列表 / 详情）失败返回 `null`，由数据层回退为空列表 / 本地缓存；
 * - 写入类（创建 / 重命名 / 置顶 / 删除）失败返回 `null` / `false`，由调用方决定提示。
 */

import type { components } from "@/lib/api-types";
import {
  normalizeComparisonAnalysis,
  normalizeFactCheck,
  type AgentAnswerView,
  type AnswerSources,
} from "@/lib/agent-client";

type RawSessionSummary = components["schemas"]["SessionSummary"];
type RawSessionTurn = components["schemas"]["SessionTurn"];
type RawSessionDetail = components["schemas"]["SessionDetail"];

/** 会话列表项（前端命名，`createdAt` / `updatedAt` 为毫秒时间戳）。 */
export interface RemoteSessionSummary {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  pinned: boolean;
  turnCount: number;
}

/** 会话中的单轮消息（assistant 轮次带归一化后的回答视图）。 */
export interface RemoteSessionTurn {
  role: "user" | "assistant";
  content: string;
  createdAt: number;
  answer: AgentAnswerView | null;
}

/** 完整会话详情。 */
export interface RemoteSessionDetail extends RemoteSessionSummary {
  entityMemory: {
    personIds: string[];
    personNames: Record<string, string>;
    eventIds: string[];
  };
  turns: RemoteSessionTurn[];
}

/** 前端持久化的当前会话 id（localStorage）：刷新页面后据此恢复聊天记录。 */
export const SESSION_STORAGE_KEY = "histolink.agent.session.v1";

/**
 * 自动化测试 / 探针会话前缀（V1.0.6.2 · 痛点 1 历史数据清理）。
 *
 * 与后端 `session_store.DISPOSABLE_SESSION_PREFIXES` 保持一致：命中这些前缀的
 * `session_id` 在后端只会写入**独立测试库**，永远不会进入用户的正式历史记录。
 * E2E 脚本可以通过 `/ask?session_id=e2e_xxx` 显式选用测试会话。
 */
export const TEST_SESSION_PREFIXES = ["test_", "e2e_", "pytest_", "smoke_"] as const;

/** 是否是自动化测试会话 id（不进入用户正式历史 / 不写入 localStorage）。 */
export function isDisposableSessionId(sessionId: string | null | undefined): boolean {
  const value = (sessionId ?? "").trim();
  if (!value) return false;
  return TEST_SESSION_PREFIXES.some((prefix) => value.startsWith(prefix));
}

/** 生成一个测试会话 id（E2E 用；不含用户数据，后端只写测试库）。 */
export function createDisposableSessionId(
  prefix: (typeof TEST_SESSION_PREFIXES)[number] = "e2e_",
  now: () => number = Date.now,
): string {
  const random = Math.random().toString(36).slice(2, 10);
  return `${prefix}${now().toString(36)}_${random}`;
}

/**
 * 从 `/ask?session_id=...` 读取测试会话 id（V1.0.6.2）。
 *
 * 只接受**测试前缀**且字符集安全的值：普通用户 URL 不能借此读取任意会话
 * （正式会话仍只经 localStorage 恢复）。非法 / 缺失返回 null。
 */
export function readTestSessionIdFromSearch(search: string | null | undefined): string | null {
  if (!search) return null;
  const params = new URLSearchParams(search.startsWith("?") ? search.slice(1) : search);
  const value = params.get("session_id")?.trim() ?? "";
  if (!value || value.length > 128) return null;
  if (!/^[A-Za-z0-9_.:-]+$/.test(value)) return null;
  return isDisposableSessionId(value) ? value : null;
}

/** 可注入的最小 Storage 接口（便于单测；浏览器传入 window.localStorage）。 */
export interface SessionIdStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export class SessionClientError extends Error {
  readonly status: number | null;

  constructor(message: string, options: { status?: number; cause?: unknown } = {}) {
    super(message);
    this.name = "SessionClientError";
    this.status = options.status ?? null;
    if (options.cause !== undefined) {
      this.cause = options.cause;
    }
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function apiBase(): string {
  return (process.env.NEXT_PUBLIC_API_BASE ?? "").replace(/\/$/, "");
}

/** 会话集合端点（同源代理；允许 `NEXT_PUBLIC_API_BASE` 直连后端）。 */
export function sessionsEndpoint(): string {
  return `${apiBase()}/api/sessions`;
}

/** 单个会话端点（session_id 做 URL 编码）。 */
export function sessionDetailEndpoint(sessionId: string): string {
  return `${sessionsEndpoint()}/${encodeURIComponent(sessionId)}`;
}

function defaultStorage(): SessionIdStorage | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

/** 读取本机持久化的当前 session_id；无 / 非法值返回 null。 */
export function readStoredSessionId(storage?: SessionIdStorage | null): string | null {
  const target = storage === undefined ? defaultStorage() : storage;
  if (!target) return null;
  try {
    const value = target.getItem(SESSION_STORAGE_KEY)?.trim();
    return value ? value : null;
  } catch {
    return null;
  }
}

/** 持久化当前 session_id（刷新页面后恢复聊天记录的关键）。 */
export function writeStoredSessionId(
  sessionId: string,
  storage?: SessionIdStorage | null,
): void {
  const target = storage === undefined ? defaultStorage() : storage;
  if (!target) return;
  const value = sessionId.trim();
  if (!value) return;
  try {
    target.setItem(SESSION_STORAGE_KEY, value);
  } catch {
    // 存储不可用（隐私模式 / 配额满）只影响「刷新后记忆」，不影响当前会话。
  }
}

/** 清除持久化的 session_id（删除当前会话 / 新建对话时）。 */
export function clearStoredSessionId(storage?: SessionIdStorage | null): void {
  const target = storage === undefined ? defaultStorage() : storage;
  if (!target) return;
  try {
    target.removeItem(SESSION_STORAGE_KEY);
  } catch {
    // 忽略存储异常。
  }
}

// ---------------------------------------------------------------------------
// 归一化：后端响应 → 前端渲染模型
// ---------------------------------------------------------------------------

function asString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function asStringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

function asNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/** 归一化会话列表项；结构非法返回 null（整条丢弃）。 */
export function normalizeSessionSummary(value: unknown): RemoteSessionSummary | null {
  if (!isRecord(value)) return null;
  const id = asString(value.session_id);
  const title = asString(value.title);
  const createdAt = asNumber(value.created_at);
  const updatedAt = asNumber(value.updated_at);
  if (!id || !title || createdAt === null || updatedAt === null) return null;
  return {
    id,
    title,
    createdAt,
    updatedAt,
    pinned: value.pinned === true,
    turnCount: asNumber(value.turn_count) ?? 0,
  };
}

/** 归一化实体记忆（服务端结构 → 前端 camelCase）。 */
export function normalizeSessionEntityMemory(
  value: unknown,
): RemoteSessionDetail["entityMemory"] {
  if (!isRecord(value)) {
    return { personIds: [], personNames: {}, eventIds: [] };
  }
  const rawNames = isRecord(value.person_names) ? value.person_names : {};
  const personNames: Record<string, string> = {};
  for (const [key, name] of Object.entries(rawNames)) {
    if (typeof name === "string" && name.trim()) personNames[key] = name.trim();
  }
  return {
    personIds: asStringArray(value.person_ids),
    personNames,
    eventIds: asStringArray(value.event_ids),
  };
}

function normalizeSources(value: unknown): AnswerSources | null {
  if (!isRecord(value)) return null;
  return typeof value.timeline === "boolean" && typeof value.graph === "boolean"
    ? { timeline: value.timeline, graph: value.graph }
    : null;
}

/**
 * 归一化后端持久化的 assistant 回答快照 → `AgentAnswerView`（V1.0.6）。
 *
 * 输入是 `backend/routers/agent.py::build_session_answer_payload` 写入的 snake_case 结构：
 * `{answer:{markdown,mode,...}, citations, entities, ui_actions, trace, request_id, snapshot_version}`。
 * 任何字段缺失 / 结构异常都回退安全默认值（不渲染坏数据），事实实证正文原样保留。
 */
export function normalizeStoredSessionAnswer(value: unknown): AgentAnswerView | null {
  if (!isRecord(value)) return null;
  const answer = value.answer;
  if (!isRecord(answer)) return null;
  const markdown = typeof answer.markdown === "string" ? answer.markdown : "";
  if (!markdown.trim()) return null;
  const mode: AgentAnswerView["mode"] =
    answer.mode === "grounded" || answer.mode === "insufficient" || answer.mode === "refusal"
      ? answer.mode
      : "insufficient";
  const trace = isRecord(value.trace) ? value.trace : null;
  const missing = Array.isArray(answer.missing)
    ? answer.missing.filter((item): item is string => typeof item === "string")
    : [];
  return {
    mode,
    markdown,
    certainty:
      answer.certainty === "high" || answer.certainty === "medium" || answer.certainty === "low"
        ? answer.certainty
        : null,
    missing,
    reasonCode:
      answer.reason_code === "OUT_OF_SCOPE" ||
      answer.reason_code === "UNSAFE_REQUEST" ||
      answer.reason_code === "NO_RELIABLE_BASIS"
        ? answer.reason_code
        : null,
    citations: Array.isArray(value.citations)
      ? (value.citations as AgentAnswerView["citations"])
      : [],
    entities: Array.isArray(value.entities) ? (value.entities as AgentAnswerView["entities"]) : [],
    uiActions: Array.isArray(value.ui_actions)
      ? (value.ui_actions as AgentAnswerView["uiActions"])
      : [],
    snapshotVersion: asString(value.snapshot_version) ?? "",
    requestId: asString(value.request_id) ?? "",
    modelUsed: trace ? asString(trace.model_used) : null,
    modelRequested: trace ? asString(trace.model_requested) : null,
    sources: trace ? normalizeSources(trace.sources) : null,
    comparisonAnalysis: normalizeComparisonAnalysis(answer.comparison_analysis),
    // V1.0.6.1：刷新后仍能显示「双重事实核查通过 / 已回退服务端实证」状态。
    factCheck: trace ? normalizeFactCheck(trace.fact_check) : null,
    // V1.0.8 Bug 1：直答轮次持久化了 ui_actions + streamed 标记，刷新后仍按「直答」渲染，
    // 且能重建回答底部的「展开图谱 / 时间轴」深链接按钮。
    streamed: value.streamed === true,
  };
}

/** 归一化单轮消息；结构非法返回 null。 */
export function normalizeSessionTurn(
  value: unknown,
  index: number,
): RemoteSessionTurn | null {
  if (!isRecord(value)) return null;
  const role = value.role;
  if (role !== "user" && role !== "assistant") return null;
  const content = typeof value.content === "string" ? value.content : "";
  if (!content.trim()) return null;
  const rawAnswer = value.answer;
  let answer: AgentAnswerView | null = null;
  if (role === "assistant" && rawAnswer !== null && rawAnswer !== undefined) {
    answer = normalizeStoredSessionAnswer(rawAnswer);
  }
  return {
    role,
    content,
    createdAt: asNumber(value.created_at) ?? index,
    answer,
  };
}

/** 归一化会话详情；结构非法返回 null。 */
export function normalizeSessionDetail(value: unknown): RemoteSessionDetail | null {
  if (!isRecord(value)) return null;
  const summary = normalizeSessionSummary(value);
  if (!summary) return null;
  const rawTurns = Array.isArray(value.turns) ? value.turns : [];
  const turns: RemoteSessionTurn[] = [];
  rawTurns.forEach((turn, index) => {
    const normalized = normalizeSessionTurn(turn, index);
    if (normalized) turns.push(normalized);
  });
  return {
    ...summary,
    turnCount: turns.length,
    entityMemory: normalizeSessionEntityMemory(value.entity_memory),
    turns,
  };
}

// ---------------------------------------------------------------------------
// fetch 封装
// ---------------------------------------------------------------------------

export interface SessionFetchOptions {
  fetchImpl?: typeof fetch;
  signal?: AbortSignal;
  /** 覆盖请求端点（测试 / 直连后端用）。 */
  endpoint?: string;
}

async function readJson(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

/** `GET /api/sessions`：读取真实历史会话列表；失败返回 null。 */
export async function fetchSessions(
  options: SessionFetchOptions = {},
): Promise<RemoteSessionSummary[] | null> {
  const fetchImpl = options.fetchImpl ?? fetch;
  try {
    const response = await fetchImpl(options.endpoint ?? sessionsEndpoint(), {
      method: "GET",
      signal: options.signal,
      cache: "no-store",
    });
    if (!response.ok) return null;
    const payload = await readJson(response);
    if (!isRecord(payload) || payload.ok !== true || !Array.isArray(payload.sessions)) {
      return null;
    }
    const sessions: RemoteSessionSummary[] = [];
    for (const item of payload.sessions) {
      const normalized = normalizeSessionSummary(item);
      if (normalized) sessions.push(normalized);
    }
    return sessions;
  } catch {
    return null;
  }
}

/** `GET /api/sessions/{id}`：读取会话详情；不存在 / 失败返回 null。 */
export async function fetchSessionDetail(
  sessionId: string,
  options: SessionFetchOptions = {},
): Promise<RemoteSessionDetail | null> {
  const fetchImpl = options.fetchImpl ?? fetch;
  try {
    const response = await fetchImpl(options.endpoint ?? sessionDetailEndpoint(sessionId), {
      method: "GET",
      signal: options.signal,
      cache: "no-store",
    });
    if (!response.ok) return null;
    const payload = await readJson(response);
    if (!isRecord(payload) || payload.ok !== true) return null;
    return normalizeSessionDetail(payload.session);
  } catch {
    return null;
  }
}

export interface CreateSessionOptions extends SessionFetchOptions {
  sessionId?: string;
  title?: string;
}

/** `POST /api/sessions`：新建会话；失败抛 `SessionClientError`（调用方决定回退）。 */
export async function createSession(
  options: CreateSessionOptions = {},
): Promise<RemoteSessionDetail> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const body: Record<string, string> = {};
  if (options.sessionId?.trim()) body.session_id = options.sessionId.trim();
  if (options.title?.trim()) body.title = options.title.trim();
  let response: Response;
  try {
    response = await fetchImpl(options.endpoint ?? sessionsEndpoint(), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: options.signal,
      cache: "no-store",
    });
  } catch (error) {
    throw new SessionClientError("无法连接史脉服务，请确认后端已启动", { cause: error });
  }
  const payload = await readJson(response);
  const session = isRecord(payload) && payload.ok === true ? payload.session : null;
  const detail = normalizeSessionDetail(session);
  if (!response.ok || !detail) {
    throw new SessionClientError(`会话创建失败（HTTP ${response.status}）`, {
      status: response.status,
    });
  }
  return detail;
}

/** `PATCH /api/sessions/{id}`：重命名 / 置顶；失败返回 null。 */
export async function patchSession(
  sessionId: string,
  patch: { title?: string; pinned?: boolean },
  options: SessionFetchOptions = {},
): Promise<RemoteSessionSummary | null> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const body: Record<string, unknown> = {};
  if (typeof patch.title === "string" && patch.title.trim()) body.title = patch.title.trim();
  if (typeof patch.pinned === "boolean") body.pinned = patch.pinned;
  try {
    const response = await fetchImpl(options.endpoint ?? sessionDetailEndpoint(sessionId), {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: options.signal,
      cache: "no-store",
    });
    if (!response.ok) return null;
    const payload = await readJson(response);
    if (!isRecord(payload) || payload.ok !== true) return null;
    return normalizeSessionSummary(payload.session);
  } catch {
    return null;
  }
}

/** `DELETE /api/sessions/{id}`：删除会话；成功返回 true。 */
export async function deleteSession(
  sessionId: string,
  options: SessionFetchOptions = {},
): Promise<boolean> {
  const fetchImpl = options.fetchImpl ?? fetch;
  try {
    const response = await fetchImpl(options.endpoint ?? sessionDetailEndpoint(sessionId), {
      method: "DELETE",
      signal: options.signal,
      cache: "no-store",
    });
    return response.ok;
  } catch {
    return false;
  }
}

/** 原始后端类型导出（仅供类型对齐 / 测试使用）。 */
export type { RawSessionDetail, RawSessionSummary, RawSessionTurn };