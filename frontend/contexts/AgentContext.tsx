"use client";

/**
 * 全局 Agent 状态（V1.0.4；V1.0.5.2 模型选择 + 历史对话侧边栏）。
 *
 * **单一会话事实源**：全局悬浮抽屉（AgentDrawer）与 `/ask` 独立页共享这一份 transcript，
 * 不允许各自 `useState`，否则会出现两个入口串消息的问题。
 *
 * V1.0.4 职责：
 * 1. `ask(question)`：组装页面上下文 + 历史 → `POST /api/agent/ask`（同源代理）→ 写入 transcript；
 * 2. 把回答里的 `ui_actions` 交给 ActionBus：同页自动执行，跨页进入待确认队列；
 * 3. 提供 `pendingActions` / `confirmAction` / `cancelAction` 给抽屉 UI（确认弹窗由 V1.0.4 UI 卡实现）；
 * 4. 错误 / 网络异常统一转成带 `isError` 的 assistant turn，不抛到 React 渲染层。
 *
 * V1.0.5.2 职责：
 * 5. `models` / `selectedModelId` / `selectModel()`：输入框左上角模型切换窗口的数据源，
 *    切换后立即生效（下一问带 `model_id`），不清空已有对话历史；
 * 6. `conversations` / `newConversation()` / `loadConversation()`：历史对话侧边栏数据层，
 *    v1.0.5.2 走内存仓库 + 演示数据（`lib/conversation-store.ts`），不接真实持久化。
 *
 * 安全：只展示服务端返回的 `answer.markdown`，前端不拼接、不改写回答文本。
 */
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { usePathname, useRouter } from "next/navigation";

import { createAgentActionBus } from "@/lib/action-bus";
import type { ActionBus, DispatchResult } from "@/lib/action-bus";
import { resolveGuideFromTranscript } from "@/lib/agent-guide";
import type { AgentGuide } from "@/lib/agent-guide";
import type { UIAction, UISurface } from "@/lib/action-policy";
import {
  AgentClientError,
  FALLBACK_MODEL_OPTIONS,
  WELCOME_TURN_ID,
  answerViewFromEnvelope,
  buildAskRequest,
  clarificationTextFromEnvelope,
  createSessionId,
  errorMessageFromEnvelope,
  fetchAgentModels,
  isErrorEnvelope,
  namespaceUiActions,
  normalizeRestoredAnswerView,
  postAsk,
  resolveRequestModelId,
  type AgentAnswerView,
  type AgentTranscriptTurn,
  type ModelOption,
} from "@/lib/agent-client";
import {
  getDefaultConversationRepository,
  groupConversationsByTime,
  type ConversationGroup,
  type ConversationSummary,
  type StoredConversationTurn,
} from "@/lib/conversation-store";
import { surfaceFromPathname } from "@/lib/routes";

export type { AgentAnswerView, AgentGuide };

export interface AgentTurn extends AgentTranscriptTurn {
  id: string;
  /** grounded / insufficient / refusal 的结构化结果（错误与欢迎语为 null）。 */
  answer?: AgentAnswerView | null;
  isError?: boolean;
}

export interface AgentSessionValue {
  transcript: AgentTurn[];
  /**
   * 会话是否已从 sessionStorage 恢复完毕（V1.0.5.1）。
   *
   * 首屏用 `WELCOME_TURN` 保证 SSR / 客户端首次渲染一致（避免 hydration mismatch），
   * 恢复在 mount 后的 effect 中完成；页面在 `isRestored=false` 时不应回滚历史会话。
   */
  isRestored: boolean;
  isOpen: boolean;
  isAsking: boolean;
  /** 最近一次成功回答（便捷访问；完整历史在 transcript）。 */
  lastAnswer: AgentAnswerView | null;
  /**
   * 当前应展示的史引副驾驶联动目标；null 表示本轮回答没有可联动的历史内容。
   * `/ask` 页面据此自动展开右侧面板（P2：绝对不需要用户再点按钮）。
   */
  guide: AgentGuide | null;
  /** 跨页动作等待用户确认。 */
  pendingActions: UIAction[];
  /** 当前页面对应的动作 surface（首页为 null）。 */
  currentSurface: UISurface | null;
  actionBus: ActionBus;
  openDrawer: () => void;
  closeDrawer: () => void;
  toggleDrawer: () => void;
  /** 提问：写入 transcript、调用后端、分发 UI 动作。 */
  ask: (question: string) => Promise<void>;
  /** 确认跨页动作（抽屉确认按钮 / 测试使用）。 */
  confirmAction: (actionId: string) => Promise<DispatchResult>;
  cancelAction: (actionId: string) => void;

