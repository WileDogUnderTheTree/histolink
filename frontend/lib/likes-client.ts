/**
 * 点赞计数 API 客户端 + 浏览器防刷标记（V1.0.8）。
 *
 * 后端（`backend/routers/likes.py`）：
 * - `GET  /api/likes` → `{ok:true, count:N}`：当前总点赞数；
 * - `POST /api/likes` → `{ok:true, count:N}`：+1 后返回最新总数；
 * - 计数持久化在 `backend/data/likes.json`（`{"count": 0}`，文件不存在时自动创建）。
 *
 * 前端防刷：同一浏览器点过一次后写入 `localStorage.has_liked_shimai`，
 * 再打开页面大拇指置灰、禁用点击（数字仍然显示）。
 *
 * 本模块只做「纯函数 + fetch」，不依赖 React；失败一律返回 null / false，
 * 由 UI 决定降级展示（点赞是锦上添花功能，不能影响问答主链路）。
 */

/** 防刷标记的 localStorage key（需求指定）。 */
export const HAS_LIKED_STORAGE_KEY = "has_liked_shimai";

/** 可注入的最小 Storage 接口（便于单测；浏览器传入 window.localStorage）。 */
export interface LikesStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export class LikesClientError extends Error {
  readonly status: number | null;

  constructor(message: string, options: { status?: number; cause?: unknown } = {}) {
    super(message);
    this.name = "LikesClientError";
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

/** 点赞端点（同源 `/api` 代理；允许 `NEXT_PUBLIC_API_BASE` 直连后端）。 */
export function likesEndpoint(): string {
  return `${apiBase()}/api/likes`;
}

/** 归一化接口响应 → 点赞数；结构异常返回 null。 */
export function normalizeLikesPayload(payload: unknown): number | null {
  if (!isRecord(payload) || payload.ok !== true) return null;
  const count = payload.count;
  if (typeof count !== "number" || !Number.isFinite(count) || count < 0) return null;
  return Math.floor(count);
}

function defaultStorage(): LikesStorage | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

/** 该浏览器是否已经点过赞（localStorage 是否有 `has_liked_shimai`）。 */
export function readHasLiked(storage?: LikesStorage | null): boolean {
  const target = storage === undefined ? defaultStorage() : storage;
  if (!target) return false;
  try {
    return target.getItem(HAS_LIKED_STORAGE_KEY) === "1";
  } catch {
    return false;
  }
}

/** 标记该浏览器已点赞（防刷；存储不可用时只影响当次会话的防刷记忆）。 */
export function writeHasLiked(storage?: LikesStorage | null): void {
  const target = storage === undefined ? defaultStorage() : storage;
  if (!target) return;
  try {
    target.setItem(HAS_LIKED_STORAGE_KEY, "1");
  } catch {
    // 隐私模式 / 配额满：忽略，数字仍然更新。
  }
}

export interface LikesFetchOptions {
  fetchImpl?: typeof fetch;
  signal?: AbortSignal;
  endpoint?: string;
}

/** `GET /api/likes`：读取当前总点赞数；失败 / 结构异常返回 null。 */
export async function fetchLikes(
  options: LikesFetchOptions = {},
): Promise<number | null> {
  const fetchImpl = options.fetchImpl ?? fetch;
  try {
    const response = await fetchImpl(options.endpoint ?? likesEndpoint(), {
      method: "GET",
      signal: options.signal,
      cache: "no-store",
    });
    if (!response.ok) return null;
    const payload: unknown = await response.json();
    return normalizeLikesPayload(payload);
  } catch {
    return null;
  }
}

/** `POST /api/likes`：点赞数 +1，返回最新总数；失败返回 null（UI 不置灰，可重试）。 */
export async function postLike(
  options: LikesFetchOptions = {},
): Promise<number | null> {
  const fetchImpl = options.fetchImpl ?? fetch;
  try {
    const response = await fetchImpl(options.endpoint ?? likesEndpoint(), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal: options.signal,
      cache: "no-store",
    });
    if (!response.ok) return null;
    const payload: unknown = await response.json();
    return normalizeLikesPayload(payload);
  } catch {
    return null;
  }
}