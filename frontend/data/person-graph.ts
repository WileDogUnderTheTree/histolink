import { TIMELINE_EVENTS } from "./timeline-events";
import type { Dynasty, TimelineEvent } from "./timeline-events";

/** 人物关系图覆盖的朝代；V0.5.1 起增加春秋、战国。 */
export type GraphDynasty = Extract<Dynasty, "春秋" | "战国" | "秦" | "西汉" | "东汉">;

export interface GraphEventReference {
  id: string;
  title: string;
  dynasty: Dynasty;
  year: number;
}

/** 人物节点；`relatedPeople` 和 `relatedEvents` 均由参与者数据自动计算。 */
export interface PersonGraphNode {
  id: string;
  name: string;
  dynasty: Dynasty;
  relatedPeople: readonly string[];
  relatedEvents: readonly GraphEventReference[];
}

/** 无向关系边；权重等于两人共同参与的事件数。 */
export interface PersonGraphEdge {
  id: string;
  source: string;
  target: string;
  weight: number;
  sharedEvents: readonly GraphEventReference[];
}

export interface PersonGraphData {
  nodes: readonly PersonGraphNode[];
  edges: readonly PersonGraphEdge[];
}

/** 人物图分期。每个分期是一份独立数据集，中心人物默认值各自不同。 */
export type PersonGraphEraId = "chunqiu" | "zhanguo" | "qinhan";

export interface PersonGraphEra {
  id: PersonGraphEraId;
  /** 选择器上展示的分期名。 */
  label: string;
  /** 该期纳入的朝代（人物图只读取这些朝代的事件）。 */
  dynasties: readonly GraphDynasty[];
  /** 切换到该期时使用的中心人物；必须存在于该期数据中。 */
  defaultCenterPersonId: string;
  graph: PersonGraphData;
}

const QIN_HAN_DYNASTIES: readonly GraphDynasty[] = ["秦", "西汉", "东汉"];

const compareEvents = (left: GraphEventReference, right: GraphEventReference) =>
  left.year - right.year || left.id.localeCompare(right.id);

const asEventReference = (event: TimelineEvent): GraphEventReference => ({
  id: event.id,
  title: event.title,
  dynasty: event.dynasty,
  year: event.year,
});

/**
 * 将带 participants 的时间轴事件转换为人物节点和无向关系边。
 *
 * 同一个事件的全部参与者两两成边；边的 weight 为两人共同参与的事件数。
 * 某一（朝代）分期传入的 dynasties 决定数据集边界：跨朝代的同一人物只在该期出现。
 *
 * 预处理代价为 O(Σk²)，k 为单条事件的去重后参与者数；读取任意边的共同事件为 O(1)。
 */
