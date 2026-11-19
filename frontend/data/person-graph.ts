import { PERSON_RELATION_INDEX } from "./person-relations";
import type { PersonRelation } from "./person-relations";
import { TIMELINE_EVENTS } from "./timeline-events";
import type { Dynasty, TimelineEvent } from "./timeline-events";

/** 人物关系图覆盖的朝代；V0.5.1 起增加春秋、战国，V0.6.1 起增加三国。 */
export type GraphDynasty = Extract<Dynasty, "春秋" | "战国" | "秦" | "西汉" | "东汉" | "三国">;

export interface GraphEventReference {
  id: string;
  title: string;
  dynasty: Dynasty;
  year: number;
  /** 事件正文摘要（= 时间轴 `description`）；关系面板缺少人工简述时回退使用。 */
  summary: string;
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
  /** 人工校订的两人关系（定性 + 逐事件简述）；未收录时为 undefined。 */
  relation?: PersonRelation;
}

export interface PersonGraphData {
  nodes: readonly PersonGraphNode[];
  edges: readonly PersonGraphEdge[];
}

/** 人物图分期。每个分期是一份独立数据集，中心人物默认值各自不同。 */
export type PersonGraphEraId = "chunqiu" | "zhanguo" | "qinhan" | "sanguo";

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
  summary: event.description,
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

      const relation = PERSON_RELATION_INDEX.get(id);
      return {
        id,
        source,
        target,
        weight: sharedEvents.length,
        sharedEvents: sharedEvents.sort(compareEvents),
        ...(relation ? { relation } : {}),
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

/**
 * 三国人物图取事件白名单：三国 11 条 + 汉末关键节点 7 条
 * （189 董卓之乱、190 关东联军、192 董卓被诛、196 迎帝都许、200 官渡、208 赤壁、219 襄樊）。
 *
 * 汉末事件让曹操、刘备、孙权、袁绍、董卓、吕布、周瑜等核心人物带上真实关系边；
 * 其余东汉事件不纳入，避免把张衡、班超等与三国无关的人物拉进本期图谱。
 */
const SAN_GUO_EVENT_IDS: readonly string[] = [
  "handong-dongzhuo",
  "handong-liandong",
  "handong-dongzhuo-death",
  "handong-caocao-emperor",
  "handong-guandu",
  "handong-chibi",
  "handong-fanchang",
  "handong-han-fall",
  "sanguo-01",
  "sanguo-02",
  "sanguo-03",
  "sanguo-04",
  "sanguo-05",
  "sanguo-06",
  "sanguo-07",
  "sanguo-08",
  "sanguo-09",
  "sanguo-10",
  // 第 5 批（V0.6.2 汉末群雄前置事件）：为孙吴、曹魏、蜀汉与群雄补足渊源事件。
  "hanmo-01",
  "hanmo-02",
  "hanmo-03",
  "hanmo-04",
  "hanmo-05",
  "hanmo-06",
  "hanmo-07",
  "hanmo-08",
  "hanmo-09",
  "hanmo-10",
  "hanmo-11",
  "hanmo-12",
  "hanmo-13",
  "hanmo-14",
  "hanmo-15",
  "hanmo-16",
  "hanmo-17",
  "hanmo-18",
  "hanmo-19",
];

const SAN_GUO_EVENT_ID_SET = new Set(SAN_GUO_EVENT_IDS);

/** 各分期各自只构建一次；切换 Tab 时直接复用。 */
const ERA_GRAPHS = {
  chunqiu: buildPersonGraph(TIMELINE_EVENTS, ["春秋"]),
  zhanguo: buildPersonGraph(TIMELINE_EVENTS, ["战国"]),
  qinhan: buildPersonGraph(TIMELINE_EVENTS, QIN_HAN_DYNASTIES),
  // 三国期读的是「三国 + 汉末白名单」的事件子集，节点归期仍按事件 dynasty 推导。
  sanguo: buildPersonGraph(
    TIMELINE_EVENTS.filter((event) => SAN_GUO_EVENT_ID_SET.has(event.id)),
    ["东汉", "三国"],
  ),
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
  {
    id: "sanguo",
    label: "三国",
    dynasties: ["东汉", "三国"],
    defaultCenterPersonId: "曹操",
    graph: ERA_GRAPHS.sanguo,
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
  三国: [
    "曹操",
    "刘备",
    "孙权",
    "孙策",
    "孙坚",
    "诸葛亮",
    "关羽",
    "司马懿",
    "周瑜",
    "陆逊",
  ],
};

/** V0.6.1 阵营快捷入口（仅三国分期渲染）：点击等同选中该阵营君主为中心人物。 */
export interface FactionShortcut {
  id: "wei" | "shu" | "wu";
  label: string;
  centerPersonId: string;
}

export const SAN_GUO_FACTION_SHORTCUTS: readonly FactionShortcut[] = [
  { id: "wei", label: "魏 · 曹操", centerPersonId: "曹操" },
  { id: "shu", label: "蜀 · 刘备", centerPersonId: "刘备" },
  { id: "wu", label: "吴 · 孙权", centerPersonId: "孙权" },
];
