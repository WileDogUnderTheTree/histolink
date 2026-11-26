/**
 * 历史对话数据层（V1.0.5.2；V1.0.6 接入真实服务端持久化）。
 *
 * V1.0.6 实现范围（替换 V1.0.5.2 的「内存 + 演示数据」）：
 * - `createHttpConversationRepository()`：走 `/api/sessions` 真实持久化（默认实现），
 *   列表 / 详情 / 新建 / 重命名 / 置顶 / 删除全部由服务端 SessionStore 承载；
 * - 保留 `createInMemoryConversationRepository()` 供单测与离线兜底；
 * - 侧边栏分组（「置顶 / 今天 / 过去 30 天」）、标题生成、排序语义保持不变：
 *   列表顺序只由「创建时间 / 最后一条消息时间」决定，点击查看不改变顺序。
 *
 * 数据流（V1.0.6）：
 * - 对话轮次由 `POST /api/agent/ask` 在服务端**原子写入**（提问成功才落库）；
 *   前端不再用 `save()` 回写正文，`save` / `syncTurns` 在 HTTP 仓库中是安全空操作；
 * - 页面刷新后：从 `localStorage` 取 `session_id` → `GET /api/sessions/{id}` 恢复完整聊天记录；
 * - 新建对话 = `POST /api/sessions` 创建空会话（更新链接 / 列表最上方）。
 */

import type { AgentAnswerView } from "@/lib/agent-client";
import {
  createSession as createRemoteSession,
  deleteSession as deleteRemoteSession,
  fetchSessionDetail,
  fetchSessions,
  patchSession as patchRemoteSession,
  type RemoteSessionDetail,
  type SessionFetchOptions,
} from "@/lib/session-client";

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
   * 未锁定时标题由首条用户消息自动生成；服务端 SessionStore 负责持久化该状态，
   * 前端只在内存实现里使用它，`ConversationSummary` 不暴露。
   */
  titleLocked?: boolean;
}

/** 仓库实现类型：`remote` 走真实 API，`memory` 供单测 / 离线兜底。 */
export type ConversationRepositoryKind = "remote" | "memory";

/**
 * 历史对话仓库接口。
 *
 * 页面 / Context 只依赖本接口；V1.0.6 默认实现为 HTTP 仓库。
 * 注意：`save` / `syncTurns` 仅内存实现会真正写入；真实持久化由服务端问答接口负责，
 * HTTP 实现返回 null（安全空操作），调用方不得据此判断会话是否存在。
 */
