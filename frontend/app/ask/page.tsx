"use client";

import { Suspense, useEffect, useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";

import { BrandMark } from "@/components/BrandMark";
import { useAgentSession, type AgentTurn } from "@/contexts/AgentContext";
import {
  MODEL_FALLBACK_HINT,
  shouldShowModelFallbackHint,
  type Citation,
} from "@/lib/agent-client";
import { graphHref, surfaceLinksFromHref, timelineHref } from "@/lib/routes";

import styles from "./ask.module.css";

/**
 * 推荐问题（V1.0.4 收尾修复 P1）。
 *
 * 只放**单跳**、库里有确定数据的事实题（事件年份 / 人物朝代），一个工具轮次即可回答；
 * 原「刘邦和项羽身边有哪些共同人物？」属于多跳图交叉查询，超出当前 Agent 单轮 4 步的
 * 工具能力，会触发数据不足 / 报错，已从推荐位下线。
 */
const SUGGESTIONS = [
  "赤壁之战发生在哪一年？",
  "玄武门之变发生在哪一年？",
  "武则天是哪个朝代的人物？",
];

const INLINE_MARKDOWN = /(\*\*[^*]+\*\*|__[^_]+__|`[^`]+`|\*[^*]+\*|_[^_]+_)/g;

function renderInline(text: string): ReactNode[] {
  return text.split(INLINE_MARKDOWN).map((part, index) => {
    if (!part) return null;
    if ((part.startsWith("**") && part.endsWith("**")) || (part.startsWith("__") && part.endsWith("__"))) {
      return <strong key={index}>{part.slice(2, -2)}</strong>;
    }
    if (part.startsWith("`") && part.endsWith("`")) return <code key={index}>{part.slice(1, -1)}</code>;
    if ((part.startsWith("*") && part.endsWith("*")) || (part.startsWith("_") && part.endsWith("_"))) {
      return <em key={index}>{part.slice(1, -1)}</em>;
    }
    return <span key={index}>{part}</span>;
  });
}

function MarkdownMessage({ content }: { content: string }) {
  const lines = content.replace(/\r\n?/g, "\n").split("\n");
  const blocks: ReactNode[] = [];
  let index = 0;

  while (index < lines.length) {
    if (!lines[index].trim()) { index += 1; continue; }
    const heading = lines[index].match(/^(#{1,3})\s+(.+)$/);
    if (heading) {
      const Heading = `h${heading[1].length}` as "h1" | "h2" | "h3";
      blocks.push(<Heading key={`heading-${index}`}>{renderInline(heading[2])}</Heading>);
      index += 1;
      continue;
    }
    if (/^\s*[-*+]\s+/.test(lines[index])) {
      const items: ReactNode[] = [];
      while (index < lines.length && /^\s*[-*+]\s+/.test(lines[index])) {
        items.push(<li key={`${index}-${items.length}`}>{renderInline(lines[index].replace(/^\s*[-*+]\s+/, ""))}</li>);
        index += 1;
      }
      blocks.push(<ul key={`list-${index}`}>{items}</ul>);
      continue;
    }
    if (/^\s*\d+[.)]\s+/.test(lines[index])) {
      const items: ReactNode[] = [];
      while (index < lines.length && /^\s*\d+[.)]\s+/.test(lines[index])) {
        items.push(<li key={`${index}-${items.length}`}>{renderInline(lines[index].replace(/^\s*\d+[.)]\s+/, ""))}</li>);
        index += 1;
      }
      blocks.push(<ol key={`ordered-${index}`}>{items}</ol>);
      continue;
    }

    const paragraph: string[] = [lines[index]];
    index += 1;
    while (index < lines.length && lines[index].trim() && !/^(#{1,3})\s+/.test(lines[index]) && !/^\s*[-*+]\s+/.test(lines[index]) && !/^\s*\d+[.)]\s+/.test(lines[index])) {
      paragraph.push(lines[index]);
      index += 1;
    }
    blocks.push(<p key={`paragraph-${index}`}>{paragraph.map((line, lineIndex) => <span key={lineIndex}>{lineIndex > 0 ? <br /> : null}{renderInline(line)}</span>)}</p>);
  }

  return <div className={styles.markdown}>{blocks}</div>;
}

function citationHref(citation: Citation): string | null {
  if (citation.event_id) return timelineHref({ event: citation.event_id, mode: "detail" });
  if (citation.person_id) return graphHref({ person: citation.person_id, mode: "detail" });
  return null;
}

function Citations({ citations, onOpenReference }: { citations: Citation[]; onOpenReference: (href: string) => void }) {
  if (!citations.length) return null;
  const [expanded, setExpanded] = useState(false);
  const visibleCitations = expanded ? citations : citations.slice(0, 3);
  return (
    <div className={styles.citations} aria-label="回答引用">
      <div className={styles.citationsHeading}><span />史料来源</div>
      <div className={styles.citationList}>
        {visibleCitations.map((citation) => {
          const label = `引自《${citation.source_ref?.book ?? citation.source_label ?? citation.title}》`;
          const href = citationHref(citation);
          const content = <><span className={styles.citationMark}>⌁</span><span className={styles.citationBody}><strong>[{label}]</strong><small>{citation.title}{citation.year ? ` · ${citation.year}年` : ""}</small></span>{href ? <span>↗</span> : null}</>;
          return href ? <button type="button" className={styles.citation} key={citation.id} title={citation.quote ?? label} onClick={() => onOpenReference(href)}>{content}</button> : <span className={styles.citation} key={citation.id} title={citation.quote ?? label}>{content}</span>;
        })}
      </div>
      {citations.length > 3 ? <button type="button" className={styles.expandCitations} onClick={() => setExpanded((value) => !value)}>{expanded ? "收起引用" : `展开全部 ${citations.length} 条引用`}</button> : null}
    </div>
  );
}

function Persona({ guide }: { guide: boolean }) {
  return <span className={`${styles.persona} ${guide ? styles.guidePersona : ""}`}><span className={styles.personaIcon} aria-hidden="true">{guide ? "引" : "令"}</span>{guide ? "史引" : "史令"}</span>;
}

function CopilotPanel({ href, target, onClose }: { href: string; target: string; onClose: () => void }) {
  const router = useRouter();
  const links = surfaceLinksFromHref(href);
  return (
    <aside className={styles.copilotPanel} role="dialog" aria-label="史引副驾驶">
      <header className={styles.copilotHeader}>
        <div className={styles.copilotTitle}><span className={styles.copilotKicker}>史引 · 副驾驶</span><h2>{target}</h2></div>
        <div className={styles.copilotActions}>
          <button
            type="button"
            className={styles.copilotExternal}
            data-active={links.focus === "timeline" ? "true" : undefined}
            onClick={() => router.push(links.timeline)}
            title={links.focus === "timeline" ? "带当前焦点事件打开完整时间轴" : "打开完整时间轴"}
          >
            展开完整时间轴<span aria-hidden="true">↗</span>
          </button>
          <button
            type="button"
            className={styles.copilotExternal}
            data-active={links.focus === "graph" ? "true" : undefined}
            onClick={() => router.push(links.graph)}
            title={links.focus === "graph" ? "带当前焦点人物打开完整人物图" : "打开完整人物图"}
          >
            展开完整人物图<span aria-hidden="true">↗</span>
          </button>
          <button type="button" className={styles.closeCopilot} onClick={onClose}>× 返回聊天</button>
        </div>
      </header>
      <div className={styles.copilotFrameWrap}><iframe className={styles.copilotFrame} title={`史引 · ${target}`} src={href} /></div>
    </aside>
  );
}

function Message({ turn, guide, onOpenReference }: { turn: AgentTurn; guide: boolean; onOpenReference: (href: string) => void }) {
  return (
    <li className={turn.role === "user" ? styles.userTurn : styles.agentTurn} data-error={turn.isError === true ? "true" : undefined}>
      <div className={styles.messageMeta}>{turn.role === "user" ? <span>你</span> : <Persona guide={guide} />}<span>{turn.role === "user" ? "提问" : guide ? "联动向导" : "日常问答"}</span></div>
      <div className={styles.messageText}>{turn.role === "assistant" ? <MarkdownMessage content={turn.content} /> : turn.content}</div>
      {turn.role === "assistant" && turn.answer ? <Citations citations={turn.answer.citations} onOpenReference={onOpenReference} /> : null}
      {turn.role === "assistant" && turn.answer && shouldShowModelFallbackHint(turn.answer.modelUsed) ? <p className={styles.modelFallbackHint}>{MODEL_FALLBACK_HINT}</p> : null}
    </li>
  );
}

function AskWorkspace() {
  const searchParams = useSearchParams();
  const question = searchParams.get("q")?.trim() ?? "";
  const { transcript, isAsking, pendingActions, ask, cancelAction, openDrawer, guide } = useAgentSession();
  const [draft, setDraft] = useState(question);
  const [copilotPreview, setCopilotPreview] = useState<{ href: string; target: string } | null>(null);
  const transcriptRef = useRef<HTMLOListElement>(null);
  /** 已经自动展开过的联动 turn：用户主动关掉面板后，同一轮不会被强行重新弹开。 */
  const presentedGuideTurn = useRef<string | null>(null);

  useEffect(() => setDraft(question), [question]);
  useEffect(() => {
    const list = transcriptRef.current;
    if (list) list.scrollTo({ top: list.scrollHeight, behavior: "smooth" });
  }, [transcript, isAsking, pendingActions]);

  /**
   * P2：回答落地后自动展开史引副驾驶。
   *
   * `guide` 由 AgentContext 从 transcript 派生：只要本轮 `ui_actions` 带
   * `timeline.focus_event` / `timeline.focus_dynasty` / `graph.focus_person` /
   * `graph.focus_relation`（payload 或 target.params 任一处给全实体 ID），
   * 或 grounded 回答自带可定位引用，就立即打开右侧面板并渲染对应组件——
   * 不存在「回答完了右下角还是空的」这种中间态。
   */
  useEffect(() => {
    if (!guide) return;
    if (presentedGuideTurn.current === guide.turnId) return;
    presentedGuideTurn.current = guide.turnId;
    setCopilotPreview({ href: guide.href, target: guide.title });
  }, [guide]);

  // 副驾驶面板已接管联动展示：同页待确认动作直接取消，避免 /ask 上残留跨页确认条。
  useEffect(() => {
    if (!guide || pendingActions.length === 0) return;
    pendingActions.forEach((action) => cancelAction(action.id));
  }, [guide, pendingActions, cancelAction]);

  const openCopilot = (href: string, target: string) => setCopilotPreview({ href, target });

  const submit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (isAsking || !draft.trim()) return;
    void ask(draft);
    setDraft("");
  };

  const chooseSuggestion = (suggestion: string) => setDraft(suggestion);

  return (
    <main className={styles.page}>
      <h1 className={styles.srOnly}>史脉问答</h1>
      <div className={`${styles.shell} ${copilotPreview ? styles.copilotMode : ""}`}>
        {/* 顶部导航：品牌「史脉问答」+ 流线型 S/史 图标常驻左侧，右侧是统一文字样式控制台导航。 */}
        <header className={styles.topbar}>
          <Link className={styles.brand} href="/" aria-label="返回史脉首页">
            <BrandMark className={styles.brandMark} size={40} />
            <span className={styles.brandText}><small>SHIMAI · CONSOLE</small><strong>史脉问答</strong></span>
          </Link>
          <nav className={styles.nav} aria-label="主要导航"><Link href="/timeline">时间轴</Link><Link href="/graph">人物图谱</Link><button type="button" onClick={openDrawer}>悬浮问答</button><Link href="/">返回首页</Link></nav>
        </header>

        {/* 推荐问题：单跳简单事实，浅米色渐变胶囊，一行排布，不再占用大块垂直空间。 */}
        <div className={styles.suggestionBar} role="group" aria-label="推荐问题">
          {SUGGESTIONS.map((suggestion, index) => (
            <button type="button" key={suggestion} className={styles.suggestionChip} onClick={() => chooseSuggestion(suggestion)}>
              <span className={styles.suggestionMark} aria-hidden="true">{String(index + 1).padStart(2, "0")}</span>
              <span className={styles.suggestionText}>{suggestion}</span>
              <b aria-hidden="true">→</b>
            </button>
          ))}
        </div>

        <div className={styles.workspaceLayout}>
          <section className={styles.chatCard} aria-labelledby="conversation-title">
            <div className={styles.chatHeader}><h2 id="conversation-title">你的历史对话</h2><span className={styles.syncNote}><i /> 已与悬浮问答同步</span></div>
            <div className={styles.conversationBody}>
              <ol className={styles.transcript} aria-live="polite" aria-busy={isAsking} ref={transcriptRef}>
                {transcript.map((turn) => <Message key={turn.id} turn={turn} guide={Boolean(turn.answer?.uiActions.length) || turn.id === guide?.turnId} onOpenReference={(href) => openCopilot(href, "史料关联事件")} />)}
                {isAsking ? <li className={`${styles.agentTurn} ${styles.loadingTurn}`} aria-label="史脉正在检索史料"><div className={styles.messageMeta}><Persona guide={false} /><span>检索中</span></div><div className={styles.loading}><span>正在从史脉数据中查找答案</span><i /><i /><i /></div></li> : null}
              </ol>
              {guide && !copilotPreview ? <aside className={styles.guideRail} aria-label="史引联动区"><div className={styles.guideSeal} aria-hidden="true">引</div><span className={styles.guideLabel}>史引 · 副驾驶</span><strong>联动已就绪</strong><p>史令为您查阅史料，史引为您推演脉络。</p><button type="button" className={styles.guideOpen} onClick={() => openCopilot(guide.href, guide.title)}>展开{guide.title}</button></aside> : null}
            </div>

            <div className={styles.composerDock}>
              <form className={styles.composer} onSubmit={submit}><label className={styles.srOnly} htmlFor="ask-composer">输入问题</label><textarea id="ask-composer" value={draft} onChange={(event) => setDraft(event.target.value)} placeholder="输入一个历史问题，例如：赤壁之战发生在哪一年" rows={1} disabled={isAsking} onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); event.currentTarget.form?.requestSubmit(); } }} /><button type="submit" disabled={isAsking || !draft.trim()} aria-label="发送问题"><span>{isAsking ? "检索中" : "发送"}</span><b aria-hidden="true">↗</b></button></form><p className={styles.composerHint}>Enter 发送 · Shift + Enter 换行 · 回答将附带可核验出处</p>
            </div>
          </section>
          {copilotPreview ? <CopilotPanel href={copilotPreview.href} target={copilotPreview.target} onClose={() => setCopilotPreview(null)} /> : null}
        </div>
      </div>
    </main>
  );
}

export default function AskPage() {
  return <Suspense fallback={<main className={styles.page}><div className={styles.loadingPage}>正在打开史脉问答…</div></main>}><AskWorkspace /></Suspense>;
}
