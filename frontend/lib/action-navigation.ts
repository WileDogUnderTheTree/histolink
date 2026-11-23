/**
 * 动作 → 深链接（V1.0.4）。
 *
 * ActionBus 只负责「同页执行 / 跨页待确认」；跨页确认后需要一个可导航的 URL。
 * 本文件把动作信封翻译成 `routes.ts` 的深链接：
 * - timeline.focus_event  → /timeline?event=
 * - timeline.focus_dynasty → /timeline?dynasty=|group=
 * - graph.focus_person    → /graph?person=
 * - graph.focus_relation  → /graph?person=&selected=
 * - ask.suggest           → /ask?q=
 *
 * 所有字段都做运行时容错：payload 缺失 / 类型不对 → 返回 null（调用方忽略，不导航到空白页）。
 *
 * V1.0.4 修复：模型可能只把实体 ID 写进 `target.params`（后端 required-field 校验会
 * 把 payload 与 target.params 合并判断，所以两种写法都合法）。之前只读 `payload`，
 * 导致「后端返回了动作、前端却算不出深链接」，副驾驶面板无法自动展开。
 * 现在统一把 `payload` 与 `target.params` 合并后再取值（target.params 优先，与后端一致）。
 */
import type { UIAction } from "@/lib/action-policy";
import { askHref, graphHref, timelineHref } from "@/lib/routes";

const MAX_QUERY_LENGTH = 200;
const MAX_QUESTION_LENGTH = 2000;

/** 合并动作的 payload 与 target.params（与后端 `_action_has_required_fields` 同一口径）。 */
export function actionFields(action: UIAction): Record<string, unknown> {
  const params = (action.target?.params ?? {}) as Record<string, unknown>;
  return { ...(action.payload ?? {}), ...params };
}

function readText(source: Record<string, unknown>, key: string, maxLength: number): string | null {
  const value = source[key];
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  return trimmed.slice(0, maxLength);
}

function readMode(source: Record<string, unknown>): "detail" | "brief" | undefined {
  return source.mode === "detail" || source.mode === "brief" ? source.mode : undefined;
}

/** 动作 → 目标深链接；无法推导时返回 null。 */
export function hrefForAction(action: UIAction): string | null {
  const payload = actionFields(action);

  switch (action.type) {
    case "timeline.focus_event": {
      const event = readText(payload, "event_id", MAX_QUERY_LENGTH);
      return event ? timelineHref({ event, mode: readMode(payload) }) : null;
    }
    case "timeline.focus_dynasty": {
      const mode = readMode(payload);
      const dynasty = readText(payload, "dynasty", MAX_QUERY_LENGTH);
      if (dynasty) return timelineHref({ dynasty, mode });
      const group = readText(payload, "group_id", MAX_QUERY_LENGTH);
      return group ? timelineHref({ group, mode }) : null;
    }
    case "graph.focus_person": {
      const person =
        readText(payload, "person_id", MAX_QUERY_LENGTH) ?? readText(payload, "person", MAX_QUERY_LENGTH);
      if (!person) return null;
      const era = readText(payload, "era_id", MAX_QUERY_LENGTH);
      return graphHref({ person, era: era ?? undefined, mode: readMode(payload) });
    }
    case "graph.focus_relation": {
      const personA = readText(payload, "person_id_a", MAX_QUERY_LENGTH);
      const personB = readText(payload, "person_id_b", MAX_QUERY_LENGTH);
      if (!personA || !personB) return null;
      const era = readText(payload, "era_id", MAX_QUERY_LENGTH);
      return graphHref({
        person: personA,
        selected: personB,
        era: era ?? undefined,
        mode: readMode(payload),
      });
    }
    case "ask.suggest": {
      const question =
        readText(payload, "question", MAX_QUESTION_LENGTH) ?? readText(payload, "q", MAX_QUESTION_LENGTH);
      return askHref(question ?? undefined);
    }
    default:
      return null;
  }
}
