/**
 * 史引副驾驶联动目标（V1.0.4 收尾修复 P2；V1.0.6.3 双图联动）。
 *
 * 回答 → 副驾驶面板需要的「可渲染深链接」。规则：
 * 1. 优先用本轮 `ui_actions` 里的联动动作（`timeline.focus_event` /
 *    `timeline.focus_dynasty` / `graph.focus_person` / `graph.focus_relation`）：
 *    `hrefForAction` 已同时读取 payload 与 target.params，模型把实体 ID 写在任一处都能展开；
 * 2. 动作缺失时回退到 grounded 回答的可定位引用（事件 → 时间轴，人物 → 关系图），
 *    保证「回答完就有史料可看」，不出现「回答完了右下角还是空的」中间态。
 *
 * V1.0.6.3：后端会让一次提问同时命中时间轴与人物图两侧（`ui_actions` 里两种动作都在），
 * 因此这里从「单个 guide」升级为「联动目标集合」：时间轴 / 人物图各取第一个可渲染目标，
 * 聊天气泡据此并排渲染两个联动按钮，右侧副驾驶面板按按钮切换视图。
 *
 * 纯函数、不依赖 React，便于单测；`/ask` 页面只消费结果并自动展开面板。
 */
import type { AgentAnswerView } from "@/lib/agent-client";
import { hrefForAction } from "@/lib/action-navigation";
import type { UIAction, UIActionType } from "@/lib/action-policy";
import { graphHref, timelineHref } from "@/lib/routes";

/** 派生 guide 所需的最小 transcript turn 结构（与 AgentContext.AgentTurn 结构兼容）。 */
export interface GuideSourceTurn {
  id: string;
  role: "user" | "assistant";
  answer?: AgentAnswerView | null;
}

/** 单个表面（时间轴 / 人物图）的联动目标。 */
export interface AgentGuideTarget {
  surface: "timeline" | "graph";
  /** 副驾驶要渲染的页面（iframe 深链接）。 */
  href: string;
  /** 副驾驶面板 / 联动按钮标题。 */
  title: string;
  /** 联动来源：动作优先，动作缺失时回退到回答引用。 */
  kind: "action" | "citation";
  /** 命中的动作（citation 回退时为 null）。 */
  action: UIAction | null;
}

/** 一轮回答的联动目标集合（时间轴 + 人物图，最多各一个）。 */
export interface AgentGuideTargets {
  /** 触发联动的回答 turn id；同一轮只自动展开一次（用户手动关闭后不会被强行弹开）。 */
  turnId: string;
  /** 按动作原始顺序（问题焦点优先）排列的目标；同一 surface 只保留第一个。 */
  targets: AgentGuideTarget[];
  timeline: AgentGuideTarget | null;
  graph: AgentGuideTarget | null;
  /** 主目标（= targets[0]，保持 V1.0.4 及更早的单面板语义）。 */
  primary: AgentGuideTarget;
}

/** 兼容旧调用方的单目标类型（= 主目标 + turnId）。 */
export interface AgentGuide extends AgentGuideTarget {
  turnId: string;
  /** V1.0.6.3：同一轮的全部联动目标（至少 1 个）。 */
  targets: AgentGuideTarget[];
}

/** 可驱动副驾驶面板的动作类型 → 面板标题 / 表面。 */
const GUIDE_ACTION_META: Partial<
  Record<UIActionType, { surface: "timeline" | "graph"; title: string }>
> = {
  "timeline.focus_event": { surface: "timeline", title: "时间轴" },
  "timeline.focus_dynasty": { surface: "timeline", title: "时间轴" },
  "graph.focus_person": { surface: "graph", title: "人物关系图" },
  "graph.focus_relation": { surface: "graph", title: "人物关系图" },
};

/** 该动作类型是否应该驱动副驾驶面板。 */
export function isGuideActionType(type: UIActionType): boolean {
  return GUIDE_ACTION_META[type] !== undefined;
}

/** 单个动作 → 联动目标；类型不在白名单 / 算不出深链接时返回 null。 */
export function guideTargetForAction(action: UIAction): AgentGuideTarget | null {
  const meta = GUIDE_ACTION_META[action.type];
  if (!meta) return null;
  const href = hrefForAction(action);
  if (!href) return null;
  return {
    surface: meta.surface,
    href,
    title: meta.title,
    kind: "action",
    action,
  };
}

/** 引用 → 时间轴 / 人物图联动目标（事件优先，其次人物）。 */
function guideTargetForCitation(citation: AgentAnswerView["citations"][number]): AgentGuideTarget | null {
  if (citation.event_id) {
    return {
      surface: "timeline",
      href: timelineHref({ event: citation.event_id, mode: "detail" }),
      title: "时间轴",
      kind: "citation",
      action: null,
    };
  }
  if (citation.person_id) {
    return {
      surface: "graph",
      href: graphHref({ person: citation.person_id, mode: "detail" }),
      title: "人物关系图",
      kind: "citation",
      action: null,
    };
  }
  return null;
}

/**
 * 从单轮回答解析联动目标（V1.0.6.3）。
 *
 * - 动作优先，按后端下发顺序（问题焦点优先）收集；
 * - 动作没覆盖的表面再用 grounded 引用的可定位实体补齐（事件 → 时间轴，人物 → 人物图）；
 * - 没有任何可联动目标时返回 null。
 */
export function resolveAnswerGuideTargets(
  answer: AgentAnswerView | null | undefined,
  turnId: string,
): AgentGuideTargets | null {
  if (!answer) return null;
  const targets: AgentGuideTarget[] = [];
  const push = (target: AgentGuideTarget | null) => {
    if (!target) return;
    if (targets.some((item) => item.surface === target.surface)) return;
    targets.push(target);
  };

  for (const action of answer.uiActions) {
    push(guideTargetForAction(action));
  }
  if (answer.mode === "grounded") {
    for (const citation of answer.citations) {
      push(guideTargetForCitation(citation));
    }
  }
  if (targets.length === 0) return null;

  const timeline = targets.find((item) => item.surface === "timeline") ?? null;
  const graph = targets.find((item) => item.surface === "graph") ?? null;
  return {
    turnId,
    targets,
    timeline,
    graph,
    primary: targets[0],
  };
}

/**
 * 从 transcript 派生史引联动目标集合。
 *
 * 只看**最近一条有结构化回答**的 assistant turn：这样后续追问（尤其是错误 / 澄清）不会让
 * 旧一轮的联动重新弹出来；同一轮内动作优先，动作算不出深链接时再退回回答引用。
 */
export function resolveGuideTargetsFromTranscript(
  transcript: readonly GuideSourceTurn[],
): AgentGuideTargets | null {
  const answerTurn = [...transcript]
    .reverse()
    .find((turn) => turn.role === "assistant" && turn.answer != null);
  if (!answerTurn) return null;
  return resolveAnswerGuideTargets(answerTurn.answer, answerTurn.id);
}

/**
 * 兼容旧调用方：只返回主目标（V1.0.4 语义）。
 *
 * V1.0.6.3 起主目标仍是「后端动作顺序里的第一个」，因此行为与旧版一致；
 * 需要并排渲染双按钮时使用 `resolveGuideTargetsFromTranscript`。
 */
export function resolveGuideFromTranscript(
  transcript: readonly GuideSourceTurn[],
): AgentGuide | null {
  const targets = resolveGuideTargetsFromTranscript(transcript);
  if (!targets) return null;
  return {
    ...targets.primary,
    turnId: targets.turnId,
    targets: targets.targets,
  };
}