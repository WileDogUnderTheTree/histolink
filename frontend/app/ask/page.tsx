"use client";

/**
 * `/ask` 独立问答页（V1.0.1 / TC-07 骨架，Q1 决策）。
 *
 * - 与全局抽屉共享同一个 `AgentProvider` 会话；
 * - 读 `?q=` 展示问题占位（Next 16 要求 `useSearchParams` 处于 `<Suspense>` 内，否则 build 会报 prerender 错误）；
 * - 不调用后端、不发送网络请求（真实问答属 V1.0.3）。
 */
import { Suspense } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";

import { useAgentSession } from "@/components/agent/AgentProvider";

import styles from "./ask.module.css";

function AskPageContent() {
  const searchParams = useSearchParams();
  const question = searchParams.get("q")?.trim() ?? "";
  const { transcript, ask } = useAgentSession();

  return (
    <main className={styles.page}>
      <header className={styles.header}>
        <p className={styles.badge}>V1.0 开发中</p>
        <h1 className={styles.title}>史脉问答 · 独立页</h1>
        <p className={styles.lead}>
          这是 Q1 决策里的 `/ask` 深链接入口，与全局悬浮抽屉共用同一份会话。
          问答与检索将在 V1.0.3–V1.0.5 接入，本版本只验证壳层。
        </p>
      </header>

      <section className={styles.card} aria-labelledby="ask-question-title">
        <h2 id="ask-question-title" className={styles.cardTitle}>
          你的问题
        </h2>
        {question ? (
          <p className={styles.question} data-testid="ask-question">
            {question}
          </p>
        ) : (
          <p className={styles.empty}>未附带问题。可从页面右下角「问史脉」抽屉，或带 `?q=` 打开本页。</p>
        )}
        <button type="button" className={styles.placeholderButton} onClick={() => ask(question)} disabled={!question}>
          占位提问（不请求后端）
        </button>
      </section>

      <section className={styles.card} aria-labelledby="ask-transcript-title">
        <h2 id="ask-transcript-title" className={styles.cardTitle}>
          共享会话
        </h2>
        <ol className={styles.transcript}>
          {transcript.map((turn) => (
            <li key={turn.id} className={turn.role === "user" ? styles.userTurn : styles.agentTurn}>
              <span className={styles.role}>{turn.role === "user" ? "你" : "史脉"}</span>
              <p className={styles.turnText}>{turn.content}</p>
            </li>
          ))}
        </ol>
      </section>

      <footer className={styles.footer}>
        <Link className={styles.link} href="/timeline">
          返回时间轴
        </Link>
        <Link className={styles.link} href="/graph">
          前往人物关系图
        </Link>
      </footer>
    </main>
  );
}

export default function AskPage() {
  return (
    <Suspense fallback={<main className={styles.page}>加载中…</main>}>
      <AskPageContent />
    </Suspense>
  );
}
