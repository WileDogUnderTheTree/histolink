/**
 * 会话管理 API 客户端单测（V1.0.6）。
 *
 * 覆盖：后端响应 → 前端渲染模型的归一化（含刷新后 assistant 回答快照恢复）、
 * localStorage session_id 持久化工具、/api/sessions fetch 封装的失败兜底。
 */

import { describe, expect, it } from "vitest";

import type { AgentAnswerView } from "@/lib/agent-client";
import {
  SESSION_STORAGE_KEY,
  TEST_SESSION_PREFIXES,
  SessionClientError,
  clearStoredSessionId,
  createDisposableSessionId,
  createSession,
  deleteSession,
  fetchSessionDetail,
  fetchSessions,
  isDisposableSessionId,
  normalizeSessionDetail,
  normalizeSessionSummary,
  normalizeStoredSessionAnswer,
  patchSession,
  readStoredSessionId,
  readTestSessionIdFromSearch,
  sessionDetailEndpoint,
  sessionsEndpoint,
  writeStoredSessionId,
  type SessionIdStorage,
} from "@/lib/session-client";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function mockFetch(
  handler: (url: string, init?: RequestInit) => Response,
): { fetchImpl: typeof fetch; requests: Array<{ url: string; init?: RequestInit }> } {
  const requests: Array<{ url: string; init?: RequestInit }> = [];
  const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    requests.push({ url, init });
    return handler(url, init);
  }) as typeof fetch;
  return { fetchImpl, requests };
}

function memoryStorage(initial: Record<string, string> = {}): SessionIdStorage {
  const values = new Map(Object.entries(initial));
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => {
      values.set(key, value);
    },
    removeItem: (key) => {
      values.delete(key);
    },
  };
}

const ASSISTANT_ANSWER_SNAPSHOT = {
  answer: {
    mode: "grounded",
    markdown: "**根据本轮工具返回的可核验资料：** 两人是对手。",
    certainty: "high",
    claims: [{ id: "c1", text: "两人是对手。", citation_ids: ["cite-relation-刘备__曹操"] }],
    missing: [],
    reason_code: null,
    related_event_ids: ["handong-chibi"],
    comparison_analysis: { text: "**背景**：材料未提供。" },
  },
  citations: [{ id: "cite-relation-刘备__曹操", kind: "relation" }],
  entities: [{ kind: "person", person_id: "p-caocao-b012", name: "曹操" }],
  ui_actions: [],
  trace: {
    model_used: "Qwen/Qwen3.5-35B-A3B",
    model_requested: null,
    sources: { timeline: true, graph: true },
    fact_check: {
      status: "passed",
      issues: [],
      warnings: [],
      checked_years: 1,
      checked_persons: 0,
      checked_books: 1,
      checked_quotes: 0,
      checked_numbers: 0,
    },
  },
  request_id: "req_abc",
  snapshot_version: "v1-8fdf1b883355",
};

