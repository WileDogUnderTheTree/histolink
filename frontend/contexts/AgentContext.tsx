"use client";

/**
 * 全局 Agent 状态（V1.0.4；V1.0.5.2 模型选择 + 历史对话侧边栏；V1.0.6 真实持久化 + 多轮记忆）。
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
 * 5. `models` / `selectedModelId` / `selectModel()`：输入框左上角模型切换窗口的数据源；
 * 6. `conversations` / `newConversation()` / `loadConversation()`：历史对话侧边栏数据层。
 *
 * V1.0.6 职责（本版重点）：
 * 7. **真实持久化**：侧边栏 `/api/sessions` 真实数据（`lib/session-client.ts` + HTTP 仓库）；
 *    点击历史 = `GET /api/sessions/{id}` 恢复完整聊天记录（含引用 / 联动动作 / 对比分析）；
 * 8. **刷新不丢会话**：当前 `session_id` 写入 `localStorage`（`histolink.agent.session.v1`），
 *    刷新后按 id 从服务端恢复；服务端不可达时回退到 `sessionStorage` 的本标签页 transcript；
 * 9. **多轮记忆**：会话历史与实体状态由后端 SessionStore 维护（前端继续随请求附带 history
 *    作为首次迁移兜底，已存在服务端会话时以服务端为准）。
 *
 * 安全：只展示服务端返回的 `answer.markdown` / 结构化字段，前端不拼接、不改写回答文本。
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
import { resolveGuideTargetsFromTranscript } from "@/lib/agent-guide";
import type { AgentGuide, AgentGuideTargets } from "@/lib/agent-guide";
import type { UIAction, UISurface } from "@/lib/action-policy";
import {
  AgentClientError,
  FALLBACK_MODEL_OPTIONS,
  WELCOME_TURN_ID,
  buildChatStreamRequest,
  createSessionId,
  fetchAgentModels,
  namespaceUiActions,
  normalizeRestoredAnswerView,
  postChatStream,
  resolveRequestModelId,
  streamedAnswerView,
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
import {
  clearStoredSessionId,
  createDisposableSessionId,
  isDisposableSessionId,
  readStoredSessionId,
  readTestSessionIdFromSearch,
  writeStoredSessionId,
} from "@/lib/session-client";
import { surfaceFromPathname } from "@/lib/routes";

export type { AgentAnswerView, AgentGuide, AgentGuideTargets };

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
  /**
   * V1.0.6.3 双图联动：同一轮回答的时间轴 / 人物图联动目标集合。
   * `/ask` 与悬浮抽屉据此并排渲染两个联动按钮，并切换右侧面板视图。
   */
  guideTargets: AgentGuideTargets | null;
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
  /**
   * V1.0.6.2「深度思考」开关（替换原「逐字回答」开关，语义反转）。
   *
   * - **默认关闭**：走快速直答链路（`POST /api/agent/chat_stream`，不开启模型思考），
   *   直接输出最终答案、首字最快；
   * - **开启**：请求体带 `enable_thinking=true`，服务端允许上游先推理再回答并追加
   *   Prompt 级推理约束；思考过程由服务端过滤，前端仍只展示最终答案。
   * 选择记忆在 `sessionStorage`（本标签页内生效，不清空对话）。
   */
  thinkingEnabled: boolean;
  setThinkingEnabled: (enabled: boolean) => void;
  /** 当前是否处于直答流式生成中（`isAsking` 的子状态，用于渲染「生成中」而不是「检索中」）。 */
  isStreaming: boolean;
  /** 正在流式输出的 assistant 轮次 id（null 表示不在流式中），供页面渲染光标。 */
  streamingTurnId: string | null;
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

  // ---- V1.0.5.2 历史对话侧边栏（V1.0.6：真实服务端历史） ----
  /** 按「今天 / 过去 30 天」分组后的历史对话（来自 `/api/sessions`）。 */
  conversationGroups: ConversationGroup[];
  /** 当前活动会话 id；null 表示尚未产生消息的本地新会话。 */
  activeConversationId: string | null;
  /** 侧边栏数据是否加载完成。 */
  conversationsLoading: boolean;
  /** 当前会话是否为空（只有欢迎语）→「新建对话」选中态。 */
  isCurrentConversationEmpty: boolean;
  /** 新建对话：服务端创建空会话、清空 transcript、开启新会话（列表最上方）。 */
  newConversation: () => Promise<void>;
  /** 加载历史对话：服务端取完整轮次；**不改变该条目的列表位置与排序时间**。 */
  loadConversation: (id: string) => Promise<void>;
  /** 重命名历史对话（PATCH，锁定标题、不改变列表位置）。 */
  renameConversation: (id: string, title: string) => Promise<void>;
  /** 删除历史对话（DELETE；若删的是当前会话则回到欢迎语）。 */
  deleteConversation: (id: string) => Promise<void>;
  /** 置顶 / 取消置顶历史对话（PATCH；置顶项移到列表最上方「置顶」组）。 */
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
/** V1.0.6.2：深度思考开关只在本标签页内记忆（默认关闭，快速直答开箱即用）。 */
const THINKING_STORAGE_KEY = "histolink.agent.thinking.v1";

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