export function buildPersonGraph(
  events: readonly TimelineEvent[],
  dynasties: readonly Dynasty[] = QIN_HAN_DYNASTIES,
): PersonGraphData {
  const permittedDynasties = new Set<Dynasty>(dynasties);
  const personEvents = new Map<string, GraphEventReference[]>();
  const pairEvents = new Map<string, GraphEventReference[]>();

  for (const event of events) {
    if (!permittedDynasties.has(event.dynasty)) continue;
    if (event.year === 0) {
      throw new Error(`事件 ${event.id} 使用了非法年份 0。`);
    }

    const participants = [...new Set(event.participants.map((name) => name.trim()).filter(Boolean))];
    const eventReference = asEventReference(event);

    for (const person of participants) {
      const relatedEvents = personEvents.get(person) ?? [];
      relatedEvents.push(eventReference);
      personEvents.set(person, relatedEvents);
    }

    for (let sourceIndex = 0; sourceIndex < participants.length; sourceIndex += 1) {
      for (let targetIndex = sourceIndex + 1; targetIndex < participants.length; targetIndex += 1) {
        const [source, target] = [participants[sourceIndex], participants[targetIndex]].sort();
        const pairId = `${source}__${target}`;
        const sharedEvents = pairEvents.get(pairId) ?? [];
        sharedEvents.push(eventReference);
        pairEvents.set(pairId, sharedEvents);
      }
    }
  }

  const relatedPeople = new Map<string, Set<string>>();
  const edges = [...pairEvents.entries()]
    .map(([id, sharedEvents]) => {
      const [source, target] = id.split("__");
      const sourceRelations = relatedPeople.get(source) ?? new Set<string>();
      const targetRelations = relatedPeople.get(target) ?? new Set<string>();
      sourceRelations.add(target);
      targetRelations.add(source);
      relatedPeople.set(source, sourceRelations);
      relatedPeople.set(target, targetRelations);

      return {
        id,
        source,
        target,
        weight: sharedEvents.length,
        sharedEvents: sharedEvents.sort(compareEvents),
      } satisfies PersonGraphEdge;
    })
    .sort((left, right) => right.weight - left.weight || left.id.localeCompare(right.id));

  const nodes = [...personEvents.entries()]
    .map(([name, relatedEvents]) => {
      const sortedEvents = relatedEvents.sort(compareEvents);
      return {
        id: name,
        name,
        // 以人物最后一次出现的事件所在朝代作为当前人物图的显示归属。
        dynasty: sortedEvents.at(-1)?.dynasty ?? "秦",
        relatedPeople: [...(relatedPeople.get(name) ?? [])].sort(),
        relatedEvents: sortedEvents,
      } satisfies PersonGraphNode;
    })
    .sort((left, right) => left.name.localeCompare(right.name, "zh-CN"));

  return { nodes, edges };
}

/** 三个分期各自只构建一次；切换 Tab 时直接复用。 */
const ERA_GRAPHS = {
  chunqiu: buildPersonGraph(TIMELINE_EVENTS, ["春秋"]),
  zhanguo: buildPersonGraph(TIMELINE_EVENTS, ["战国"]),
  qinhan: buildPersonGraph(TIMELINE_EVENTS, QIN_HAN_DYNASTIES),
} satisfies Record<PersonGraphEraId, PersonGraphData>;

/** 人物图分期清单：选择器按此顺序展示，并各自提供默认中心人物。 */
export const PERSON_GRAPH_ERAS: readonly PersonGraphEra[] = [
  {
    id: "chunqiu",
    label: "春秋",
    dynasties: ["春秋"],
    defaultCenterPersonId: "孔子",
    graph: ERA_GRAPHS.chunqiu,
  },
  {
    id: "zhanguo",
    label: "战国",
    dynasties: ["战国"],
    defaultCenterPersonId: "商鞅",
    graph: ERA_GRAPHS.zhanguo,
  },
  {
    id: "qinhan",
    label: "秦汉",
    dynasties: QIN_HAN_DYNASTIES,
    defaultCenterPersonId: "刘邦",
    graph: ERA_GRAPHS.qinhan,
  },
];

/** V0.4.1 兼容导出：秦汉人物图，默认中心人物为刘邦。 */
export const QIN_HAN_PERSON_GRAPH = ERA_GRAPHS.qinhan;
export const DEFAULT_GRAPH_CENTER_PERSON = "刘邦";

/**
 * V0.5.2 左侧「名人堂」快捷导航配置。
 *
 * 按分期标签给出该期代表性人物。页面渲染前会再用当期图数据过滤一次：
 * 名字写错或人物不在该期时只会被跳过，不会导致页面报错。
 * 每期人数可自由增删（建议 6—8 位）。
 */
export const KEY_FIGURES: Record<string, string[]> = {
  春秋: ["齐桓公", "晋文公", "孔子", "老子", "管仲"],
  战国: ["商鞅", "秦孝公", "孙膑", "苏秦", "白起"],
  秦汉: ["秦始皇", "刘邦", "项羽", "汉武帝", "张良"],
};
