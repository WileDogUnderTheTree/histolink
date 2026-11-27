/**
 * 历史对话数据层单测（V1.0.5.2；V1.0.5.2-layout 补丁；V1.0.6 真实持久化仓库）。
 *
 * 覆盖：时间分组 / 标题生成 / 内存仓库增改查；
 * 布局修复补丁重点回归：**点击查看不得改变列表物理顺序**（syncTurns 不刷新 updatedAt）、
 * 置顶进入最上方「置顶」组、重命名锁定标题、删除后其余项顺序不变；
 * V1.0.6 重点：HTTP 仓库（/api/sessions）列表 / 详情 / 新建 / PATCH / DELETE 映射与失败兜底。
 */

import { describe, expect, it } from "vitest";

import type { RestorableTurn, StoredConversationTurn } from "@/lib/conversation-store";
import {
  createConversationId,
  createHttpConversationRepository,
  createInMemoryConversationRepository,
  groupConversationsByTime,
  mergeCachedTurnAnswers,
  recordFromRemoteSession,
  titleFromTurns,
  type ConversationSummary,
} from "@/lib/conversation-store";

const DAY_MS = 24 * 60 * 60 * 1000;

function summary(id: string, updatedAt: number, pinned = false): ConversationSummary {
  return { id, title: `会话 ${id}`, createdAt: updatedAt, updatedAt, pinned };
}

function turn(role: "user" | "assistant", content: string): StoredConversationTurn {
  return { id: `${role}-${content.slice(0, 4)}`, role, content };
}

describe("groupConversationsByTime", () => {
  const now = new Date("2026-11-25T12:00:00+08:00").getTime();

  it("按「今天 / 过去 30 天」分组并倒序排列", () => {
    const groups = groupConversationsByTime(
      [
        summary("today-old", now - 5 * 60 * 60 * 1000),
        summary("today-new", now - 10 * 60 * 1000),
        summary("month", now - 5 * DAY_MS),
        summary("older", now - 60 * DAY_MS),
      ],
      now,
    );

    expect(groups.map((group) => group.label)).toEqual(["今天", "过去 30 天"]);
    expect(groups[0].items.map((item) => item.id)).toEqual(["today-new", "today-old"]);
    // 更早的会话归入第二组尾部（v1.0.6 再补「更早」分组）。
    expect(groups[1].items.map((item) => item.id)).toEqual(["month", "older"]);
  });

  it("置顶会话进入最上方独立「置顶」组，其余分组不再重复出现", () => {
    const groups = groupConversationsByTime(
      [
        summary("normal", now - 10 * 60 * 1000),
        summary("pinned", now - 6 * 60 * 60 * 1000, true),
      ],
      now,
    );
    expect(groups.map((group) => group.key)).toEqual(["pinned", "today", "past30"]);
    expect(groups[0].items.map((item) => item.id)).toEqual(["pinned"]);
    expect(groups[1].items.map((item) => item.id)).toEqual(["normal"]);
  });

  it("没有置顶项时不渲染空的「置顶」组", () => {
    const groups = groupConversationsByTime([summary("only", now - 1000)], now);
    expect(groups.map((group) => group.key)).toEqual(["today", "past30"]);
  });
});

describe("titleFromTurns", () => {
  it("取首条用户消息并压缩空白 / 截断超长标题", () => {
    expect(titleFromTurns([turn("user", "  赤壁之战   发生在哪一年？ ")].slice(0, 1))).toBe(
      "赤壁之战 发生在哪一年？",
    );
    const long = titleFromTurns([turn("user", "问".repeat(40))]);
    expect(long.endsWith("…")).toBe(true);
    expect(long.length).toBeLessThanOrEqual(29);
    expect(titleFromTurns([])).toBe("新的历史对话");
  });
});

