/**
 * ActionBus 单测（V1.0.1 骨架 → V1.0.4 跨页导航）。
 *
 * 覆盖：同页自动执行、跨页进入待确认、确认后导航、确认/取消、幂等键、
 * 未知类型忽略、无 handler、handler 异常、批量分发、生产工厂。
 */
import { describe, expect, it, vi } from "vitest";

import { ActionBus, createAgentActionBus } from "@/lib/action-bus";
import type { ActionBusEvent } from "@/lib/action-bus";
import type { UIAction } from "@/lib/action-policy";

function makeAction(overrides: Partial<UIAction> = {}): UIAction {
  return {
    id: "act-1",
    type: "timeline.focus_event",
    payload: { event_id: "handong-chibi" },
    target: { surface: "timeline", params: { event_id: "handong-chibi" } },
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

  it("没有注册 handler 时忽略（同页但组件未接入）", async () => {
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

  it("register 返回注销函数，且只删除自己注册的 handler", async () => {
    const bus = new ActionBus(() => "timeline");
    const first = vi.fn();
    const second = vi.fn();

    const unregisterFirst = bus.register("timeline.focus_event", first);
    bus.register("timeline.focus_event", second);
    // 后注册者已覆盖 first；先注销 first 不应误删 second。
    unregisterFirst();

    await expect(bus.dispatch(makeAction({ id: "act-second" }))).resolves.toEqual({
      status: "executed",
    });
    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledTimes(1);

    const unregisterSecond = bus.register("timeline.focus_event", second);
    unregisterSecond();
    await expect(bus.dispatch(makeAction({ id: "act-removed" }))).resolves.toEqual({
      status: "ignored",
      reason: "no_handler",
    });
  });

  // ------------------------------------------------------------------
  // V1.0.4：跨页确认 → 深链接导航
  // ------------------------------------------------------------------

  it("跨页动作确认后导航到目标深链接（无 handler 时）", async () => {
    const navigate = vi.fn();
    const events: ActionBusEvent[] = [];
    const bus = new ActionBus(() => "graph", { navigate });
    bus.on((event) => events.push(event));
    const action = makeAction({ id: "act-cross" });

    await bus.dispatch(action);
    await expect(bus.confirm("act-cross")).resolves.toEqual({ status: "navigated" });

    expect(navigate).toHaveBeenCalledWith("/timeline?event=handong-chibi");
    expect(events.map((event) => event.type)).toEqual([
      "confirmation-required",
      "navigated",
    ]);
    expect(bus.isExecuted("act-cross")).toBe(true);
    // 已导航动作再次确认 → 不在队列。
    await expect(bus.confirm("act-cross")).resolves.toEqual({
      status: "ignored",
      reason: "not_pending",
    });
  });

  it("跨页确认支持自定义 resolveHref", async () => {
    const navigate = vi.fn();
    const bus = new ActionBus(() => "graph", {
      navigate,
      resolveHref: () => "/custom-target",
    });
    await bus.dispatch(makeAction({ id: "act-custom", type: "timeline.focus_dynasty" }));
    await expect(bus.confirm("act-custom")).resolves.toEqual({ status: "navigated" });
    expect(navigate).toHaveBeenCalledWith("/custom-target");
  });

  it("导航抛错时上报 failed，不标记已执行", async () => {
    const navigate = vi.fn(() => {
      throw new Error("router failed");
    });
    const bus = new ActionBus(() => "graph", { navigate });
    const events = collect(bus);
    await bus.dispatch(makeAction({ id: "act-nav-fail" }));
    await expect(bus.confirm("act-nav-fail")).resolves.toEqual({
      status: "ignored",
      reason: "navigate_failed",
    });
    expect(events.map((event) => event.type)).toEqual(["confirmation-required", "failed"]);
    expect(bus.isExecuted("act-nav-fail")).toBe(false);
  });

  it("跨页确认时若目标页已注册 handler，优先执行 handler 而不是导航", async () => {
    const navigate = vi.fn();
    const handler = vi.fn();
    const bus = new ActionBus(() => "graph", { navigate });
    // 模拟「用户已经在目标页，且该页注册了 handler」的边界。
    bus.register("timeline.focus_event", handler);
    await bus.dispatch(makeAction({ id: "act-handler-pending" }));
    await expect(bus.confirm("act-handler-pending")).resolves.toEqual({ status: "executed" });
    expect(handler).toHaveBeenCalledTimes(1);
    expect(navigate).not.toHaveBeenCalled();
  });

  it("dispatchAll 批量分发并返回每个动作的去向", async () => {
    const bus = new ActionBus(() => "timeline");
    const handler = vi.fn();
    bus.register("timeline.focus_event", handler);

    const results = await bus.dispatchAll([
      makeAction({ id: "act-a" }),
      makeAction({ id: "act-b", type: "graph.focus_person", target: { surface: "graph" } }),
      makeAction({ id: "act-a" }),
    ]);

    expect(results).toEqual([
      { status: "executed" },
      { status: "pending" },
      { status: "duplicate" },
    ]);
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it("createAgentActionBus 工厂：同页执行 + 跨页导航全链路", async () => {
    let surface: "timeline" | "graph" | null = "graph";
    const navigate = vi.fn();
    const bus = createAgentActionBus({
      getCurrentSurface: () => surface,
      navigate,
    });

    // 当前在 graph 且未注册 timeline handler：timeline 动作跨页 → 确认后导航。
    await expect(bus.dispatch(makeAction({ id: "act-cross" }))).resolves.toEqual({
      status: "pending",
    });
    await expect(bus.confirm("act-cross")).resolves.toEqual({ status: "navigated" });
    expect(navigate).toHaveBeenCalledWith("/timeline?event=handong-chibi");

    // 到达 timeline 后页面注册 handler：同页动作自动执行。
    surface = "timeline";
    const timelineHandler = vi.fn();
    bus.register("timeline.focus_event", timelineHandler);
    await expect(bus.dispatch(makeAction({ id: "act-same" }))).resolves.toEqual({
      status: "executed",
    });
    expect(timelineHandler).toHaveBeenCalledTimes(1);
  });
});
