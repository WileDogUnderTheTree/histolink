/**
 * 历史对话数据层（V1.0.5.2；V1.0.5.2-layout 补丁扩展）。
 *
 * v1.0.5.2 实现范围：
 * - 定义 `ConversationRepository` / `ConversationStorage` 接口与数据形状；
 * - 提供**内存实现 + 演示数据**（页面刷新后回到演示数据，不接真实持久化）；
 * - `/ask` 左侧历史对话侧边栏的「置顶 / 今天 / 过去 30 天」分组、点击加载、新建对话都基于本模块。
 *
 * v1.0.5.2-layout 补丁（布局与侧边栏修复）：
 * - `save()` 只在**新消息进入会话**时刷新 `updatedAt`（最后一条消息时间）；
 * - 新增 `syncTurns()`：只同步正文、不改变排序时间——加载 / 切换 / 离开会话时使用，
 *   修掉「点击历史记录即被当成最新活跃并弹到列表顶部」的体验 Bug；
 * - `rename()` / `remove()` / `pin()` 落地为**本地内存状态更新**（重命名锁定标题、
 *   删除后其余项顺序不变、置顶后由 `groupConversationsByTime` 放进最上方「置顶」组）。
 *
 * v1.0.6 预留（本版本只留接口与注释，**不实现业务逻辑**）：
 * - 历史对话持久化存储（localStorage / IndexedDB / 服务端会话库）；
 * - 跨会话上下文关联（把 earlier 会话摘要拼进新一轮 history）。
 * 预留位置带 `// TODO v1.0.6 多轮历史对话记忆模块 - 功能待实现`，
 * 后续版本可直接替换实现，不需要改动 `/ask` 页面与 `AgentContext` 的调用方式。
 */

import type { AgentAnswerView } from "@/lib/agent-client";

/** 持久化到仓库的单轮对话（与 AgentContext.AgentTurn 结构兼容）。 */
export interface StoredConversationTurn {
  id: string;
  role: "user" | "assistant";
  content: string;
  /** 欢迎语 / 错误提示不进入下一轮 history。 */
  skipHistory?: boolean;
  isError?: boolean;
  answer?: AgentAnswerView | null;
}

/** 侧边栏渲染用的会话摘要（不含完整 turns，避免列表过重）。 */
export interface ConversationSummary {
  id: string;
  title: string;
  /** 毫秒时间戳；列表按 `updatedAt` 倒序排列。 */
  createdAt: number;
  updatedAt: number;
  pinned: boolean;
}

/** 完整会话（加载历史对话时使用）。 */
export interface ConversationRecord extends ConversationSummary {
  turns: StoredConversationTurn[];
  /**
   * 标题是否已被用户手动锁定（重命名后为 true）。
   *
   * 未锁定时标题由首条用户消息自动生成；锁定后 `save` 不允许再用首问覆盖自定义标题。
   * 该字段只在数据层内部使用，`ConversationSummary` 不暴露，避免污染侧边栏渲染模型。
   */
  titleLocked?: boolean;
}

/** v1.0.6 预留：真实持久化存储接口（当前版本不使用）。 */
export interface ConversationStorage {
  readAll(): Promise<ConversationRecord[]>;
  writeAll(records: readonly ConversationRecord[]): Promise<void>;
}

/**
 * 历史对话仓库接口（v1.0.5.2 只实现内存版）。
 *
 * 页面/Context 只依赖本接口，v1.0.6 接入真实持久化时替换实现即可。
 */
export interface ConversationRepository {
  list(): Promise<ConversationSummary[]>;
  get(id: string): Promise<ConversationRecord | null>;
  create(init?: {
    title?: string;
    turns?: StoredConversationTurn[];
    now?: number;
  }): Promise<ConversationRecord>;
  /**
   * 保存正文并刷新 `updatedAt`（= 最后一条消息的发送时间）。
   *
   * 只允许在**会话里真的产生了新消息**时调用；加载 / 切换会话请用 `syncTurns`，
   * 否则会把「点击查看」误当成「最新活跃」，历史记录会被重新排序。
   */
  save(
    id: string,
    turns: readonly StoredConversationTurn[],
    title?: string,
  ): Promise<ConversationSummary | null>;
  /**
   * 同步正文但**不改变排序时间**（V1.0.5.2-layout 补丁）。
   *
   * 用于加载历史会话、切换会话前保存当前会话等「查看」场景：
   * 列表顺序只由创建时间 / 最后一条消息时间决定，查看行为绝不移动条目位置。
   */
  syncTurns(
    id: string,
    turns: readonly StoredConversationTurn[],
    title?: string,
  ): Promise<ConversationSummary | null>;
  /** 重命名历史对话：只改标题并锁定，不改变排序时间。 */
  rename(id: string, title: string): Promise<void>;
  /** 删除历史对话：其余条目的相对顺序保持不变。 */
  remove(id: string): Promise<void>;
  /** 置顶 / 取消置顶历史对话：置顶项由侧边栏放进最上方「置顶」组。 */
  pin(id: string, pinned: boolean): Promise<void>;
  /** v1.0.6 预留：跨会话上下文关联（把 earlier 会话摘要拼进新一轮 history）。 */
  buildCrossSessionContext(sessionId: string): Promise<string>;
  /** v1.0.6 预留：历史对话持久化写入。 */
  persist(record: ConversationRecord): Promise<void>;
  /** v1.0.6 预留：启动时读取已持久化的历史对话。 */
  loadPersisted(): Promise<ConversationRecord[]>;
}

