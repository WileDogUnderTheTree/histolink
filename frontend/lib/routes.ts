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
  /** 来源标记（V1.0.4 UI 精修）：`agent` = 从史引副驾驶跳入，页面显示「返回聊天」。 */
  from?: string;
}

export interface GraphHrefParams {
  person?: string;
  era?: string;
  mode?: string;
  /** 受控选中的人物（V1.0.1 / TC-08）：刷新后仍保持关系面板。 */
  selected?: string;
  /** 来源标记（V1.0.4 UI 精修）：`agent` = 从史引副驾驶跳入，页面显示「返回聊天」。 */
  from?: string;
}

export function timelineHref(params: TimelineHrefParams = {}): string {
  return buildHref("/timeline", {
    event: params.event,
    dynasty: params.dynasty,
    group: params.group,
    mode: params.mode,
    from: params.from,
  });
}

export function graphHref(params: GraphHrefParams = {}): string {
  return buildHref("/graph", {
    person: params.person,
    era: params.era,
    mode: params.mode,
    selected: params.selected,
    from: params.from,
  });
}

export function askHref(question?: string): string {
  return buildHref("/ask", { q: question?.trim() ?? "" });
}

/** 副驾驶面板「展开完整页面」用的双入口（V1.0.4 UI 精修）。 */
export interface FullSurfaceLinks {
  /** 当前副驾驶面板所在的表面；href 不是时间轴 / 图谱深链接时为 null。 */
  focus: "timeline" | "graph" | null;
  /** 完整时间轴入口；面板本身在时间轴时带上焦点实体。 */
  timeline: string;
  /** 完整人物图入口；面板本身在关系图时带上焦点实体。 */
  graph: string;
}

/**
 * 从史引副驾驶的深链接派生「展开完整时间轴 / 完整人物图」两个入口。
 *
 * 规则：
 * - 两个入口都带 `from=agent`，完整页面据此渲染「返回聊天」按钮，形成
 *   「从聊天中来到聊天中去」的闭环（V1.0.4 UI 精修）；
 * - 面板当前在哪一面，就把该面的焦点实体（`event` / `person` / `era` /
 *   `selected` / `mode`）原样带到完整页面；另一面没有可迁移的实体，回退到裸路径。
 *   这样 `/timeline?event=handong-chibi` 的副驾驶点「展开完整人物图」不会把
 *   event 参数硬塞给图谱（图谱不认 event，反而会被当成非法参数）。
 */
export function surfaceLinksFromHref(href: string): FullSurfaceLinks {
  const [rawPath, rawSearch = ""] = href.split("?");
  const path = rawPath.replace(/\/+$/, "");
  const params = new URLSearchParams(rawSearch.split("#")[0]);
  const read = (key: string): string | undefined => params.get(key) ?? undefined;

  if (path === "/timeline") {
    return {
      focus: "timeline",
      timeline: timelineHref({
        event: read("event"),
        dynasty: read("dynasty"),
        group: read("group"),
        mode: read("mode"),
        from: "agent",
      }),
      graph: graphHref({ from: "agent" }),
    };
  }

  if (path === "/graph") {
    return {
      focus: "graph",
      timeline: timelineHref({ from: "agent" }),
      graph: graphHref({
        person: read("person"),
        era: read("era"),
        mode: read("mode"),
        selected: read("selected"),
        from: "agent",
      }),
    };
  }

  return {
    focus: null,
    timeline: timelineHref({ from: "agent" }),
    graph: graphHref({ from: "agent" }),
  };
}
