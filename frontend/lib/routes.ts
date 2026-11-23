/**
 * 深链接构造器（V1.0.1 / TC-07 骨架）。
 *
 * V1.0.1 只冻结 URL 形状，不实现页面状态化（V1.0.4 再做 useSearchParams 派生）。
 * 约定：
 * - `/timeline?event=&dynasty=&mode=`
 * - `/graph?person=&era=&mode=`
 * - `/ask?q=`
 */
import type { UISurface } from "@/lib/action-policy";

export type QueryValue = string | number | boolean | null | undefined;

function buildHref(basePath: string, params: Record<string, QueryValue>): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === "") continue;
    search.set(key, String(value));
  }
  const query = search.toString();
  return query ? `${basePath}?${query}` : basePath;
}

/** 从 pathname 推导页面 surface；`/` 与未知路径返回 null（跨页一律需确认）。 */
export function surfaceFromPathname(pathname: string | null | undefined): UISurface | null {
  if (!pathname) return null;
  const cleaned = pathname.split("?")[0].split("#")[0].replace(/\/+$/, "") || "/";
  switch (cleaned) {
    case "/timeline":
      return "timeline";
    case "/graph":
      return "graph";
    case "/ask":
      return "ask";
    default:
      return null;
  }
}

export interface TimelineHrefParams {
  event?: string;
  dynasty?: string;
  /** 简阅断代 id（跨页 `timeline.focus_dynasty` 使用 group_id 时携带）。 */
  group?: string;
  mode?: string;
}

export interface GraphHrefParams {
  person?: string;
  era?: string;
  mode?: string;
  /** 受控选中的人物（V1.0.1 / TC-08）：刷新后仍保持关系面板。 */
  selected?: string;
}

export function timelineHref(params: TimelineHrefParams = {}): string {
  return buildHref("/timeline", {
    event: params.event,
    dynasty: params.dynasty,
    group: params.group,
    mode: params.mode,
  });
}

export function graphHref(params: GraphHrefParams = {}): string {
  return buildHref("/graph", {
    person: params.person,
    era: params.era,
    mode: params.mode,
    selected: params.selected,
  });
}

export function askHref(question?: string): string {
  return buildHref("/ask", { q: question?.trim() ?? "" });
}