  // ---- V1.0.5.2 模型切换窗口 ----
  /** 模型注册表（`GET /api/agent/models`；后端不可达时用内置静态表兜底）。 */
  models: ModelOption[];
  /** 后端默认主模型 id。 */
  defaultModelId: string | null;
  /** 当前选中的模型 id；null 表示使用后端默认主模型。 */
  selectedModelId: string | null;
  /** 切换当前会话使用的模型：立即生效，不清空已有对话历史。 */
  selectModel: (modelId: string) => void;
  /** 模型注册表是否已读取完成。 */
  modelsReady: boolean;
  /** 模型注册表是否来自静态兜底（后端未启动 / 接口异常）。 */
  modelsFromFallback: boolean;

  // ---- V1.0.5.2 历史对话侧边栏 ----
  /** 按「今天 / 过去 30 天」分组后的历史对话（v1.0.5.2 为演示 + 内存数据）。 */
  conversationGroups: ConversationGroup[];
  /** 当前活动会话 id；null 表示尚未落库的新会话。 */
  activeConversationId: string | null;
  /** 侧边栏数据是否加载完成。 */
  conversationsLoading: boolean;
  /** 当前会话是否为空（只有欢迎语）→「新建对话」选中态。 */
  isCurrentConversationEmpty: boolean;
  /** 新建对话：保存当前会话、清空 transcript、开启新会话（新会话出现在列表最上方）。 */
  newConversation: () => Promise<void>;
  /** 加载历史对话：仅切换查看，**不改变该条目的列表位置与排序时间**。 */
  loadConversation: (id: string) => Promise<void>;
  /** 重命名历史对话（本地内存状态更新；锁定标题，不改变列表位置）。 */
  renameConversation: (id: string, title: string) => Promise<void>;
  /** 删除历史对话（本地内存状态更新；若删的是当前会话则回到欢迎语）。 */
  deleteConversation: (id: string) => Promise<void>;
  /** 置顶 / 取消置顶历史对话（本地内存状态更新；置顶项移到列表最上方「置顶」组）。 */
  pinConversation: (id: string, pinned: boolean) => Promise<void>;
}

const AgentSessionContext = createContext<AgentSessionValue | null>(null);

const WELCOME_TURN: AgentTurn = {
  id: WELCOME_TURN_ID,
  role: "assistant",
  content:
    "你好，我是史脉问答。可以问我历史事件、人物或人物关系；我会优先检索史脉数据，并在回答里标注可核验的史料来源。",
  skipHistory: true,
  answer: null,
};

const GENERIC_ERROR = "史脉服务暂时不可用，请稍后重试。";
const TRANSCRIPT_STORAGE_KEY = "histolink.agent.transcript.v1";
/** 选中的模型只在本标签页内记忆（不清空会话，也不写入服务端）。 */
const MODEL_STORAGE_KEY = "histolink.agent.model.v1";

/**
 * 读取本次标签页保留的对话（V1.0.5.1）。
 *
 * 只在客户端 mount 后调用：首屏统一渲染 WELCOME_TURN，避免服务端与客户端首帧不一致的
 * hydration 报错；损坏 / 版本不符的数据一律回落欢迎语，不让脏数据进渲染层。
 */
