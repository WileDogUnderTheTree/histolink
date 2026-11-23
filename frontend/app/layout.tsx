import type { Metadata } from "next";
import "./globals.css";

import { AgentDrawer } from "@/components/agent/AgentDrawer";
import { AgentProvider } from "@/components/agent/AgentProvider";

export const metadata: Metadata = {
  title: "中国历史探索 · V1.0.1",
  description: "中国历史探索 · V1.0.1：时间轴、2D 人物关系图与 Agent 前置基建",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="zh-CN">
      <body>
        <AgentProvider>
          {children}
          <AgentDrawer />
        </AgentProvider>
      </body>
    </html>
  );
}