describe("createInMemoryConversationRepository", () => {
  it("create → list → get → save 全链路可用", async () => {
    const repository = createInMemoryConversationRepository({ now: () => 1000 });
    const created = await repository.create({
      turns: [turn("user", "武则天是哪个朝代的人物")],
    });
    expect(created.title).toBe("武则天是哪个朝代的人物");

    const listed = await repository.list();
    expect(listed.map((item) => item.id)).toContain(created.id);

    await repository.save(created.id, [
      turn("user", "武则天是哪个朝代的人物"),
      turn("assistant", "唐朝。"),
    ]);
    const loaded = await repository.get(created.id);
    expect(loaded?.turns).toHaveLength(2);
    expect(loaded?.turns[1].content).toBe("唐朝。");
  });

  it("get 不存在的会话返回 null，save 不存在的会话返回 null", async () => {
    const repository = createInMemoryConversationRepository();
    expect(await repository.get("missing")).toBeNull();
    expect(await repository.save("missing", [])).toBeNull();
  });

  it("演示数据覆盖今天与过去 30 天两组", async () => {
    const repository = createInMemoryConversationRepository({
      seed: [
        { title: "今天的会话", createdAt: 10, updatedAt: 10, pinned: false, turns: [] },
      ],
    });
    const listed = await repository.list();
    expect(listed).toHaveLength(1);
  });
});

