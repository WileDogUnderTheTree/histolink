"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";

const API_BASE = process.env.NEXT_PUBLIC_API_BASE ?? "http://localhost:8000";

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
          时间轴覆盖夏—南北朝（含新莽、三国两晋十六国）；人物关系图已扩展至春秋、战国、秦汉与三国。
        </p>
      </header>

      <nav className="entries" aria-label="模块入口">
        <button
          type="button"
          className="entry"
          onClick={() => showToast("聊天问答模块占位，尚未实现")}
        >
          <span className="entry-label">聊天问答</span>
          <span className="entry-hint">占位 · 点击查看提示</span>
        </button>

        <Link href="/timeline" className="entry">
          <span className="entry-label">时间轴</span>
          <span className="entry-hint">夏—南北朝 · 逐朝浏览大事记</span>
        </Link>

        <Link href="/graph" className="entry">
          <span className="entry-label">人物关系图</span>
          <span className="entry-hint">春秋战国 · 秦汉 · 三国 · 2D 力导向网络</span>
        </Link>
      </nav>

      <div className={`status status-${health}`} role="status" aria-live="polite">
        <span className="dot" aria-hidden="true" />
        {statusText}
      </div>

      <div className={`toast${toast ? " toast-show" : ""}`} role="alert" aria-live="assertive">
        {toast}
      </div>
    </main>
  );
}
