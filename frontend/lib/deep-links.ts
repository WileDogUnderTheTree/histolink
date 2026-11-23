/**
 * 深链接解析（V1.0.1 / TC-08）。
 *
 * 只负责「URL → 页面状态」的纯函数推导，不依赖 React / 路由：
 * - `/timeline?event=<event_id>&dynasty=<朝代>&mode=detail|brief`
 * - `/graph?person=<person_id|姓名|别名>&era=<era_id|scope_id>&mode=detail|brief&selected=<人物>`
 *
 * 设计取舍：V1.0.1 只做「打开链接即可恢复视图」与「ActionBus 执行后回写 URL」，
 * 不做全量 URL 状态化（每次点击都同步 query）——那属于 V1.0.4 范围。
 */
import type { ViewMode } from "@/components/ViewModeSwitch";
import {
  ERA_TO_SCOPE,
  PERSON_GRAPH_ERAS,
  PERSON_GRAPH_SCOPES,
  PERSON_NAME_ALIASES,
  SCOPE_TO_ERA,
} from "@/data/person-graph";
import type {
  PersonGraphData,
  PersonGraphEraId,
  PersonGraphScopeId,
} from "@/data/person-graph";
import { resolvePersonCandidates } from "@/data/persons";
import {
  DYNASTY_GROUPS,
  DYNASTY_START_YEARS,
  TIMELINE_EVENTS,
  groupOfDynasty,
  importanceOf,
} from "@/data/timeline-events";
import type { Dynasty, DynastyGroupId } from "@/data/timeline-events";

/** 数据中实际出现过的朝代，按起始年排序（与时间轴 Tab 同一口径）。 */
export const DEEP_LINK_DYNASTIES: readonly Dynasty[] = Array.from(
  new Set(TIMELINE_EVENTS.map((event) => event.dynasty)),
).sort((left, right) => DYNASTY_START_YEARS[left] - DYNASTY_START_YEARS[right]);

function readMode(value: string | null): ViewMode | null {
  return value === "brief" || value === "detail" ? value : null;
}

function isDynasty(value: string | null): value is Dynasty {
  return value !== null && (DEEP_LINK_DYNASTIES as readonly string[]).includes(value);
}

export interface ResolvedTimelineDeepLink {
  mode: ViewMode;
  dynasty: Dynasty;
  groupId: DynastyGroupId;
  selectedEventId: string | null;
  openEasterEgg: boolean;
}

const DEFAULT_DYNASTY = DEEP_LINK_DYNASTIES[0];

/**
 * 解析时间轴深链接。
 *
 * 优先级：`event` > `group` > `dynasty` > 默认（细览第一个朝代）。
 * 显式 `event` 时以事件自身朝代为准，忽略冲突的 `dynasty` 参数；
 * 简阅模式下若事件不是顶级事件会自动回退细览，保证打开链接一定能看到该事件。
 */
export function resolveTimelineDeepLink(search: string): ResolvedTimelineDeepLink {
  const params = new URLSearchParams(search);
  const requestedMode = readMode(params.get("mode"));
  const eventId = params.get("event");
  const event = eventId ? TIMELINE_EVENTS.find((item) => item.id === eventId) : undefined;

  if (event) {
    const group = groupOfDynasty(event.dynasty);
    const visibleInBrief = importanceOf(event) === 3;
    const mode: ViewMode = requestedMode === "brief" && visibleInBrief ? "brief" : "detail";
    return {
      mode,
      dynasty: event.dynasty,
      groupId: group.id,
      selectedEventId: event.id,
      openEasterEgg: event.isSpecial === true,
    };
  }

  const groupParam = params.get("group");
  const group = DYNASTY_GROUPS.find((item) => item.id === groupParam);
  if (group) {
    const dynasty =
      group.dynasties.find((candidate) => isDynasty(candidate)) ?? DEFAULT_DYNASTY;
    return {
      mode: requestedMode ?? "brief",
      dynasty,
      groupId: group.id,
      selectedEventId: null,
      openEasterEgg: false,
    };
  }

  const dynastyParam = params.get("dynasty");
  if (isDynasty(dynastyParam)) {
    const resolvedGroup = groupOfDynasty(dynastyParam);
    return {
      mode: requestedMode ?? "detail",
      dynasty: dynastyParam,
      groupId: resolvedGroup.id,
      selectedEventId: null,
      openEasterEgg: false,
    };
  }

  if (requestedMode === "brief") {
    const defaultGroup = DYNASTY_GROUPS[0];
    const dynasty =
      defaultGroup.dynasties.find((candidate) => isDynasty(candidate)) ?? DEFAULT_DYNASTY;
    return {
      mode: "brief",
      dynasty,
      groupId: defaultGroup.id,
      selectedEventId: null,
      openEasterEgg: false,
    };
  }

  return {
    mode: "detail",
    dynasty: DEFAULT_DYNASTY,
    groupId: groupOfDynasty(DEFAULT_DYNASTY).id,
    selectedEventId: null,
    openEasterEgg: false,
  };
}

