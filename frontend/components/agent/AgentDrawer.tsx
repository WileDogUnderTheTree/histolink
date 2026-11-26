"use client";

/** V1.0.4 Agent UI：数据由 AgentContext / ActionBus 提供，组件负责视觉呈现。 */
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";

import { BrandMark } from "@/components/BrandMark";
import { GuideActionButtons } from "@/components/agent/GuideActionButtons";
import { MarkdownMessage } from "@/components/agent/MarkdownMessage";
import { ModelSwitcher } from "@/components/agent/ModelSwitcher";
import { useAgentSession } from "@/contexts/AgentContext";
import {
  MODEL_FALLBACK_HINT,
  shouldShowModelFallbackHint,
  type Citation,
} from "@/lib/agent-client";
import { resolveAnswerGuideTargets } from "@/lib/agent-guide";
import { graphHref, timelineHref } from "@/lib/routes";

import styles from "./AgentDrawer.module.css";

function citationHref(citation: Citation): string | null {
  if (citation.event_id) return timelineHref({ event: citation.event_id, mode: "detail" });
  if (citation.person_id) return graphHref({ person: citation.person_id, mode: "detail" });
  return null;
}

function CitationCards({ citations, onNavigate }: { citations: Citation[]; onNavigate?: () => void }) {
  if (citations.length === 0) return null;
  const [expanded, setExpanded] = useState(false);
  const visibleCitations = expanded ? citations : citations.slice(0, 3);
  return (
    <div className={styles.citations} aria-label="回答引用">
      <div className={styles.citationsHeading}><span className={styles.citationsRule} /><span>史料来源</span></div>
      <div className={styles.citationList}>
        {visibleCitations.map((citation) => {
          const href = citationHref(citation);
          const book = citation.source_ref?.book ?? citation.source_label ?? citation.title;
          const label = `引自《${book}》`;
          const content = (
            <>
              <span className={styles.citationMark}>⌁</span>
              <span className={styles.citationBody}>
                <strong>[{label}]</strong>
                <small>{citation.title}{citation.year ? ` · ${citation.year}年` : ""}</small>
              </span>
              {href ? <span className={styles.citationArrow}>↗</span> : null}
            </>
          );
          return href ? (
            <Link className={styles.citation} href={href} key={citation.id} title={citation.quote ?? label} onClick={onNavigate}>{content}</Link>
          ) : (
            <span className={styles.citation} key={citation.id} title={citation.quote ?? label}>{content}</span>
          );
        })}
      </div>
      {citations.length > 3 ? <button type="button" className={styles.expandCitations} onClick={() => setExpanded((value) => !value)}>{expanded ? "收起引用" : `展开全部 ${citations.length} 条引用`}</button> : null}
      <p className={styles.attribution}>资料来源：史脉历史数据 · CC BY-NC-SA 4.0</p>
    </div>
  );
}

function Persona({ guide }: { guide: boolean }) {
  return (
    <span className={`${styles.persona} ${guide ? styles.guidePersona : ""}`}>
      <span className={styles.personaIcon} aria-hidden="true">{guide ? "引" : "令"}</span>
      <span>{guide ? "史引" : "史令"}</span>
    </span>
  );
}

function ActionPrompt({
  onOpenCopilot,
}: {
  onOpenCopilot: () => void;
}) {
  return (
    <aside className={styles.pending} aria-live="polite">
      <div className={styles.pendingHeader}><span className={styles.pendingIcon} aria-hidden="true">引</span><div><strong>史引副驾驶已就绪</strong><p>将在完整对话中原地展开历史脉络。</p></div></div>
      <div className={styles.pendingActions}>
        <button type="button" className={styles.confirmButton} onClick={onOpenCopilot}>展开史引副驾驶</button>
      </div>
    </aside>
  );
}

