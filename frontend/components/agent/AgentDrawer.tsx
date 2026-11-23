"use client";

/**
 * 全局悬浮抽屉（V1.0.1 骨架 → V1.0.4 数据层接入）。
 *
 * - 真实调用 `/api/agent/ask`（经 `AgentContext.ask`），展示服务端返回的 markdown；
 * - 同页 UI 动作由 ActionBus 自动执行；跨页动作在这里显示确认按钮；
 * - ESC 关闭、点击遮罩关闭、按钮带 aria-label / aria-expanded；
 * - 与 `/ask` 共享同一个 AgentContext 会话（不是本地 state）。
 *
 * 视觉细节由 V1.0.4 UI 卡（AgentDrawer 视觉）继续打磨；本文件只保证数据与交互可用。
 */
import { useEffect, useState } from "react";
import Link from "next/link";

import { useAgentSession } from "@/contexts/AgentContext";
import { askHref } from "@/lib/routes";

import styles from "./AgentDrawer.module.css";

export function AgentDrawer() {
  const {
    isOpen,
    openDrawer,
    closeDrawer,
    transcript,
    isAsking,
    pendingActions,
    ask,
    confirmAction,
    cancelAction,
  } = useAgentSession();
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
    if (isAsking) return;
    void ask(draft);
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
                  V1.0.4：已接入真实问答（历史数据 + 可核验引用）；跨页动作会先向你确认。
                </p>
              </div>
              <button type="button" className={styles.close} onClick={closeDrawer} aria-label="关闭抽屉">
                ×
              </button>
            </header>

            <ol className={styles.transcript} aria-live="polite">
              {transcript.map((turn) => (
                <li
                  key={turn.id}
                  className={turn.role === "user" ? styles.userTurn : styles.agentTurn}
                  data-error={turn.isError === true ? "true" : undefined}
                >
                  <span className={styles.role}>{turn.role === "user" ? "你" : "史脉"}</span>
                  <p className={styles.content}>{turn.content}</p>
                </li>
              ))}
            </ol>

            {pendingActions.length > 0 ? (
              <div className={styles.pending} role="status">
                <p>以下动作需要跨页跳转，确认后执行：</p>
                <ul>
                  {pendingActions.map((action) => (
                    <li key={action.id}>
                      <span>{action.label}</span>
                      <button type="button" onClick={() => void confirmAction(action.id)}>
                        前往
                      </button>
                      <button type="button" onClick={() => cancelAction(action.id)}>
                        取消
                      </button>
                    </li>
                  ))}
                </ul>
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
                placeholder="例如：赤壁之战发生在哪一年？"
                autoComplete="off"
                disabled={isAsking}
              />
              <button type="submit" className={styles.send} disabled={isAsking}>
                {isAsking ? "思考中…" : "提问"}
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

