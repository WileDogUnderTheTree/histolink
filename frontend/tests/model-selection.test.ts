/**
 * 模型注册表 + 请求级模型选择单测（V1.0.5.2）。
 */

import { describe, expect, it } from "vitest";

import {
  FALLBACK_MODEL_OPTIONS,
  agentModelsEndpoint,
  answerViewFromEnvelope,
  buildAskRequest,
  fetchAgentModels,
  findModelName,
  modelsStateFromPayload,
  shouldShowModelFallbackHint,
  type AnswerEnvelope,
} from "@/lib/agent-client";

const PRIMARY = "Qwen/Qwen3.5-35B-A3B";
const FALLBACK = "Qwen/Qwen3.5-8B-Instruct";

function jsonResponse(payload: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(payload), {
    status: 200,
    headers: { "Content-Type": "application/json" },
    ...init,
  });
}

const BASE_PARAMS = {
  question: "赤壁之战发生在哪一年？",
  pathname: "/ask",
  search: "",
  sessionId: "session_test",
  history: [],
};

describe("agentModelsEndpoint", () => {
  it("默认走同源代理", () => {
    expect(agentModelsEndpoint()).toContain("/api/agent/models");
  });
});

describe("modelsStateFromPayload", () => {
  it("解析主 / 备模型与默认模型", () => {
    const state = modelsStateFromPayload({
      ok: true,
      models: [
        { id: PRIMARY, name: PRIMARY, role: "primary", description: "主模型" },
        { id: FALLBACK, name: FALLBACK, role: "fallback" },
      ],
      default_model_id: PRIMARY,
    });
    expect(state?.models).toHaveLength(2);
    expect(state?.defaultModelId).toBe(PRIMARY);
  });

  it("非法形状返回 null", () => {
    expect(modelsStateFromPayload(null)).toBeNull();
    expect(modelsStateFromPayload({ ok: false })).toBeNull();
    expect(modelsStateFromPayload({ ok: true, models: [] })).toBeNull();
    expect(
      modelsStateFromPayload({ ok: true, models: [{ id: "", name: "", role: "x" }] }),
    ).toBeNull();
  });
});

describe("fetchAgentModels", () => {
  it("读取成功时返回服务端注册表", async () => {
    const state = await fetchAgentModels({
      fetchImpl: (async () =>
        jsonResponse({
          ok: true,
          models: [{ id: PRIMARY, name: PRIMARY, role: "primary" }],
          default_model_id: PRIMARY,
        })) as typeof fetch,
    });
    expect(state.fromFallback).toBe(false);
    expect(state.models[0].id).toBe(PRIMARY);
  });

  it("后端不可达 / 响应异常时回退静态表（不阻塞提问）", async () => {
    const offline = await fetchAgentModels({
      fetchImpl: (async () => {
        throw new Error("offline");
      }) as typeof fetch,
    });
    expect(offline.fromFallback).toBe(true);
    expect(offline.models.map((model) => model.id)).toEqual([
      FALLBACK_MODEL_OPTIONS[0].id,
      FALLBACK_MODEL_OPTIONS[1].id,
    ]);

    const badShape = await fetchAgentModels({
      fetchImpl: (async () => jsonResponse({ ok: true, models: [] })) as typeof fetch,
    });
    expect(badShape.fromFallback).toBe(true);
  });
});

describe("buildAskRequest 携带 model_id", () => {
  it("选中模型时写入 model_id；未选中不写（后端用默认主模型）", () => {
    const withModel = buildAskRequest({ ...BASE_PARAMS, modelId: FALLBACK });
    expect(withModel.model_id).toBe(FALLBACK);

    const withoutModel = buildAskRequest(BASE_PARAMS);
    expect(withoutModel.model_id).toBeUndefined();
  });
});

describe("shouldShowModelFallbackHint（V1.0.5.2 双向降级）", () => {
  it("手动选择备用模型时：实际为主模型 → 提示；实际为所选模型 → 不提示", () => {
    expect(shouldShowModelFallbackHint(PRIMARY, FALLBACK)).toBe(true);
    expect(shouldShowModelFallbackHint(FALLBACK, FALLBACK)).toBe(false);
  });

  it("手动选择主模型时：实际为备用模型 → 提示", () => {
    expect(shouldShowModelFallbackHint(FALLBACK, PRIMARY)).toBe(true);
    expect(shouldShowModelFallbackHint(PRIMARY, PRIMARY)).toBe(false);
  });

  it("未传所选模型时沿用 V1.0.5 的 35B 特征判断", () => {
    expect(shouldShowModelFallbackHint(FALLBACK)).toBe(true);
    expect(shouldShowModelFallbackHint(PRIMARY)).toBe(false);
    expect(shouldShowModelFallbackHint(null)).toBe(false);
  });
});

describe("answerViewFromEnvelope 归一化 model_requested / sources", () => {
  it("把 trace 的模型与双源覆盖映射到视图", () => {
    const envelope = {
      ok: true,
      request_id: "req_1",
      snapshot: { version: "v1-test", hash: `sha256:${"a".repeat(64)}` },
      answer: {
        markdown: "**[人物关系图]**\n…",
        mode: "grounded",
        claims: [{ id: "c1", text: "…", citation_ids: ["c1"] }],
      },
      citations: [],
      entities: [],
      ui_actions: [],
      trace: {
        model: PRIMARY,
        model_used: PRIMARY,
        model_requested: FALLBACK,
        sources: { timeline: true, graph: true },
      },
    } as unknown as AnswerEnvelope;

    const view = answerViewFromEnvelope(envelope);
    expect(view?.modelRequested).toBe(FALLBACK);
    expect(view?.sources).toEqual({ timeline: true, graph: true });
  });

  it("没有 trace 时 modelRequested 回退到调用方传入的所选模型", () => {
    const envelope = {
      ok: true,
      request_id: "req_2",
      snapshot: { version: "v1-test", hash: `sha256:${"b".repeat(64)}` },
      answer: {
        markdown: "**[时间轴·大事记]**\n…",
        mode: "grounded",
        claims: [{ id: "c1", text: "…", citation_ids: ["c1"] }],
      },
      citations: [],
      entities: [],
      ui_actions: [],
    } as unknown as AnswerEnvelope;

    const view = answerViewFromEnvelope(envelope, { requestedModel: PRIMARY });
    expect(view?.modelRequested).toBe(PRIMARY);
    expect(view?.sources).toBeNull();
  });
});

describe("findModelName", () => {
  it("按 id 找全称，找不到返回 null", () => {
    expect(findModelName([...FALLBACK_MODEL_OPTIONS], FALLBACK)).toBe(FALLBACK);
    expect(findModelName([...FALLBACK_MODEL_OPTIONS], "unknown")).toBeNull();
  });
});