describe("会话排序稳定性（V1.0.5.2-layout 回归）", () => {
  /** 可注入时钟的仓库：精确模拟「创建 → 查看 → 再产生消息」的时间推进。 */
  function repositoryWithClock(start = 1_000_000) {
    let clock = start;
    const repository = createInMemoryConversationRepository({ now: () => clock });
    return {
      repository,
      advance(ms: number) {
        clock += ms;
      },
    };
  }

  it("syncTurns（点击查看 / 切换会话）不刷新 updatedAt → 列表位置不变", async () => {
    const { repository, advance } = repositoryWithClock();
    const older = await repository.create({ turns: [turn("user", "先创建的会话")] });
    advance(1000);
    const newer = await repository.create({ turns: [turn("user", "后创建的会话")] });
    const order = (await repository.list()).map((item) => item.id);
    expect(order).toEqual([newer.id, older.id]);

    // 模拟用户点击最下面那条：加载视图只同步正文，不刷新排序时间。
    advance(60 * 60 * 1000);
    await repository.syncTurns(older.id, [
      turn("user", "先创建的会话"),
      turn("assistant", "查看时同步的回答"),
    ]);

    const afterView = await repository.list();
    expect(afterView.map((item) => item.id)).toEqual(order);
    expect(afterView[1].updatedAt).toBe(older.updatedAt);
  });

  it("save（真的产生新消息）才刷新 last-message 时间并升到最前", async () => {
    const { repository, advance } = repositoryWithClock();
    const older = await repository.create({ turns: [turn("user", "会话 A")] });
    advance(1000);
    const newer = await repository.create({ turns: [turn("user", "会话 B")] });
    expect((await repository.list())[0].id).toBe(newer.id);

    advance(5000);
    await repository.save(older.id, [
      turn("user", "会话 A"),
      turn("user", "会话 A 的新问题"),
    ]);
    const listed = await repository.list();
    expect(listed[0].id).toBe(older.id);
    expect(listed[0].updatedAt).toBeGreaterThan(newer.updatedAt);
  });

  it("rename 只改标题并锁定，不改变排序时间；后续 save 不覆盖自定义标题", async () => {
    const { repository, advance } = repositoryWithClock();
    const first = await repository.create({ turns: [turn("user", "原始问题")] });
    advance(1000);
    const second = await repository.create({ turns: [turn("user", "第二条会话")] });
    const order = (await repository.list()).map((item) => item.id);

    advance(10_000);
    await repository.rename(first.id, "我的自定义标题");
    const renamed = await repository.list();
    expect(renamed.map((item) => item.id)).toEqual(order);
    expect(renamed.find((item) => item.id === first.id)?.title).toBe("我的自定义标题");

    await repository.save(first.id, [
      turn("user", "原始问题"),
      turn("assistant", "新回答"),
    ]);
    expect((await repository.get(first.id))?.title).toBe("我的自定义标题");
    expect((await repository.get(second.id))?.title).toBe("第二条会话");
  });

  it("remove 删除后其余条目相对顺序保持不变", async () => {
    const { repository, advance } = repositoryWithClock();
    const a = await repository.create({ turns: [turn("user", "会话 A")] });
    advance(1000);
    const b = await repository.create({ turns: [turn("user", "会话 B")] });
    advance(1000);
    const c = await repository.create({ turns: [turn("user", "会话 C")] });
    expect((await repository.list()).map((item) => item.id)).toEqual([c.id, b.id, a.id]);

    await repository.remove(b.id);
    expect((await repository.list()).map((item) => item.id)).toEqual([c.id, a.id]);
    expect(await repository.get(b.id)).toBeNull();
  });

  it("pin 置顶后升到列表最前（并进入「置顶」组），取消置顶后回到原时间序", async () => {
    const { repository, advance } = repositoryWithClock();
    const a = await repository.create({ turns: [turn("user", "会话 A")] });
    advance(1000);
    const b = await repository.create({ turns: [turn("user", "会话 B")] });
    advance(1000);
    const c = await repository.create({ turns: [turn("user", "会话 C")] });

    await repository.pin(a.id, true);
    const pinnedList = await repository.list();
    expect(pinnedList[0].id).toBe(a.id);
    expect(pinnedList[0].pinned).toBe(true);
    // 用测试时钟作为「今天」基准，避免 1970 时间戳全部落进「过去 30 天」组。
    const groups = groupConversationsByTime(pinnedList, 1_000_000 + 2000);
    expect(groups[0].key).toBe("pinned");
    expect(groups[0].items.map((item) => item.id)).toEqual([a.id]);
    // 置顶不改变其余条目的相对时间序。
    expect(groups[1].items.map((item) => item.id)).toEqual([c.id, b.id]);

    await repository.pin(a.id, false);
    expect((await repository.list()).map((item) => item.id)).toEqual([c.id, b.id, a.id]);
  });

  it("create 新会话（新建对话）拥有最新时间 → 出现在列表最上方", async () => {
    const { repository, advance } = repositoryWithClock();
    await repository.create({ turns: [turn("user", "旧会话")] });
    advance(1000);
    const fresh = await repository.create({ turns: [] });
    const listed = await repository.list();
    expect(listed[0].id).toBe(fresh.id);
    expect(listed[0].title).toBe("新的历史对话");
  });

  // V1.0.5.3 回归：用户反馈的「点击置顶 Bug」——点击历史记录不得被误判为「置顶 / 最新活跃」。
  it("点击查看已置顶会话：保持置顶、原位高亮、不重排、不取消置顶", async () => {
    const { repository, advance } = repositoryWithClock();
    const a = await repository.create({ turns: [turn("user", "会话 A")] });
    advance(1000);
    const b = await repository.create({ turns: [turn("user", "会话 B")] });
    advance(1000);
    const c = await repository.create({ turns: [turn("user", "会话 C")] });

    // C 被用户主动置顶 → 进入「置顶」组；其余顺序保持 c/b/a 的时间序。
    await repository.pin(c.id, true);
    const beforeView = await repository.list();
    const beforeOrder = beforeView.map((item) => item.id);
    expect(beforeView[0].id).toBe(c.id);
    expect(beforeView[0].pinned).toBe(true);

    // 模拟用户点击「置顶」组里的 C 查看历史：只同步正文，不得刷新时间 / 改变置顶 / 重排。
    advance(60 * 60 * 1000);
    await repository.syncTurns(c.id, [
      turn("user", "会话 C"),
      turn("assistant", "查看历史时的正文同步"),
    ]);
    const afterView = await repository.list();
    expect(afterView.map((item) => item.id)).toEqual(beforeOrder);
    expect(afterView[0].id).toBe(c.id);
    expect(afterView[0].pinned).toBe(true);

    // 主动取消置顶后回到原时间序（c 最新 → 仍在最前，其余 b/a 不变）。
    await repository.pin(c.id, false);
    expect((await repository.list()).map((item) => item.id)).toEqual([c.id, b.id, a.id]);
  });

  it("点击普通历史记录不会把它变成置顶项", async () => {
    const { repository, advance } = repositoryWithClock();
    const first = await repository.create({ turns: [turn("user", "第一条")] });
    advance(1000);
    const second = await repository.create({ turns: [turn("user", "第二条")] });
    const order = (await repository.list()).map((item) => item.id);

    advance(1000);
    await repository.syncTurns(second.id, [
      turn("user", "第二条"),
      turn("assistant", "查看正文"),
    ]);

    const afterView = await repository.list();
    expect(afterView.map((item) => item.id)).toEqual(order);
    expect(afterView.every((item) => item.pinned === false)).toBe(true);
    expect(afterView.find((item) => item.id === first.id)?.title).toBe("第一条");
  });
});

