import type { Metadata } from "next";

/** `/ask` 的浏览器标题：把默认的「中国历史探索」换成控制台品牌「史脉问答」。 */
export const metadata: Metadata = {
  title: "史脉问答 · 史脉 HistoLink",
  description: "史脉问答控制台：史令查阅史料，史引联动时间轴与人物关系图。",
};

export default function AskLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return children;
}
