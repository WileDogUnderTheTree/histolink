/**
 * 动作能力映射单测（V1.0.1 / TC-08）。
 *
 * 验收要求：覆盖契约动作枚举全部成员（无遗漏、无多余），
 * 且能力表与 `contracts/action-policy.json` / 前端 ACTION_POLICY 口径一致。
 */
import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import {
  ACTION_CAPABILITIES,
  actionsForSurface,
  isAvailableAction,
  isConsistentWithPolicy,
} from "@/lib/action-capabilities";
import { ACTION_POLICY } from "@/lib/action-policy";
import type { UIActionType } from "@/lib/action-policy";

interface RawPolicy {
  actions: Record<string, { surface: string | null; availability: string }>;
}

const rawPolicy = JSON.parse(
  readFileSync(new URL("../../contracts/action-policy.json", import.meta.url), "utf8"),
) as RawPolicy;

const ACTION_TYPES = Object.keys(ACTION_CAPABILITIES) as UIActionType[];

describe("ACTION_CAPABILITIES 覆盖完整性", () => {
  it("覆盖契约动作枚举全部成员，无遗漏无多余", () => {
    expect(ACTION_TYPES.sort()).toEqual(Object.keys(rawPolicy.actions).sort());
    expect(ACTION_TYPES.sort()).toEqual(Object.keys(ACTION_POLICY).sort());
  });

  it("每个动作的 surface / availability 与策略、契约一致", () => {
    for (const type of ACTION_TYPES) {
      expect(isConsistentWithPolicy(type), `${type} 与前端策略不一致`).toBe(true);
      const entry = ACTION_CAPABILITIES[type];
      expect(entry.surface).toBe(rawPolicy.actions[type].surface);
      expect(entry.availability).toBe(rawPolicy.actions[type].availability);
    }
  });

  it("每个动作至少声明一项组件能力，且归属版本为 1.0.x", () => {
    for (const type of ACTION_TYPES) {
      const entry = ACTION_CAPABILITIES[type];
      expect(entry.requiredCapabilities.length, `${type} 缺少 requiredCapabilities`).toBeGreaterThan(0);
      expect(entry.targetVersion).toMatch(/^1\.0\.\d+$/);
      expect(["implemented", "partial", "planned"]).toContain(entry.capabilityStatus);
      expect(entry.note.length).toBeGreaterThan(0);
    }
  });

  it("V1.0.4 范围内的可用动作已落地或 partial，暂缓动作不得提前标 implemented", () => {
    for (const type of ACTION_TYPES) {
      const entry = ACTION_CAPABILITIES[type];
      if (entry.availability === "available" && entry.targetVersion <= "1.0.4") {
        expect(["implemented", "partial"]).toContain(entry.capabilityStatus);
      }
      if (entry.availability === "planned") {
        expect(entry.capabilityStatus).not.toBe("implemented");
      }
    }
  });
});

describe("动作接入清单", () => {
  it("时间轴页注册两条可执行动作", () => {
    expect(actionsForSurface("timeline")).toEqual([
      "timeline.focus_event",
      "timeline.focus_dynasty",
    ]);
  });

  it("图谱页注册两条可执行动作", () => {
    expect(actionsForSurface("graph")).toEqual([
      "graph.focus_person",
      "graph.focus_relation",
    ]);
  });

  it("ask.suggest 属可用动作但页面能力待 V1.0.6", () => {
    expect(isAvailableAction("ask.suggest")).toBe(true);
    expect(actionsForSurface("ask")).toEqual(["ask.suggest"]);
    expect(ACTION_CAPABILITIES["ask.suggest"].capabilityStatus).toBe("planned");
  });

  it("planned 动作不进入任何页面的可执行清单", () => {
    const availableByAction = ACTION_TYPES.filter((type) => isAvailableAction(type));
    const registered = [
      ...actionsForSurface("timeline"),
      ...actionsForSurface("graph"),
      ...actionsForSurface("ask"),
    ];
    expect(registered.sort()).toEqual(availableByAction.sort());
  });
});