export function AgentDrawer() {
  const { isOpen, openDrawer, closeDrawer, transcript, isAsking, pendingActions, ask, cancelAction,
    models, defaultModelId, selectedModelId, selectModel, modelsReady, modelsFromFallback,
    thinkingEnabled, streamingTurnId } = useAgentSession();
  const router = useRouter();
  const pathname = usePathname();
  const [draft, setDraft] = useState("");
  const [isEmbedded, setIsEmbedded] = useState(false);
  const transcriptRef = useRef<HTMLOListElement>(null);
  const latestAssistantId = [...transcript].reverse().find((turn) => turn.role === "assistant")?.id;
  const latestActionTurnId = [...transcript].reverse().find((turn) => turn.role === "assistant" && Boolean(turn.answer?.uiActions.length))?.id;
  const actionAnchorId = latestActionTurnId ?? latestAssistantId;

  useEffect(() => {
    setIsEmbedded(window.self !== window.top);
  }, []);

  useEffect(() => {
    if (!isOpen) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") { event.stopPropagation(); event.preventDefault(); closeDrawer(); }
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [isOpen, closeDrawer]);

  useEffect(() => {
    const list = transcriptRef.current;
    if (list) list.scrollTo({ top: list.scrollHeight, behavior: "smooth" });
  }, [transcript, isAsking, pendingActions]);

  const submit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (isAsking) return;
    void ask(draft);
    setDraft("");
  };

  const openFullChat = () => {
    pendingActions.forEach((action) => cancelAction(action.id));
    closeDrawer();
    router.push("/ask");
  };

  /**
   * V1.0.6.3 双图联动（悬浮抽屉）：点击「查看人物图谱 / 查看时间轴」后，
   * 关闭抽屉并带 `?panel=<surface>` 跳到完整对话页——/ask 会据此直接展开
   * 对应视图的右侧史引面板（与页内按钮行为一致）。
   */
  const openGuideInFullChat = (surface: "timeline" | "graph") => {
    pendingActions.forEach((action) => cancelAction(action.id));
    closeDrawer();
    router.push(`/ask?panel=${surface}`);
  };

  // /ask 是完整对话页：页内已有「悬浮问答」入口，隐藏全局悬浮球，避免压住右侧史引副驾驶面板。
  const hideLauncher = pathname === "/ask";

  if (isEmbedded) return null;

  return (
    <>
      {hideLauncher ? null : (
        <button type="button" className={styles.launcher} aria-label={isOpen ? "关闭史脉问答抽屉" : "打开史脉问答抽屉"} aria-expanded={isOpen} aria-haspopup="dialog" onClick={isOpen ? closeDrawer : openDrawer}>
          <span className={styles.launcherIcon} aria-hidden="true">✦</span><span>{isOpen ? "收起问答" : "问史脉"}</span>
        </button>
      )}

      {isOpen ? (
        <div className={styles.overlay} role="presentation" onClick={closeDrawer}>
          <section className={styles.panel} role="dialog" aria-modal="true" aria-labelledby="shimai-agent-title" aria-describedby="shimai-agent-note" onClick={(event) => event.stopPropagation()}>
            <header className={styles.header}>
              <div className={styles.brand}>
                <BrandMark className={styles.brandIcon} size={42} />
                <div><div className={styles.kicker}>SHIMAI · AGENT</div><h2 id="shimai-agent-title" className={styles.title}>史脉问答</h2><p id="shimai-agent-note" className={styles.note}>从史料出发，给每个答案留下出处。</p></div>
              </div>
              <div className={styles.headerActions}>
                <button type="button" className={styles.fullChat} onClick={openFullChat} aria-label="打开完整对话页面">
                  <span aria-hidden="true">↗</span><span>完整对话</span>
                </button>
                <button type="button" className={styles.close} onClick={closeDrawer} aria-label="关闭抽屉"><span aria-hidden="true">×</span></button>
              </div>
            </header>

            <div className={styles.statusLine}><span className={styles.statusDot} aria-hidden="true" /><span>史脉数据已连接</span><span className={styles.statusVersion}>{thinkingEnabled ? "V1.0.7 · 深度思考" : "V1.0.7"}</span></div>

            <ol className={styles.transcript} aria-live="polite" aria-busy={isAsking} ref={transcriptRef}>
              {transcript.map((turn) => {
                // V1.0.6.3 双图联动：每轮回答都可独立渲染「人物图谱 / 时间轴」双按钮。
                const turnTargets = turn.role === "assistant"
                  ? resolveAnswerGuideTargets(turn.answer, turn.id)
                  : null;
                return (
                  <li key={turn.id} className={turn.role === "user" ? styles.userTurn : styles.agentTurn} data-error={turn.isError === true ? "true" : undefined} data-streaming={turn.id === streamingTurnId ? "true" : undefined}>
                    {turn.role === "user" ? <span className={styles.role}>你</span> : <Persona guide={Boolean(turn.answer?.uiActions.length || (pendingActions.length > 0 && turn.id === actionAnchorId))} />}
                    <div className={styles.content}>{turn.role === "assistant" ? <MarkdownMessage content={turn.content} /> : turn.content}{turn.id === streamingTurnId ? <span className={styles.streamCaret} aria-hidden="true" /> : null}</div>
                    {turnTargets && turnTargets.targets.length > 0 ? <GuideActionButtons compact targets={turnTargets.targets} onOpen={(target) => openGuideInFullChat(target.surface)} /> : null}
                    {turn.role === "assistant" && turn.answer ? <CitationCards citations={turn.answer.citations} onNavigate={closeDrawer} /> : null}
                    {turn.role === "assistant" && turn.answer && shouldShowModelFallbackHint(turn.answer.modelUsed, turn.answer.modelRequested) ? <p className={styles.modelFallbackHint}>{MODEL_FALLBACK_HINT}</p> : null}
                    {turn.role === "assistant" && turn.id === actionAnchorId && pendingActions.length > 0 ? <ActionPrompt onOpenCopilot={openFullChat} /> : null}
                  </li>
                );
              })}
            </ol>

            <form className={styles.form} onSubmit={submit}>
              <label className={styles.srOnly} htmlFor="shimai-agent-input">输入问题</label>
              <input id="shimai-agent-input" className={styles.input} value={draft} onChange={(event) => setDraft(event.target.value)} placeholder="问一个历史问题…" autoComplete="off" disabled={isAsking} />
              <button type="submit" className={styles.send} disabled={isAsking || !draft.trim()}><span>{isAsking ? "检索中" : "发送"}</span><span aria-hidden="true">↗</span></button>
            </form>
            {/* V1.0.5.2：抽屉与完整对话页共用同一模型选择（切换立即生效、不清空历史）。 */}
            <div className={styles.modelRow}>
              <ModelSwitcher models={models} value={selectedModelId ?? defaultModelId} onChange={selectModel} loading={!modelsReady} fallback={modelsFromFallback} disabled={isAsking} />
            </div>
            <footer className={styles.footer}><button type="button" className={styles.fullChatLink} onClick={openFullChat}>进入完整对话页 <span aria-hidden="true">→</span></button><span className={styles.hint}>ESC 关闭</span></footer>
          </section>
        </div>
      ) : null}
    </>
  );
}
