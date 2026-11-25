import { PERSON_RELATION_INDEX } from "./person-relations";
import type { PersonRelation } from "./person-relations";
import { TIMELINE_EVENTS } from "./timeline-events";
import type { Dynasty, TimelineEvent } from "./timeline-events";
import { WEIJIN_EVENTS } from "./weijin-events";
import {
  INGESTED_ERA_TO_SCOPE,
  INGESTED_GRAPH_ERAS,
  INGESTED_KEY_FIGURES,
  INGESTED_PERSON_ALIASES,
} from "./ingested-graph-data.generated";

/**
 * 人物关系图覆盖的朝代；V0.5.1 起增加春秋、战国，V0.6.1 起增加三国，
 * V0.6.3 补入夏、商、西周，V0.6.4 补入西晋、东晋十六国、南北朝，
 * V0.7.2 补入隋、唐、五代十国、北宋、南宋、辽、西夏、金，
 * V0.8.0 补入元、明、清（元明清图谱共 3 期 + 简阅 1 组）。
 * V0.8.2 起各期事件池按「同期并立政权互见」补厚（金期含南宋、元期含金末与南宋末等）。
 * V0.8.2.1 修复秦汉 / 三国串期：秦汉图按 184 年截止、三国图收 188 年起汉末前史，
 * 曹操、刘备、孙权等三国人物不再进入秦汉图，切期中心人物与名人堂保持同池。
 */
export type GraphDynasty = Extract<
  Dynasty,
  | "夏"
  | "商"
  | "西周"
  | "春秋"
  | "战国"
  | "秦"
  | "西汉"
  | "东汉"
  | "三国"
  | "西晋"
  | "东晋十六国"
  | "南北朝"
  | "隋"
  | "唐"
  | "五代十国"
  | "北宋"
  | "南宋"
  | "辽"
  | "西夏"
  | "金"
  | "元"
  | "明"
  | "清"
>;

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

/** 既有（手写）细览分期的 id。 */
export type BasePersonGraphEraId =
  | "chunqiu"
  | "zhanguo"
  | "qinhan"
  | "sanguo"
  | "xijin"
  | "dongjin"
  | "nanbeichao"
  | "sui"
  | "tang"
  | "wudai"
  | "beisong"
  | "nansong"
  | "liao"
  | "xixia"
  | "jin"
  | "yuan"
  | "ming"
  | "qing";

/**
 * V1.0.5.4 图谱扩充生成的新分期 id（夏 / 商 / 西周）。
 *
 * 新增分期由 `backend/scripts/ingest_graph_data.py` 解析 docs 扩充表后写入
 * `ingested-graph-data.generated.ts` 的 `INGESTED_GRAPH_ERAS`；这里登记 id 联合类型，
 * 页面 Tab / 深链接 / 关系图构建全部自动跟随，不需要逐处硬编码。
 */
export type IngestedPersonGraphEraId = "xia" | "shang" | "xizhou";

/** 人物图分期。每个分期是一份独立数据集，中心人物默认值各自不同。 */
export type PersonGraphEraId = BasePersonGraphEraId | IngestedPersonGraphEraId;

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
 * 秦汉 / 三国图谱的时间分界（V0.8.2.1 修复数据串期）。
 *
 * 东汉王朝跨 25—220，但「汉末群雄」事件（188 年改刺史为州牧起，含讨董、官渡、
 * 赤壁、襄樊等）的人物完全属于三国图谱的叙事。若按 `dynasty === "东汉"` 直接取事件，
 * 曹操、刘备、孙权、吕布等会串进「秦汉」图，出现「秦汉名人堂 + 三国中心人物」的错位。
 *
 * 因此改为按年份切分，并保持「一个事件只归一个朝代」的时间轴口径不变：
 * - 秦汉图：秦 + 西汉 + 东汉至 184 年（黄巾起义；含党锢、张衡、蔡伦、熹平石经等）；
 * - 三国图：全部三国事件 + 东汉 188 年及以后的汉末群雄事件（讨董—襄樊，作为三国前史）。
 */
const QIN_HAN_END_YEAR = 184;
const SANGUO_PRELUDE_START_YEAR = 188;

/** 秦汉图事件池：秦、西汉，以及东汉 184 年及以前（不含汉末群雄）。 */
const QIN_HAN_EVENTS: readonly TimelineEvent[] = TIMELINE_EVENTS.filter(
  (event) =>
    event.dynasty === "秦" ||
    event.dynasty === "西汉" ||
    (event.dynasty === "东汉" && event.year <= QIN_HAN_END_YEAR),
);

