"use client";

import { useEffect, useRef, useState } from "react";

const API_BASE = process.env.NEXT_PUBLIC_API_BASE ?? "http://localhost:8000";

type HealthState = "checking" | "connected" | "disconnected";

const ENTRIES = [
  { key: "ask", label: "聊天问答", hint: "聊天问答模块占位，尚未实现" },
  { key: "timeline", label: "时间轴", hint: "时间轴模块占位，尚未实现" },
  { key: "people", label: "人物查找", hint: "人物查找模块占位，尚未实现" },
] as const;

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
        <p className="subtitle">当前仅交付导航骨架，四个业务模块均未实现。</p>
      </header>

      <nav className="entries" aria-label="模块入口">
        {ENTRIES.map((entry) => (
          <button
            key={entry.key}
            type="button"
            className="entry"
            onClick={() => showToast(entry.hint)}
          >
            <span className="entry-label">{entry.label}</span>
            <span className="entry-hint">占位 · 点击查看提示</span>
          </button>
        ))}
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
