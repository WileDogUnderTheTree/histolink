"use client";

/**
 * 全局悬浮抽屉（V1.0.1 / TC-07 骨架，Q1 决策）。
 *
 * - 占位内容：只显示「V1.0 开发中」与会话 transcript，不发网络请求；
 * - ESC 关闭、点击遮罩关闭、按钮带 aria-label / aria-expanded；
 * - 与 `/ask` 共享同一个 `AgentProvider` 会话（不是本地 state）。
 */
import { useEffect, useState } from "react";
import Link from "next/link";

import { useAgentSession } from "@/components/agent/AgentProvider";
import { askHref } from "@/lib/routes";

import styles from "./AgentDrawer.module.css";

export function AgentDrawer() {
  const { isOpen, openDrawer, closeDrawer, transcript, pendingActions, ask } = useAgentSession();
  const [draft, setDraft] = useState("");

  useEffect(() => {
    if (!isOpen) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.stopPropagation();
        event.preventDefault();
        closeDrawer();
      }
    };
    // 捕获阶段监听：部分浏览器扩展 / 输入法会在冒泡链上 stopPropagation，
    // 捕获阶段可确保 ESC 始终由抽屉优先处理（TC-07 手工验收要求）。
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [isOpen, closeDrawer]);

  const submit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    ask(draft);
    setDraft("");
  };

  return (
    <>
      <button
        type="button"
        className={styles.launcher}
        aria-label={isOpen ? "关闭史脉问答抽屉" : "打开史脉问答抽屉"}
        aria-expanded={isOpen}
        aria-haspopup="dialog"
        onClick={isOpen ? closeDrawer : openDrawer}
      >
        {isOpen ? "收起" : "问史脉"}
      </button>

      {isOpen ? (
        <div className={styles.overlay} role="presentation" onClick={closeDrawer}>
          <section
            className={styles.panel}
            role="dialog"
            aria-modal="true"
            aria-labelledby="shimai-agent-title"
            aria-describedby="shimai-agent-note"
            onClick={(event) => event.stopPropagation()}
          >
            <header className={styles.header}>
              <div>
                <h2 id="shimai-agent-title" className={styles.title}>
                  史脉问答
                </h2>
                <p id="shimai-agent-note" className={styles.note}>
                  V1.0 开发中：当前为壳层骨架，不调用后端、不发送网络请求。
                </p>
              </div>
              <button type="button" className={styles.close} onClick={closeDrawer} aria-label="关闭抽屉">
                ×
              </button>
            </header>

            <ol className={styles.transcript} aria-live="polite">
              {transcript.map((turn) => (
                <li key={turn.id} className={turn.role === "user" ? styles.userTurn : styles.agentTurn}>
                  <span className={styles.role}>{turn.role === "user" ? "你" : "史脉"}</span>
                  <p className={styles.content}>{turn.content}</p>
                </li>
              ))}
            </ol>

            {pendingActions.length > 0 ? (
              <div className={styles.pending} role="status">
                有 {pendingActions.length} 个跨页动作等待确认（V1.0.4 接入确认按钮）。
              </div>
            ) : null}

            <form className={styles.form} onSubmit={submit}>
              <label className={styles.srOnly} htmlFor="shimai-agent-input">
                输入问题
              </label>
              <input
                id="shimai-agent-input"
                className={styles.input}
                value={draft}
                onChange={(event) => setDraft(event.target.value)}
                placeholder="V1.0 开发中，可先输入占位"
                autoComplete="off"
              />
              <button type="submit" className={styles.send}>
                占位提问
              </button>
            </form>

            <footer className={styles.footer}>
              <Link className={styles.link} href={askHref(draft)} onClick={closeDrawer}>
                打开独立问答页 →
              </Link>
              <span className={styles.hint}>ESC 关闭</span>
            </footer>
          </section>
        </div>
      ) : null}
    </>
  );
}