/**
 * 三国图事件池：三国事件 + 东汉 188 年及以后的汉末群雄事件。
 *
 * 汉末事件让曹操、刘备、孙权、袁绍、董卓、吕布、周瑜等核心人物带上真实关系边；
 * 184 年以前的东汉人物（张衡、班超、蔡伦等）不纳入，避免与三国图谱无关的人物串入。
 */
const SANGUO_EVENTS: readonly TimelineEvent[] = TIMELINE_EVENTS.filter(
  (event) =>
    event.dynasty === "三国" ||
    (event.dynasty === "东汉" && event.year >= SANGUO_PRELUDE_START_YEAR),
);

/** 先秦简阅断代：夏、商、西周、春秋、战国（V0.6.3 补齐夏商西周参与者后可用）。 */
const PRE_QIN_DYNASTIES: readonly GraphDynasty[] = ["夏", "商", "西周", "春秋", "战国"];

/**
 * 魏晋南北朝三期的图谱事件池（V0.6.4）。
 *
 * 来源两类：
 * 1. 时间轴既有的西晋 / 东晋十六国 / 南北朝 29 条事件（V0.6 已入库，本期首次接入图谱）；
 * 2. `weijin-events.ts` 的补足事件 —— 解析 `docs/史脉_第一批_魏晋南北朝.md` 得到，
 *    表中与时间轴同题的事件直接复用既有 id（如淝水之战 = `dongjin-07`），不重复造事件。
 *
 * 各期用白名单取事件，而不是「只读某朝 dynasty」：曹魏事件并入西晋期作为开国前史，
 * 「讨灭桓玄」同属东晋与南北朝两期（刘裕代晋的渊源），与三国期复用汉末事件同一口径。
 */
const GRAPH_EVENT_POOL: readonly TimelineEvent[] = [...TIMELINE_EVENTS, ...WEIJIN_EVENTS];
const GRAPH_EVENT_INDEX: ReadonlyMap<string, TimelineEvent> = new Map(
  GRAPH_EVENT_POOL.map((event) => [event.id, event]),
);

/** 按 id 取事件；漏配直接抛错，避免静默缺事件导致图谱无声变薄。 */
const pickEvents = (ids: readonly string[]): readonly TimelineEvent[] =>
  ids.map((id) => {
    const event = GRAPH_EVENT_INDEX.get(id);
    if (!event) throw new Error(`人物图事件 id 未找到：${id}`);
    return event;
  });

/** 西晋期：曹魏末年（司马氏专权）＋西晋，曹魏事件作为代魏建晋的前史。 */
const XIJIN_EVENT_IDS: readonly string[] = [
  // 曹魏末年
  "sanguo-08",
  "sanguo-09",
  "weijin-simashi-zhuanquan",
  "weijin-feicaofang",
  "weijin-shmaohuan",
  "weijin-fengjinwang",
  "weijin-zhulin",
  "weijin-dazui",
  // 西晋
  "xijin-01",
  "xijin-02",
  "xijin-03",
  "xijin-04",
  "xijin-05",
  "xijin-06",
  "xijin-07",
  "weijin-jingzhou",
  "weijin-taizifei",
  "weijin-yanglu",
  "weijin-doufu",
  "weijin-jingu",
  "weijin-erlu",
  "weijin-wenji",
];

/** 东晋十六国期：东晋 10 条 + 前秦、十六国与人物关系补足事件。 */
const DONGJIN_EVENT_IDS: readonly string[] = [
  "dongjin-01",
  "dongjin-02",
  "dongjin-03",
  "dongjin-04",
  "dongjin-05",
  "dongjin-06",
  "dongjin-07",
  "dongjin-08",
  "dongjin-09",
  "dongjin-10",
  "weijin-zhongliu",
  "weijin-beifu",
  "weijin-xiean-huanwen",
  "weijin-xiexuan-beifa",
  "weijin-feiyinhao",
  "weijin-menshi",
  "weijin-erwang",
  "weijin-wudoumi",
  "weijin-zhiguo",
  "weijin-canhebei",
];

