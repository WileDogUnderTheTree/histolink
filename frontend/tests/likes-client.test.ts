/**
 * 点赞模块前端数据层单测（V1.0.8）。
 *
 * 覆盖：
 * - `GET /api/likes` / `POST /api/likes` 请求方法与响应归一化；
 * - 接口失败 / 结构异常时安全返回 null（不阻塞页面）；
 * - `localStorage.has_liked_shimai` 防刷标记读写。
 */

import { describe, expect, it } from "vitest";

import {
  HAS_LIKED_STORAGE_KEY,
  likesEndpoint,
  normalizeLikesPayload,
  postLike,
  fetchLikes,
  readHasLiked,
  writeHasLiked,
  type LikesStorage,
} from "@/lib/likes-client";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function mockFetch(handler: (url: string, init?: RequestInit) => Response) {
  const requests: Array<{ url: string; init?: RequestInit }> = [];
  const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    requests.push({ url, init });
    return handler(url, init);
  }) as typeof fetch;
  return { fetchImpl, requests };
}

function memoryStorage(): LikesStorage {
  const values = new Map<string, string>();
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => {
      values.set(key, value);
    },
  };
}

describe("点赞接口客户端", () => {
  it("端点走同源 /api/likes", () => {
    expect(likesEndpoint()).toBe("/api/likes");
  });

  it("normalizeLikesPayload 只接受合法 count", () => {
    expect(normalizeLikesPayload({ ok: true, count: 12 })).toBe(12);
    expect(normalizeLikesPayload({ ok: true, count: 0 })).toBe(0);
    expect(normalizeLikesPayload({ ok: true, count: "12" })).toBeNull();
    expect(normalizeLikesPayload({ ok: true, count: -1 })).toBeNull();
    expect(normalizeLikesPayload({ ok: false, count: 1 })).toBeNull();
    expect(normalizeLikesPayload(null)).toBeNull();
  });

  it("fetchLikes：GET 请求并返回总数；失败 / 结构异常返回 null", async () => {
    const ok = mockFetch(() => jsonResponse({ ok: true, count: 7 }));
    expect(await fetchLikes({ fetchImpl: ok.fetchImpl })).toBe(7);
    expect(ok.requests[0].init?.method).toBe("GET");

    const failed = mockFetch(() => jsonResponse({ ok: false }, 503));
    expect(await fetchLikes({ fetchImpl: failed.fetchImpl })).toBeNull();

    const broken = mockFetch(() => jsonResponse({ ok: true }));
    expect(await fetchLikes({ fetchImpl: broken.fetchImpl })).toBeNull();

    const offline = (async () => {
      throw new Error("ECONNREFUSED");
    }) as typeof fetch;
    expect(await fetchLikes({ fetchImpl: offline })).toBeNull();
  });

  it("postLike：POST 请求并返回最新总数；失败返回 null", async () => {
    const ok = mockFetch(() => jsonResponse({ ok: true, count: 8 }));
    expect(await postLike({ fetchImpl: ok.fetchImpl })).toBe(8);
    expect(ok.requests[0].init?.method).toBe("POST");

    const failed = mockFetch(() => jsonResponse({ ok: false }, 405));
    expect(await postLike({ fetchImpl: failed.fetchImpl })).toBeNull();
  });
});

describe("localStorage 防刷标记 has_liked_shimai", () => {
  it("未点过为 false，写入后为 true", () => {
    const storage = memoryStorage();
    expect(readHasLiked(storage)).toBe(false);
    writeHasLiked(storage);
    expect(storage.getItem(HAS_LIKED_STORAGE_KEY)).toBe("1");
    expect(readHasLiked(storage)).toBe(true);
  });

  it("存储不可用时安全降级", () => {
    const broken: LikesStorage = {
      getItem: () => {
        throw new Error("denied");
      },
      setItem: () => {
        throw new Error("denied");
      },
    };
    expect(readHasLiked(broken)).toBe(false);
    expect(() => writeHasLiked(broken)).not.toThrow();
    expect(readHasLiked(null)).toBe(false);
    expect(() => writeHasLiked(null)).not.toThrow();
  });
});