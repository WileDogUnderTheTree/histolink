/**
 * ActionBus 单测（V1.0.1 / TC-07 骨架）。
 *
 * 覆盖：同页自动执行、跨页进入待确认、幂等键、确认/取消、未知类型忽略、无 handler、handler 异常。
 */
import { describe, expect, it, vi } from "vitest";

import { ActionBus } from "@/lib/action-bus";
import type { ActionBusEvent } from "@/lib/action-bus";
import type { UIAction } from "@/lib/action-policy";

function makeAction(overrides: Partial<UIAction> = {}): UIAction {
  return {
    id: "act-1",
    type: "timeline.focus_event",
    target: { surface: "timeline" },
    auto: false,
    label: "在时间轴中查看",
    ...overrides,
  };
}

function collect(bus: ActionBus): ActionBusEvent[] {
  const events: ActionBusEvent[] = [];
  bus.on((event) => events.push(event));
  return events;
}

describe("ActionBus", () => {
  it("同页动作自动执行且只执行一次（幂等键）", async () => {
    const bus = new ActionBus(() => "timeline");
    const handler = vi.fn();
    bus.register("timeline.focus_event", handler);
    const events = collect(bus);

    const action = makeAction();
    await expect(bus.dispatch(action)).resolves.toEqual({ status: "executed" });
    await expect(bus.dispatch(action)).resolves.toEqual({ status: "duplicate" });

    expect(handler).toHaveBeenCalledTimes(1);
    expect(events.map((event) => event.type)).toEqual(["executed"]);
    expect(bus.isExecuted(action.id)).toBe(true);
  });

  it("跨页动作进入待确认队列，不执行", async () => {
    const bus = new ActionBus(() => "timeline");
    const handler = vi.fn();
    bus.register("graph.focus_person", handler);
    const events = collect(bus);

    const action = makeAction({ id: "act-graph", type: "graph.focus_person", target: { surface: "graph" } });
    await expect(bus.dispatch(action)).resolves.toEqual({ status: "pending" });
    await expect(bus.dispatch(action)).resolves.toEqual({ status: "duplicate" });

    expect(handler).not.toHaveBeenCalled();
    expect(bus.getPendingActions()).toHaveLength(1);
    expect(events.map((event) => event.type)).toEqual(["confirmation-required"]);
  });

  it("确认后执行待确认动作", async () => {
    const bus = new ActionBus(() => "timeline");
    const handler = vi.fn();
    bus.register("graph.focus_person", handler);
    const action = makeAction({ id: "act-graph", type: "graph.focus_person", target: { surface: "graph" } });
    await bus.dispatch(action);

    await expect(bus.confirm("act-graph")).resolves.toEqual({ status: "executed" });
    expect(handler).toHaveBeenCalledTimes(1);
    expect(bus.getPendingActions()).toHaveLength(0);
    expect(bus.isExecuted("act-graph")).toBe(true);

    await expect(bus.confirm("act-graph")).resolves.toEqual({ status: "ignored", reason: "not_pending" });
  });

  it("取消待确认动作后不再执行", async () => {
    const bus = new ActionBus(() => "timeline");
    const handler = vi.fn();
    bus.register("graph.focus_person", handler);
    const events = collect(bus);
    const action = makeAction({ id: "act-graph", type: "graph.focus_person", target: { surface: "graph" } });
    await bus.dispatch(action);

    expect(bus.cancel("act-graph")).toBe(true);
    expect(bus.cancel("act-graph")).toBe(false);
    expect(bus.getPendingActions()).toHaveLength(0);
    expect(events.map((event) => event.type)).toEqual(["confirmation-required", "cancelled"]);
  });

  it("未知动作类型忽略并上报", async () => {
    const bus = new ActionBus(() => "timeline");
    const events = collect(bus);
    const action = makeAction({ type: "open.nonexistent" as UIAction["type"] });

    await expect(bus.dispatch(action)).resolves.toEqual({ status: "ignored", reason: "unknown_type" });
    expect(events.map((event) => event.type)).toEqual(["ignored"]);
  });

  it("没有注册 handler 时忽略（V1.0.4 前不真实执行）", async () => {
    const bus = new ActionBus(() => "timeline");
    await expect(bus.dispatch(makeAction())).resolves.toEqual({ status: "ignored", reason: "no_handler" });
    expect(bus.isExecuted("act-1")).toBe(false);
  });

  it("handler 抛错时上报 failed 且不标记已执行", async () => {
    const bus = new ActionBus(() => "timeline");
    const events = collect(bus);
    bus.register("timeline.focus_event", () => {
      throw new Error("boom");
    });

    await expect(bus.dispatch(makeAction())).resolves.toEqual({ status: "ignored", reason: "handler_failed" });
    expect(events.map((event) => event.type)).toEqual(["failed"]);
    expect(bus.isExecuted("act-1")).toBe(false);
  });

  it("依据当前 surface 动态判定同页/跨页", async () => {
    let surface: "timeline" | "graph" | null = "timeline";
    const bus = new ActionBus(() => surface);
    bus.register("timeline.focus_event", vi.fn());

    expect(bus.decide(makeAction())).toEqual({ decision: "auto" });
    surface = "graph";
    expect(bus.decide(makeAction())).toEqual({ decision: "confirm", reason: "cross_page" });
    surface = null;
    expect(bus.decide(makeAction())).toEqual({ decision: "confirm", reason: "cross_page" });
  });
});
