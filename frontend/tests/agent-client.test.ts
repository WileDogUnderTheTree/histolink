/**
 * Agent 数据层单测（V1.0.4）。
 *
 * 覆盖：页面上下文推导、history 过滤、请求组装、fetch 错误映射、信封归一化、
 * 动作 id 命名空间。全部离线（不访问 8000 端口）。
 */
import { afterEach, describe, expect, it } from "vitest";

import {
  AgentClientError,
  MAX_HISTORY_TURNS,
  MODEL_FALLBACK_HINT,
  agentAskEndpoint,
  answerViewFromEnvelope,
  buildAskRequest,
  clarificationTextFromEnvelope,
  createSessionId,
  errorMessageFromEnvelope,
  historyFromTranscript,
  isAnswerEnvelope,
  isErrorEnvelope,
  namespaceUiActions,
  postAsk,
  RATE_LIMIT_MESSAGE,
  readPageContext,
  shouldShowModelFallbackHint,
  type AgentResponse,
  type AnswerEnvelope,
  type ErrorEnvelope,
  type UIAction,
} from "@/lib/agent-client";

const SESSION_ID = "session_test";

const ANSWER_ENVELOPE = {
  ok: true,
  request_id: "req_abc",
  schema_version: "1.0",
  snapshot: { version: "v1-test", hash: `sha256:${"a".repeat(64)}` },
  answer: {
    markdown: "赤壁之战（东汉，208年）：曹操南下荆州……",
    mode: "grounded",
    certainty: "high",
    claims: [{ id: "c1", text: "服务端生成的 claim", citation_ids: ["cite-handong-chibi-0"] }],
    missing: [],
    reason_code: null,
    related_event_ids: ["handong-chibi"],
  },
  citations: [{ id: "cite-handong-chibi-0", kind: "event", title: "赤壁之战" }],
  entities: [{ kind: "event", event_id: "handong-chibi", title: "赤壁之战" }],
  ui_actions: [
    {
      id: "act-1",
      type: "timeline.focus_event",
      payload: { event_id: "handong-chibi" },
      target: { surface: "timeline", params: { event_id: "handong-chibi" } },
      auto: true,
      label: "在时间轴中查看",
    },
  ],
  clarification: null,
};

const ERROR_ENVELOPE = {
  ok: false,
  request_id: "req_err",
  error: {
    code: "LLM_TIMEOUT",
    message: "模型服务超时",
    retryable: true,
    details: { model: "qwen" },
  },
};

function asAnswer(): AnswerEnvelope {
  return ANSWER_ENVELOPE as unknown as AnswerEnvelope;
}

function asError(): ErrorEnvelope {
  return ERROR_ENVELOPE as unknown as ErrorEnvelope;
}

function mockFetch(payload: unknown, status = 200): typeof fetch {
  return (async () =>
    new Response(JSON.stringify(payload), {
      status,
      headers: { "Content-Type": "application/json" },
    })) as unknown as typeof fetch;
}

const BASE_TURNS = [
  { role: "assistant" as const, content: "欢迎语", skipHistory: true },
  { role: "user" as const, content: "赤壁之战发生在哪一年？" },
  { role: "assistant" as const, content: "赤壁之战发生在 208 年。" },
  { role: "assistant" as const, content: "网络错误", skipHistory: true },
];

afterEach(() => {
  delete process.env.NEXT_PUBLIC_API_BASE;
});

describe("readPageContext", () => {
  it("从时间轴 URL 推导 route / mode / dynasty / event", () => {
    const context = readPageContext(
      "/timeline",
      "?event=handong-chibi&dynasty=%E4%B8%9C%E6%B1%89&mode=detail",
    );
    expect(context.route).toBe("/timeline");
    expect(context.mode).toBe("detail");
    expect(context.event_id).toBe("handong-chibi");
    expect(context.dynasty).toBe("东汉");
  });

  it("graph URL 的 person 只有稳定 ID 才作为 person_id", () => {
    expect(readPageContext("/graph", "?person=p-zhouyu-b475&era=sanguo").person_id).toBe(
      "p-zhouyu-b475",
    );
    expect(readPageContext("/graph", "?person=%E5%91%A8%E7%91%9C").person_id).toBeUndefined();
  });

  it("无 mode 时默认 browse，空路径回退 /", () => {
    expect(readPageContext("", "").mode).toBe("browse");
    expect(readPageContext("", "").route).toBe("/");
  });
});