/** 南北朝期：南北朝 12 条 + 东晋末「讨灭桓玄」前史 + 人物关系补足事件。 */
const NANBEICHAO_EVENT_IDS: readonly string[] = [
  "dongjin-09",
  "nanbeichao-01",
  "nanbeichao-02",
  "nanbeichao-03",
  "nanbeichao-04",
  "nanbeichao-05",
  "nanbeichao-06",
  "nanbeichao-07",
  "nanbeichao-08",
  "nanbeichao-09",
  "nanbeichao-10",
  "nanbeichao-11",
  "nanbeichao-12",
  "weijin-yuanjia",
  "weijin-guiyin",
  "weijin-baipao",
  "weijin-luoyang",
  "weijin-houjing-pan",
  "weijin-linchao",
  "weijin-bohaiwang",
  "weijin-liutiao",
  "weijin-shayuan",
  "weijin-beizhou-guanzhi",
  "weijin-beizhou-waiqi",
  // V0.8.2：补齐 docs/03 的南朝易代三事（萧齐、萧梁、陈陈），使三家开国人物成边。
  "nanbeichao-13",
  "nanbeichao-14",
  "nanbeichao-15",
];

/** 简阅「魏晋南北朝」：三期白名单去重合并。 */
const WEIJIN_EVENT_IDS: readonly string[] = [
  ...new Set([...XIJIN_EVENT_IDS, ...DONGJIN_EVENT_IDS, ...NANBEICHAO_EVENT_IDS]),
];

/** 按朝代取事件（V0.7.2 隋唐—宋辽夏金各期的基础事件来源）。 */
const eventsOfDynasties = (dynasties: readonly GraphDynasty[]): readonly TimelineEvent[] => {
  const permitted = new Set<GraphDynasty>(dynasties);
  return TIMELINE_EVENTS.filter((event) => permitted.has(event.dynasty as GraphDynasty));
};

/**
 * 隋唐—宋辽夏金各期的图谱事件池（V0.7.2）。
 *
 * 多数分期直接取该朝事件；稀疏期补入跨期前史事件，避免图谱过空：
 * - 南宋期补「采石之战」（金），呈现宋金对峙的两方人物；
 * - 辽期补「割燕云十六州」（五代）与「澶渊之盟」（北宋），串起辽与中原的往来；
 * - 西夏期补「庆历新政」「西北御夏」（北宋），呈现宋夏战争双方；
 * - 金期补「海上之盟」（北宋），串起金与北宋末年的交涉。
 */
const SUITANG_GRAPH = buildPersonGraph(eventsOfDynasties(["隋", "唐"]), ["隋", "唐"]);
const SONG_LIAO_JIN_XIA_DYNASTIES: readonly GraphDynasty[] = [
  "五代十国",
  "北宋",
  "南宋",
  "辽",
  "西夏",
  "金",
];
const SONG_LIAO_JIN_XIA_GRAPH = buildPersonGraph(
  eventsOfDynasties(SONG_LIAO_JIN_XIA_DYNASTIES),
  SONG_LIAO_JIN_XIA_DYNASTIES,
);

/**
 * 元明清各期的图谱事件池（V0.8.0）。
 *
 * 关系数据来自 `docs/史脉_第四批_元明清.md`（68 行、50 个唯一人物对），
 * 全部映射到时间轴既有的 52 条元明清事件（元 10 / 明 20 / 清 22），无需新增事件。
 *
 * 清期补两条明末前史事件，避免「努尔哈赤 × 袁崇焕」「多尔衮 × 吴三桂」两条关系缺边：
 * - `ming-15` 宁远之战（袁崇焕 × 努尔哈赤）；
 * - `ming-18` 山海关之战（李自成 × 吴三桂 × 多尔衮）。
 * 与南宋补「采石之战」、辽补「澶渊之盟」同一口径。
 */
const YUAN_MING_QING_DYNASTIES: readonly GraphDynasty[] = ["元", "明", "清"];
// V0.8.2：元期补入金末三峰山与元灭南宋 4 条事件，串起蒙古—金—宋三方人物。
const YUAN_GRAPH = buildPersonGraph(
  [
    ...eventsOfDynasties(["元"]),
    ...pickEvents(["jin-15", "nansong-21", "nansong-23", "nansong-25", "nansong-08"]),
  ],
  ["元", "金", "南宋"],
);
const MING_GRAPH = buildPersonGraph(eventsOfDynasties(["明"]), ["明"]);
// V0.8.2：清期除宁远、山海关外，再补萨尔浒、己巳之变两条明末清兴前史。
const QING_GRAPH = buildPersonGraph(
  [
    ...eventsOfDynasties(["清"]),
    ...pickEvents(["ming-15", "ming-18", "ming-38", "ming-40"]),
  ],
  ["明", "清"],
);
const YUAN_MING_QING_GRAPH = buildPersonGraph(
  eventsOfDynasties(YUAN_MING_QING_DYNASTIES),
  YUAN_MING_QING_DYNASTIES,
);