/**
 * 把一个「person_id / 展示名 / 别名」解析成当期图节点 id（V1.0.1 图节点仍以姓名为 id）。
 *
 * 解析顺序：节点名直接命中 → 图谱别名表 → 人物主数据（person_id / 同名候选 / 全局别名）。
 * 同名且未给上下文时不会默认取第一条：只有唯一候选能在当期图中命中时才返回。
 */
export function resolvePersonInGraph(
  value: string,
  graph: PersonGraphData,
): string | null {
  const trimmed = value.trim();
  if (!trimmed) return null;

  const direct = graph.nodes.find(
    (node) => node.id === trimmed || node.name === trimmed,
  );
  if (direct) return direct.id;

  const graphAlias = PERSON_NAME_ALIASES[trimmed];
  if (graphAlias) {
    const aliased = graph.nodes.find((node) => node.id === graphAlias);
    if (aliased) return aliased.id;
  }

  for (const person of resolvePersonCandidates(trimmed)) {
    const match = graph.nodes.find((node) => node.id === person.displayName);
    if (match) return match.id;
  }

  return null;
}

export interface ResolvedGraphDeepLink {
  mode: ViewMode;
  eraId: PersonGraphEraId;
  scopeId: PersonGraphScopeId;
  centerPersonId: string;
  /** 受控选中人物（`?selected=`）；`undefined` = 非受控。 */
  selectedPersonId: string | undefined;
}

const DEFAULT_ERA = PERSON_GRAPH_ERAS[0];
const DEFAULT_SCOPE = PERSON_GRAPH_SCOPES[0];

/**
 * 没有显式分期时，跨 18 期 / 7 组找包含该人物的关系图。
 *
 * 史引副驾驶 / 引用跳转生成的深链接只带 `person_id`，不带 `era`；如果直接用默认
 * （春秋）图解析，周瑜、武则天等人物会落回孔子，面板看起来「联动错了人」。
 * 这里按请求的视图模式优先扫对应视图，找到就切换到该分期。
 */
function findGraphViewForPerson(
  value: string,
  preferredMode: ViewMode,
): {
  mode: ViewMode;
  eraId: PersonGraphEraId;
  scopeId: PersonGraphScopeId;
  personId: string;
} | null {
  const eraHit = (era: (typeof PERSON_GRAPH_ERAS)[number]) => {
    const personId = resolvePersonInGraph(value, era.graph);
    if (!personId) return null;
    const scope =
      PERSON_GRAPH_SCOPES.find((item) => item.id === ERA_TO_SCOPE[era.id]) ?? DEFAULT_SCOPE;
    return { mode: "detail" as const, eraId: era.id, scopeId: scope.id, personId };
  };
  const scopeHit = (scope: (typeof PERSON_GRAPH_SCOPES)[number]) => {
    const personId = resolvePersonInGraph(value, scope.graph);
    if (!personId) return null;
    const era =
      PERSON_GRAPH_ERAS.find((item) => item.id === SCOPE_TO_ERA[scope.id]) ?? DEFAULT_ERA;
    return { mode: "brief" as const, eraId: era.id, scopeId: scope.id, personId };
  };

  const candidates =
    preferredMode === "brief"
      ? [...PERSON_GRAPH_SCOPES.map(scopeHit), ...PERSON_GRAPH_ERAS.map(eraHit)]
      : [...PERSON_GRAPH_ERAS.map(eraHit), ...PERSON_GRAPH_SCOPES.map(scopeHit)];
  return candidates.find((item) => item !== null) ?? null;
}

