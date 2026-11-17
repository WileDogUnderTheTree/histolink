import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "中国历史探索",
  description: "中国历史探索 · 最小全栈骨架",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  );
}
