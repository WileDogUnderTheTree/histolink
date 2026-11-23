"use client";

/**
 * 会话 Provider（V1.0.1 / TC-07 骨架，Q1 决策）。
 *
 * **单一会话事实源**：全局悬浮抽屉（AgentDrawer）与 `/ask` 独立页都读这一份 transcript，
 * 不允许各自 `useState`，否则 V1.0.4 会出现两个入口串消息的问题。
 *
 * V1.0.1 边界：不调用 `/api/agent/ask`、不发送任何网络请求。
 * 用户提问只会得到固定的「V1.0 开发中」占位回答；真实问答在 V1.0.3 接入。
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
import { usePathname } from "next/navigation";

import { ActionBus } from "@/lib/action-bus";
import type { UIAction, UISurface } from "@/lib/action-policy";
import { surfaceFromPathname } from "@/lib/routes";

export interface AgentTurn {
  id: string;
  role: "user" | "assistant";
  content: string;
}

export interface AgentSessionValue {
  transcript: AgentTurn[];
  isOpen: boolean;
  pendingActions: UIAction[];
  /** 当前页面对应的动作 surface（首页为 null）。 */
  currentSurface: UISurface | null;
  actionBus: ActionBus;
  openDrawer: () => void;
  closeDrawer: () => void;
  toggleDrawer: () => void;
  ask: (question: string) => void;
}

const AgentSessionContext = createContext<AgentSessionValue | null>(null);

const PLACEHOLDER_REPLY =
  "V1.0 开发中：问答与检索能力将在 V1.0.3–V1.0.5 接入。当前为壳层骨架，不会发送网络请求。";

const SEED_TRANSCRIPT: AgentTurn[] = [
  {
    id: "turn-seed",
    role: "assistant",
    content: "史脉问答骨架已就绪（V1.0.1）。问答能力将在 V1.0.3 接入，本版本只验证壳层与会话共享。",
  },
];

export function AgentProvider({ children }: Readonly<{ children: React.ReactNode }>) {
  const pathname = usePathname();
  const currentSurface = useMemo(() => surfaceFromPathname(pathname), [pathname]);

  const [transcript, setTranscript] = useState<AgentTurn[]>(SEED_TRANSCRIPT);
  const [isOpen, setIsOpen] = useState(false);
  const [pendingActions, setPendingActions] = useState<UIAction[]>([]);

  const surfaceRef = useRef<UISurface | null>(currentSurface);
  useEffect(() => {
    surfaceRef.current = currentSurface;
  }, [currentSurface]);

  const actionBusRef = useRef<ActionBus | null>(null);
  if (actionBusRef.current === null) {
    actionBusRef.current = new ActionBus(() => surfaceRef.current);
  }
  const actionBus = actionBusRef.current;

  useEffect(() => {
    const unsubscribe = actionBus.on((event) => {
      if (event.type === "confirmation-required") {
        setPendingActions((previous) =>
          previous.some((item) => item.id === event.action.id) ? previous : [...previous, event.action],
        );
      }
      if (event.type === "cancelled" || event.type === "executed") {
        setPendingActions((previous) => previous.filter((item) => item.id !== event.action.id));
      }
    });
    return unsubscribe;
  }, [actionBus]);

  const openDrawer = useCallback(() => setIsOpen(true), []);
  const closeDrawer = useCallback(() => setIsOpen(false), []);
  const toggleDrawer = useCallback(() => setIsOpen((open) => !open), []);

  const ask = useCallback((question: string) => {
    const trimmed = question.trim();
    if (!trimmed) return;
    setTranscript((previous) => {
      const nextIndex = previous.length + 1;
      return [
        ...previous,
        { id: `turn-${nextIndex}`, role: "user", content: trimmed },
        { id: `turn-${nextIndex + 1}`, role: "assistant", content: PLACEHOLDER_REPLY },
      ];
    });
  }, []);

  const value = useMemo<AgentSessionValue>(
    () => ({
      transcript,
      isOpen,
      pendingActions,
      currentSurface,
      actionBus,
      openDrawer,
      closeDrawer,
      toggleDrawer,
      ask,
    }),
    [transcript, isOpen, pendingActions, currentSurface, actionBus, openDrawer, closeDrawer, toggleDrawer, ask],
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