/** 读取「深度思考」开关（V1.0.6.2）：默认关闭；显式存过 "1" 才开启。 */
function loadStoredThinkingEnabled(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return window.sessionStorage.getItem(THINKING_STORAGE_KEY) === "1";
  } catch {
    return false;
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
  // V1.0.6.2：深度思考状态（开关 / 是否流式中 / 正在输出的轮次 id）。
  const [thinkingEnabled, setThinkingEnabledState] = useState(false);
  const [isStreaming, setIsStreaming] = useState(false);
  const [streamingTurnId, setStreamingTurnId] = useState<string | null>(null);
  const thinkingEnabledRef = useRef(false);
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

  // ---- V1.0.5.2 历史对话侧边栏状态（V1.0.6：真实服务端数据） ----
  const repository = useRef(getDefaultConversationRepository()).current;
  const [conversations, setConversations] = useState<ConversationSummary[]>([]);
  const [activeConversationId, setActiveConversationId] = useState<string | null>(null);
  const [conversationsLoading, setConversationsLoading] = useState(true);
  const activeConversationIdRef = useRef<string | null>(null);
  /** 当前会话 id（V1.0.6：mount 时从 localStorage 恢复，否则新生成；首次提问时落库）。 */
  const sessionIdRef = useRef<string | null>(null);
  /**
   * V1.0.6.2 E2E 测试会话（`/ask?session_id=e2e_xxx`）：命中测试前缀时只写后端
   * **独立测试库**，不进入用户正式历史、也不写入 localStorage。
   */
  const testSessionIdRef = useRef<string | null>(null);
  /** 已写入仓库的 transcript 签名 / 轮次数：决定是否需要同步、以及是否属于「新消息」。 */
  const syncedTurnsSignatureRef = useRef<string>(transcriptSignature([WELCOME_TURN]));
  const syncedTurnCountRef = useRef<number>(1);

  /**
   * 史引副驾驶联动目标（P2）：任何一轮回答落地后自动更新。
   * `/ask` 页面只消费这个值并展开面板，不再自己解析动作 / 深链接。
   */
  const guideTargets = useMemo<AgentGuideTargets | null>(
    () => resolveGuideTargetsFromTranscript(transcript),
    [transcript],
  );
  /** 兼容旧调用方的单目标视图（= guideTargets 主目标）。 */
  const guide = useMemo<AgentGuide | null>(() => {
    if (!guideTargets) return null;
    return {
      ...guideTargets.primary,
      turnId: guideTargets.turnId,
      targets: guideTargets.targets,
    };
  }, [guideTargets]);

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
  // V1.0.6.2 收尾：后端冷启动 / Next 代理抖动时首次读取可能失败，静默重试一次，
  // 避免模型切换窗口一直停留在静态兜底的 Qwen 表（与本地 Ollama 实际白名单不符）。
  useEffect(() => {
    const controller = new AbortController();
    let retryTimer: number | null = null;

    const applyModels = (state: Awaited<ReturnType<typeof fetchAgentModels>>) => {
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
    };

    const load = (attempt: number) => {
      void fetchAgentModels({ signal: controller.signal })
        .then((state) => {
          if (controller.signal.aborted) return;
          if (state.fromFallback && attempt === 0) {
            // 先渲染静态兜底表保证 UI 可用；1.2s 后静默重试一次真实注册表。
            applyModels(state);
            retryTimer = window.setTimeout(() => load(1), 1200);
            return;
          }
          applyModels(state);
        })
        .catch(() => {
          if (controller.signal.aborted) return;
          setModels(FALLBACK_MODEL_OPTIONS);
          setDefaultModelId(FALLBACK_MODEL_OPTIONS[0]?.id ?? null);
          setSelectedModelId((previous) => previous ?? FALLBACK_MODEL_OPTIONS[0]?.id ?? null);
          setModelsFromFallback(true);
          setModelsReady(true);
        });
    };

    load(0);
    return () => {
      controller.abort();
      if (retryTimer !== null) window.clearTimeout(retryTimer);
    };
  }, []);

  /**
   * 首屏恢复（V1.0.6）：session_id + 真实聊天记录都从服务端恢复。
   *
   * 顺序（任何一步失败都不阻塞页面）：
   * 1. 读取 `localStorage` 里持久化的 `session_id`（刷新 / 新标签页后 session 不丢）；
   *    若 URL 带 `?session_id=e2e_...`（E2E 测试会话）则优先使用，且只写后端测试库；
   * 2. 先用 `sessionStorage` 的 transcript 兜底渲染（后端不可达时仍能看到本次对话）；
   * 3. 拉取真实历史列表；若持久化的 session_id 在服务端存在 → 用服务端轮次覆盖恢复；
   *    不存在（例如刚清理过脏数据）→ 清掉失效 id、生成新 id，下次提问重新落库；
   * 4. 完成后 `isRestored=true`，之后才写回 sessionStorage、允许真实数据渲染。
   *
   * 首帧仍渲染欢迎语（SSR / 客户端一致，避免 hydration mismatch）。
   */
  useEffect(() => {
    let cancelled = false;
    const testSessionId = readTestSessionIdFromSearch(window.location.search);
    testSessionIdRef.current = testSessionId;
    const storedSessionId = readStoredSessionId();
    const usableStoredSessionId =
      storedSessionId && !isDisposableSessionId(storedSessionId) ? storedSessionId : null;
    if (testSessionId) {
      sessionIdRef.current = testSessionId;
    } else if (!sessionIdRef.current) {
      sessionIdRef.current = usableStoredSessionId ?? createSessionId();
    }
    if (storedSessionId && isDisposableSessionId(storedSessionId)) {
      // 上一次 E2E 遗留的测试会话 id：绝不持久化 / 恢复。
      clearStoredSessionId();
    }
    setTranscript(loadStoredTranscript());

    const restore = async () => {
      try {
        try {
          const items = await repository.list();
          if (!cancelled) setConversations(items);
        } catch {
          // 侧边栏读取失败不阻塞问答；保持空列表，用户仍可提问。
        } finally {
          if (!cancelled) setConversationsLoading(false);
        }

        const restoreSessionId = testSessionId ?? usableStoredSessionId;
        if (restoreSessionId && restoreSessionId === sessionIdRef.current) {
          const record = await repository.get(restoreSessionId);
          if (cancelled) return;
          if (!record) {
            // 会话已不存在（例如用户正式库刚被清理脚本清空）：丢弃失效 id，重新开始。
            if (!testSessionId) {
              clearStoredSessionId();
              sessionIdRef.current = createSessionId();
            }
            return;
          }
          activeConversationIdRef.current = record.id;
          setActiveConversationId(record.id);
          if (record.turns.length > 0) {
            const nextTranscript = record.turns.map((turn) => ({ ...turn }));
            syncedTurnsSignatureRef.current = transcriptSignature(nextTranscript);
            syncedTurnCountRef.current = nextTranscript.length;
            setTranscript(nextTranscript);
            setLastAnswer(
              [...nextTranscript].reverse().find((turn) => turn.answer)?.answer ?? null,
            );
          }
        }
      } finally {
        if (!cancelled) setIsRestored(true);
      }
    };
    void restore();
    return () => {
      cancelled = true;
    };
  }, [repository]);

  useEffect(() => {
    if (!isRestored) return;
    try {
      window.sessionStorage.setItem(TRANSCRIPT_STORAGE_KEY, JSON.stringify(transcript));
    } catch {
      // Storage may be disabled or full; the in-memory transcript remains authoritative.
    }
  }, [transcript, isRestored]);

  /**
   * 当前会话 id 持久化（V1.0.6）：刷新页面后 `readStoredSessionId` 据此恢复。
   * V1.0.6.2：E2E 测试会话（test_ / e2e_ 前缀）只写后端测试库，不污染用户 localStorage。
   */
  useEffect(() => {
    if (!isRestored) return;
    if (!activeConversationId) return;
    if (isDisposableSessionId(activeConversationId)) {
      clearStoredSessionId();
      return;
    }
    writeStoredSessionId(activeConversationId);
  }, [activeConversationId, isRestored]);

  const hasUserTurn = transcript.some((turn) => turn.role === "user");
  /**
   * 内存仓库专用同步（单测 / 离线兜底）。
   *
   * V1.0.6 默认 HTTP 仓库不回写正文：服务端在 `POST /api/agent/ask` 成功后原子写入轮次，
   * 前端若再 `save()` 会造成重复 / 覆盖。这里只对 `kind === "memory"` 的仓库执行旧逻辑。
   *
   * 内存仓库规则（V1.0.5.2-layout 补丁保留）：
   * - 列表顺序只由【创建时间 / 最后一条消息发送时间】决定；
   * - **只有会话里真的新增了消息**才调用 `save`（刷新 `updatedAt`）；
   * - 加载 / 切换会话用 `syncTurns`（不刷新时间）。
   */
  useEffect(() => {
    if (repository.kind !== "memory") return;
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
    void repository.create({ turns: storedTurns }).then((record) => {
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

  const inFlightRef = useRef(false);

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
   * 「深度思考」开关（V1.0.6.2，替换原「逐字回答」并反转语义）。
   *
   * - 默认关闭：快速直答（不开启模型思考），直接输出最终答案；
   * - 主动开启：下一次请求带 `enable_thinking=true`，模型先推理再回答（更准但稍慢），
   *   思考过程由服务端过滤，前端只展示最终答案；两者共用同一 transcript / 会话库。
   */
  const setThinkingEnabled = useCallback((enabled: boolean) => {
    thinkingEnabledRef.current = enabled;
    setThinkingEnabledState(enabled);
    try {
      window.sessionStorage.setItem(THINKING_STORAGE_KEY, enabled ? "1" : "0");
    } catch {
      // 存储不可用只影响「刷新后记忆」，不影响当前选择。
    }
  }, []);

  // 首屏挂载后读取本标签页记忆（首帧保持默认值，避免 SSR / 客户端不一致）。
  useEffect(() => {
    const stored = loadStoredThinkingEnabled();
    thinkingEnabledRef.current = stored;
    setThinkingEnabledState(stored);
  }, []);

  /**
   * 新建对话（V1.0.5.2；V1.0.6 改为服务端真实会话）。
   *
   * 用户点击「+ 新建对话」时：
   * 1. 生成新的 `session_id`（写入 localStorage，保证刷新后仍指向新会话）；
   * 2. `POST /api/sessions` 创建空会话 → 出现在列表最上方；后端不可达时退化为纯本地
   *    新会话（首次提问时再由服务端懒创建）；
   * 3. 中间聊天区清空回欢迎语状态（`WELCOME_TURN`），滚动由页面负责回位。
   *
   * 若当前已经是空白新会话则不重复创建，避免列表里出现多条空标题。
   */
  const newConversation = useCallback(async () => {
    const activeId = activeConversationIdRef.current;
    const currentTurns = transcriptRef.current;
    const currentHasUserTurn = currentTurns.some((turn) => turn.role === "user");
    if (activeId && !currentHasUserTurn) {
      setPendingActions([]);
      setLastAnswer(null);
      return;
    }
    if (activeId && repository.kind === "memory") {
      // 内存仓库：切换前同步正文，不刷新排序时间。
      await repository.syncTurns(activeId, toStoredTurns(currentTurns));
    }

    const nextSessionId = testSessionIdRef.current
      ? createDisposableSessionId("e2e_")
      : createSessionId();
    sessionIdRef.current = nextSessionId;
    let nextActiveId: string | null = null;
    try {
      const record = await repository.create({ id: nextSessionId, turns: [] });
      nextActiveId = record.id;
    } catch {
      // 后端不可达 / 创建失败：保留本地 session_id，首次提问时再尝试落库。
      nextActiveId = null;
    }

    activeConversationIdRef.current = nextActiveId;
    setActiveConversationId(nextActiveId);
    if (nextActiveId && !isDisposableSessionId(nextActiveId)) {
      writeStoredSessionId(nextActiveId);
    } else {
      clearStoredSessionId();
    }
    syncedTurnsSignatureRef.current = transcriptSignature([WELCOME_TURN]);
    syncedTurnCountRef.current = 1;
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
   * 加载历史对话（V1.0.5.2；V1.0.6 从服务端恢复完整聊天记录）。
   *
   * 关键行为：点击查看只切换当前会话与高亮，**绝不改变该条目的物理位置**——
   * 服务端读取不会刷新 `updatedAt`，前端也只登记签名、不触发任何回写。
   */
  const loadConversation = useCallback(
    async (id: string) => {
      const currentId = activeConversationIdRef.current;
      if (currentId === id) return;
      if (currentId && repository.kind === "memory") {
        await repository.syncTurns(currentId, toStoredTurns(transcriptRef.current));
      }
      const record = await repository.get(id);
      if (!record) {
        // 会话已被删除 / 后端不可达：以服务端列表为准，保持当前会话不变。
        await refreshConversations();
        return;
      }
      const turns: AgentTurn[] = record.turns.map((turn) => ({ ...turn }));
      const nextTranscript = turns.length > 0 ? turns : [WELCOME_TURN];
      activeConversationIdRef.current = record.id;
      syncedTurnsSignatureRef.current = transcriptSignature(nextTranscript);
      syncedTurnCountRef.current = nextTranscript.length;
      setActiveConversationId(record.id);
      if (isDisposableSessionId(record.id)) {
        clearStoredSessionId();
      } else {
        writeStoredSessionId(record.id);
      }
      setTranscript(nextTranscript);
      setPendingActions([]);
      setLastAnswer(
        [...turns].reverse().find((turn) => turn.answer)?.answer ?? null,
      );
      await refreshConversations();
    },
    [repository, refreshConversations],
  );

  /** 重命名历史对话（PATCH）：只改标题并锁定，不改变列表位置。 */
  const renameConversation = useCallback(
    async (id: string, title: string) => {
      await repository.rename(id, title);
      await refreshConversations();
    },
    [repository, refreshConversations],
  );

  /** 删除历史对话（DELETE）：删除当前会话时回到空白欢迎态并生成新的 session_id。 */
  const deleteConversation = useCallback(
    async (id: string) => {
      await repository.remove(id);
      if (activeConversationIdRef.current === id) {
        activeConversationIdRef.current = null;
        sessionIdRef.current = testSessionIdRef.current
          ? createDisposableSessionId("e2e_")
          : createSessionId();
        clearStoredSessionId();
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

  /** 置顶 / 取消置顶（PATCH）：置顶项由侧边栏放进最上方「置顶」组。 */
  const pinConversation = useCallback(
    async (id: string, pinned: boolean) => {
      await repository.pin(id, pinned);
      await refreshConversations();
    },
    [repository, refreshConversations],
  );

  /**
   * V1.0.6.2 直答链路：把一轮问答交给 `POST /api/agent/chat_stream`（SSE）。
   *
   * - 「深度思考」关闭（默认）与开启都走这条链路，区别只在请求参数
   *   `enable_thinking` 与服务端 Prompt 约束：关闭时最快出最终答案，开启时先推理再回答；
   * - 先落一个空的 assistant 占位轮次，随后按帧刷新内容（requestAnimationFrame 合帧，
   *   避免每个 token 一次 setState 造成渲染抖动）；
   * - 服务端已过滤思考过程、并做了重复循环治理，这里只展示最终答案；完成后由服务端写入会话库；
   * - **痛点 1**：`done.ui_actions` 是服务端意图后置推断出的联动动作，挂到 `answer.streamed`
   *   视图上，`resolveGuideFromTranscript` 据此自动展开右侧史引（不再要求模型自己输出动作）；
   * - 错误（含流中 `error` 事件）落到同一个占位轮次，标记 `isError`。
   */
  const runStreamingAsk = useCallback(
    async (params: {
      question: string;
      requestId: string;
      sessionId: string;
      requestModelId: string | null;
      enableThinking: boolean;
    }) => {
      const assistantId = `${params.requestId}-assistant`;
      appendTurn({ id: assistantId, role: "assistant", content: "", answer: null });
      setStreamingTurnId(assistantId);
      setIsStreaming(true);

      let pending = "";
      let frame: number | null = null;
      const hasRaf =
        typeof window !== "undefined" && typeof window.requestAnimationFrame === "function";
      const flush = () => {
        frame = null;
        const text = pending;
        setTranscript((previous) =>
          previous.map((turn) =>
            turn.id === assistantId ? { ...turn, content: text } : turn,
          ),
        );
      };
      const schedule = () => {
        if (frame !== null) return;
        frame = hasRaf
          ? window.requestAnimationFrame(flush)
          : (window.setTimeout(flush, 50) as unknown as number);
      };
      const cancelPendingFrame = () => {
        if (frame === null) return;
        if (hasRaf) window.cancelAnimationFrame(frame);
        else window.clearTimeout(frame);
        frame = null;
      };

      try {
        const request = buildChatStreamRequest({
          question: params.question,
          sessionId: params.sessionId,
          history: transcriptRef.current,
          modelId: params.requestModelId,
          enableThinking: params.enableThinking,
        });
        let done;
        try {
          done = await postChatStream(request, {
            onDelta: (_delta, full) => {
              pending = full;
              schedule();
            },
          });
        } catch (error) {
          /**
           * V1.0.6.2 收尾兜底：极少数情况下前端仍可能带着一个后端白名单里没有的
           * model_id（冷启动注册表抖动 / 后端模型配置刚切换）。400「未知模型」发生在
           * 流开始之前，可安全地去掉 model_id 重试一次，交给后端默认主模型。
           */
          const unknownModel =
            error instanceof AgentClientError &&
            error.status === 400 &&
            error.message.includes("未知模型");
          if (!unknownModel) throw error;
          done = await postChatStream(
            { ...request, model_id: undefined },
            {
              onDelta: (_delta, full) => {
                pending = full;
                schedule();
              },
            },
          );
        }
        cancelPendingFrame();
        /**
         * V1.0.6.2 专项修复（痛点 1）：服务端在 `done.ui_actions` 里下发了
         * 「意图后置推断」出的联动动作（事件 / 人物 / 关系 → 快照 ID）。
         * 有动作时构造 `streamed=true` 的 answer view：
         * - `resolveGuideFromTranscript` 据此自动展开右侧史引副驾驶；
         * - 气泡显示「逐字直答 / 史引已联动」，不冒充「已核验」（直答没有证据校验）。
         */
        const view = streamedAnswerView(done, {
          requestId: done.requestId || params.requestId,
          modelRequested: params.requestModelId,
        });
        setTranscript((previous) =>
          previous.map((turn) =>
            turn.id === assistantId
              ? { ...turn, content: done.answer, answer: view }
              : turn,
          ),
        );
        setLastAnswer(view);
        if (view) {
          // 同页动作（例如在 /timeline 上问事件）走 ActionBus 自动执行；/ask 上由页面自动展开史引。
          const sameSurfaceActions = currentSurface
            ? view.uiActions.filter(
                (action) => action.target.surface === currentSurface,
              )
            : [];
          if (sameSurfaceActions.length > 0) {
            await dispatchAnswerActions(
              sameSurfaceActions,
              done.requestId || params.requestId,
            );
          }
        }
        if (repository.kind === "remote") {
          if (activeConversationIdRef.current !== params.sessionId) {
            activeConversationIdRef.current = params.sessionId;
            setActiveConversationId(params.sessionId);
            if (isDisposableSessionId(params.sessionId)) {
              clearStoredSessionId();
            } else {
              writeStoredSessionId(params.sessionId);
            }
          }
          void refreshConversations();
        }
      } catch (error) {
        cancelPendingFrame();
        const message = error instanceof AgentClientError ? error.message : GENERIC_ERROR;
        setTranscript((previous) =>
          previous.map((turn) =>
            turn.id === assistantId
              ? { ...turn, content: message, isError: true, skipHistory: true }
              : turn,
          ),
        );
      } finally {
        setIsStreaming(false);
        setStreamingTurnId(null);
      }
    },
    [appendTurn, currentSurface, dispatchAnswerActions, refreshConversations, repository],
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
      const requestModelId = resolveRequestModelId(
        selectedModelId,
        defaultModelId,
        modelsReady,
        modelsFromFallback,
      );
      appendTurn({ id: `${requestId}-user`, role: "user", content: trimmed });

      try {
        const sessionId =
          sessionIdRef.current ??
          (sessionIdRef.current = testSessionIdRef.current
            ? createDisposableSessionId("e2e_")
            : createSessionId());
        /**
         * V1.0.6.2：统一的 SSE 直答链路。
         * - 深度思考关闭（默认）：`enable_thinking=false`，直接出最终答案、速度最快；
         * - 深度思考开启：`enable_thinking=true`，服务端允许上游先推理再回答（思考过程过滤）。
         */
        await runStreamingAsk({
          question: trimmed,
          requestId,
          sessionId,
          requestModelId,
          enableThinking: thinkingEnabledRef.current,
        });
      } finally {
        inFlightRef.current = false;
        setIsAsking(false);
      }
    },
    [
      appendTurn,
      defaultModelId,
      modelsFromFallback,
      modelsReady,
      resolveRequestModelId,
      runStreamingAsk,
      selectedModelId,
    ],
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
      thinkingEnabled,
      setThinkingEnabled,
      isStreaming,
      streamingTurnId,
      lastAnswer,
      guide,
      guideTargets,
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
      thinkingEnabled,
      setThinkingEnabled,
      isStreaming,
      streamingTurnId,
      lastAnswer,
      guide,
      guideTargets,
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