export interface ConversationRepository {
  readonly kind: ConversationRepositoryKind;
  list(): Promise<ConversationSummary[]>;
  get(id: string): Promise<ConversationRecord | null>;
  create(init?: {
    /** 指定会话 id（前端生成，保证刷新后 id 稳定）。 */
    id?: string;
    title?: string;
    turns?: StoredConversationTurn[];
    now?: number;
  }): Promise<ConversationRecord>;
  /**
   * 保存正文并刷新 `updatedAt`（仅内存实现；HTTP 仓库为空操作）。
   *
   * 只允许在**会话里真的产生了新消息**时调用；加载 / 切换会话请用 `syncTurns`。
   */
  save(
    id: string,
    turns: readonly StoredConversationTurn[],
    title?: string,
  ): Promise<ConversationSummary | null>;
  /**
   * 同步正文但**不改变排序时间**（仅内存实现；HTTP 仓库为空操作）。
   *
   * 用于加载历史会话、切换会话前保存当前会话等「查看」场景。
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
}

/** 侧边栏分组（置顶优先，其次按创建 / 最后消息时间倒序分「今天 / 过去 30 天」）。 */
export interface ConversationGroup {
  key: "pinned" | "today" | "past30";
  label: string;
  items: ConversationSummary[];
}

/** 历史对话标题的最大展示长度（侧边栏单行省略）。 */
export const MAX_CONVERSATION_TITLE_LENGTH = 28;
const DAY_MS = 24 * 60 * 60 * 1000;

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
 * 按「置顶 / 今天 / 过去 30 天」分组并倒序排列（V1.0.5.2-layout 补丁语义，V1.0.6 保留）。
 *
 * 排序口径（用户验收口径）：
 * 1. 用户主动「置顶」的会话进入最上方独立「置顶」组（没有置顶项时不渲染该组）；
 * 2. 其余会话严格按【最后一条消息发送时间】倒序，仅做「今天 / 过去 30 天」分组；
 * 3. 点击查看 / 切换会话不改变上述顺序（查看行为不写 `updatedAt`）。
 *
 * 返回的 today / past30 两组始终存在（可能为空），由侧边栏过滤空组。
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
      // V1.0.6 侧边栏仍只有两组：更早的会话归入「过去 30 天」组尾部。
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

/** 远程会话详情 → 仓库记录（服务端轮次没有前端 id，这里按位置生成稳定 id）。 */
export function recordFromRemoteSession(detail: RemoteSessionDetail): ConversationRecord {
  return {
    id: detail.id,
    title: detail.title,
    createdAt: detail.createdAt,
    updatedAt: detail.updatedAt,
    pinned: detail.pinned,
    turns: detail.turns.map((turn, index) => ({
      id: `${detail.id}-turn-${index}`,
      role: turn.role,
      content: turn.content,
      answer: turn.answer,
    })),
  };
}

/**
 * 真实持久化仓库（V1.0.6 默认）：全部操作走 `/api/sessions`。
 *
 * - 读取失败（后端未启动 / 网络异常）：`list()` 返回空列表、`get()` 返回 null，
 *   页面进入「暂无历史对话」而不是崩溃；
 * - 写入失败：创建会话抛 `SessionClientError`（调用方回退为纯本地新会话），
 *   重命名 / 置顶 / 删除静默失败，随后 `refreshConversations()` 以服务端状态为准。
 */
export function createHttpConversationRepository(
  options: SessionFetchOptions = {},
): ConversationRepository {
  const toSummary = (detail: RemoteSessionDetail | null): ConversationSummary | null =>
    detail
      ? {
          id: detail.id,
          title: detail.title,
          createdAt: detail.createdAt,
          updatedAt: detail.updatedAt,
          pinned: detail.pinned,
        }
      : null;

  const repository: ConversationRepository = {
    kind: "remote",

    async list() {
      const sessions = await fetchSessions(options);
      if (!sessions) return [];
      return sessions
        .map((session) => ({
          id: session.id,
          title: session.title,
          createdAt: session.createdAt,
          updatedAt: session.updatedAt,
          pinned: session.pinned,
        }))
        .sort(
          (a, b) =>
            Number(b.pinned) - Number(a.pinned) || b.updatedAt - a.updatedAt,
        );
    },

    async get(id: string) {
      const detail = await fetchSessionDetail(id, options);
      return detail ? recordFromRemoteSession(detail) : null;
    },

    async create(init = {}) {
      const detail = await createRemoteSession({
        ...options,
        sessionId: init.id,
        title: init.title,
      });
      return recordFromRemoteSession(detail);
    },

    // 服务端在 `POST /api/agent/ask` 成功后原子写入轮次；前端不再回写正文。
    async save() {
      return null;
    },

    async syncTurns() {
      return null;
    },

    async rename(id: string, title: string) {
      await patchRemoteSession(id, { title }, options);
    },

    async remove(id: string) {
      await deleteRemoteSession(id, options);
    },

    async pin(id: string, pinned: boolean) {
      await patchRemoteSession(id, { pinned }, options);
    },
  };
  return repository;
}

// ---------------------------------------------------------------------------
// 内存仓库（单测 / 离线兜底）
// ---------------------------------------------------------------------------

interface InMemoryOptions {
  seed?: ReadonlyArray<Omit<ConversationRecord, "id"> & { id?: string }>;
  now?: () => number;
}

/**
 * 内存仓库实现（单测 / 离线兜底；V1.0.6 默认实现已换成 HTTP 仓库）。
 *
 * 数据只活在当前进程内存里，排序语义与 HTTP 仓库保持一致。
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
    kind: "memory",

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
        id: init.id?.trim() || createConversationId(now),
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
  };
  return repository;
}

let defaultRepository: ConversationRepository | null = null;

/** 全局默认仓库（V1.0.6：真实服务端持久化；测试可注入内存实现）。 */
export function getDefaultConversationRepository(): ConversationRepository {
  if (defaultRepository === null) {
    defaultRepository = createHttpConversationRepository();
  }
  return defaultRepository;
}

/** 测试辅助：重置默认仓库。 */
export function resetDefaultConversationRepository(
  repository?: ConversationRepository,
): void {
  defaultRepository = repository ?? null;
}

/** 「今天」分组的毫秒基准（导出便于测试 / 侧边栏时间文案复用）。 */
export const ONE_DAY_MS = DAY_MS;