describe("historyFromTranscript", () => {
  it("过滤欢迎语 / 错误提示，保留最近 N 轮", () => {
    expect(historyFromTranscript(BASE_TURNS)).toEqual([
      { role: "user", content: "赤壁之战发生在哪一年？" },
      { role: "assistant", content: "赤壁之战发生在 208 年。" },
    ]);
  });

  it("最多保留 10 轮，超长内容截断到 4000 字", () => {
    const turns = Array.from({ length: 20 }, (_, index) => ({
      role: (index % 2 === 0 ? "user" : "assistant") as "user" | "assistant",
      content: `turn-${index}`,
    }));
    const history = historyFromTranscript(turns);
    expect(history).toHaveLength(MAX_HISTORY_TURNS);
    expect(history[0]).toEqual({ role: "user", content: "turn-10" });

    const long = historyFromTranscript([{ role: "user", content: "x".repeat(5000) }]);
    expect(long[0].content).toHaveLength(4000);
  });
});

describe("buildAskRequest", () => {
  it("组装 AskRequest（问题去空格、带 context/history/schema 版本）", () => {
    const request = buildAskRequest({
      question: "  赤壁之战发生在哪一年？  ",
      pathname: "/timeline",
      search: "?event=handong-chibi&mode=detail",
      sessionId: SESSION_ID,
      history: BASE_TURNS,
    });
    expect(request.question).toBe("赤壁之战发生在哪一年？");
    expect(request.session_id).toBe(SESSION_ID);
    expect(request.client_schema_version).toBe("1.0");
    expect(request.context).toMatchObject({ route: "/timeline", mode: "detail", event_id: "handong-chibi" });
    expect(request.history).toHaveLength(2);
  });

  it("空问题 / 超长问题 / 空 sessionId 抛 AgentClientError", () => {
    const base = {
      pathname: "/timeline",
      search: "",
      sessionId: SESSION_ID,
      history: [],
    };
    expect(() => buildAskRequest({ ...base, question: "   " })).toThrow(AgentClientError);
    expect(() => buildAskRequest({ ...base, question: "x".repeat(2001) })).toThrow(AgentClientError);
    expect(() =>
      buildAskRequest({ ...base, question: "hi", sessionId: "  " }),
    ).toThrow(AgentClientError);
  });
});

describe("agentAskEndpoint", () => {
  it("默认走同源代理，NEXT_PUBLIC_API_BASE 可覆盖", () => {
    expect(agentAskEndpoint()).toBe("/api/agent/ask");
    process.env.NEXT_PUBLIC_API_BASE = "http://127.0.0.1:8000/";
    expect(agentAskEndpoint()).toBe("http://127.0.0.1:8000/api/agent/ask");
  });
});

describe("postAsk", () => {
  const request = buildAskRequest({
    question: "赤壁之战",
    pathname: "/timeline",
    search: "",
    sessionId: SESSION_ID,
    history: [],
  });

  it("成功：返回 AnswerEnvelope", async () => {
    const response = await postAsk(request, { fetchImpl: mockFetch(ANSWER_ENVELOPE) });
    expect(isAnswerEnvelope(response)).toBe(true);
    expect((response as AnswerEnvelope).answer?.markdown).toContain("赤壁之战");
  });

  it("后端 ErrorEnvelope 原样返回（不抛异常）", async () => {
    const response = await postAsk(request, { fetchImpl: mockFetch(ERROR_ENVELOPE, 504) });
    expect(isErrorEnvelope(response)).toBe(true);
    expect(errorMessageFromEnvelope(response as ErrorEnvelope)).toBe("模型服务超时");
  });

  it("非 JSON 响应抛 AgentClientError", async () => {
    const fetchImpl = (async () =>
      new Response("<html>bad gateway</html>", { status: 502 })) as unknown as typeof fetch;
    await expect(postAsk(request, { fetchImpl })).rejects.toBeInstanceOf(AgentClientError);
  });

  it("HTTP 429 映射成中文限流提示，不泄露原始网关错误", async () => {
    const fetchImpl = (async () => new Response("HTTP 429 Too Many Requests", { status: 429 })) as unknown as typeof fetch;
    await expect(postAsk(request, { fetchImpl })).rejects.toThrow(RATE_LIMIT_MESSAGE);
  });

  it("无法识别的 JSON 形状抛 AgentClientError", async () => {
    await expect(postAsk(request, { fetchImpl: mockFetch({ hello: "world" }) })).rejects.toBeInstanceOf(
      AgentClientError,
    );
  });

  it("网络异常转成中文提示", async () => {
    const fetchImpl = (async () => {
      throw new TypeError("fetch failed");
    }) as unknown as typeof fetch;
    await expect(postAsk(request, { fetchImpl })).rejects.toThrow("无法连接史脉服务");
  });
});

