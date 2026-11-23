"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";

/**
 * 健康检查默认走**同源** `/api`（由 `next.config.ts` 的 rewrites 代理到 FastAPI）。
 * 这样局域网 IP、UUMit 隧道等非 localhost 访问时，健康角标依然可用，
 * 也不会被浏览器的 Mixed Content / 跨域策略拦掉。
 * 如确实需要直连后端，构建时设置 `NEXT_PUBLIC_API_BASE=http://<host>:8000`。
 */
const API_BASE = (process.env.NEXT_PUBLIC_API_BASE ?? "").replace(/\/$/, "");

type HealthState = "checking" | "connected" | "disconnected";

export default function HomePage() {
  const [health, setHealth] = useState<HealthState>("checking");
  const [toast, setToast] = useState<string | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const controller = new AbortController();

    fetch(`${API_BASE}/api/health`, { signal: controller.signal, cache: "no-store" })
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error(String(res.status)))))
      .then((data: { ok?: boolean }) => {
        setHealth(data.ok === true ? "connected" : "disconnected");
      })
      .catch((error: unknown) => {
        if ((error as Error).name !== "AbortError") setHealth("disconnected");
      });

    return () => controller.abort();
  }, []);

  useEffect(() => () => {
    if (timerRef.current) clearTimeout(timerRef.current);
  }, []);

  const showToast = (message: string) => {
    if (timerRef.current) clearTimeout(timerRef.current);
    setToast(message);
    timerRef.current = setTimeout(() => setToast(null), 2400);
  };

  const statusText =
    health === "checking" ? "检测中…" : health === "connected" ? "后端已连接" : "后端未连接";

  return (
    <main className="page">
      <header className="hero">
        <p className="eyebrow">中国历史探索</p>
        <h1>从一个入口开始</h1>
        <p className="subtitle">
          时间轴覆盖夏—清（约前 2070—1912，含新莽、三国两晋十六国、五代辽宋夏金）；人物关系图已覆盖先秦、秦汉、三国、魏晋南北朝、隋唐、宋辽金夏与元明清。
        </p>
        <p className="version">V0.9.0 · 内测版</p>
      </header>

      <nav className="entries" aria-label="模块入口">
        <button
          type="button"
          className="entry entry-muted"
          aria-disabled="true"
          aria-describedby="chat-entry-hint"
          title="Agent 智能问答模块正在闭关开发中"
          onClick={() => showToast("Agent 智能问答模块正在闭关开发中，敬请期待！")}
        >
          <span className="entry-label">
            聊天问答
            <span className="entry-tag">开发中</span>
          </span>
          <span className="entry-hint" id="chat-entry-hint">
            Agent 智能问答 · 敬请期待
          </span>
        </button>

        <Link href="/timeline" className="entry">
          <span className="entry-label">时间轴</span>
          <span className="entry-hint">夏—清 · 逐朝浏览大事记</span>
        </Link>

        <Link href="/graph" className="entry">
          <span className="entry-label">人物关系图</span>
          <span className="entry-hint">春秋至清 · 18 期 · 2D 力导向网络</span>
        </Link>
      </nav>

      <div
        className={`status status-${health}`}
        role="status"
        aria-live="polite"
        title={
          health === "disconnected"
            ? "问答模块暂未上线；时间轴与人物关系图为纯前端数据，不依赖后端，可正常浏览。"
            : undefined
        }
      >
        <span className="dot" aria-hidden="true" />
        {statusText}
      </div>

      <div className={`toast${toast ? " toast-show" : ""}`} role="alert" aria-live="assertive">
        {toast}
      </div>
    </main>
  );
}