/**
 * 解析图谱深链接。
 *
 * `era` 同时接受细览分期 id 与简阅断代 id：
 * - 命中细览 id → 默认细览；命中简阅 id → 默认简阅；
 * - `mode` 显式给出时以 mode 为准，并自动换算到对应的另一视图；
 * - `person` 无法解析时回落到该视图默认中心，不产生空白画布；
 * - **未显式给 era / group 时**：person 不在默认期里就跨期查找（否则史引面板会显示错的人）。
 */
export function resolveGraphDeepLink(search: string): ResolvedGraphDeepLink {
  const params = new URLSearchParams(search);
  const requestedMode = readMode(params.get("mode"));
  const eraParam = params.get("era");
  const groupParam = params.get("group");

  const matchedEra = PERSON_GRAPH_ERAS.find((item) => item.id === eraParam);
  const matchedScope = PERSON_GRAPH_SCOPES.find((item) => item.id === eraParam);

  let mode: ViewMode = requestedMode ?? (matchedScope ? "brief" : "detail");

  let era = matchedEra;
  let scope = matchedScope;
  if (!era && scope) {
    const scopeId = scope.id;
    era = PERSON_GRAPH_ERAS.find((item) => item.id === SCOPE_TO_ERA[scopeId]) ?? DEFAULT_ERA;
  }
  if (!scope && era) {
    const eraId = era.id;
    scope = PERSON_GRAPH_SCOPES.find((item) => item.id === ERA_TO_SCOPE[eraId]) ?? DEFAULT_SCOPE;
  }
  if (!era) era = DEFAULT_ERA;
  if (!scope) scope = DEFAULT_SCOPE;

  const graph = mode === "brief" ? scope.graph : era.graph;
  const personParam = params.get("person");
  let centerPersonId = personParam ? resolvePersonInGraph(personParam, graph) : null;

  // 没有显式分期上下文时跨期查找人物，保证「只带 person_id」的深链接也能打开正确的人。
  if (personParam && !centerPersonId && !eraParam && !groupParam) {
    const found = findGraphViewForPerson(personParam, mode);
    if (found) {
      centerPersonId = found.personId;
      mode = found.mode;
      era =
        PERSON_GRAPH_ERAS.find((item) => item.id === found.eraId) ?? DEFAULT_ERA;
      scope =
        PERSON_GRAPH_SCOPES.find((item) => item.id === found.scopeId) ?? DEFAULT_SCOPE;
    }
  }

  const finalGraph = mode === "brief" ? scope.graph : era.graph;
  const fallbackCenter = mode === "brief" ? scope.defaultCenterPersonId : era.defaultCenterPersonId;
  const resolvedCenter = centerPersonId ?? fallbackCenter;

  // V1.0.1 / TC-08：`?selected=` 直接驱动 PersonGraph2D 的受控选中，
  // 刷新或分享链接时关系面板可复现。非法 / 中心自己一律视为非受控（不打开面板）。
  const selectedParam = params.get("selected");
  const resolvedSelected = selectedParam ? resolvePersonInGraph(selectedParam, finalGraph) : null;
  const selectedPersonId =
    resolvedSelected && resolvedSelected !== resolvedCenter ? resolvedSelected : undefined;

  return { mode, eraId: era.id, scopeId: scope.id, centerPersonId: resolvedCenter, selectedPersonId };
}
