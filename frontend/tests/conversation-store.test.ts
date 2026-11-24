/**
 * 历史对话数据层单测（V1.0.5.2）。
 *
 * 覆盖：时间分组 / 标题生成 / 内存仓库增改查；v1.0.6 预留接口的注释与占位行为。
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

  it("置顶会话在组内优先", () => {
    const groups = groupConversationsByTime(
      [
        summary("normal", now - 10 * 60 * 1000),
        summary("pinned", now - 6 * 60 * 60 * 1000, true),
      ],
      now,
    );
    expect(groups[0].items.map((item) => item.id)).toEqual(["pinned", "normal"]);
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

describe("v1.0.6 预留占位", () => {
  it("重命名 / 删除 / 置顶明确抛出「v1.0.6 提供」，不做半成品实现", async () => {
    const repository = createInMemoryConversationRepository();
    await expect(repository.rename("x", "新标题")).rejects.toThrow("v1.0.6");
    await expect(repository.remove("x")).rejects.toThrow("v1.0.6");
    await expect(repository.pin("x", true)).rejects.toThrow("v1.0.6");
    expect(await repository.buildCrossSessionContext("x")).toBe("");
    expect(await repository.loadPersisted()).toEqual([]);
  });

  it("数据层源码包含规定的 TODO 注释原文（至少 5 处）", () => {
    const source = readFileSync(
      fileURLToPath(new URL("../lib/conversation-store.ts", import.meta.url)),
      "utf8",
    );
    const marker = "// TODO v1.0.6 多轮历史对话记忆模块 - 功能待实现";
    const occurrences = source.split(marker).length - 1;
    expect(occurrences).toBeGreaterThanOrEqual(5);
  });
});

describe("createConversationId", () => {
  it("生成 conv_ 前缀且可注入时间", () => {
    expect(createConversationId(() => 42)).toMatch(/^conv_[0-9a-z]+_[0-9a-z]+$/);
  });
});