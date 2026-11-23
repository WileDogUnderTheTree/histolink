/**
 * 动作能力映射（V1.0.1 / TC-08）。
 *
 * 回答一个问题：每种 UI 动作要真正执行，目标页面/组件必须提供什么能力？
 * 本表是「契约（动作类型）→ 组件能力 → 归属版本」的唯一映射，由
 * `frontend/tests/action-capabilities.test.ts` 校验覆盖完整、与动作策略一致。
 *
 * 注意：`availability` 来自 `contracts/action-policy.json`（V1.0 冻结口径），
 * `capabilityStatus` 表示**本仓库当前实现进度**，两者不可混用：
 * - 一个动作可以 `available`（契约允许）但 `capabilityStatus: "partial"`（组件能力未齐）。
 */
import type { UIActionType, UISurface } from "@/lib/action-policy";
import { ACTION_POLICY } from "@/lib/action-policy";

/** 组件能力粒度；引用方按 id 判断「动作能不能落地」。 */
export type ComponentCapability =
  | "timeline.select-event"
  | "timeline.select-dynasty"
  | "timeline.highlight-event-set"
  | "graph.focus-person"
  | "graph.select-relation"
  | "graph.highlight-person-set"
  | "graph.center-person"
  | "ask.suggest-questions"
  | "overlay.event-card"
  | "overlay.person-card";

export type CapabilityStatus = "implemented" | "partial" | "planned";

export interface ActionCapabilityEntry {
  /** 目标表面；与动作策略的 surface 一致（null = 无固定页面，需确认）。 */
  surface: UISurface | null;
  /** 契约可用性（available / planned）。 */
  availability: "available" | "planned";
  /** 本仓库当前实现进度。 */
  capabilityStatus: CapabilityStatus;
  /** 执行该动作所需的组件能力；V1.0.4 按此清单补齐。 */
  requiredCapabilities: readonly ComponentCapability[];
  /** 能力落地的归属版本。 */
  targetVersion: string;
  /** 备注：V1.0.1 实际覆盖到什么程度。 */
  note: string;
}

export const ACTION_CAPABILITIES: Record<UIActionType, ActionCapabilityEntry> = {
  "timeline.focus_event": {
    surface: "timeline",
    availability: "available",
    capabilityStatus: "implemented",
    requiredCapabilities: ["timeline.select-event"],
    targetVersion: "1.0.4",
    note: "V1.0.1：时间轴页已注册 handler，能切朝代 / 简细览并打开事件卡，同时回写 /timeline?event= 深链接。",
  },
  "timeline.focus_dynasty": {
    surface: "timeline",
    availability: "available",
    capabilityStatus: "implemented",
    requiredCapabilities: ["timeline.select-dynasty"],
    targetVersion: "1.0.4",
    note: "V1.0.1：时间轴页已注册 handler，支持 dynasty / group_id / mode 三个 payload 字段。",
  },
  "graph.focus_person": {
    surface: "graph",
    availability: "available",
    capabilityStatus: "implemented",
    requiredCapabilities: ["graph.focus-person", "graph.center-person"],
    targetVersion: "1.0.4",
    note: "V1.0.1：图谱页已注册 handler，person_id 经人物主数据解析成图节点（姓名）后换中心，并回写 ?person=。",
  },
  "graph.focus_relation": {
    surface: "graph",
    availability: "available",
    capabilityStatus: "partial",
    requiredCapabilities: ["graph.focus-person", "graph.select-relation", "graph.center-person"],
    targetVersion: "1.0.4",
    note: "V1.0.1：能换中心并驱动受控 selectedPersonId 打开关系面板；尚无关系卡抽屉与边高亮。",
  },
  "ask.suggest": {
    surface: "ask",
    availability: "available",
    capabilityStatus: "planned",
    requiredCapabilities: ["ask.suggest-questions"],
    targetVersion: "1.0.6",
    note: "V1.0.1：/ask 只展示占位问题，建议问题列表未实现。",
  },
  "timeline.highlight_events": {
    surface: "timeline",
    availability: "planned",
    capabilityStatus: "planned",
    requiredCapabilities: ["timeline.highlight-event-set"],
    targetVersion: "1.0.4",
    note: "V1.0.1 明确不做：时间轴高亮集合 / 区间属 V1.0.4；本卡只记录能力缺口。",
  },
  "graph.highlight_persons": {
    surface: "graph",
    availability: "planned",
    capabilityStatus: "partial",
    requiredCapabilities: ["graph.highlight-person-set"],
    targetVersion: "1.0.4",
    note: "V1.0.1：PersonGraph2D 已接受 highlightedPersonIds（最小视觉高亮）；尚无页面级入口。",
  },
  "open.event_card": {
    surface: null,
    availability: "planned",
    capabilityStatus: "planned",
    requiredCapabilities: ["overlay.event-card"],
    targetVersion: "1.0.5",
    note: "V1.0.1：事件卡只在时间轴内嵌显示，无全局抽屉。",
  },
  "open.person_card": {
    surface: null,
    availability: "planned",
    capabilityStatus: "planned",
    requiredCapabilities: ["overlay.person-card"],
    targetVersion: "1.0.5",
    note: "V1.0.1：人物详情只在图谱右栏显示，无全局抽屉。",
  },
};

/** 动作类型是否为「同页可自动执行」的可用动作（V1.0 冻结口径）。 */
export function isAvailableAction(type: UIActionType): boolean {
  return ACTION_CAPABILITIES[type].availability === "available";
}

/** 某个 surface 上已注册 handler 的动作类型（供页面接入清单与测试使用）。 */
export function actionsForSurface(surface: UISurface): readonly UIActionType[] {
  return (Object.keys(ACTION_CAPABILITIES) as UIActionType[]).filter(
    (type) =>
      ACTION_CAPABILITIES[type].surface === surface &&
      ACTION_CAPABILITIES[type].availability === "available",
  );
}

/** 契约策略与能力映射的 surface / availability 必须逐项一致（防两份口径漂移）。 */
export function isConsistentWithPolicy(type: UIActionType): boolean {
  const capability = ACTION_CAPABILITIES[type];
  const policy = ACTION_POLICY[type];
  return (
    capability.surface === policy.surface && capability.availability === policy.availability
  );
}
