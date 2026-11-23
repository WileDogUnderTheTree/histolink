import type { Metadata } from "next";
import "./globals.css";

import { AgentDrawer } from "@/components/agent/AgentDrawer";
import { AgentProvider } from "@/components/agent/AgentProvider";

export const metadata: Metadata = {
  title: "中国历史探索 · V0.9.0 内测版",
  description: "中国历史探索 · V0.9.0 内测版：时间轴与 2D 人物关系图",
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