/** 侧边栏分组（置顶优先，其次按创建 / 最后消息时间倒序分「今天 / 过去 30 天」）。 */
export interface ConversationGroup {
  key: "pinned" | "today" | "past30";
  label: string;
  items: ConversationSummary[];
}

const DAY_MS = 24 * 60 * 60 * 1000;
/** 历史对话标题的最大展示长度（侧边栏单行省略）。 */
export const MAX_CONVERSATION_TITLE_LENGTH = 28;

/** 取会话标题：优先已有标题，其次首条用户消息，最后兜底「新的历史对话」。 */
export function titleFromTurns(
  turns: readonly StoredConversationTurn[],
  fallback = "新的历史对话",
): string {
  const firstQuestion = turns.find((turn) => turn.role === "user" && turn.content.trim());
  if (!firstQuestion) return fallback;
  const compact = firstQuestion.content.replace(/\s+/g, " ").trim();
  return compact.length > MAX_CONVERSATION_TITLE_LENGTH
    ? `${compact.slice(0, MAX_CONVERSATION_TITLE_LENGTH)}…`
    : compact;
}

/**
 * 按「置顶 / 今天 / 过去 30 天」分组并倒序排列（V1.0.5.2-layout 补丁）。
 *
 * 排序口径（用户验收口径）：
 * 1. 用户主动「置顶」的会话进入最上方独立「置顶」组（没有置顶项时不渲染该组）；
 * 2. 其余会话严格按【最后一条消息发送时间】倒序，仅做「今天 / 过去 30 天」分组；
 * 3. 点击查看 / 切换会话不改变上述顺序（数据层用 `syncTurns` 不刷新 `updatedAt`）。
 *
 * 返回的 today / past30 两组始终存在（可能为空），由侧边栏过滤空组；
 * 「置顶」组只在存在置顶会话时出现，避免空标题占位。
 */
export function groupConversationsByTime(
  conversations: readonly ConversationSummary[],
  now: number = Date.now(),
): ConversationGroup[] {
  const startOfToday = new Date(now);
  startOfToday.setHours(0, 0, 0, 0);
  const todayStart = startOfToday.getTime();

  const sortDesc = (items: ConversationSummary[]) =>
    [...items].sort(
      (a, b) => Number(b.pinned) - Number(a.pinned) || b.updatedAt - a.updatedAt,
    );

  const pinned: ConversationSummary[] = [];
  const today: ConversationSummary[] = [];
  const past30: ConversationSummary[] = [];
  for (const conversation of conversations) {
    if (conversation.pinned) {
      pinned.push(conversation);
    } else if (conversation.updatedAt >= todayStart) {
      today.push(conversation);
    } else {
      // V1.0.5.2 侧边栏只有两组：更早的会话归入「过去 30 天」组尾部，
      // v1.0.6 接入真实持久化后再补「更早」分组与分页。
      past30.push(conversation);
    }
  }
  const groups: ConversationGroup[] = [];
  if (pinned.length > 0) {
    groups.push({ key: "pinned", label: "置顶", items: sortDesc(pinned) });
  }
  groups.push({ key: "today", label: "今天", items: sortDesc(today) });
  groups.push({ key: "past30", label: "过去 30 天", items: sortDesc(past30) });
  return groups;
}

/** 生成会话 id（不依赖 crypto.randomUUID，测试环境可用）。 */
export function createConversationId(now: () => number = Date.now): string {
  const random = Math.random().toString(36).slice(2, 8);
  return `conv_${now().toString(36)}_${random}`;
}

interface InMemoryOptions {
  seed?: ReadonlyArray<Omit<ConversationRecord, "id"> & { id?: string }>;
  now?: () => number;
}

/**
 * 内存仓库实现（v1.0.5.2 默认实现）。
 *
 * 数据只活在当前标签页内存里：刷新页面回到演示数据，符合「暂不接入真实持久化」。
 */
