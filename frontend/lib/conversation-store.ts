/**
 * 历史对话数据层（V1.0.5.2）。
 *
 * v1.0.5.2 实现范围：
 * - 定义 `ConversationRepository` / `ConversationStorage` 接口与数据形状；
 * - 提供**内存实现 + 演示数据**（页面刷新后回到演示数据，不接真实持久化）；
 * - `/ask` 左侧历史对话侧边栏的「今天 / 过去 30 天」分组、点击加载、新建对话都基于本模块。
 *
 * v1.0.6 预留（本版本只留接口与注释，**不实现业务逻辑**）：
 * - 历史对话持久化存储（localStorage / IndexedDB / 服务端会话库）；
 * - 跨会话上下文关联（把 earlier 会话摘要拼进新一轮 history）；
 * - 历史对话重命名 / 删除 / 置顶。
 * 所有预留位置均带 `// TODO v1.0.6 多轮历史对话记忆模块 - 功能待实现`，
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
  save(
    id: string,
    turns: readonly StoredConversationTurn[],
    title?: string,
  ): Promise<ConversationSummary | null>;
  /** v1.0.6 预留：重命名历史对话。 */
  rename(id: string, title: string): Promise<void>;
  /** v1.0.6 预留：删除历史对话。 */
  remove(id: string): Promise<void>;
  /** v1.0.6 预留：置顶 / 取消置顶历史对话。 */
  pin(id: string, pinned: boolean): Promise<void>;
  /** v1.0.6 预留：跨会话上下文关联（把 earlier 会话摘要拼进新一轮 history）。 */
  buildCrossSessionContext(sessionId: string): Promise<string>;
  /** v1.0.6 预留：历史对话持久化写入。 */
  persist(record: ConversationRecord): Promise<void>;
  /** v1.0.6 预留：启动时读取已持久化的历史对话。 */
  loadPersisted(): Promise<ConversationRecord[]>;
}

/** 侧边栏分组（按时间维度）。 */
export interface ConversationGroup {
  key: "today" | "past30";
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

/** 按「今天 / 过去 30 天」分组并倒序排列（置顶项优先）。 */
export function groupConversationsByTime(
  conversations: readonly ConversationSummary[],
  now: number = Date.now(),
): ConversationGroup[] {
  const startOfToday = new Date(now);
  startOfToday.setHours(0, 0, 0, 0);
  const todayStart = startOfToday.getTime();
  const past30Start = todayStart - 29 * DAY_MS;

  const sortDesc = (items: ConversationSummary[]) =>
    [...items].sort(
      (a, b) => Number(b.pinned) - Number(a.pinned) || b.updatedAt - a.updatedAt,
    );

  const today: ConversationSummary[] = [];
  const past30: ConversationSummary[] = [];
  for (const conversation of conversations) {
    if (conversation.updatedAt >= todayStart) {
      today.push(conversation);
    } else if (conversation.updatedAt >= past30Start) {
      past30.push(conversation);
    } else {
      // V1.0.5.2 侧边栏只有两组：更早的会话归入「过去 30 天」组尾部，
      // v1.0.6 接入真实持久化后再补「更早」分组与分页。
      past30.push(conversation);
    }
  }
  return [
    { key: "today", label: "今天", items: sortDesc(today) },
    { key: "past30", label: "过去 30 天", items: sortDesc(past30) },
  ];
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
      const record: ConversationRecord = {
        id: createConversationId(now),
        title: init.title?.trim() || titleFromTurns(turns),
        createdAt: timestamp,
        updatedAt: timestamp,
        pinned: false,
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
      record.updatedAt = now();
      record.title = title?.trim() || titleFromTurns(nextTurns, record.title);
      return toSummary(record);
    },

    async rename(id: string, title: string) {
      // TODO v1.0.6 多轮历史对话记忆模块 - 功能待实现
      void id;
      void title;
      throw new Error("重命名历史对话将在 v1.0.6 提供");
    },

    async remove(id: string) {
      // TODO v1.0.6 多轮历史对话记忆模块 - 功能待实现
      void id;
      throw new Error("删除历史对话将在 v1.0.6 提供");
    },

    async pin(id: string, pinned: boolean) {
      // TODO v1.0.6 多轮历史对话记忆模块 - 功能待实现
      void id;
      void pinned;
      throw new Error("置顶历史对话将在 v1.0.6 提供");
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
      answer:
        "**[时间轴·大事记]**\n安史之乱（唐，755年—763年）：……\n\n（演示会话：可点击加载查看历史布局。）",
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