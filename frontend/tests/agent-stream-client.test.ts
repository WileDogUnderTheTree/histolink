/**
 * 流式直答客户端单测（V1.0.6.2）。
 *
 * 覆盖：SSE 帧跨 chunk 缓冲、start/delta/done 分发、error 事件、非 2xx 错误信封、
 * 网络异常、请求组装（问题 / 会话 / 历史 / 模型 id）。全部离线。
 */
import { describe, expect, it, vi } from "vitest";

import {
  AgentClientError,
  RATE_LIMIT_MESSAGE,
  buildChatStreamRequest,
  chatStreamEndpoint,
  normalizeRestoredAnswerView,
  postChatStream,
  streamedAnswerView,
  type ChatStreamDone,
  type ChatStreamRequest,
} from "@/lib/agent-client";

const REQUEST: ChatStreamRequest = {
  question: "赤壁之战发生在哪一年？",
  session_id: "session_stream_test",
  enable_thinking: false,
};

function sseResponse(chunks: string[], init: ResponseInit = {}): Response {
  const encoder = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
      controller.close();
    },
  });
  return new Response(body, {
    status: 200,
    headers: { "Content-Type": "text/event-stream" },
    ...init,
  });
}

function asFetch(response: Response): typeof fetch {
  return vi.fn(async () => response) as unknown as typeof fetch;
}

function frame(payload: unknown): string {
  return `data: ${JSON.stringify(payload)}\n\n`;
}

function makeDone(answer: string): string {
  return frame({
    type: "done",
    answer,
    model: "hf.co/mradermacher/XiaoHong-v1-GGUF:Q4_K_M",
    latency_ms: 1200,
    first_token_ms: 300,
    reasoning_chars: 42,
    filtered_chars: 51,
    usage: { completion_tokens: 30, prompt_tokens: 20, total_tokens: 50 },
  });
}

describe("postChatStream", () => {
  it("逐帧回调 delta，并在 done 时返回完整结果", async () => {
    const response = sseResponse([
      frame({
        type: "start",
        request_id: "req_s1",
        session_id: "session_stream_test",
        model: "m",
      }),
      frame({ type: "delta", text: "赤壁之战" }),
      frame({ type: "delta", text: "发生在公元 208 年。" }),
      makeDone("赤壁之战发生在公元 208 年。"),
    ]);
    const deltas: string[] = [];
    let started = false;
    const result = await postChatStream(
      REQUEST,
      {
        onStart: () => {
          started = true;
        },
        onDelta: (delta, full) => {
          deltas.push(full);
          expect(delta.length).toBeGreaterThan(0);
        },
      },
      { fetchImpl: asFetch(response) },
    );

    expect(started).toBe(true);
    expect(deltas).toEqual(["赤壁之战", "赤壁之战发生在公元 208 年。"]);
    expect(result.answer).toBe("赤壁之战发生在公元 208 年。");
    expect(result.reasoningChars).toBe(42);
    expect(result.filteredChars).toBe(51);
    expect(result.firstTokenMs).toBe(300);
    expect(result.usage?.total_tokens).toBe(50);
    // V1.0.6.2「深度思考」观测字段：缺失时按关闭 / 未回退处理。
    expect(result.enableThinking).toBe(false);
    expect(result.thinkingFallback).toBe(false);
  });

  it("跨 chunk 切断的 SSE 帧不会丢失内容", async () => {
    const response = sseResponse([
      'data: {"type":"del',
      'ta","text":"赤壁"}\n\ndata: {"type":"delta","text":"之战"}\n\n',
      makeDone("赤壁之战"),
    ]);
    const result = await postChatStream(REQUEST, {}, { fetchImpl: asFetch(response) });
    expect(result.answer).toBe("赤壁之战");
  });

  it("error 事件抛 AgentClientError（不把半截答案当成功）", async () => {
    const makeResponse = () =>
      sseResponse([
        frame({ type: "start", request_id: "req_s2", model: "m" }),
        frame({ type: "delta", text: "半截" }),
        frame({
          type: "error",
          code: "LLM_UPSTREAM_ERROR",
          message: "上游返回 HTTP 500：boom",
          retryable: true,
        }),
      ]);
    await expect(
      postChatStream(REQUEST, {}, { fetchImpl: asFetch(makeResponse()) }),
    ).rejects.toBeInstanceOf(AgentClientError);
    await expect(
      postChatStream(REQUEST, {}, { fetchImpl: asFetch(makeResponse()) }),
    ).rejects.toThrow("上游返回 HTTP 500");
  });

  it("非 2xx 的错误信封转成可读错误", async () => {
    const response = new Response(
      JSON.stringify({
        ok: false,
        request_id: "req_s3",
        error: { code: "INVALID_REQUEST", message: "未知模型：x", retryable: false },
      }),
      { status: 400, headers: { "Content-Type": "application/json" } },
    );
    await expect(
      postChatStream(REQUEST, {}, { fetchImpl: asFetch(response) }),
    ).rejects.toThrow("未知模型：x");
  });

  it("429 返回友好限流文案", async () => {
    const response = new Response("{}", { status: 429 });
    await expect(
      postChatStream(REQUEST, {}, { fetchImpl: asFetch(response) }),
    ).rejects.toThrow(RATE_LIMIT_MESSAGE);
  });

  it("网络异常提示后端未启动", async () => {
    const fetchImpl = vi.fn(async () => {
      throw new Error("ECONNREFUSED");
    }) as unknown as typeof fetch;
    await expect(postChatStream(REQUEST, {}, { fetchImpl })).rejects.toThrow(
      "无法连接史脉服务",
    );
  });

  it("流在没有 done 的情况下结束 → 明确报错", async () => {
    const response = sseResponse([
      frame({ type: "start", request_id: "req_s4", model: "m" }),
      frame({ type: "delta", text: "半截" }),
    ]);
    await expect(
      postChatStream(REQUEST, {}, { fetchImpl: asFetch(response) }),
    ).rejects.toThrow("流式回答意外中断");
  });
});