describe("answerViewFromEnvelope", () => {
  it("归一化 markdown / certainty / citations / actions", () => {
    const view = answerViewFromEnvelope(asAnswer());
    expect(view).not.toBeNull();
    expect(view?.mode).toBe("grounded");
    expect(view?.certainty).toBe("high");
    expect(view?.markdown).toContain("赤壁之战");
    expect(view?.citations).toHaveLength(1);
    expect(view?.entities).toHaveLength(1);
    expect(view?.uiActions).toHaveLength(1);
    expect(view?.snapshotVersion).toBe("v1-test");
    // 信封没有 trace → 未上报最终模型，不展示降级提示。
    expect(view?.modelUsed).toBeNull();
  });

  it("把 trace.model_used 归一化为 modelUsed（V1.0.5 自动降级）", () => {
    const fallbackEnvelope = {
      ...ANSWER_ENVELOPE,
      trace: {
        tools: [],
        model: "Qwen/Qwen3.5-35B-A3B",
        model_used: "Qwen/Qwen3.5-8B-Instruct",
        latency_ms: 1200,
      },
    } as unknown as AnswerEnvelope;
    const view = answerViewFromEnvelope(fallbackEnvelope);
    expect(view?.modelUsed).toBe("Qwen/Qwen3.5-8B-Instruct");
    expect(shouldShowModelFallbackHint(view?.modelUsed)).toBe(true);
  });

  it("澄清信封没有 answer → null，并给出来源文案", () => {
    const clarificationEnvelope = {
      ...ANSWER_ENVELOPE,
      answer: null,
      clarification: {
        id: "clar_1",
        type: "entity",
        question: "你指的是哪一位梁太后？",
        candidates: [
          { person_id: "p-1", name: "梁太后", disambiguator: "西夏·毅宗后" },
          { person_id: "p-2", name: "梁太后", disambiguator: "东汉·顺帝后" },
        ],
      },
    } as unknown as AnswerEnvelope;
    expect(answerViewFromEnvelope(clarificationEnvelope)).toBeNull();
    const text = clarificationTextFromEnvelope(clarificationEnvelope);
    expect(text).toContain("哪一位梁太后");
    expect(text).toContain("西夏·毅宗后");
  });
});

describe("shouldShowModelFallbackHint", () => {
  it("未手动选模型时：非 35B（备用模型）才提示，主模型 / 未上报不提示", () => {
    expect(shouldShowModelFallbackHint("Qwen/Qwen3.5-8B-Instruct")).toBe(true);
    expect(shouldShowModelFallbackHint("Qwen/Qwen3.5-35B-A3B")).toBe(false);
    expect(shouldShowModelFallbackHint("qwen3.5-35b-a3b")).toBe(false);
    expect(shouldShowModelFallbackHint(null)).toBe(false);
    expect(shouldShowModelFallbackHint(undefined)).toBe(false);
    expect(shouldShowModelFallbackHint("   ")).toBe(false);
    expect(MODEL_FALLBACK_HINT).toContain("模型");
  });

  it("V1.0.5.2：手动选择模型后按「实际模型 ≠ 所选模型」判断（双向降级）", () => {
    expect(shouldShowModelFallbackHint("Qwen/Qwen3.5-35B-A3B", "Qwen/Qwen3.5-8B-Instruct")).toBe(true);
    expect(shouldShowModelFallbackHint("Qwen/Qwen3.5-8B-Instruct", "Qwen/Qwen3.5-8B-Instruct")).toBe(false);
    expect(shouldShowModelFallbackHint("Qwen/Qwen3.5-8B-Instruct", "Qwen/Qwen3.5-35B-A3B")).toBe(true);
  });
});

describe("namespaceUiActions", () => {
  it("用 request_id 前缀并去重", () => {
    const action = ANSWER_ENVELOPE.ui_actions[0] as unknown as UIAction;
    const namespaced = namespaceUiActions([action, action], "req_abc");
    expect(namespaced).toHaveLength(1);
    expect(namespaced[0].id).toBe("req_abc:act-1");
    expect(namespaced[0].label).toBe("在时间轴中查看");
  });
});

describe("createSessionId", () => {
  it("生成 session_ 前缀的稳定形态 id", () => {
    expect(createSessionId()).toMatch(/^session_/);
  });
});

describe("信封类型判断", () => {
  it("区分成功 / 失败 / 非法结构", () => {
    expect(isAnswerEnvelope(ANSWER_ENVELOPE)).toBe(true);
    expect(isErrorEnvelope(ANSWER_ENVELOPE)).toBe(false);
    expect(isErrorEnvelope(ERROR_ENVELOPE)).toBe(true);
    expect(isAnswerEnvelope(ERROR_ENVELOPE)).toBe(false);
    expect(isAnswerEnvelope({ ok: true })).toBe(false);
  });
});

describe("AgentResponse 联合类型", () => {
  it("运行时返回的是可判别的联合", async () => {
    const response: AgentResponse = await postAsk(
      buildAskRequest({
        question: "赤壁之战",
        pathname: "/",
        search: "",
        sessionId: SESSION_ID,
        history: [],
      }),
      { fetchImpl: mockFetch(ERROR_ENVELOPE, 500) },
    );
    expect(response.ok).toBe(false);
  });
});
