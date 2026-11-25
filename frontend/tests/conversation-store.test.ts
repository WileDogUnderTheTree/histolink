/**
 * 历史对话数据层单测（V1.0.5.2；V1.0.5.2-layout 补丁）。
 *
 * 覆盖：时间分组 / 标题生成 / 内存仓库增改查；
 * 布局修复补丁重点回归：**点击查看不得改变列表物理顺序**（syncTurns 不刷新 updatedAt）、
 * 置顶进入最上方「置顶」组、重命名锁定标题、删除后其余项顺序不变；v1.0.6 预留接口占位。
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import type { StoredConversationTurn } from "@/lib/conversation-store";
import {
  createConversationId,
  createInMemoryConversationRepository,
  groupConversationsByTime,
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

describe("v1.0.6 预留占位（持久化与跨会话上下文）", () => {
  it("跨会话上下文 / 持久化接口保持空实现，不假装已接入", async () => {
    const repository = createInMemoryConversationRepository();
    expect(await repository.buildCrossSessionContext("x")).toBe("");
    expect(await repository.loadPersisted()).toEqual([]);
    await expect(repository.persist({
      id: "x",
      title: "x",
      createdAt: 0,
      updatedAt: 0,
      pinned: false,
      turns: [],
    })).resolves.toBeUndefined();
  });

  it("数据层源码保留 v1.0.6 持久化 / 跨会话 TODO 注释（至少 3 处）", () => {
    const source = readFileSync(
      fileURLToPath(new URL("../lib/conversation-store.ts", import.meta.url)),
      "utf8",
    );
    const marker = "// TODO v1.0.6 多轮历史对话记忆模块 - 功能待实现";
    const occurrences = source.split(marker).length - 1;
    expect(occurrences).toBeGreaterThanOrEqual(3);
  });
});

describe("createConversationId", () => {
  it("生成 conv_ 前缀且可注入时间", () => {
    expect(createConversationId(() => 42)).toMatch(/^conv_[0-9a-z]+_[0-9a-z]+$/);
  });
});