describe("v1.0.6 真实持久化仓库（createHttpConversationRepository）", () => {
  /** 简易 fetch mock：按 method + URL 返回预设 JSON / 记录请求。 */
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

  function jsonResponse(body: unknown, status = 200): Response {
    return new Response(JSON.stringify(body), {
      status,
      headers: { "Content-Type": "application/json" },
    });
  }

  const SESSION_PAYLOAD = {
    ok: true,
    schema_version: "1.0",
    api_version: "1.0.6",
    session: {
      session_id: "session_x",
      title: "曹操和刘备是什么关系？",
      created_at: 1,
      updated_at: 2,
      pinned: false,
      turn_count: 2,
      entity_memory: {
        person_ids: ["p-caocao-b012"],
        person_names: { "p-caocao-b012": "曹操" },
        event_ids: ["handong-chibi"],
      },
      turns: [
        { role: "user", content: "曹操和刘备是什么关系？", created_at: 1, answer: null },
        {
          role: "assistant",
          content: "**根据本轮工具返回的可核验资料：**",
          created_at: 2,
          answer: {
            answer: {
              mode: "grounded",
              markdown: "**根据本轮工具返回的可核验资料：**",
              certainty: "high",
              claims: [],
              missing: [],
              reason_code: null,
              related_event_ids: [],
              comparison_analysis: null,
            },
            citations: [{ id: "cite-handong-chibi-0", kind: "event" }],
            entities: [],
            ui_actions: [],
            trace: { model_used: "fake-qwen", model_requested: null, sources: { timeline: true, graph: true } },
            request_id: "req_1",
            snapshot_version: "v1-x",
          },
        },
      ],
    },
  };

  it("list 读取 /api/sessions 并映射为侧边栏摘要（置顶优先）", async () => {
    const { fetchImpl, requests } = mockFetch(() =>
      jsonResponse({
        ok: true,
        sessions: [
          { session_id: "a", title: "会话 A", created_at: 10, updated_at: 20, pinned: false, turn_count: 2 },
          { session_id: "b", title: "会话 B", created_at: 11, updated_at: 12, pinned: true, turn_count: 4 },
        ],
      }),
    );
    const repository = createHttpConversationRepository({ fetchImpl });
    const list = await repository.list();
    expect(repository.kind).toBe("remote");
    expect(requests[0].url).toContain("/api/sessions");
    expect(list.map((item) => item.id)).toEqual(["b", "a"]);
    expect(list[0]).toMatchObject({ title: "会话 B", pinned: true });
  });

  it("get 读取会话详情并恢复完整轮次 + 结构化回答视图", async () => {
    const { fetchImpl } = mockFetch(() => jsonResponse(SESSION_PAYLOAD));
    const repository = createHttpConversationRepository({ fetchImpl });
    const record = await repository.get("session_x");
    expect(record).not.toBeNull();
    expect(record?.turns).toHaveLength(2);
    expect(record?.turns[0]).toMatchObject({ role: "user", content: "曹操和刘备是什么关系？" });
    expect(record?.turns[1].answer?.mode).toBe("grounded");
    expect(record?.turns[1].answer?.citations[0].id).toBe("cite-handong-chibi-0");
    expect(record?.turns[1].answer?.sources).toEqual({ timeline: true, graph: true });
  });

  it("create 用前端生成的 session_id POST 新会话", async () => {
    const { fetchImpl, requests } = mockFetch(() => jsonResponse(SESSION_PAYLOAD));
    const repository = createHttpConversationRepository({ fetchImpl });
    const record = await repository.create({ id: "session_new", turns: [] });
    expect(record.id).toBe("session_x");
    expect(requests[0].init?.method).toBe("POST");
    expect(JSON.parse(String(requests[0].init?.body))).toEqual({ session_id: "session_new" });
  });

  it("save / syncTurns 在 HTTP 仓库中是安全空操作（服务端负责写入轮次）", async () => {
    const { fetchImpl, requests } = mockFetch(() => jsonResponse({ ok: true }));
    const repository = createHttpConversationRepository({ fetchImpl });
    expect(await repository.save("session_x", [])).toBeNull();
    expect(await repository.syncTurns("session_x", [])).toBeNull();
    expect(requests).toHaveLength(0);
  });

  it("rename / pin 走 PATCH，remove 走 DELETE", async () => {
    const { fetchImpl, requests } = mockFetch((_url, init) => {
      if (init?.method === "DELETE") {
        return jsonResponse({ ok: true, session_id: "session_x" });
      }
      return jsonResponse({
        ok: true,
        session: { session_id: "session_x", title: "新标题", created_at: 1, updated_at: 2, pinned: true, turn_count: 2 },
      });
    });
    const repository = createHttpConversationRepository({ fetchImpl });
    await repository.rename("session_x", "新标题");
    await repository.pin("session_x", true);
    await repository.remove("session_x");
    expect(requests.map((request) => request.init?.method)).toEqual([
      "PATCH",
      "PATCH",
      "DELETE",
    ]);
    expect(JSON.parse(String(requests[0].init?.body))).toEqual({ title: "新标题" });
    expect(JSON.parse(String(requests[1].init?.body))).toEqual({ pinned: true });
  });

  it("后端不可达时 list 返回空列表、get 返回 null（页面不崩溃）", async () => {
    const fetchImpl = (async () => {
      throw new Error("ECONNREFUSED");
    }) as typeof fetch;
    const repository = createHttpConversationRepository({ fetchImpl });
    expect(await repository.list()).toEqual([]);
    expect(await repository.get("session_x")).toBeNull();
    // 写操作不抛异常（创建除外，由调用方回退）。
    await expect(repository.rename("session_x", "标题")).resolves.toBeUndefined();
    await expect(repository.remove("session_x")).resolves.toBeUndefined();
  });

  it("recordFromRemoteSession 生成稳定轮次 id，供 React key / transcript 使用", () => {
    const detail = {
      id: "session_x",
      title: "标题",
      createdAt: 1,
      updatedAt: 2,
      pinned: false,
      turnCount: 2,
      entityMemory: { personIds: [], personNames: {}, eventIds: [] },
      turns: [
        { role: "user" as const, content: "问题", createdAt: 1, answer: null },
        { role: "assistant" as const, content: "回答", createdAt: 2, answer: null },
      ],
    };
    const record = recordFromRemoteSession(detail);
    expect(record.turns.map((turn) => turn.id)).toEqual([
      "session_x-turn-0",
      "session_x-turn-1",
    ]);
  });
});