/** 各分期各自只构建一次；切换 Tab 时直接复用。 */
const ERA_GRAPHS = {
  chunqiu: buildPersonGraph(TIMELINE_EVENTS, ["春秋"]),
  zhanguo: buildPersonGraph(TIMELINE_EVENTS, ["战国"]),
  qinhan: buildPersonGraph(QIN_HAN_EVENTS, QIN_HAN_DYNASTIES),
  // 三国期读「三国 + 汉末群雄（188 起）」事件子集，节点归期仍按事件 dynasty 推导。
  sanguo: buildPersonGraph(SANGUO_EVENTS, ["东汉", "三国"]),
  // 魏晋三期读两类事件池 + 各期白名单；节点归期仍按事件 dynasty 推导。
  xijin: buildPersonGraph(pickEvents(XIJIN_EVENT_IDS), ["三国", "西晋"]),
  dongjin: buildPersonGraph(pickEvents(DONGJIN_EVENT_IDS), ["东晋十六国"]),
  nanbeichao: buildPersonGraph(pickEvents(NANBEICHAO_EVENT_IDS), ["东晋十六国", "南北朝"]),
  // 隋唐—宋辽夏金（V0.7.2）：按朝取事件；V0.8.2 起北族三朝与两宋交叉补入，呈现并立格局。
  sui: buildPersonGraph(eventsOfDynasties(["隋"]), ["隋"]),
  tang: buildPersonGraph(eventsOfDynasties(["唐"]), ["唐"]),
  wudai: buildPersonGraph(eventsOfDynasties(["五代十国"]), ["五代十国"]),
  beisong: buildPersonGraph(eventsOfDynasties(["北宋"]), ["北宋"]),
  nansong: buildPersonGraph(
    [
      ...eventsOfDynasties(["南宋"]),
      ...pickEvents(["jin-03", "jin-18", "jin-19", "beisong-34"]),
    ],
    ["南宋", "金", "北宋"],
  ),
  liao: buildPersonGraph(
    [
      ...eventsOfDynasties(["辽"]),
      ...pickEvents([
        "wudai-08",
        "beisong-06",
        "beisong-16",
        "beisong-17",
        "beisong-19",
        "jin-01",
      ]),
    ],
    ["辽", "五代十国", "北宋", "金"],
  ),
  xixia: buildPersonGraph(
    [
      ...eventsOfDynasties(["西夏"]),
      ...pickEvents(["beisong-07", "beisong-08", "beisong-25", "beisong-26"]),
    ],
    ["西夏", "北宋"],
  ),
  // 金期读全部金与南宋事件，另补北宋末海上之盟、金军南下、开封保卫战、靖康之变，
  // 使宋金对峙的双方人物（完颜宗弼、岳飞、韩世忠、秦桧等）同图成边。
  jin: buildPersonGraph(
    [
      ...eventsOfDynasties(["金"]),
      ...eventsOfDynasties(["南宋"]),
      ...pickEvents(["beisong-15", "beisong-32", "beisong-33", "beisong-34"]),
    ],
    ["金", "南宋", "北宋"],
  ),
  // 元明清（V0.8.0）：元 / 明按朝取事件；清期补宁远、山海关两条明末前史。
  yuan: YUAN_GRAPH,
  ming: MING_GRAPH,
  qing: QING_GRAPH,
} satisfies Record<BasePersonGraphEraId, PersonGraphData>;

/**
 * V1.0.5.4 图谱扩充生成的新分期（夏 / 商 / 西周 …）。
 *
 * 生成物只声明 `{id, label, dynasties, eventIds, defaultCenterPersonId}`，这里用与既有分期
 * 完全相同的 `buildPersonGraph(pickEvents(...), dynasties)` 构建，保证节点 / 边 / 关系口径一致。
 * 排在新分期之前（史序更早），页面 Tab 顺序即为此数组顺序。
 */
const INGESTED_ERAS: readonly PersonGraphEra[] = INGESTED_GRAPH_ERAS.map((spec) => ({
  id: spec.id as IngestedPersonGraphEraId,
  label: spec.label,
  dynasties: spec.dynasties as readonly GraphDynasty[],
  defaultCenterPersonId: spec.defaultCenterPersonId,
  graph: buildPersonGraph(
    pickEvents(spec.eventIds),
    spec.dynasties as readonly GraphDynasty[],
  ),
}));

