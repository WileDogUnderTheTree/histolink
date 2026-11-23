/**
 * 动作策略（V1.0.1 / TC-07 骨架；Q2 决策落地）。
 *
 * 唯一事实源是 `contracts/action-policy.json`（人工维护、由 `scripts/validate-contract.mjs` 校验）；
 * 本文件是它的**前端只读镜像**，必须逐项一致（`frontend/tests/action-policy.test.ts` 会对照校验）。
 *
 * 机械规则（Q2，不信任后端 auto）：
 * 1. 未知动作类型 → 忽略并上报（`unknown_type`）；
 * 2. `planned` 类型（V1.0 暂缓）→ 忽略（`planned`），不执行也不提示；
 * 3. 缺 `target.surface` 或 surface 非法 → 视为跨页，必须确认（`missing_surface`）；
 * 4. `target.surface === 当前页面 surface` → 同页，自动执行；
 * 5. 其余 → 跨页，渲染确认按钮（`cross_page`）。
 */
import type { components } from "@/lib/api-types";

export type UIAction = components["schemas"]["UIAction"];
export type UIActionType = components["schemas"]["UIActionType"];
export type UISurface = components["schemas"]["UISurface"];

/** 动作类型 → 策略条目（镜像 contracts/action-policy.json）。 */
export interface ActionPolicyEntry {
  surface: UISurface | null;
  availability: "available" | "planned";
  auto: "same_page_only" | "requires_confirmation";
  since: string;
}

export const ACTION_POLICY: Record<UIActionType, ActionPolicyEntry> = {
  "timeline.focus_event": {
    surface: "timeline",
    availability: "available",
    auto: "same_page_only",
    since: "1.0.4",
  },
  "timeline.focus_dynasty": {
    surface: "timeline",
    availability: "available",
    auto: "same_page_only",
    since: "1.0.4",
  },
  "graph.focus_person": {
    surface: "graph",
    availability: "available",
    auto: "same_page_only",
    since: "1.0.4",
  },
  "graph.focus_relation": {
    surface: "graph",
    availability: "available",
    auto: "same_page_only",
    since: "1.0.4",
  },
  "ask.suggest": {
    surface: "ask",
    availability: "available",
    auto: "same_page_only",
    since: "1.0.6",
  },
  "timeline.highlight_events": {
    surface: "timeline",
    availability: "planned",
    auto: "same_page_only",
    since: "1.0.4",
  },
  "graph.highlight_persons": {
    surface: "graph",
    availability: "planned",
    auto: "same_page_only",
    since: "1.0.4",
  },
  "open.event_card": {
    surface: null,
    availability: "planned",
    auto: "requires_confirmation",
    since: "1.0.5",
  },
  "open.person_card": {
    surface: null,
    availability: "planned",
    auto: "requires_confirmation",
    since: "1.0.5",
  },
};

/** 策略判定结果。 */
export type ActionDecision =
  | { decision: "auto" }
  | { decision: "confirm"; reason: "cross_page" | "missing_surface" }
  | { decision: "ignore"; reason: "unknown_type" | "planned" };

const VALID_SURFACES: readonly UISurface[] = ["timeline", "graph", "ask"];

function isUISurface(value: unknown): value is UISurface {
  return typeof value === "string" && (VALID_SURFACES as readonly string[]).includes(value);
}

/**
 * 判定一个动作该如何处理。
 *
 * @param action 服务端下发的动作信封（可含运行时非法值，函数必须容错）
 * @param currentSurface 当前页面的 surface；`null` 表示不在三个动作目标页（如首页）
 */
export function decideAction(action: UIAction, currentSurface: UISurface | null): ActionDecision {
  const actionType = action?.type as string | undefined;
  const policy = actionType ? ACTION_POLICY[actionType as UIActionType] : undefined;

  if (!policy) return { decision: "ignore", reason: "unknown_type" };
  if (policy.availability !== "available") return { decision: "ignore", reason: "planned" };

  const targetSurface = (action.target as { surface?: unknown } | undefined)?.surface;
  if (!isUISurface(targetSurface)) return { decision: "confirm", reason: "missing_surface" };

  if (targetSurface === currentSurface) return { decision: "auto" };
  return { decision: "confirm", reason: "cross_page" };
}