describe("buildChatStreamRequest", () => {
  const history = [
    { id: "t1", role: "user" as const, content: "赤壁之战是哪一年？" },
    { id: "t2", role: "assistant" as const, content: "公元 208 年。" },
    { id: "t3", role: "assistant" as const, content: "错误提示", skipHistory: true },
  ];

  it("组装问题 / 会话 / 历史 / 模型 id", () => {
    const request = buildChatStreamRequest({
      question: "  那官渡之战呢？ ",
      sessionId: " session_x ",
      history,
      modelId: "hf.co/mradermacher/XiaoHong-v1-GGUF:Q4_K_M",
    });
    expect(request.question).toBe("那官渡之战呢？");
    expect(request.session_id).toBe("session_x");
    expect(request.history).toEqual([
      { role: "user", content: "赤壁之战是哪一年？" },
      { role: "assistant", content: "公元 208 年。" },
    ]);
    expect(request.model_id).toBe("hf.co/mradermacher/XiaoHong-v1-GGUF:Q4_K_M");
    // V1.0.6.2：深度思考默认关闭（快速直答）。
    expect(request.enable_thinking).toBe(false);
  });

  it("深度思考开启时请求体透传 enable_thinking=true（V1.0.6.2）", () => {
    const request = buildChatStreamRequest({
      question: "玄武门之变发生在哪一年？",
      sessionId: "session_x",
      history: [],
      enableThinking: true,
    });
    expect(request.enable_thinking).toBe(true);
    expect(request.history).toEqual([]);
  });

  it("空问题 / 空会话 id 抛错", () => {
    expect(() =>
      buildChatStreamRequest({ question: "  ", sessionId: "s", history }),
    ).toThrow(AgentClientError);
    expect(() =>
      buildChatStreamRequest({ question: "问题", sessionId: " ", history }),
    ).toThrow(AgentClientError);
  });
});

describe("chatStreamEndpoint", () => {
  it("默认走同源代理", () => {
    const previous = process.env.NEXT_PUBLIC_API_BASE;
    delete process.env.NEXT_PUBLIC_API_BASE;
    try {
      expect(chatStreamEndpoint()).toBe("/api/agent/chat_stream");
    } finally {
      if (previous === undefined) delete process.env.NEXT_PUBLIC_API_BASE;
      else process.env.NEXT_PUBLIC_API_BASE = previous;
    }
  });
});

// ===========================================================================
// V1.0.6.2 专项修复（痛点 1）：直答 done.ui_actions → 史引联动视图
// ===========================================================================

const GUIDE_ACTION = {
  id: "infer-timeline.focus_event",
  type: "timeline.focus_event",
  payload: { event_id: "handong-chibi" },
  target: { surface: "timeline", params: { event_id: "handong-chibi" } },
  auto: true,
  label: "在时间轴中查看",
  reason: "服务端意图后置推断（模型未返回 UI 动作）",
} as const;