/** 先秦简阅图：跨夏商西周与春秋战国的聚合数据集，仅简阅模式使用。 */
const PRE_QIN_GRAPH = buildPersonGraph(TIMELINE_EVENTS, PRE_QIN_DYNASTIES);

/** 魏晋南北朝简阅图：三期合并，对应时间轴「魏晋南北朝」断代。 */
const WEIJIN_GRAPH = buildPersonGraph(pickEvents(WEIJIN_EVENT_IDS), [
  "三国",
  "西晋",
  "东晋十六国",
  "南北朝",
]);

/** 既有（手写）分期清单：选择器按此顺序展示，并各自提供默认中心人物。 */
const BASE_PERSON_GRAPH_ERAS: readonly PersonGraphEra[] = [
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
    // 秦汉图只收东汉 184 年及以前的事件；汉末群雄（188 起）归三国图，避免曹操等串期。
    id: "qinhan",
    label: "秦汉",
    dynasties: QIN_HAN_DYNASTIES,
    defaultCenterPersonId: "刘邦",
    graph: ERA_GRAPHS.qinhan,
  },
  {
    // 三国图 = 三国事件 + 东汉 188 年后的汉末群雄事件（三国前史）；184 年前的东汉人物不入本期。
    id: "sanguo",
    label: "三国",
    dynasties: ["东汉", "三国"],
    defaultCenterPersonId: "曹操",
    graph: ERA_GRAPHS.sanguo,
  },
  {
    id: "xijin",
    label: "西晋",
    dynasties: ["三国", "西晋"],
    defaultCenterPersonId: "司马炎",
    graph: ERA_GRAPHS.xijin,
  },
  {
    id: "dongjin",
    label: "东晋十六国",
    dynasties: ["东晋十六国"],
    defaultCenterPersonId: "谢安",
    graph: ERA_GRAPHS.dongjin,
  },
  {
    id: "nanbeichao",
    label: "南北朝",
    dynasties: ["东晋十六国", "南北朝"],
    defaultCenterPersonId: "孝文帝",
    graph: ERA_GRAPHS.nanbeichao,
  },
  // ===== V0.7.2：隋唐与五代辽宋夏金，共 8 期 =====
  {
    id: "sui",
    label: "隋",
    dynasties: ["隋"],
    defaultCenterPersonId: "杨坚",
    graph: ERA_GRAPHS.sui,
  },
  {
    id: "tang",
    label: "唐",
    dynasties: ["唐"],
    defaultCenterPersonId: "李世民",
    graph: ERA_GRAPHS.tang,
  },
  {
    id: "wudai",
    label: "五代十国",
    dynasties: ["五代十国"],
    defaultCenterPersonId: "赵匡胤",
    graph: ERA_GRAPHS.wudai,
  },
  {
    id: "beisong",
    label: "北宋",
    dynasties: ["北宋"],
    defaultCenterPersonId: "赵匡胤",
    graph: ERA_GRAPHS.beisong,
  },
  {
    id: "nansong",
    label: "南宋",
    dynasties: ["南宋", "金", "北宋"],
    defaultCenterPersonId: "岳飞",
    graph: ERA_GRAPHS.nansong,
  },
  {
    id: "liao",
    label: "辽",
    dynasties: ["辽", "五代十国", "北宋", "金"],
    defaultCenterPersonId: "耶律阿保机",
    graph: ERA_GRAPHS.liao,
  },
  {
    id: "xixia",
    label: "西夏",
    dynasties: ["西夏", "北宋"],
    defaultCenterPersonId: "李元昊",
    graph: ERA_GRAPHS.xixia,
  },
  {
    id: "jin",
    label: "金",
    dynasties: ["金", "南宋", "北宋"],
    defaultCenterPersonId: "完颜阿骨打",
    graph: ERA_GRAPHS.jin,
  },
  // ===== V0.8.0：元明清，共 3 期 =====
  {
    id: "yuan",
    label: "元",
    dynasties: ["元", "金", "南宋"],
    defaultCenterPersonId: "忽必烈",
    graph: ERA_GRAPHS.yuan,
  },
  {
    id: "ming",
    label: "明",
    dynasties: ["明"],
    defaultCenterPersonId: "朱元璋",
    graph: ERA_GRAPHS.ming,
  },
  {
    id: "qing",
    label: "清",
    dynasties: ["明", "清"],
    defaultCenterPersonId: "康熙帝",
    graph: ERA_GRAPHS.qing,
  },
];

