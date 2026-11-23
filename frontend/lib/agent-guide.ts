/**
 * 史引副驾驶联动目标（V1.0.4 收尾修复 P2）。
 *
 * 回答 → 副驾驶面板需要的「一个可渲染的深链接」。规则：
 * 1. 优先用本轮 `ui_actions` 里的联动动作（`timeline.focus_event` /
 *    `timeline.focus_dynasty` / `graph.focus_person` / `graph.focus_relation`）：
 *    `hrefForAction` 已同时读取 payload 与 target.params，模型把实体 ID 写在任一处都能展开；
 * 2. 动作缺失时回退到 grounded 回答的第一条可定位引用（事件 → 时间轴，人物 → 关系图），
 *    保证「回答完就有史料可看」，不出现「回答完了右下角还是空的」中间态。
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

export interface AgentGuide {
  /** 触发联动的回答 turn id；同一轮只自动展开一次（用户手动关闭后不会被强行弹开）。 */
  turnId: string;
  /** 联动来源：动作优先，动作缺失时回退到回答引用。 */
  kind: "action" | "citation";
  /** 副驾驶要渲染的页面（iframe 深链接）。 */
  href: string;
  /** 目标表面。 */
  surface: "timeline" | "graph";
  /** 副驾驶面板标题。 */
  title: string;
  /** 命中的动作（citation 回退时为 null）。 */
  action: UIAction | null;
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

/**
 * 从 transcript 派生史引联动目标。
 *
 * 只看**最近一条有结构化回答**的 assistant turn：这样后续追问（尤其是错误 / 澄清）不会让
 * 旧一轮的联动重新弹出来；同一轮内动作优先，动作算不出深链接时再退回回答引用。
 */
export function resolveGuideFromTranscript(
  transcript: readonly GuideSourceTurn[],
): AgentGuide | null {
  const answerTurn = [...transcript]
    .reverse()
    .find((turn) => turn.role === "assistant" && turn.answer != null);
  const answer = answerTurn?.answer;
  if (!answerTurn || !answer) return null;

  for (const action of answer.uiActions) {
    const meta = GUIDE_ACTION_META[action.type];
    if (!meta) continue;
    const href = hrefForAction(action);
    if (!href) continue;
    return {
      turnId: answerTurn.id,
      kind: "action",
      href,
      surface: meta.surface,
      title: meta.title,
      action,
    };
  }

  if (answer.mode !== "grounded") return null;
  for (const citation of answer.citations) {
    if (citation.event_id) {
      return {
        turnId: answerTurn.id,
        kind: "citation",
        href: timelineHref({ event: citation.event_id, mode: "detail" }),
        surface: "timeline",
        title: "时间轴",
        action: null,
      };
    }
    if (citation.person_id) {
      return {
        turnId: answerTurn.id,
        kind: "citation",
        href: graphHref({ person: citation.person_id, mode: "detail" }),
        surface: "graph",
        title: "人物关系图",
        action: null,
      };
    }
  }
  return null;
}