describe("createConversationId", () => {
  it("生成 conv_ 前缀且可注入时间", () => {
    expect(createConversationId(() => 42)).toMatch(/^conv_[0-9a-z]+_[0-9a-z]+$/);
  });
});

/**
 * V1.0.8 Bug 1：刷新页面后历史消息的「展开图谱 / 时间轴」按钮消失。
 *
 * 服务端旧轮次可能只有正文、没有结构化 answer；这里用本标签页 sessionStorage 缓存
 * 按「位置 + 角色 + 正文」严格对齐后补回 `ui_actions`。
 */
describe("mergeCachedTurnAnswers（刷新恢复合并）", () => {
  const uiActions = [
    {
      id: "act-1",
      type: "timeline.focus_event" as const,
      payload: { event_id: "handong-chibi" },
      target: { surface: "timeline" as const, params: { event_id: "handong-chibi" } },
      auto: true,
      label: "在时间轴中查看",
      reason: null,
    },
  ];

  const streamedAnswer = {
    mode: "grounded" as const,
    markdown: "赤壁之战发生在公元 208 年。",
    certainty: null,
    missing: [],
    reasonCode: null,
    citations: [],
    entities: [],
    uiActions,
    snapshotVersion: "",
    requestId: "req_1",
    modelUsed: "XiaoHong-v1",
    modelRequested: null,
    sources: null,
    comparisonAnalysis: null,
    factCheck: null,
    streamed: true,
  };

  it("服务端没有 answer 时用缓存补回完整回答视图（含 uiActions）", () => {
    const serverTurns: RestorableTurn[] = [
      { role: "user", content: "赤壁之战发生在哪一年？", answer: null },
      { role: "assistant", content: streamedAnswer.markdown, answer: null },
    ];
    const cachedTurns: RestorableTurn[] = [
      { role: "user", content: "赤壁之战发生在哪一年？" },
      { role: "assistant", content: streamedAnswer.markdown, answer: streamedAnswer },
    ];
    const merged = mergeCachedTurnAnswers(serverTurns, cachedTurns);
    expect(merged[1]?.answer?.uiActions).toEqual(uiActions);
    expect(merged[1]?.answer?.streamed).toBe(true);
  });

  it("服务端 answer 缺 uiActions 时只补联动指令（其余以服务端为准）", () => {
    const serverTurns: RestorableTurn[] = [
      { role: "user", content: "赤壁之战发生在哪一年？", answer: null },
      {
        role: "assistant",
        content: streamedAnswer.markdown,
        answer: { ...streamedAnswer, uiActions: [], citations: [] },
      },
    ];
    const cachedTurns: RestorableTurn[] = [
      { role: "user", content: "赤壁之战发生在哪一年？" },
      { role: "assistant", content: streamedAnswer.markdown, answer: streamedAnswer },
    ];
    const merged = mergeCachedTurnAnswers(serverTurns, cachedTurns);
    expect(merged[1]?.answer?.uiActions).toEqual(uiActions);
    // 服务端已有的其它字段不被缓存覆盖。
    expect(merged[1]?.answer?.citations).toEqual([]);
    expect(merged[1]?.answer?.mode).toBe("grounded");
  });

  it("角色 / 正文对不上时不拼接（避免跨会话恢复错答案）", () => {
    const serverTurns: RestorableTurn[] = [
      { role: "user", content: "玄武门之变发生在哪一年？", answer: null },
      { role: "assistant", content: "玄武门之变发生在公元 626 年。", answer: null },
    ];
    const cachedTurns: RestorableTurn[] = [
      { role: "user", content: "赤壁之战发生在哪一年？" },
      { role: "assistant", content: "赤壁之战发生在公元 208 年。", answer: streamedAnswer },
    ];
    const merged = mergeCachedTurnAnswers(serverTurns, cachedTurns);
    expect(merged[1]?.answer).toBeNull();
  });

  it("没有缓存 / 缓存为空时原样返回服务端轮次（不抛出）", () => {
    const serverTurns: RestorableTurn[] = [{ role: "user", content: "问题", answer: null }];
    expect(mergeCachedTurnAnswers(serverTurns, null)).toEqual(serverTurns);
    expect(mergeCachedTurnAnswers(serverTurns, [])).toEqual(serverTurns);
  });
});