/**
 * 人物图分期清单：选择器按此顺序展示，并各自提供默认中心人物。
 *
 * V1.0.5.4 起把「图谱扩充」生成的新分期（夏 / 商 / 西周）排在最前，再接既有分期；
 * 页面 Tab、深链接默认值、`person-types.PersonGraphEraId` 全部由这一个数组驱动。
 */
export const PERSON_GRAPH_ERAS: readonly PersonGraphEra[] = [
  ...INGESTED_ERAS,
  ...BASE_PERSON_GRAPH_ERAS,
];

/** V0.4.1 兼容导出：秦汉人物图，默认中心人物为刘邦。 */
export const QIN_HAN_PERSON_GRAPH = ERA_GRAPHS.qinhan;
export const DEFAULT_GRAPH_CENTER_PERSON = "刘邦";

/**
 * 简阅模式的图谱断代（大断代聚合）。
 *
 * 与 `DYNASTY_GROUPS` 对齐：V0.6.4 起四组（先秦 / 秦汉 / 三国 / 魏晋南北朝），
 * V0.7.2 起六组（新增 隋唐 / 宋辽金夏），V0.8.0 起七组（新增 元明清）。
 */
export type PersonGraphScopeId =
  | "xianqin"
  | "qinhan"
  | "sanguo"
  | "weijin"
  | "suitang"
  | "songliaojinxia"
  | "yuanmingqing";

export interface PersonGraphScope {
  id: PersonGraphScopeId;
  /** 简阅 Tab 上展示的名称。 */
  label: string;
  graph: PersonGraphData;
  defaultCenterPersonId: string;
}

export const PERSON_GRAPH_SCOPES: readonly PersonGraphScope[] = [
  { id: "xianqin", label: "先秦", graph: PRE_QIN_GRAPH, defaultCenterPersonId: "周公旦" },
  { id: "qinhan", label: "秦汉", graph: ERA_GRAPHS.qinhan, defaultCenterPersonId: "刘邦" },
  { id: "sanguo", label: "三国", graph: ERA_GRAPHS.sanguo, defaultCenterPersonId: "曹操" },
  { id: "weijin", label: "魏晋南北朝", graph: WEIJIN_GRAPH, defaultCenterPersonId: "刘裕" },
  { id: "suitang", label: "隋唐", graph: SUITANG_GRAPH, defaultCenterPersonId: "李世民" },
  {
    id: "songliaojinxia",
    label: "宋辽金夏",
    graph: SONG_LIAO_JIN_XIA_GRAPH,
    defaultCenterPersonId: "赵匡胤",
  },
  { id: "yuanmingqing", label: "元明清", graph: YUAN_MING_QING_GRAPH, defaultCenterPersonId: "朱元璋" },
];

/** 既有（手写）细览分期 → 简阅断代：模式切换时用于定位到同一大断代。 */
const BASE_ERA_TO_SCOPE: Readonly<Record<BasePersonGraphEraId, PersonGraphScopeId>> = {
  chunqiu: "xianqin",
  zhanguo: "xianqin",
  qinhan: "qinhan",
  sanguo: "sanguo",
  xijin: "weijin",
  dongjin: "weijin",
  nanbeichao: "weijin",
  sui: "suitang",
  tang: "suitang",
  // 五代十国作为「宋辽金夏」的前史，与三国期含汉末、南北朝期含东晋末同一口径。
  wudai: "songliaojinxia",
  beisong: "songliaojinxia",
  nansong: "songliaojinxia",
  liao: "songliaojinxia",
  xixia: "songliaojinxia",
  jin: "songliaojinxia",
  yuan: "yuanmingqing",
  ming: "yuanmingqing",
  qing: "yuanmingqing",
};

/**
 * 细览分期 → 简阅断代（V1.0.5.4 起合并入库生成的新分期映射）。
 *
 * 夏 / 商 / 西周同属「先秦」简阅断代；生成物只声明自己新增的映射，
 * 这里与手写基线合并成完整表，避免每批新分期都改手写文件。
 */