describe("归一化：后端会话结构 → 前端渲染模型", () => {
  it("normalizeSessionSummary 映射 snake_case 并丢弃非法项", () => {
    expect(
      normalizeSessionSummary({
        session_id: "session_a",
        title: "曹操和刘备是什么关系？",
        created_at: 100,
        updated_at: 200,
        pinned: true,
        turn_count: 4,
      }),
    ).toEqual({
      id: "session_a",
      title: "曹操和刘备是什么关系？",
      createdAt: 100,
      updatedAt: 200,
      pinned: true,
      turnCount: 4,
    });
    expect(normalizeSessionSummary({ session_id: "", title: "x" })).toBeNull();
    expect(normalizeSessionSummary(null)).toBeNull();
  });

  it("normalizeStoredSessionAnswer 恢复刷新后的完整回答视图（引用 / 来源 / 对比分析）", () => {
    const view = normalizeStoredSessionAnswer(ASSISTANT_ANSWER_SNAPSHOT);
    expect(view).not.toBeNull();
    const answer = view as AgentAnswerView;
    expect(answer.mode).toBe("grounded");
    expect(answer.markdown).toContain("两人是对手");
    expect(answer.citations[0].id).toBe("cite-relation-刘备__曹操");
    expect(answer.entities[0].name).toBe("曹操");
    expect(answer.modelUsed).toBe("Qwen/Qwen3.5-35B-A3B");
    expect(answer.sources).toEqual({ timeline: true, graph: true });
    expect(answer.comparisonAnalysis?.text).toContain("材料未提供");
    // V1.0.6.1：刷新后仍恢复文本级事实核查状态。
    expect(answer.factCheck).toEqual({ status: "passed", issues: [] });
  });

  it("normalizeStoredSessionAnswer 对损坏 / 空正文返回 null（不渲染坏数据）", () => {
    expect(normalizeStoredSessionAnswer(null)).toBeNull();
    expect(normalizeStoredSessionAnswer({})).toBeNull();
    expect(
      normalizeStoredSessionAnswer({ answer: { mode: "grounded", markdown: "   " } }),
    ).toBeNull();
  });

  it("normalizeStoredSessionAnswer 恢复直答轮次的 ui_actions / streamed（V1.0.8 Bug 1）", () => {
    const view = normalizeStoredSessionAnswer({
      answer: {
        mode: "grounded",
        markdown: "赤壁之战发生在公元 208 年。",
        certainty: null,
        missing: [],
        reason_code: null,
      },
      citations: [],
      entities: [],
      ui_actions: [
        {
          id: "act-1",
          type: "timeline.focus_event",
          payload: { event_id: "handong-chibi" },
          target: { surface: "timeline", params: { event_id: "handong-chibi" } },
          auto: true,
          label: "在时间轴中查看",
          reason: null,
        },
      ],
      trace: { model_used: "XiaoHong-v1", model_requested: null, sources: null },
      request_id: "req_stream",
      snapshot_version: "",
      streamed: true,
    });
    const answer = view as AgentAnswerView;
    expect(answer.streamed).toBe(true);
    expect(answer.uiActions).toHaveLength(1);
    expect(answer.uiActions[0]?.type).toBe("timeline.focus_event");
    expect(answer.uiActions[0]?.payload).toMatchObject({ event_id: "handong-chibi" });
  });

  it("normalizeStoredSessionAnswer 对旧数据 streamed 缺省为 false", () => {
    const view = normalizeStoredSessionAnswer(ASSISTANT_ANSWER_SNAPSHOT);
    expect((view as AgentAnswerView).streamed).toBe(false);
  });

  it("normalizeSessionDetail 过滤非法轮次并归一化实体记忆", () => {
    const detail = normalizeSessionDetail({
      session_id: "session_a",
      title: "标题",
      created_at: 1,
      updated_at: 2,
      pinned: false,
      turn_count: 5,
      entity_memory: {
        person_ids: ["p-caocao-b012", 123],
        person_names: { "p-caocao-b012": "曹操", bad: 1 },
        event_ids: ["handong-chibi"],
      },
      turns: [
        { role: "user", content: "曹操和刘备是什么关系？", created_at: 1, answer: null },
        { role: "system", content: "非法角色", created_at: 2, answer: null },
        {
          role: "assistant",
          content: "两人是对手。",
          created_at: 3,
          answer: ASSISTANT_ANSWER_SNAPSHOT,
        },
      ],
    });
    expect(detail).not.toBeNull();
    expect(detail?.turnCount).toBe(2);
    expect(detail?.turns.map((turn) => turn.role)).toEqual(["user", "assistant"]);
    expect(detail?.turns[1].answer?.mode).toBe("grounded");
    expect(detail?.entityMemory.personIds).toEqual(["p-caocao-b012"]);
    expect(detail?.entityMemory.personNames).toEqual({ "p-caocao-b012": "曹操" });
  });
});

describe("自动化测试会话隔离（V1.0.6.2 痛点 1）", () => {
  it("测试前缀判定：只认 test_ / e2e_ 等显式前缀", () => {
    for (const prefix of TEST_SESSION_PREFIXES) {
      expect(isDisposableSessionId(`${prefix}abc`)).toBe(true);
    }
    expect(isDisposableSessionId("session_12338a12-af0e")).toBe(false);
    expect(isDisposableSessionId("stream-session-1")).toBe(false);
    expect(isDisposableSessionId("")).toBe(false);
    expect(isDisposableSessionId(null)).toBe(false);
  });

  it("createDisposableSessionId 生成带测试前缀的稳定字符集 id", () => {
    const id = createDisposableSessionId("e2e_", () => 1000);
    expect(id.startsWith("e2e_")).toBe(true);
    expect(id).toMatch(/^[A-Za-z0-9_.:-]+$/);
    expect(id.length).toBeLessThanOrEqual(128);
  });

  it("readTestSessionIdFromSearch 只接受 ?session_id= 的测试会话", () => {
    expect(readTestSessionIdFromSearch("?session_id=e2e_abc123")).toBe("e2e_abc123");
    expect(readTestSessionIdFromSearch("session_id=test_case_1")).toBe("test_case_1");
    // 普通正式会话 id 不能通过 URL 覆盖（避免越权读取用户历史）。
    expect(readTestSessionIdFromSearch("?session_id=session_abc")).toBeNull();
    expect(readTestSessionIdFromSearch("?session_id=../etc/passwd")).toBeNull();
    expect(readTestSessionIdFromSearch("?other=1")).toBeNull();
    expect(readTestSessionIdFromSearch("")).toBeNull();
  });
});

