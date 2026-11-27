import type { Metadata } from "next";
import "./globals.css";

import { SealDock } from "@/components/SealDock";
import { AgentDrawer } from "@/components/agent/AgentDrawer";
import { AgentProvider } from "@/contexts/AgentContext";

export const metadata: Metadata = {
  title: "中国历史探索 · V1.0.8",
  description: "中国历史探索 · V1.0.8：时间轴、人物关系图与对话驱动历史探索",
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
          {/* V1.0.8：左下角固定「史」字印章 + 点赞组合（全站可见）。 */}
          <SealDock />
        </AgentProvider>
      </body>
    </html>
  );
}