export const ERA_TO_SCOPE: Readonly<Record<PersonGraphEraId, PersonGraphScopeId>> = {
  // 显式声明新分期默认归属，保证即使生成物暂时为空，类型与运行时映射也完整。
  xia: "xianqin",
  shang: "xianqin",
  xizhou: "xianqin",
  ...BASE_ERA_TO_SCOPE,
  ...(INGESTED_ERA_TO_SCOPE as Readonly<Partial<Record<PersonGraphEraId, PersonGraphScopeId>>>),
};

/** 简阅断代 → 细览落地分期：切回细览且无历史记录时使用（先秦默认落在最早的夏）。 */
export const SCOPE_TO_ERA: Readonly<Record<PersonGraphScopeId, PersonGraphEraId>> = {
  xianqin: "xia",
  qinhan: "qinhan",
  sanguo: "sanguo",
  weijin: "xijin",
  suitang: "tang",
  songliaojinxia: "beisong",
  yuanmingqing: "ming",
};

/**
 * V0.5.2 左侧「名人堂」快捷导航配置（手写基线）。
 *
 * 按分期标签给出该期代表性人物。页面渲染前会再用当期图数据过滤一次：
 * 名字写错或人物不在该期时只会被跳过，不会导致页面报错。
 * 每期人数可自由增删（建议 6—8 位）。
 * V1.0.5.4 起，图谱扩充生成的新分期（夏 / 商 / 西周）名人堂由生成物自动提供（按事件度数排序）。
 */
const BASE_KEY_FIGURES: Readonly<Record<string, readonly string[]>> = {
  先秦: ["周公旦", "商汤", "周文王", "周武王", "姜子牙", "孔子", "齐桓公", "孙武"],
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
  西晋: ["司马炎", "司马懿", "司马昭", "羊祜", "杜预", "贾南风", "石崇", "陆机"],
  东晋十六国: ["王导", "谢安", "谢玄", "苻坚", "王猛", "桓温", "王羲之", "刘裕"],
  南北朝: ["刘裕", "拓跋焘", "孝文帝", "冯太后", "高欢", "宇文泰", "宇文邕", "杨坚"],
  魏晋南北朝: ["司马炎", "谢安", "苻坚", "王猛", "拓跋珪", "刘裕", "孝文帝", "杨坚"],
  隋: ["杨坚", "杨广", "独孤伽罗", "高颎", "杨素", "李密", "宇文化及", "李世民"],
  唐: [
    "李世民",
    "李渊",
    "魏徵",
    "房玄龄",
    "杜如晦",
    "李靖",
    "武则天",
    "李隆基",
    "安禄山",
    "郭子仪",
  ],
  五代十国: ["朱温", "李存勖", "石敬瑭", "郭威", "柴荣", "赵匡胤", "李煜", "钱镠"],
  北宋: ["赵匡胤", "赵普", "赵光义", "寇准", "范仲淹", "王安石", "司马光", "苏轼"],
  南宋: ["岳飞", "秦桧", "赵构", "韩世忠", "宗泽", "辛弃疾", "文天祥", "陆秀夫"],
  辽: ["耶律阿保机", "耶律德光", "述律平", "萧太后", "辽圣宗", "石敬瑭", "寇准", "赵恒"],
  西夏: ["李元昊", "赵祯", "范仲淹", "韩琦", "狄青", "欧阳修"],
  金: ["完颜阿骨打", "完颜亮", "完颜亶", "虞允文", "辽天祚帝", "完颜娄室"],
  隋唐: ["杨坚", "杨广", "李世民", "李隆基", "武则天", "安禄山", "郭子仪", "李靖"],
  宋辽金夏: [
    "赵匡胤",
    "柴荣",
    "岳飞",
    "秦桧",
    "完颜阿骨打",
    "耶律阿保机",
    "李元昊",
    "范仲淹",
  ],
  元: [
    "成吉思汗",
    "忽必烈",
    "窝阔台",
    "耶律楚材",
    "伯颜",
    "八思巴",
    "文天祥",
    "脱脱",
    "元顺帝",
    "贾鲁",
  ],
  明: [
    "朱元璋",
    "朱棣",
    "刘基",
    "郑和",
    "王阳明",
    "张居正",
    "戚继光",
    "海瑞",
    "袁崇焕",
    "崇祯帝",
  ],
  清: [
    "努尔哈赤",
    "皇太极",
    "多尔衮",
    "康熙帝",
    "雍正帝",
    "乾隆帝",
    "曾国藩",
    "李鸿章",
    "左宗棠",
    "慈禧太后",
  ],
  元明清: ["成吉思汗", "忽必烈", "朱元璋", "朱棣", "康熙帝", "乾隆帝", "曾国藩", "李鸿章"],
};

