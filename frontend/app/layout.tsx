import type { Metadata } from "next";
import "./globals.css";

import { AgentDrawer } from "@/components/agent/AgentDrawer";
import { AgentProvider } from "@/contexts/AgentContext";

export const metadata: Metadata = {
  title: "中国历史探索 · V1.0.7",
  description: "中国历史探索 · V1.0.7：时间轴、人物关系图与对话驱动历史探索",
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
