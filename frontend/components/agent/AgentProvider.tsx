"use client";

/**
 * 兼容层（V1.0.4）：真实实现已迁移到 `frontend/contexts/AgentContext.tsx`。
 *
 * 保留旧路径导出，避免 V1.0.1/V1.0.3 的页面与后续文档引用失效；
 * 新代码请直接从 `@/contexts/AgentContext` 引入。
 */
export { AgentProvider, useAgentSession } from "@/contexts/AgentContext";
export type {
  AgentAnswerView,
  AgentGuide,
  AgentSessionValue,
  AgentTurn,
} from "@/contexts/AgentContext";