/** 名人堂：手写基线 + 图谱扩充生成的新分期（生成物只包含新增分期，不覆盖既有配置）。 */
export const KEY_FIGURES: Readonly<Record<string, readonly string[]>> = {
  ...BASE_KEY_FIGURES,
  ...INGESTED_KEY_FIGURES,
};

/**
 * 人物别名 → 图谱节点名（V0.6.4 起）。
 *
 * 节点名以史书通称为准（如「孝文帝」而非「拓跋宏」），搜索时允许用本名 / 庙号 / 谥号命中：
 * 页面把别名展开成节点名后走同一套模糊搜索，不新增独立节点。
 * V0.7.2 补充隋唐宋辽金夏各期常见庙号（如「唐太宗」→ 李世民）；
 * V0.8.0 补充元明清本名与庙号（如「铁木真」→ 成吉思汗、「明太祖」→ 朱元璋、「清圣祖」→ 康熙帝）；
 * V1.0.5.4 起合并图谱扩充生成物：「桀」→ 夏桀、「大禹」→ 禹、「召公」→ 召穆公 等由
 * `backend/scripts/ingest_graph_data.py` 从 docs 数据自动归一，`--check` 门禁防止手改漂移。
 */
const BASE_PERSON_NAME_ALIASES: Readonly<Record<string, string>> = {
  拓跋宏: "孝文帝",
  元宏: "孝文帝",
  魏孝文帝: "孝文帝",
  晋武帝: "司马炎",
  梁武帝: "萧衍",
  宋武帝: "刘裕",
  魏道武帝: "拓跋珪",
  隋文帝: "杨坚",
  隋炀帝: "杨广",
  唐太宗: "李世民",
  唐高祖: "李渊",
  唐高宗: "李治",
  唐玄宗: "李隆基",
  武后: "武则天",
  则天皇后: "武则天",
  宋太祖: "赵匡胤",
  宋太宗: "赵光义",
  宋真宗: "赵恒",
  宋神宗: "赵顼",
  宋徽宗: "赵佶",
  宋高宗: "赵构",
  辽太祖: "耶律阿保机",
  金太祖: "完颜阿骨打",
  // V0.8.0：元（本名 / 庙号）
  元太祖: "成吉思汗",
  铁木真: "成吉思汗",
  元世祖: "忽必烈",
  // V0.8.0：明（本名 / 庙号）
  明太祖: "朱元璋",
  洪武: "朱元璋",
  明成祖: "朱棣",
  永乐帝: "朱棣",
  明世宗: "嘉靖帝",
  明武宗: "朱厚照",
  明神宗: "万历帝",
  明思宗: "崇祯帝",
  // V0.8.0：清（本名 / 庙号）
  清太祖: "努尔哈赤",
  清太宗: "皇太极",
  清世祖: "顺治帝",
  清圣祖: "康熙帝",
  玄烨: "康熙帝",
  清世宗: "雍正帝",
  清高宗: "乾隆帝",
  弘历: "乾隆帝",
  清宣宗: "道光帝",
  清文宗: "咸丰帝",
  清德宗: "光绪帝",
  // V0.8.2：宋、金、元、明、清补遗（庙号 / 本名 / 别名 → 图谱节点名）
  宋英宗: "赵曙",
  宋哲宗: "赵煦",
  宋钦宗: "赵桓",
  宋孝宗: "赵昚",
  宋宁宗: "赵扩",
  宋理宗: "赵昀",
  宋恭帝: "赵㬎",
  完颜兀术: "完颜宗弼",
  金世宗: "完颜雍",
  金章宗: "完颜璟",
  金宣宗: "完颜珣",
  完颜守绪: "金哀宗",
  卫绍王: "完颜永济",
  泰定帝: "也孙铁木儿",
  朱祁镇: "明英宗",
  朱允炆: "建文帝",
  溥仪: "宣统帝",
  唐武宗: "李炎",
  唐宣宗: "李忱",
  唐德宗: "李适",
  唐宪宗: "李纯",
};

/** 人物别名 → 图谱节点名：手写基线 + 图谱扩充自动归一（生成物优先合并、重复键以手写为准）。 */
export const PERSON_NAME_ALIASES: Readonly<Record<string, string>> = {
  ...INGESTED_PERSON_ALIASES,
  ...BASE_PERSON_NAME_ALIASES,
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
