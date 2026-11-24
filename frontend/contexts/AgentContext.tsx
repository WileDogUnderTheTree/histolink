"use client";

/**
 * 全局 Agent 状态（V1.0.4）。
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
  WELCOME_TURN_ID,
  answerViewFromEnvelope,
  buildAskRequest,
  clarificationTextFromEnvelope,
  createSessionId,
  errorMessageFromEnvelope,
  isErrorEnvelope,
  namespaceUiActions,
  postAsk,
  type AgentAnswerView,
  type AgentTranscriptTurn,
} from "@/lib/agent-client";
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
    const turns = parsed.filter((turn): turn is AgentTurn => {
      if (!turn || typeof turn !== "object") return false;
      const value = turn as Partial<AgentTurn>;
      return typeof value.id === "string"
        && (value.role === "user" || value.role === "assistant")
        && typeof value.content === "string";
    });
    return turns.length > 0 ? turns : [WELCOME_TURN];
  } catch {
    return [WELCOME_TURN];
  }
}

/** 每次请求独立 id：既做 transcript key，也用来给动作 id 加前缀（避免跨轮幂等冲突）。 */
function createTurnRequestId(now: () => number = Date.now): string {
  return `req_${now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
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

  const ask = useCallback(
    async (question: string) => {
      const trimmed = question.trim();
      if (!trimmed || inFlightRef.current) return;

      inFlightRef.current = true;
      setIsAsking(true);
      const requestId = createTurnRequestId();
      appendTurn({ id: `${requestId}-user`, role: "user", content: trimmed });

      try {
        const sessionId = sessionIdRef.current ?? (sessionIdRef.current = createSessionId());
        const request = buildAskRequest({
          question: trimmed,
          pathname: window.location.pathname,
          search: window.location.search,
          sessionId,
          history: transcriptRef.current,
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

        const view = answerViewFromEnvelope(response);
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
    [appendTurn, dispatchAnswerActions],
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