export function createInMemoryConversationRepository(
  options: InMemoryOptions = {},
): ConversationRepository {
  const now = options.now ?? Date.now;
  const records = new Map<string, ConversationRecord>();

  for (const seed of options.seed ?? []) {
    const id = seed.id ?? createConversationId(now);
    records.set(id, {
      ...seed,
      id,
      turns: [...seed.turns],
    });
  }

  const toSummary = (record: ConversationRecord): ConversationSummary => ({
    id: record.id,
    title: record.title,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
    pinned: record.pinned,
  });

  /**
   * 标题更新策略（V1.0.5.2-layout 补丁）：
   * - 显式传入标题 → 采用并锁定；
   * - 已被用户重命名锁定 → 不再被首条用户消息覆盖；
   * - 否则沿用「首条用户消息自动生成」的规则。
   */
  const applyTitle = (
    record: ConversationRecord,
    turns: readonly StoredConversationTurn[],
    title?: string,
  ) => {
    const explicit = title?.trim();
    if (explicit) {
      record.title = explicit;
      record.titleLocked = true;
      return;
    }
    if (record.titleLocked) return;
    record.title = titleFromTurns(turns, record.title);
  };

  const repository: ConversationRepository = {
    async list() {
      return [...records.values()]
        .map(toSummary)
        .sort((a, b) => Number(b.pinned) - Number(a.pinned) || b.updatedAt - a.updatedAt);
    },

    async get(id: string) {
      const record = records.get(id);
      return record ? { ...record, turns: [...record.turns] } : null;
    },

    async create(init = {}) {
      const timestamp = init.now ?? now();
      const turns = [...(init.turns ?? [])];
      const explicitTitle = init.title?.trim();
      const record: ConversationRecord = {
        id: createConversationId(now),
        title: explicitTitle || titleFromTurns(turns),
        createdAt: timestamp,
        updatedAt: timestamp,
        pinned: false,
        titleLocked: Boolean(explicitTitle),
        turns,
      };
      records.set(record.id, record);
      return { ...record, turns: [...record.turns] };
    },

    async save(id, turns, title) {
      const record = records.get(id);
      if (!record) return null;
      const nextTurns = [...turns];
      record.turns = nextTurns;
      // 只有真的写入新消息时才刷新「最后一条消息时间」→ 列表排序随新消息变化。
      record.updatedAt = now();
      applyTitle(record, nextTurns, title);
      return toSummary(record);
    },

    async syncTurns(id, turns, title) {
      const record = records.get(id);
      if (!record) return null;
      const nextTurns = [...turns];
      record.turns = nextTurns;
      // 关键：不更新 updatedAt。查看 / 切换 / 离开会话绝不重新排序。
      applyTitle(record, nextTurns, title);
      return toSummary(record);
    },

    async rename(id: string, title: string) {
      const record = records.get(id);
      const trimmed = title.trim();
      if (!record || !trimmed) return;
      record.title = trimmed;
      record.titleLocked = true;
      // 重命名不刷新 updatedAt：条目留在原位，只改标题。
    },

    async remove(id: string) {
      records.delete(id);
    },

    async pin(id: string, pinned: boolean) {
      const record = records.get(id);
      if (record) record.pinned = pinned;
    },

    async buildCrossSessionContext(sessionId: string) {
      // TODO v1.0.6 多轮历史对话记忆模块 - 功能待实现
      void sessionId;
      return "";
    },

    async persist(record: ConversationRecord) {
      // TODO v1.0.6 多轮历史对话记忆模块 - 功能待实现
      void record;
    },

    async loadPersisted() {
      // TODO v1.0.6 多轮历史对话记忆模块 - 功能待实现
      return [];
    },
  };
  return repository;
}

