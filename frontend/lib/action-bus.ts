/**
 * ActionBus（V1.0.1 骨架 → V1.0.4 真实分发）。
 *
 * 职责边界：
 * - 「动作类型注册 / 分发 / 幂等键 / 同页自动执行 / 跨页确认」；
 * - 同页：调用页面注册的 handler（Timeline / Graph 已接入）；
 * - 跨页：进入待确认队列（抽屉渲染确认按钮），确认后优先执行 handler，
 *   没有 handler 时用 `resolveHref` + `navigate` 导航到目标深链接；
 * - 本文件不发网络请求，也不直接改页面状态。
 *
 * 幂等约定：`action.id` 是幂等键——同一动作重复 dispatch 只执行一次；
 * 已进入「待确认」队列 / 已执行 / 已导航的动作重复 dispatch 视为 duplicate。
 */
import { hrefForAction } from "@/lib/action-navigation";
import { decideAction } from "@/lib/action-policy";
import type { ActionDecision, UIAction, UIActionType, UISurface } from "@/lib/action-policy";

export type ActionHandler = (action: UIAction) => void | Promise<void>;

export type ActionBusEvent =
  | { type: "executed"; action: UIAction }
  | { type: "confirmation-required"; action: UIAction }
  | { type: "navigated"; action: UIAction; href: string }
  | { type: "cancelled"; action: UIAction }
  | { type: "ignored"; action: UIAction; reason: string }
  | { type: "failed"; action: UIAction; error: unknown };

export type DispatchResult =
  | { status: "executed" }
  | { status: "navigated" }
  | { status: "pending" }
  | { status: "duplicate" }
  | { status: "ignored"; reason: string };

export type ActionBusListener = (event: ActionBusEvent) => void;

export interface ActionBusOptions {
  /** 用户确认跨页动作后的导航实现（通常是 next/navigation 的 router.push）。 */
  navigate?: (href: string) => void;
  /** 跨页动作 → 深链接；默认用 `hrefForAction`。 */
  resolveHref?: (action: UIAction) => string | null;
}

export class ActionBus {
  private readonly handlers = new Map<UIActionType, ActionHandler>();
  private readonly listeners = new Set<ActionBusListener>();
  private readonly executed = new Set<string>();
  private readonly pending = new Map<string, UIAction>();

  constructor(
    /** 返回当前页面的 surface；页面切换时应重新创建或注入最新实现。 */
    private readonly getCurrentSurface: () => UISurface | null = () => null,
    private readonly options: ActionBusOptions = {},
  ) {}

  /**
   * 注册动作 handler；返回注销函数。
   *
   * 页面级接入在 `useEffect` 里注册、卸载时注销：单例 ActionBus 生命周期
   * 长于页面，不注销会把旧页面闭包留在内存里，切页后执行到过期状态。
   * 注销只删除「仍是本次注册的那个 handler」，避免后注册的页面被先卸载的页面误删。
   */
  register(type: UIActionType, handler: ActionHandler): () => void {
    this.handlers.set(type, handler);
    return () => {
      if (this.handlers.get(type) === handler) {
        this.handlers.delete(type);
      }
    };
  }

  on(listener: ActionBusListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /** 用当前 surface 重新判定动作走向（纯函数，便于测试与页面使用）。 */
  decide(action: UIAction): ActionDecision {
    return decideAction(action, this.getCurrentSurface());
  }

  /** 分发一个动作；返回最终去向，不抛异常（异常走 failed 事件 + 返回值）。 */
  async dispatch(action: UIAction): Promise<DispatchResult> {
    if (this.executed.has(action.id) || this.pending.has(action.id)) {
      return { status: "duplicate" };
    }

    const decision = this.decide(action);
    if (decision.decision === "ignore") {
      this.emit({ type: "ignored", action, reason: decision.reason });
      return { status: "ignored", reason: decision.reason };
    }
    if (decision.decision === "confirm") {
      this.pending.set(action.id, action);
      this.emit({ type: "confirmation-required", action });
      return { status: "pending" };
    }

    return this.execute(action);
  }

  /** 批量分发（回答里最多 3 个动作）；返回每个动作的去向。 */
  async dispatchAll(actions: readonly UIAction[]): Promise<DispatchResult[]> {
    const results: DispatchResult[] = [];
    for (const action of actions) {
      results.push(await this.dispatch(action));
    }
    return results;
  }

  /** 执行已判定为同页的动作；无 handler 时忽略（由页面决定是否注册）。 */
  private async execute(action: UIAction): Promise<DispatchResult> {
    const handler = this.handlers.get(action.type);
    if (!handler) {
      this.emit({ type: "ignored", action, reason: "no_handler" });
      return { status: "ignored", reason: "no_handler" };
    }

    try {
      await handler(action);
      this.executed.add(action.id);
      this.emit({ type: "executed", action });
      return { status: "executed" };
    } catch (error) {
      this.emit({ type: "failed", action, error });
      return { status: "ignored", reason: "handler_failed" };
    }
  }

  /**
   * 用户点击「前往…」确认按钮后调用。
   *
   * 1. 目标页恰好已有 handler（例如用户在目标页确认）→ 直接执行；
   * 2. 否则用动作深链接导航（跨页动作的标准路径）；
   * 3. 两者都不行 → ignored。
   */
  async confirm(actionId: string): Promise<DispatchResult> {
    const action = this.pending.get(actionId);
    if (!action) return { status: "ignored", reason: "not_pending" };
    this.pending.delete(actionId);

    if (this.handlers.get(action.type)) {
      return this.execute(action);
    }

    const resolveHref = this.options.resolveHref ?? hrefForAction;
    const href = resolveHref(action);
    if (href && this.options.navigate) {
      try {
        this.options.navigate(href);
        this.executed.add(action.id);
        this.emit({ type: "navigated", action, href });
        return { status: "navigated" };
      } catch (error) {
        this.emit({ type: "failed", action, error });
        return { status: "ignored", reason: "navigate_failed" };
      }
    }

    this.emit({ type: "ignored", action, reason: "no_handler" });
    return { status: "ignored", reason: "no_handler" };
  }

  cancel(actionId: string): boolean {
    const action = this.pending.get(actionId);
    if (!action) return false;
    this.pending.delete(actionId);
    this.emit({ type: "cancelled", action });
    return true;
  }

  getPendingActions(): UIAction[] {
    return [...this.pending.values()];
  }

  isExecuted(actionId: string): boolean {
    return this.executed.has(actionId);
  }

  private emit(event: ActionBusEvent): void {
    for (const listener of this.listeners) listener(event);
  }
}

/**
 * 生产用 ActionBus：页面 surface 动态读取 + 跨页动作导航。
 *
 * 页面只注册自己的 handler；跨页动作由抽屉确认后走 `navigate`。
 */
export function createAgentActionBus(options: {
  getCurrentSurface: () => UISurface | null;
  navigate: (href: string) => void;
  resolveHref?: (action: UIAction) => string | null;
}): ActionBus {
  return new ActionBus(options.getCurrentSurface, {
    navigate: options.navigate,
    resolveHref: options.resolveHref ?? hrefForAction,
  });
}
