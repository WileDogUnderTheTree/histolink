/**
 * 动作策略单测（V1.0.1 / TC-07）。
 *
 * 验收要求覆盖：同页自动、跨页需确认、未知类型忽略、缺 `target.surface` 视为跨页；
 * 额外校验前端策略表与 `contracts/action-policy.json` 完全一致（防止两份口径漂移）。
 */
import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { ACTION_POLICY, decideAction } from "@/lib/action-policy";
import type { UIAction, UIActionType, UISurface } from "@/lib/action-policy";

interface RawPolicy {
  actions: Record<string, { surface: string | null; availability: string; auto: string; since: string }>;
  surfaces: string[];
}

const rawPolicy = JSON.parse(
  readFileSync(new URL("../../contracts/action-policy.json", import.meta.url), "utf8"),
) as RawPolicy;

function makeAction(overrides: Partial<UIAction> = {}): UIAction {
  return {
    id: "act-1",
    type: "timeline.focus_event",
    target: { surface: "timeline" },
    auto: false,
    label: "在时间轴中查看",
    payload: { event_id: "xixia-09" },
    ...overrides,
  };
}

function withType(type: string, overrides: Partial<UIAction> = {}): UIAction {
  return makeAction({ type: type as UIActionType, ...overrides });
}

describe("ACTION_POLICY 与 contracts/action-policy.json 同步", () => {
  it("动作类型集合完全一致", () => {
    expect(Object.keys(ACTION_POLICY).sort()).toEqual(Object.keys(rawPolicy.actions).sort());
  });

  it("每个动作的 surface / availability / auto 与契约一致", () => {
    for (const [actionType, entry] of Object.entries(rawPolicy.actions)) {
      const mirror = ACTION_POLICY[actionType as UIActionType];
      expect(mirror, `缺少动作 ${actionType}`).toBeDefined();
      expect(mirror.surface).toBe(entry.surface);
      expect(mirror.availability).toBe(entry.availability);
      expect(mirror.auto).toBe(entry.auto);
      expect(mirror.since).toBe(entry.since);
    }
  });

  it("contracts/action-policy.json 的 surfaces 与冻结值一致", () => {
    expect(rawPolicy.surfaces.sort()).toEqual(["ask", "graph", "timeline"]);
  });
});

describe("decideAction", () => {
  it("同页动作自动执行", () => {
    expect(decideAction(makeAction(), "timeline")).toEqual({ decision: "auto" });
  });

  it("同页动作不依赖后端 auto 建议值", () => {
    expect(decideAction(makeAction({ auto: false }), "timeline")).toEqual({ decision: "auto" });
    expect(decideAction(makeAction({ auto: true }), "timeline")).toEqual({ decision: "auto" });
  });

  it("跨页动作必须确认", () => {
    const action = withType("graph.focus_person", { target: { surface: "graph" } });
    expect(decideAction(action, "timeline")).toEqual({ decision: "confirm", reason: "cross_page" });
  });

  it("首页（surface=null）上的任何动作都需确认", () => {
    expect(decideAction(makeAction(), null)).toEqual({ decision: "confirm", reason: "cross_page" });
  });

  it("缺 target.surface 视为跨页", () => {
    const broken = makeAction({ target: {} as UIAction["target"] });
    expect(decideAction(broken, "timeline")).toEqual({ decision: "confirm", reason: "missing_surface" });
  });

  it("非法 target.surface 视为跨页", () => {
    const broken = makeAction({ target: { surface: "entity" as UISurface } });
    expect(decideAction(broken, "timeline")).toEqual({ decision: "confirm", reason: "missing_surface" });
  });

  it("未知动作类型忽略", () => {
    const unknown = withType("open.nonexistent");
    expect(decideAction(unknown, "timeline")).toEqual({ decision: "ignore", reason: "unknown_type" });
  });

  it("planned 动作类型忽略（V1.0 暂缓）", () => {
    const planned = withType("open.event_card", { target: { surface: "timeline" } });
    expect(decideAction(planned, "timeline")).toEqual({ decision: "ignore", reason: "planned" });
  });

  it("缺 type 的动作安全忽略", () => {
    const broken = makeAction({ type: undefined as unknown as UIAction["type"] });
    expect(decideAction(broken, "timeline")).toEqual({ decision: "ignore", reason: "unknown_type" });
  });

  it("三类可用 surface 都能命中同页", () => {
    expect(decideAction(withType("timeline.focus_dynasty"), "timeline")).toEqual({ decision: "auto" });
    expect(decideAction(withType("graph.focus_relation", { target: { surface: "graph" } }), "graph")).toEqual({
      decision: "auto",
    });
    expect(decideAction(withType("ask.suggest", { target: { surface: "ask" } }), "ask")).toEqual({
      decision: "auto",
    });
  });
});