describe("localStorage session_id 持久化", () => {
  it("写入 / 读取 / 清除当前会话 id", () => {
    const storage = memoryStorage();
    expect(readStoredSessionId(storage)).toBeNull();
    writeStoredSessionId("  session_abc  ", storage);
    expect(storage.getItem(SESSION_STORAGE_KEY)).toBe("session_abc");
    expect(readStoredSessionId(storage)).toBe("session_abc");
    clearStoredSessionId(storage);
    expect(readStoredSessionId(storage)).toBeNull();
  });

  it("空值 / 非法存储 / 存储异常都安全返回 null", () => {
    const storage = memoryStorage();
    writeStoredSessionId("   ", storage);
    expect(readStoredSessionId(storage)).toBeNull();
    const broken: SessionIdStorage = {
      getItem: () => {
        throw new Error("denied");
      },
      setItem: () => {
        throw new Error("denied");
      },
      removeItem: () => {
        throw new Error("denied");
      },
    };
    expect(readStoredSessionId(broken)).toBeNull();
    expect(() => writeStoredSessionId("session_a", broken)).not.toThrow();
    expect(() => clearStoredSessionId(broken)).not.toThrow();
  });
});

describe("fetch 封装与失败兜底", () => {
  it("端点：同源 /api/sessions，详情做 URL 编码", () => {
    expect(sessionsEndpoint()).toContain("/api/sessions");
    expect(sessionDetailEndpoint("session_a b")).toContain("session_a%20b");
  });

  it("fetchSessions 成功返回摘要列表，失败 / 结构异常返回 null", async () => {
    const ok = mockFetch(() =>
      jsonResponse({
        ok: true,
        sessions: [
          { session_id: "a", title: "A", created_at: 1, updated_at: 2, pinned: false, turn_count: 2 },
        ],
      }),
    );
    const sessions = await fetchSessions({ fetchImpl: ok.fetchImpl });
    expect(sessions?.map((session) => session.id)).toEqual(["a"]);

    const failed = mockFetch(() => jsonResponse({ ok: false }, 503));
    expect(await fetchSessions({ fetchImpl: failed.fetchImpl })).toBeNull();

    const broken = mockFetch(() => jsonResponse({ ok: true, sessions: "not-array" }));
    expect(await fetchSessions({ fetchImpl: broken.fetchImpl })).toBeNull();

    const offline = (async () => {
      throw new Error("ECONNREFUSED");
    }) as typeof fetch;
    expect(await fetchSessions({ fetchImpl: offline })).toBeNull();
  });

  it("fetchSessionDetail 404 / 网络异常返回 null", async () => {
    const notFound = mockFetch(() => jsonResponse({ ok: false }, 404));
    expect(await fetchSessionDetail("x", { fetchImpl: notFound.fetchImpl })).toBeNull();
  });

  it("createSession 发送 session_id + title 并在失败时抛 SessionClientError", async () => {
    const ok = mockFetch(() =>
      jsonResponse({
        ok: true,
        session: {
          session_id: "session_new",
          title: "新的历史对话",
          created_at: 1,
          updated_at: 1,
          pinned: false,
          turn_count: 0,
          entity_memory: { person_ids: [], person_names: {}, event_ids: [] },
          turns: [],
        },
      }),
    );
    const detail = await createSession({
      fetchImpl: ok.fetchImpl,
      sessionId: "session_new",
      title: "新的历史对话",
    });
    expect(detail.id).toBe("session_new");
    expect(ok.requests[0].init?.method).toBe("POST");
    expect(JSON.parse(String(ok.requests[0].init?.body))).toEqual({
      session_id: "session_new",
      title: "新的历史对话",
    });

    const failed = mockFetch(() => jsonResponse({ ok: false }, 500));
    await expect(
      createSession({ fetchImpl: failed.fetchImpl, sessionId: "x" }),
    ).rejects.toBeInstanceOf(SessionClientError);
  });

  it("patchSession / deleteSession 失败时安全返回 null / false", async () => {
    const failed = mockFetch(() => jsonResponse({ ok: false }, 500));
    expect(await patchSession("x", { title: "t" }, { fetchImpl: failed.fetchImpl })).toBeNull();
    expect(await deleteSession("x", { fetchImpl: failed.fetchImpl })).toBe(false);

    const deleteOk = mockFetch(() => jsonResponse({ ok: true, session_id: "x" }));
    expect(await deleteSession("x", { fetchImpl: deleteOk.fetchImpl })).toBe(true);
  });
});