function loadStoredTranscript(): AgentTurn[] {
  if (typeof window === "undefined") return [WELCOME_TURN];
  try {
    const raw = window.sessionStorage.getItem(TRANSCRIPT_STORAGE_KEY);
    if (!raw) return [WELCOME_TURN];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed) || parsed.length === 0) return [WELCOME_TURN];
    const turns = parsed
      .filter((turn): turn is AgentTurn => {
        if (!turn || typeof turn !== "object") return false;
        const value = turn as Partial<AgentTurn>;
        return typeof value.id === "string"
          && (value.role === "user" || value.role === "assistant")
          && typeof value.content === "string";
      })
      .map((turn) => ({
        ...turn,
        answer: turn.answer ? normalizeRestoredAnswerView(turn.answer) : null,
        isError: turn.isError === true,
        skipHistory: turn.skipHistory === true,
      }));
    return turns.length > 0 ? turns : [WELCOME_TURN];
  } catch {
    return [WELCOME_TURN];
  }
}

/** 读取本标签页记忆的模型选择（V1.0.5.2）；非法值返回 null（使用默认主模型）。 */
function loadStoredModelId(): string | null {
  if (typeof window === "undefined") return null;
  try {
    const value = window.sessionStorage.getItem(MODEL_STORAGE_KEY)?.trim();
    return value ? value : null;
  } catch {
    return null;
  }
}