function donePayload(extra: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    type: "done",
    answer: "赤壁之战发生在建安十三年（208年）。",
    model: "hf.co/mradermacher/XiaoHong-v1-GGUF:Q4_K_M",
    latency_ms: 1000,
    request_id: "req_stream_actions",
    ui_actions: [GUIDE_ACTION],
    ...extra,
  };
}

function emptyDone(): ChatStreamDone {
  return {
    answer: "答案",
    model: "m",
    latencyMs: 1,
    firstTokenMs: null,
    reasoningChars: 0,
    filteredChars: 0,
    usage: null,
    uiActions: [],
    requestId: "req-x",
    dedupedChars: 0,
    repetitionStopped: false,
    enableThinking: false,
    thinkingFallback: false,
  };
}

describe("直答 UI 动作与史引联动（V1.0.6.2 痛点 1）", () => {
  it("done 事件解析 ui_actions：保留合法动作、丢弃未知类型 / 缺 surface", async () => {
    const response = sseResponse([
      frame({ type: "delta", text: "赤壁之战发生在建安十三年（208年）。" }),
      frame(
        donePayload({
          ui_actions: [
            GUIDE_ACTION,
            { id: "bad-1", type: "unknown.action", target: { surface: "timeline" } },
            { id: "bad-2", type: "timeline.focus_event", payload: {}, target: {} },
          ],
        }),
      ),
    ]);
    const result = await postChatStream(REQUEST, {}, { fetchImpl: asFetch(response) });

    expect(result.uiActions).toHaveLength(1);
    expect(result.uiActions[0]?.type).toBe("timeline.focus_event");
    expect(
      (result.uiActions[0]?.payload as Record<string, unknown> | undefined)?.event_id,
    ).toBe("handong-chibi");
    expect(result.requestId).toBe("req_stream_actions");
  });

  it("旧后端 done 缺 ui_actions 时按空数组处理（向后兼容）", async () => {
    const response = sseResponse([
      frame(donePayload({ ui_actions: undefined })),
    ]);
    const result = await postChatStream(REQUEST, {}, { fetchImpl: asFetch(response) });

    expect(result.uiActions).toEqual([]);
    expect(result.dedupedChars).toBe(0);
    expect(result.repetitionStopped).toBe(false);
  });

  it("done 事件解析深度思考观测字段（enable_thinking / thinking_fallback）", async () => {
    const response = sseResponse([
      frame(
        donePayload({
          enable_thinking: true,
          thinking_fallback: true,
          reasoning_chars: 128,
        }),
      ),
    ]);
    const result = await postChatStream(REQUEST, {}, { fetchImpl: asFetch(response) });
    expect(result.enableThinking).toBe(true);
    expect(result.thinkingFallback).toBe(true);
    expect(result.reasoningChars).toBe(128);
  });

  it("streamedAnswerView：有动作时构造 streamed 视图（前端据此自动展开史引）", () => {
    const done: ChatStreamDone = {
      ...emptyDone(),
      answer: "赤壁之战发生在建安十三年（208年）。",
      uiActions: [GUIDE_ACTION as unknown as ChatStreamDone["uiActions"][number]],
    };
    const view = streamedAnswerView(done, {
      requestId: "req-1",
      modelRequested: "hf.co/mradermacher/XiaoHong-v1-GGUF:Q4_K_M",
    });

    expect(view).not.toBeNull();
    expect(view?.streamed).toBe(true);
    expect(view?.mode).toBe("grounded");
    expect(view?.markdown).toBe(done.answer);
    expect(view?.uiActions).toHaveLength(1);
    expect(view?.citations).toEqual([]);
    expect(view?.factCheck).toBeNull();
    expect(view?.requestId).toBe("req-1");
  });

  it("streamedAnswerView：没有动作时返回 null（不构造伪「已核验」回答）", () => {
    expect(streamedAnswerView(emptyDone())).toBeNull();
  });

  it("normalizeRestoredAnswerView 保留 streamed 标记（刷新后不冒充已核验）", () => {
    const view = normalizeRestoredAnswerView({
      mode: "grounded",
      markdown: "答案",
      citations: [],
      uiActions: [GUIDE_ACTION],
      streamed: true,
    });
    expect(view?.streamed).toBe(true);
    const legacy = normalizeRestoredAnswerView({ mode: "grounded", markdown: "答案" });
    expect(legacy?.streamed).toBe(false);
  });
});

