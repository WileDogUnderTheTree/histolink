/**
 * ActionBus（V1.0.1 / TC-07 骨架）。
 *
 * 职责边界：
 * - 本卡只做「动作类型注册 / 分发 / 幂等键记录 / 同页自动·跨页确认」骨架；
 * - **不接后端**、不导航、不改页面状态（真实执行留给 V1.0.4）；
 * - 页面渲染状态仍由各页面自身负责，动作只通过已注册 handler 暴露意图。
 *
 * 幂等约定：`action.id` 是幂等键——同一动作重复 dispatch 只执行一次；
 * 已进入「待确认」队列的动作重复 dispatch 视为 duplicate。
 */
import { decideAction } from "@/lib/action-policy";
import type { ActionDecision, UIAction, UIActionType, UISurface } from "@/lib/action-policy";

export type ActionHandler = (action: UIAction) => void | Promise<void>;

export type ActionBusEvent =
  | { type: "executed"; action: UIAction }
  | { type: "confirmation-required"; action: UIAction }
  | { type: "cancelled"; action: UIAction }
  | { type: "ignored"; action: UIAction; reason: string }
  | { type: "failed"; action: UIAction; error: unknown };

export type DispatchResult =
  | { status: "executed" }
  | { status: "pending" }
  | { status: "duplicate" }
  | { status: "ignored"; reason: string };

export type ActionBusListener = (event: ActionBusEvent) => void;

export class ActionBus {
  private readonly handlers = new Map<UIActionType, ActionHandler>();
  private readonly listeners = new Set<ActionBusListener>();
  private readonly executed = new Set<string>();
  private readonly pending = new Map<string, UIAction>();

  constructor(
    /** 返回当前页面的 surface；页面切换时应重新创建或注入最新实现。 */
    private readonly getCurrentSurface: () => UISurface | null = () => null,
  ) {}

  register(type: UIActionType, handler: ActionHandler): void {
    this.handlers.set(type, handler);
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

  /** 执行已判定为同页的动作；无 handler 时忽略（V1.0.4 前不真实执行）。 */
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

  /** 用户点击「前往…」确认按钮后调用；不在待确认队列则忽略。 */
  async confirm(actionId: string): Promise<DispatchResult> {
    const action = this.pending.get(actionId);
    if (!action) return { status: "ignored", reason: "not_pending" };
    this.pending.delete(actionId);
    return this.execute(action);
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