/** 每次请求独立 id：既做 transcript key，也用来给动作 id 加前缀（避免跨轮幂等冲突）。 */
function createTurnRequestId(now: () => number = Date.now): string {
  return `req_${now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

/** AgentTurn ⇄ 仓库轮次（结构兼容，只做一次浅拷贝保证不可变）。 */
function toStoredTurns(turns: readonly AgentTurn[]): StoredConversationTurn[] {
  return turns.map((turn) => ({ ...turn }));
}

/**
 * transcript 的「已同步签名」（V1.0.5.2-layout 补丁）。
 *
 * 轮次 id 每轮唯一，用 id 序列即可判断「文本内容是否变化」，避免每帧 JSON 序列化。
 * 切换 / 加载会话时先写入签名，让同步 effect 跳过 save——这是修复
 * 「点击历史记录被误判为最新活跃并弹到列表顶部」的关键。
 */
function transcriptSignature(turns: readonly AgentTurn[]): string {
  return turns.map((turn) => turn.id).join("|");
}

export function AgentProvider({ children }: Readonly<{ children: React.ReactNode }>) {
  const pathname = usePathname();
  const router = useRouter();
  const currentSurface = useMemo(() => surfaceFromPathname(pathname), [pathname]);

  const [transcript, setTranscript] = useState<AgentTurn[]>(() => [WELCOME_TURN]);
  const [isRestored, setIsRestored] = useState(false);
  const [isOpen, setIsOpen] = useState(false);
  const [isAsking, setIsAsking] = useState(false);
  const [pendingActions, setPendingActions] = useState<UIAction[]>([]);
  const [lastAnswer, setLastAnswer] = useState<AgentAnswerView | null>(null);

  // ---- V1.0.5.2 模型切换窗口状态 ----
  const [models, setModels] = useState<ModelOption[]>(FALLBACK_MODEL_OPTIONS);
  const [defaultModelId, setDefaultModelId] = useState<string | null>(
    FALLBACK_MODEL_OPTIONS[0]?.id ?? null,
  );
  const [selectedModelId, setSelectedModelId] = useState<string | null>(null);
  const [modelsReady, setModelsReady] = useState(false);
  const [modelsFromFallback, setModelsFromFallback] = useState(true);

  // ---- V1.0.5.2 历史对话侧边栏状态 ----
  const repository = useRef(getDefaultConversationRepository()).current;
  const [conversations, setConversations] = useState<ConversationSummary[]>([]);
  const [activeConversationId, setActiveConversationId] = useState<string | null>(null);
  const [conversationsLoading, setConversationsLoading] = useState(true);
  const activeConversationIdRef = useRef<string | null>(null);
  /** 已写入仓库的 transcript 签名 / 轮次数：决定是否需要同步、以及是否属于「新消息」。 */
  const syncedTurnsSignatureRef = useRef<string>(transcriptSignature([WELCOME_TURN]));
  const syncedTurnCountRef = useRef<number>(1);

  /**
   * 史引副驾驶联动目标（P2）：任何一轮回答落地后自动更新。
   * `/ask` 页面只消费这个值并展开面板，不再自己解析动作 / 深链接。
   */
  const guide = useMemo(() => resolveGuideFromTranscript(transcript), [transcript]);

  /** 给 ask() 读「提问前的历史」，避免把当前问题重复放进 history。 */
  const transcriptRef = useRef(transcript);
  useEffect(() => {
    transcriptRef.current = transcript;
  }, [transcript]);

  useEffect(() => {
    activeConversationIdRef.current = activeConversationId;
  }, [activeConversationId]);

  const refreshConversations = useCallback(async () => {
    const items = await repository.list();
    setConversations(items);
  }, [repository]);

  // 模型注册表：首屏读取；失败回退静态表，绝不影响提问。
  // V1.0.5.4 修复三：再加一层 catch 兜底（异常 promise 不能变成新窗口首屏的控制台报错）。
  useEffect(() => {
    const controller = new AbortController();
    void fetchAgentModels({ signal: controller.signal })
      .then((state) => {
        if (controller.signal.aborted) return;
        setModels(state.models);
        setDefaultModelId(state.defaultModelId);
        setModelsFromFallback(state.fromFallback);
        setModelsReady(true);
        const stored = loadStoredModelId();
        const known = state.models.some((model) => model.id === stored);
        setSelectedModelId((previous) => {
          if (previous && state.models.some((model) => model.id === previous)) {
            return previous;
          }
          return known ? stored : state.defaultModelId;
        });
      })
      .catch(() => {
        if (controller.signal.aborted) return;
        setModels(FALLBACK_MODEL_OPTIONS);
        setDefaultModelId(FALLBACK_MODEL_OPTIONS[0]?.id ?? null);
        setSelectedModelId((previous) => previous ?? FALLBACK_MODEL_OPTIONS[0]?.id ?? null);
        setModelsFromFallback(true);
        setModelsReady(true);
      });
    return () => controller.abort();
  }, []);

  // 历史对话列表：首屏读取内存仓库（含演示数据）。
  useEffect(() => {
    let cancelled = false;
    void repository.list().then((items) => {
      if (cancelled) return;
      setConversations(items);
      setConversationsLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [repository]);

  // 会话恢复（V1.0.5.1）：mount 后再读 sessionStorage，首帧服务端 / 客户端都渲染欢迎语，
  // 因此不会出现 hydration mismatch；恢复完成前也不写回，避免欢迎语覆盖已保存的会话。
  useEffect(() => {
    setTranscript(loadStoredTranscript());
    setIsRestored(true);
  }, []);

  useEffect(() => {
    if (!isRestored) return;
    try {
      window.sessionStorage.setItem(TRANSCRIPT_STORAGE_KEY, JSON.stringify(transcript));
    } catch {
      // Storage may be disabled or full; the in-memory transcript remains authoritative.
    }
  }, [transcript, isRestored]);

  /**
   * 把 transcript 同步进历史对话仓库（V1.0.5.2；V1.0.5.2-layout 补丁修正排序语义）。
   *
   * 规则（用户验收口径）：
   * - 列表顺序只由【创建时间 / 最后一条消息发送时间】决定；
   * - **只有会话里真的新增了消息**才调用 `save`（刷新 `updatedAt`）；
   * - 加载 / 切换会话用 `syncTurns`（不刷新时间），且加载后先登记签名、跳过本轮同步，
   *   保证「点击查看」绝不把该条历史记录弹到列表顶部；
   * - 首次出现用户轮次时创建会话记录（恢复会话场景）。
   */
  const hasUserTurn = transcript.some((turn) => turn.role === "user");
  useEffect(() => {
    if (!isRestored) return;
    const signature = transcriptSignature(transcript);
    if (signature === syncedTurnsSignatureRef.current) return;
    const previousTurnCount = syncedTurnCountRef.current;
    syncedTurnsSignatureRef.current = signature;
    syncedTurnCountRef.current = transcript.length;

    const storedTurns = toStoredTurns(transcript);
    const activeId = activeConversationIdRef.current;
    if (activeId) {
      const write =
        transcript.length > previousTurnCount
          ? repository.save(activeId, storedTurns)
          : repository.syncTurns(activeId, storedTurns);
      void write.then(() => refreshConversations());
      return;
    }
    if (!hasUserTurn) return;
    void repository
      .create({ turns: storedTurns })
      .then((record) => {
        activeConversationIdRef.current = record.id;
        setActiveConversationId(record.id);
        return refreshConversations();
      });
  }, [transcript, isRestored, hasUserTurn, repository, refreshConversations]);

  const surfaceRef = useRef<UISurface | null>(currentSurface);
  useEffect(() => {
    surfaceRef.current = currentSurface;
  }, [currentSurface]);

  const routerRef = useRef(router);
  useEffect(() => {
    routerRef.current = router;
  }, [router]);

  const sessionIdRef = useRef<string | null>(null);
  const inFlightRef = useRef(false);

  /**
   * 会话 id 初始化（V1.0.5.4 修复三）：mount 时即生成，保证冷启动 / 新窗口的
   * 首次请求一定带合法的 `session_id`（不再依赖「第一次 ask 时才懒生成」）。
   */
  useEffect(() => {
    if (!sessionIdRef.current) {
      sessionIdRef.current = createSessionId();
    }
  }, []);

  const actionBusRef = useRef<ActionBus | null>(null);
  if (actionBusRef.current === null) {
    actionBusRef.current = createAgentActionBus({
      getCurrentSurface: () => surfaceRef.current,
      navigate: (href) => routerRef.current.push(href),
    });
  }
  const actionBus = actionBusRef.current;

  useEffect(() => {
    const unsubscribe = actionBus.on((event) => {
      if (event.type === "confirmation-required") {
        setPendingActions((previous) =>
          previous.some((item) => item.id === event.action.id)
            ? previous
            : [...previous, event.action],
        );
      }
      if (
        event.type === "cancelled" ||
        event.type === "executed" ||
        event.type === "navigated"
      ) {
        setPendingActions((previous) =>
          previous.filter((item) => item.id !== event.action.id),
        );
      }
    });
    return unsubscribe;
  }, [actionBus]);

  const openDrawer = useCallback(() => setIsOpen(true), []);
  const closeDrawer = useCallback(() => setIsOpen(false), []);
  const toggleDrawer = useCallback(() => setIsOpen((open) => !open), []);

  const appendTurn = useCallback((turn: AgentTurn) => {
    setTranscript((previous) => [...previous, turn]);
  }, []);

  const dispatchAnswerActions = useCallback(
    async (actions: readonly UIAction[], scope: string) => {
      if (actions.length === 0) return;
      await actionBus.dispatchAll(namespaceUiActions(actions, scope));
    },
    [actionBus],
  );

  /** 切换模型（V1.0.5.2）：只写本标签页记忆 + 下一次请求带 model_id，不动 transcript。 */
  const selectModel = useCallback((modelId: string) => {
    setSelectedModelId(modelId);
    try {
      window.sessionStorage.setItem(MODEL_STORAGE_KEY, modelId);
    } catch {
      // 存储不可用只影响「刷新后记忆」，不影响当前会话的选择。
    }
  }, []);

  /**
   * 新建对话（V1.0.5.2；V1.0.5.2-layout 补丁）。
   *
   * 用户点击「+ 新建对话」时：
   * 1. 当前会话内容用 `syncTurns` 落库（不刷新排序时间，避免自己把旧会话顶上去）；
   * 2. **立即创建一条新的空会话记录**（`updatedAt = now`）→ 它会出现在列表最上方，
   *    且只有这个主动动作会新增列表项；
   * 3. 中间聊天区清空回欢迎语状态（`WELCOME_TURN`），滚动由页面负责回位。
   *
   * 若当前已经是空白新会话则不重复创建，避免列表里出现多条空标题。
   */
  const newConversation = useCallback(async () => {
    const activeId = activeConversationIdRef.current;
    const currentTurns = transcriptRef.current;
    const currentHasUserTurn = currentTurns.some((turn) => turn.role === "user");
    if (activeId) {
      if (!currentHasUserTurn) {
        setPendingActions([]);
        setLastAnswer(null);
        return;
      }
      await repository.syncTurns(activeId, toStoredTurns(currentTurns));
    }
    const record = await repository.create({ turns: [] });
    activeConversationIdRef.current = record.id;
    syncedTurnsSignatureRef.current = transcriptSignature([WELCOME_TURN]);
    syncedTurnCountRef.current = 1;
    setActiveConversationId(record.id);
    setPendingActions([]);
    setLastAnswer(null);
    setTranscript([WELCOME_TURN]);
    try {
      window.sessionStorage.removeItem(TRANSCRIPT_STORAGE_KEY);
    } catch {
      // 忽略存储异常：内存中的新会话仍然生效。
    }
    await refreshConversations();
  }, [repository, refreshConversations]);

  /**
   * 加载历史对话（V1.0.5.2；V1.0.5.2-layout 补丁）。
   *
   * 关键行为：点击查看只切换当前会话与高亮，**绝不改变该条目的物理位置**——
   * 切换前保存当前会话用 `syncTurns`（不刷新 `updatedAt`），加载后登记签名跳过同步 effect。
   */
  const loadConversation = useCallback(
    async (id: string) => {
      const currentId = activeConversationIdRef.current;
      if (currentId === id) return;
      if (currentId) {
        await repository.syncTurns(currentId, toStoredTurns(transcriptRef.current));
      }
      const record = await repository.get(id);
      if (!record) return;
      const turns: AgentTurn[] = record.turns.map((turn) => ({ ...turn }));
      const nextTranscript = turns.length > 0 ? turns : [WELCOME_TURN];
      activeConversationIdRef.current = record.id;
      syncedTurnsSignatureRef.current = transcriptSignature(nextTranscript);
      syncedTurnCountRef.current = nextTranscript.length;
      setActiveConversationId(record.id);
      setTranscript(nextTranscript);
      setPendingActions([]);
      setLastAnswer(
        [...turns].reverse().find((turn) => turn.answer)?.answer ?? null,
      );
      await refreshConversations();
    },
    [repository, refreshConversations],
  );

  /** 重命名历史对话（本地内存状态）：只改标题并锁定，不改变列表位置。 */
  const renameConversation = useCallback(
    async (id: string, title: string) => {
      await repository.rename(id, title);
      await refreshConversations();
    },
    [repository, refreshConversations],
  );

  /** 删除历史对话（本地内存状态）：删除当前会话时回到空白欢迎态。 */
  const deleteConversation = useCallback(
    async (id: string) => {
      await repository.remove(id);
      if (activeConversationIdRef.current === id) {
        activeConversationIdRef.current = null;
        syncedTurnsSignatureRef.current = transcriptSignature([WELCOME_TURN]);
        syncedTurnCountRef.current = 1;
        setActiveConversationId(null);
        setTranscript([WELCOME_TURN]);
        setPendingActions([]);
        setLastAnswer(null);
        try {
          window.sessionStorage.removeItem(TRANSCRIPT_STORAGE_KEY);
        } catch {
          // 忽略存储异常：内存状态已回到欢迎语。
        }
      }
      await refreshConversations();
    },
    [repository, refreshConversations],
  );

  /** 置顶 / 取消置顶（本地内存状态）：置顶项由侧边栏放进最上方「置顶」组。 */
  const pinConversation = useCallback(
    async (id: string, pinned: boolean) => {
      await repository.pin(id, pinned);
      await refreshConversations();
    },
    [repository, refreshConversations],
  );

  const ask = useCallback(
    async (question: string) => {
      const trimmed = question.trim();
      if (!trimmed || inFlightRef.current) return;

      inFlightRef.current = true;
      setIsAsking(true);
      const requestId = createTurnRequestId();
      /**
       * 请求级 model_id（V1.0.5.4 修复三）：
       * - 已选模型 / 注册表就绪 → 始终带上当前模型 id（含后端默认主模型）；
       * - 冷启动时注册表尚未返回 → 不发送静态兜底 id（可能与后端 .env 配置不一致，
       *   会被后端按「未知模型」拒绝），交给后端默认主模型，避免新窗口首个请求报错。
       */
      const requestModelId = resolveRequestModelId(selectedModelId, defaultModelId, modelsReady);
      const requestedModel = requestModelId;
      appendTurn({ id: `${requestId}-user`, role: "user", content: trimmed });

      try {
        const sessionId = sessionIdRef.current ?? (sessionIdRef.current = createSessionId());
        const request = buildAskRequest({
          question: trimmed,
          pathname: window.location.pathname,
          search: window.location.search,
          sessionId,
          history: transcriptRef.current,
          modelId: requestModelId,
        });
        const response = await postAsk(request);

        if (isErrorEnvelope(response)) {
          appendTurn({
            id: `${requestId}-assistant-error`,
            role: "assistant",
            content: errorMessageFromEnvelope(response),
            isError: true,
            skipHistory: true,
            answer: null,
          });
          return;
        }

        const view = answerViewFromEnvelope(response, {
          requestedModel,
        });
        if (!view) {
          const clarification = clarificationTextFromEnvelope(response);
          appendTurn({
            id: `${requestId}-assistant-clarify`,
            role: "assistant",
            content: clarification ?? "史脉需要你补充更多信息后才能回答。",
            skipHistory: true,
            answer: null,
          });
          return;
        }

        setLastAnswer(view);
        appendTurn({
          id: `${requestId}-assistant`,
          role: "assistant",
          content: view.markdown,
          answer: view,
        });
        // 动作用服务端 request_id 做前缀：模型每轮可能复用 act-1，不能触发跨轮幂等。
        await dispatchAnswerActions(view.uiActions, response.request_id);
      } catch (error) {
        const message =
          error instanceof AgentClientError ? error.message : GENERIC_ERROR;
        appendTurn({
          id: `${requestId}-assistant-error`,
          role: "assistant",
          content: message,
          isError: true,
          skipHistory: true,
          answer: null,
        });
      } finally {
        inFlightRef.current = false;
        setIsAsking(false);
      }
    },
    [appendTurn, defaultModelId, dispatchAnswerActions, modelsReady, selectedModelId],
  );

  const confirmAction = useCallback(
    async (actionId: string): Promise<DispatchResult> => {
      const result = await actionBus.confirm(actionId);
      setPendingActions((previous) => previous.filter((item) => item.id !== actionId));
      return result;
    },
    [actionBus],
  );

  const cancelAction = useCallback(
    (actionId: string) => {
      actionBus.cancel(actionId);
      setPendingActions((previous) => previous.filter((item) => item.id !== actionId));
    },
    [actionBus],
  );

  /** 侧边栏分组（置顶 / 今天 / 过去 30 天）；每次列表变化时重算。 */
  const conversationGroups = useMemo(
    () => groupConversationsByTime(conversations),
    [conversations],
  );
  const isCurrentConversationEmpty = !hasUserTurn;

  const value = useMemo<AgentSessionValue>(
    () => ({
      transcript,
      isRestored,
      isOpen,
      isAsking,
      lastAnswer,
      guide,
      pendingActions,
      currentSurface,
      actionBus,
      openDrawer,
      closeDrawer,
      toggleDrawer,
      ask,
      confirmAction,
      cancelAction,
      models,
      defaultModelId,
      selectedModelId,
      selectModel,
      modelsReady,
      modelsFromFallback,
      conversationGroups,
      activeConversationId,
      conversationsLoading,
      isCurrentConversationEmpty,
      newConversation,
      loadConversation,
      renameConversation,
      deleteConversation,
      pinConversation,
    }),
    [
      transcript,
      isRestored,
      isOpen,
      isAsking,
      lastAnswer,
      guide,
      pendingActions,
      currentSurface,
      actionBus,
      openDrawer,
      closeDrawer,
      toggleDrawer,
      ask,
      confirmAction,
      cancelAction,
      models,
      defaultModelId,
      selectedModelId,
      selectModel,
      modelsReady,
      modelsFromFallback,
      conversationGroups,
      activeConversationId,
      conversationsLoading,
      isCurrentConversationEmpty,
      newConversation,
      loadConversation,
      renameConversation,
      deleteConversation,
      pinConversation,
    ],
  );

  return <AgentSessionContext.Provider value={value}>{children}</AgentSessionContext.Provider>;
}

export function useAgentSession(): AgentSessionValue {
  const context = useContext(AgentSessionContext);
  if (context === null) {
    throw new Error("useAgentSession 必须在 <AgentProvider> 内使用");
  }
  return context;
}