/** 演示数据构造：让侧边栏首屏有「今天 / 过去 30 天」两组真实排布。 */
function buildDemoSeed(now: number): Array<Omit<ConversationRecord, "id">> {
  const hour = 60 * 60 * 1000;
  const demoConversations: Array<{
    title: string;
    ageMs: number;
    question: string;
    answer: string;
  }> = [
    {
      title: "赤壁之战发生在哪一年？",
      ageMs: 26 * 60 * 1000,
      question: "赤壁之战发生在哪一年？",
      answer:
        "**根据本轮工具返回的可核验资料：**\n\n**[时间轴·大事记]**\n赤壁之战（东汉，208年）：曹操南下荆州，孙权与刘备联军于赤壁大败曹军……（据《三国志·吴书·周瑜传》）\n\n（演示会话：v1.0.5.2 数据层为内存演示数据，不接真实持久化。）",
    },
    {
      title: "武则天是哪个朝代的人物？",
      ageMs: 4 * hour,
      question: "武则天是哪个朝代的人物？",
      answer:
        "**[人物关系图]**\n武则天：主要活动于唐……\n\n**[时间轴·大事记]**\n相关事件：武则天称帝（690年）……\n\n（演示会话：仅用于验证侧边栏点击加载。）",
    },
    {
      title: "孔子和老子是什么关系？",
      ageMs: 2 * DAY_MS,
      question: "孔子和老子是什么关系？",
      answer:
        "**[人物关系图]**\n关系：孔子 × 老子……\n\n（演示会话：v1.0.6 将接入跨会话上下文与真实持久化。）",
    },
    {
      title: "商鞅变法为什么能成功？",
      ageMs: 9 * DAY_MS,
      question: "商鞅变法为什么能成功？",
      answer:
        "**[时间轴·大事记]**\n商鞅变法（战国，前359年）：……\n\n（演示会话：可点击加载查看历史布局。）",
    },
    {
      title: "安史之乱的经过与影响",
      ageMs: 18 * DAY_MS,
      question: "安史之乱的经过与影响",
      // V1.0.5.2-layout 补丁：演示数据里保留一条**长回答**会话，
      // 用于验证「点击历史对话 → 加载完毕后自动滚动到底部」与中间列独立滚动。
      answer: [
        "**[时间轴·大事记]**",
        "安史之乱（唐，755年—763年）：平卢、范阳、河东三镇节度使安禄山以「清君侧」为名起兵，唐廷仓促应战，战火自河北蔓延至关中、河南，最终在回鹘与唐军联合反攻下平定，但唐朝由盛转衰。",
        "",
        "### 一、起因",
        "开元天宝之际，节度使权力膨胀，边镇掌握兵、财、民三权；中央府兵制瓦解后依赖募兵，形成「外重内轻」格局。天宝后期，宰相杨国忠与安禄山互相倾轧，又逢关中饥荒与朝廷财政紧张，叛乱一触即发。",
        "",
        "### 二、经过",
        "755年冬，安禄山自范阳起兵，迅速攻陷洛阳；756年正月称帝，国号大燕。唐玄宗杀高仙芝、封常清后命哥舒翰守潼关，潼关失守，长安沦陷，玄宗入蜀。肃宗即位灵武，借回鹘兵反攻；757年郭子仪、李光弼收复两京，安庆绪退守邺城。759年史思明再叛，杀安庆绪自立；761年史朝义杀史思明。763年史朝义兵败自缢，乱事告终。",
        "",
        "### 三、影响",
        "- 人口与经济：北方户口锐减，关中、河南财政凋敝，经济重心进一步南移；",
        "- 政治格局：中央集权削弱，藩镇割据合法化，宦官专权与党争加剧；",
        "- 军事制度：府兵彻底退出，藩镇兵与神策军并立，边防体系重组；",
        "- 社会文化：士人南迁、南方城市兴起，唐诗中「感时伤乱」题材成为主流。",
        "",
        "### 四、史评",
        "《资治通鉴》以「由是祸乱继起，兵革不息」概括安史之乱后的唐朝困局；后世多认为其根源不在单一人物，而在边防—财政—政治结构的长期失衡。",
        "",
        "（演示会话：本条为长文本占位，用于验证加载历史对话后聊天列表自动滚动到底部，以及中间聊天区独立滚动。）",
      ].join("\n"),
    },
  ];

  return demoConversations.map((demo) => {
    const timestamp = now - demo.ageMs;
    const turns: StoredConversationTurn[] = [
      {
        id: `demo-user-${demo.ageMs}`,
        role: "user",
        content: demo.question,
      },
      {
        id: `demo-assistant-${demo.ageMs}`,
        role: "assistant",
        content: demo.answer,
        answer: null,
      },
    ];
    return {
      title: demo.title,
      createdAt: timestamp,
      updatedAt: timestamp,
      pinned: false,
      // 演示数据标题是策展值，视为已锁定：后续 sync 不会被首问标题覆盖。
      titleLocked: true,
      turns,
    };
  });
}

let defaultRepository: ConversationRepository | null = null;

/** 全局默认仓库（内存实现 + 演示数据；V1.0.6 换成真实持久化实现）。 */
export function getDefaultConversationRepository(): ConversationRepository {
  if (defaultRepository === null) {
    const now = Date.now();
    defaultRepository = createInMemoryConversationRepository({
      seed: buildDemoSeed(now),
    });
  }
  return defaultRepository;
}

/** 测试辅助：重置默认仓库。 */
export function resetDefaultConversationRepository(
  repository?: ConversationRepository,
): void {
  defaultRepository = repository ?? null;
}