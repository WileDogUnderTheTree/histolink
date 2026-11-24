"use client";

import { Suspense, useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";

import { BrandMark } from "@/components/BrandMark";
import { ConversationSidebar } from "@/components/agent/ConversationSidebar";
import { MarkdownMessage } from "@/components/agent/MarkdownMessage";
import { ModelSwitcher } from "@/components/agent/ModelSwitcher";
import { useAgentSession, type AgentAnswerView, type AgentTurn } from "@/contexts/AgentContext";
import {
  MODEL_FALLBACK_HINT,
  shouldShowModelFallbackHint,
  type Citation,
} from "@/lib/agent-client";
import {
  ASK_SIDEBAR_NARROW_QUERY,
  ASK_SIDEBAR_STORAGE_KEY,
  askSidebarPreferenceToStored,
  resolveAskSidebarPreference,
  type AskSidebarPreference,
} from "@/lib/ask-layout";
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

/** 页面级滚动位置（V1.0.5.1）：从时间轴 / 图谱「返回聊天」时恢复阅读位置。 */
const SCROLL_STORAGE_KEY = "histolink.ask.scroll.v1";

/**
 * 引用折叠阈值（V1.0.5.2 UI 呼吸感补丁）。
 *
 * 引用超过 3 条时默认只展示前 3 条，剩余条目收进「展开全部 N 条引用」按钮，
 * 避免引用卡片把屏幕纵向撑爆；点击后再向下展开 / 收起。
 */
const CITATION_COLLAPSE_LIMIT = 3;

const ANSWER_STATUS_LABEL: Record<AgentAnswerView["mode"], string> = {
  grounded: "已核验",
  insufficient: "资料不足",
  refusal: "无法回答",
};

/**
 * 多轮对话布局预览（V1.0.5.1）。
 *
 * 纯静态占位数据，用于验证「用户问题 A → AI 回答 A → 用户追问 B → AI 回答 B」的时间线布局、
 * 长 Markdown、表格 / 代码块、每轮独立状态与引用区；**不接发送、不接多轮业务逻辑**。
 */
function previewCitation(id: string, eventId: string, title: string, sourceLabel: string): Citation {
  return {
    id,
    kind: "event",
    title,
    event_id: eventId,
    attribution: "史脉历史数据 · 多轮布局预览",
    license: "CC BY-NC-SA 4.0",
    source_label: sourceLabel,
  };
}

function previewAnswer(mode: AgentAnswerView["mode"], citations: Citation[]): AgentAnswerView {
  return {
    mode,
    markdown: "",
    certainty: mode === "grounded" ? "high" : mode === "insufficient" ? "low" : null,
    missing: mode === "insufficient" ? ["布局预览占位：正式回答会在这里说明缺失的信息"] : [],
    reasonCode: null,
    citations,
    entities: [],
    uiActions: [],
    snapshotVersion: "preview",
    requestId: "preview",
    modelUsed: null,
    modelRequested: null,
    sources: null,
  };
}

const PREVIEW_TRANSCRIPT: AgentTurn[] = [
  {
    id: "preview-user-a",
    role: "user",
    content: "商鞅变法和王安石变法分别发生在什么时代？",
  },
  {
    id: "preview-assistant-a",
    role: "assistant",
    content:
      "## 两场改革的时代背景\n\n商鞅变法发生在**战国时期的秦国**，王安石变法发生在**北宋宋神宗时期**。两者都试图通过制度调整增强国家能力，但面对的社会结构与政治条件并不相同。\n\n> 这是多轮对话布局预览：正文、状态与引用都只是静态占位，不会调用后端。",
    // V1.0.5.2 UI 呼吸感补丁：预置 6 条引用，用于验证「默认只展示前 3 条 + 展开全部」的折叠交互。
    answer: previewAnswer("grounded", [
      previewCitation("preview-cite-shangyang", "zhanguo-05", "商鞅变法", "史脉图谱"),
      previewCitation("preview-cite-wanganshi", "beisong-10", "王安石变法", "史脉图谱"),
      previewCitation("preview-cite-fashu", "zhanguo-09", "法家变法比较", "史脉时间轴"),
      previewCitation("preview-cite-shangjun", "zhanguo-11", "商君书·更法", "史脉时间轴"),
      previewCitation("preview-cite-songshi", "beisong-12", "宋史·王安石传", "史脉时间轴"),
      previewCitation("preview-cite-xuzizhi", "beisong-13", "续资治通鉴长编", "史脉时间轴"),
    ]),
  },
  {
    id: "preview-user-b",
    role: "user",
    content: "它们在主要措施和历史影响上有什么不同？",
  },
  {
    id: "preview-assistant-b",
    role: "assistant",
    content:
      "## 主要维度对照\n\n| 维度 | 商鞅变法 | 王安石变法 |\n| --- | --- | --- |\n| 核心目标 | 富国强兵、建立耕战秩序 | 理财、强兵、缓解北宋积弊 |\n| 推行时代 | 战国秦孝公时期 | 北宋熙宁年间 |\n| 历史影响 | 奠定秦国制度基础 | 改革理念影响深远，但执行与党争加剧阻力 |\n\n- 后续回答可以继续沿着某一个维度展开；\n- 每一轮回答都可以独立挂载证据、状态与引用；\n- 输入区固定在对话工作区底部，长回答由页面滚动承载。\n\n```text\nV1.0.6 composer slot —— 多轮发送、上下文延续将在下一版接入\n```\n\n> 本轮用「资料不足」状态做视觉占位，用于验证每轮回答独立的状态徽标与引用区。",
    answer: previewAnswer("insufficient", []),
  },
];

function citationHref(citation: Citation): string | null {
  if (citation.event_id) return timelineHref({ event: citation.event_id, mode: "detail" });
  if (citation.person_id) return graphHref({ person: citation.person_id, mode: "detail" });
  return null;
}

function Citations({ citations, onOpenReference }: { citations: Citation[]; onOpenReference: (href: string) => void }) {
  // Hook 必须无条件调用：引用列表长度在同一轮内稳定，但保持 hook 顺序一致更安全。
  const [expanded, setExpanded] = useState(false);
  if (!citations.length) return null;
  const visibleCitations = expanded ? citations : citations.slice(0, CITATION_COLLAPSE_LIMIT);
  const hiddenCount = citations.length - CITATION_COLLAPSE_LIMIT;
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
      {citations.length > CITATION_COLLAPSE_LIMIT ? (
        <button
          type="button"
          className={styles.expandCitations}
          data-expanded={expanded ? "true" : undefined}
          aria-expanded={expanded}
          onClick={() => setExpanded((value) => !value)}
        >
          <span className={styles.expandCitationsChevron} aria-hidden="true">▾</span>
          <span>{expanded ? "收起引用" : `展开全部 ${citations.length} 条引用`}</span>
          {expanded ? null : <span className={styles.expandCitationsCount} aria-hidden="true">+{hiddenCount}</span>}
        </button>
      ) : null}
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
  const answerStatus = turn.answer ? ANSWER_STATUS_LABEL[turn.answer.mode] : null;
  return (
    <li className={turn.role === "user" ? styles.userTurn : styles.agentTurn} data-error={turn.isError === true ? "true" : undefined}>
      <div className={styles.messageMeta}>{turn.role === "user" ? <span>你</span> : <Persona guide={guide} />}<span>{turn.role === "user" ? "提问" : guide ? "联动向导" : "日常问答"}</span></div>
      <div className={styles.messageText}>{turn.role === "assistant" ? <MarkdownMessage content={turn.content} /> : turn.content}</div>
      {turn.role === "assistant" && turn.answer ? <div className={styles.answerMeta} data-mode={turn.answer.mode}>
        <span className={styles.statusBadge}>{answerStatus}</span>
        <span>{turn.answer.citations.length > 0 ? `${turn.answer.citations.length} 条可核验来源` : "证据待补充"}</span>
      </div> : null}
      {turn.role === "assistant" && turn.answer ? <Citations citations={turn.answer.citations} onOpenReference={onOpenReference} /> : null}
      {turn.role === "assistant" && turn.answer && shouldShowModelFallbackHint(turn.answer.modelUsed, turn.answer.modelRequested) ? <p className={styles.modelFallbackHint}>{MODEL_FALLBACK_HINT}</p> : null}
    </li>
  );
}

function AskWorkspace() {
  const searchParams = useSearchParams();
  const question = searchParams.get("q")?.trim() ?? "";
  const isPreviewMode = searchParams.get("preview") === "multiturn";
  const { transcript, isRestored, isAsking, pendingActions, ask, cancelAction, openDrawer, guide,
    models, defaultModelId, selectedModelId, selectModel, modelsReady, modelsFromFallback,
    conversationGroups, activeConversationId, conversationsLoading, isCurrentConversationEmpty,
    newConversation, loadConversation } = useAgentSession();
  const visibleTranscript = isPreviewMode ? PREVIEW_TRANSCRIPT : transcript;
  // 预览模式不消费真实会话的联动目标，避免静态布局被上一次真实回答的副驾驶面板干扰。
  const activeGuide = isPreviewMode ? null : guide;
  const [draft, setDraft] = useState(question);
  const [copilotPreview, setCopilotPreview] = useState<{ href: string; target: string } | null>(null);
  const transcriptRef = useRef<HTMLOListElement>(null);
  /** 已经自动展开过的联动 turn：用户主动关掉面板后，同一轮不会被强行重新弹开。 */
  const presentedGuideTurn = useRef<string | null>(null);
  const guideInitialized = useRef(false);
  /** 页面级滚动（V1.0.5.1）：恢复会话滚动位置，之后只有新增轮次才自动滚动到底部。 */
  const scrollRestored = useRef(false);
  const lastTurnCount = useRef(0);
  const scrollSaveFrame = useRef<number | null>(null);
  const lastUserScrollTop = useRef(0);
  const navigationIntent = useRef(false);
  const intentResetTimer = useRef<number | null>(null);
  /**
   * 侧边栏折叠偏好（V1.0.5.2 UI 呼吸感补丁）。
   *
   * 首帧按「展开」渲染（SSR 与 hydration 一致），挂载后再读取 localStorage / 视口宽度：
   * 宽屏尊重用户上次选择，窄屏默认收起并改为浮层展开。
   */
  const [sidebarPreference, setSidebarPreference] = useState<AskSidebarPreference>("expanded");
  const [sidebarReady, setSidebarReady] = useState(false);
  const [isNarrowViewport, setIsNarrowViewport] = useState(false);
  const sidebarCollapsed = sidebarPreference === "collapsed";
  /** 史引分屏时自动收起侧边栏，把横向空间让给 40% / 60% 分屏；关闭分屏后恢复用户选择。 */
  const sidebarVisible = !isPreviewMode && sidebarReady && !sidebarCollapsed && !copilotPreview;
  /** 左侧没有实际占用宽度（预览模式 / 手动收起）→ 对话区切到 60%–70% 宽版并居中。 */
  const sidebarSpaceFreed = isPreviewMode || sidebarCollapsed;

  const setSidebarCollapsed = useCallback((collapsed: boolean) => {
    const next: AskSidebarPreference = collapsed ? "collapsed" : "expanded";
    setSidebarPreference(next);
    try {
      window.localStorage.setItem(ASK_SIDEBAR_STORAGE_KEY, askSidebarPreferenceToStored(next));
    } catch {
      // 存储不可用时只丢失「刷新后保持折叠」的偏好，不影响当次交互。
    }
  }, []);

  useEffect(() => {
    const media = window.matchMedia(ASK_SIDEBAR_NARROW_QUERY);
    let stored: string | null = null;
    try {
      stored = window.localStorage.getItem(ASK_SIDEBAR_STORAGE_KEY);
    } catch {
      stored = null;
    }
    setSidebarPreference(resolveAskSidebarPreference(stored, media.matches));
    setIsNarrowViewport(media.matches);
    setSidebarReady(true);
    const onMediaChange = (event: MediaQueryListEvent) => setIsNarrowViewport(event.matches);
    media.addEventListener("change", onMediaChange);
    return () => media.removeEventListener("change", onMediaChange);
  }, []);

  // 窄屏下侧边栏改为浮层：Esc 收起，与点击遮罩的语义一致。
  useEffect(() => {
    if (!isNarrowViewport || !sidebarVisible) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setSidebarCollapsed(true);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [isNarrowViewport, sidebarVisible, setSidebarCollapsed]);

  useEffect(() => setDraft(question), [question]);

  /**
   * 记录页面滚动位置（V1.0.5.1）。
   *
   * 说明：Next App Router 在路由跳转时可能把滚动位置复位为 0，因此不能简单地
   * 「监听 scroll 后写入」；这里以「用户最后一次真实滚动」为准，并在点击 / 键盘 / popstate
   * 等跳转意图发生时先同步落盘，卸载时再写一次最后位置，避免把程序性复位误存为离开位置。
   */
  useEffect(() => {
    if (isPreviewMode) return;
    const write = (top: number) => {
      try {
        window.sessionStorage.setItem(SCROLL_STORAGE_KEY, String(Math.max(0, Math.round(top))));
      } catch {
        // 存储不可用时只是丢失滚动位置，不影响对话本身。
      }
    };
    const scheduleWrite = () => {
      if (scrollSaveFrame.current !== null) return;
      scrollSaveFrame.current = window.requestAnimationFrame(() => {
        scrollSaveFrame.current = null;
        if (navigationIntent.current) return;
        lastUserScrollTop.current = window.scrollY;
        write(window.scrollY);
      });
    };
    const markIntent = () => {
      if (navigationIntent.current) return;
      lastUserScrollTop.current = window.scrollY;
      write(window.scrollY);
      navigationIntent.current = true;
      if (intentResetTimer.current !== null) window.clearTimeout(intentResetTimer.current);
      intentResetTimer.current = window.setTimeout(() => {
        navigationIntent.current = false;
        intentResetTimer.current = null;
      }, 900);
    };
    window.addEventListener("scroll", scheduleWrite, { passive: true });
    window.addEventListener("click", markIntent, true);
    window.addEventListener("keydown", markIntent, true);
    window.addEventListener("popstate", markIntent, true);
    return () => {
      window.removeEventListener("scroll", scheduleWrite);
      window.removeEventListener("click", markIntent, true);
      window.removeEventListener("keydown", markIntent, true);
      window.removeEventListener("popstate", markIntent, true);
      if (scrollSaveFrame.current !== null) {
        window.cancelAnimationFrame(scrollSaveFrame.current);
        scrollSaveFrame.current = null;
      }
      if (intentResetTimer.current !== null) window.clearTimeout(intentResetTimer.current);
      write(lastUserScrollTop.current);
    };
  }, [isPreviewMode]);

  // 会话恢复完成后：先还原滚动位置；之后的每一次新增轮次才平滑滚动到最新回答。
  useEffect(() => {
    if (isPreviewMode || !isRestored) return;
    if (!scrollRestored.current) {
      scrollRestored.current = true;
      lastTurnCount.current = visibleTranscript.length;
      let saved = 0;
      try {
        saved = Number(window.sessionStorage.getItem(SCROLL_STORAGE_KEY) ?? "0");
      } catch {
        saved = 0;
      }
      if (Number.isFinite(saved) && saved > 0) {
        // 延后一拍：Next 的导航滚动复位可能发生在 mount 之后，等路由完成再恢复。
        window.setTimeout(() => window.scrollTo({ top: saved, behavior: "auto" }), 120);
        window.setTimeout(() => {
          if (window.scrollY < 1) window.scrollTo({ top: saved, behavior: "auto" });
        }, 420);
      }
      return;
    }
    if (visibleTranscript.length > lastTurnCount.current || isAsking) {
      lastTurnCount.current = visibleTranscript.length;
      // 页面级滚动容器（单一滚动条）：滚动到对话工作区底部，露出最新回答与输入区。
      window.requestAnimationFrame(() =>
        window.scrollTo({ top: document.documentElement.scrollHeight, behavior: "smooth" }),
      );
    }
  }, [isPreviewMode, isRestored, visibleTranscript.length, isAsking]);

  /**
   * P2：回答落地后自动展开史引副驾驶。
   *
   * `guide` 由 AgentContext 从 transcript 派生：只要本轮 `ui_actions` 带
   * `timeline.focus_event` / `timeline.focus_dynasty` / `graph.focus_person` /
   * `graph.focus_relation`（payload 或 target.params 任一处给全实体 ID），
   * 或 grounded 回答自带可定位引用，就立即打开右侧面板并渲染对应组件。
   *
   * V1.0.5.1：页面重新进入（恢复会话 / 从时间轴「返回聊天」）时不再自动弹开旧面板，
   * 保证落点就是对话列表本身；新回答仍然自动展开。
   */
  useEffect(() => {
    if (!activeGuide || !isRestored) {
      if (isRestored && !guideInitialized.current) guideInitialized.current = true;
      return;
    }
    if (!guideInitialized.current) {
      guideInitialized.current = true;
      presentedGuideTurn.current = activeGuide.turnId;
      return;
    }
    if (presentedGuideTurn.current === activeGuide.turnId) return;
    presentedGuideTurn.current = activeGuide.turnId;
    setCopilotPreview({ href: activeGuide.href, target: activeGuide.title });
  }, [activeGuide, isRestored]);

  // 副驾驶面板已接管联动展示：同页待确认动作直接取消，避免 /ask 上残留跨页确认条。
  useEffect(() => {
    if (!activeGuide || pendingActions.length === 0) return;
    pendingActions.forEach((action) => cancelAction(action.id));
  }, [activeGuide, pendingActions, cancelAction]);

  const openCopilot = (href: string, target: string) => setCopilotPreview({ href, target });

  const submit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (isPreviewMode || isAsking || !draft.trim()) return;
    void ask(draft);
    setDraft("");
  };

  const chooseSuggestion = (suggestion: string) => setDraft(suggestion);

  const userTurnCount = visibleTranscript.filter((turn) => turn.role === "user").length;
  /** 折叠按钮只在「有侧边栏可开合」时出现：预览模式 / 史引分屏自动让位时不显示。 */
  const canToggleSidebar = sidebarReady && !isPreviewMode && !copilotPreview;

  return (
    <div className={`${styles.appFrame} ${sidebarSpaceFreed ? styles.sidebarCollapsed : ""}`}>
      {sidebarVisible ? (
        <ConversationSidebar
          groups={conversationGroups}
          activeConversationId={activeConversationId}
          isCurrentConversationEmpty={isCurrentConversationEmpty}
          onNewConversation={() => void newConversation()}
          onSelectConversation={(id) => void loadConversation(id)}
          loading={conversationsLoading}
          disabled={isAsking}
          onCollapse={() => setSidebarCollapsed(true)}
        />
      ) : null}
      {sidebarVisible && isNarrowViewport ? (
        <button
          type="button"
          className={styles.sidebarBackdrop}
          aria-label="关闭历史对话浮层"
          onClick={() => setSidebarCollapsed(true)}
        />
      ) : null}
      <main className={styles.page}>
        <h1 className={styles.srOnly}>史脉问答</h1>
        <div className={`${styles.shell} ${copilotPreview ? styles.copilotMode : ""}`}>
        {/* 顶部导航：品牌「史脉问答」+ 流线型 S/史 图标常驻左侧，右侧是统一文字样式控制台导航。 */}
        <header className={styles.topbar}>
          <div className={styles.topbarLead}>
            {canToggleSidebar && !sidebarVisible ? (
              <button
                type="button"
                className={styles.sidebarToggle}
                title="展开历史对话"
                aria-label="展开历史对话侧边栏"
                onClick={() => setSidebarCollapsed(false)}
              >
                <span className={styles.sidebarToggleIcon} aria-hidden="true">☰</span>
                <span>历史对话</span>
              </button>
            ) : null}
            <Link className={styles.brand} href="/" aria-label="返回史脉首页">
              <BrandMark className={styles.brandMark} size={40} />
              <span className={styles.brandText}><small>SHIMAI · CONSOLE</small><strong>史脉问答</strong></span>
            </Link>
          </div>
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
            <div className={styles.chatHeader}>
              <div>
                <span className={styles.workspaceKicker}>CONVERSATION WORKSPACE · V1.0.5.2</span>
                <h2 id="conversation-title">{isPreviewMode ? "多轮对话布局预览" : "你的历史对话"}</h2>
              </div>
              <div className={styles.chatHeaderMeta}>
                <span className={styles.syncNote}>
                  <i />
                  {isPreviewMode
                    ? "静态占位数据 · 不发送请求"
                    : isRestored
                      ? `${userTurnCount} 轮 · 会话已保留`
                      : "正在载入会话…"}
                </span>
                <Link className={styles.previewLink} href={isPreviewMode ? "/ask" : "/ask?preview=multiturn"}>
                  {isPreviewMode ? "← 返回当前对话" : "多轮布局预览"}
                </Link>
              </div>
            </div>
            <div className={styles.conversationBody}>
              <ol className={styles.transcript} aria-live="polite" aria-busy={isAsking} ref={transcriptRef}>
                {isPreviewMode ? <li className={styles.previewNotice}>静态数据仅用于验证多轮对话布局（时间线 / 长文本 / 每轮状态与引用），未连接发送与多轮业务逻辑。</li> : null}
                {visibleTranscript.map((turn) => <Message key={turn.id} turn={turn} guide={Boolean(turn.answer?.uiActions.length) || turn.id === activeGuide?.turnId} onOpenReference={(href) => openCopilot(href, "史料关联事件")} />)}
                {isAsking ? <li className={`${styles.agentTurn} ${styles.loadingTurn}`} aria-label="史脉正在检索史料"><div className={styles.messageMeta}><Persona guide={false} /><span>检索中</span></div><div className={styles.loading}><span>正在从史脉数据中查找答案</span><i /><i /><i /></div></li> : null}
              </ol>
              {activeGuide && !copilotPreview ? <aside className={styles.guideRail} aria-label="史引联动区"><div className={styles.guideSeal} aria-hidden="true">引</div><span className={styles.guideLabel}>史引 · 副驾驶</span><strong>联动已就绪</strong><p>史令为您查阅史料，史引为您推演脉络。</p><button type="button" className={styles.guideOpen} onClick={() => openCopilot(activeGuide.href, activeGuide.title)}>展开{activeGuide.title}</button></aside> : null}
            </div>

            <div className={styles.composerDock}>
              {/* V1.0.5.2：模型切换窗口位于输入框左上角（输入框外部左侧区域）。 */}
              <div className={styles.composerTop}>
                <ModelSwitcher
                  models={models}
                  value={selectedModelId ?? defaultModelId}
                  onChange={selectModel}
                  loading={!modelsReady}
                  fallback={modelsFromFallback}
                  disabled={isPreviewMode}
                />
                <span className={styles.composerTopNote}>切换模型立即生效 · 不清空已有对话历史</span>
              </div>
              <form className={styles.composer} onSubmit={submit}>
                <label className={styles.srOnly} htmlFor="ask-composer">输入问题</label>
                <textarea id="ask-composer" value={draft} onChange={(event) => setDraft(event.target.value)} placeholder={isPreviewMode ? "V1.0.6 追问输入区预留" : "输入一个历史问题，例如：赤壁之战发生在哪一年"} rows={1} disabled={isAsking || isPreviewMode} onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); event.currentTarget.form?.requestSubmit(); } }} />
                <div className={styles.composerActions}>
                  <button type="button" className={styles.composerIconButton} title="附件上传（V1.0.6 接入）" aria-label="附件上传（V1.0.6 接入）" disabled>
                    <span aria-hidden="true">📎</span>
                  </button>
                  <button type="button" className={styles.composerIconButton} title="新建对话" aria-label="新建对话" disabled={isPreviewMode || isAsking} onClick={() => void newConversation()}>
                    <span aria-hidden="true">＋</span>
                  </button>
                  <button type="submit" disabled={isPreviewMode || isAsking || !draft.trim()} aria-label="发送问题"><span>{isAsking ? "检索中" : "发送"}</span><b aria-hidden="true">↗</b></button>
                </div>
              </form>
              <p className={styles.composerHint}>Enter 发送 · Shift + Enter 换行 · 回答将附带可核验出处{isPreviewMode ? "" : " · 历史对话演示数据将在 V1.0.6 接入持久化"}</p>
            </div>
          </section>
          {copilotPreview ? <CopilotPanel href={copilotPreview.href} target={copilotPreview.target} onClose={() => setCopilotPreview(null)} /> : null}
        </div>
      </div>
      </main>
    </div>
  );
}

export default function AskPage() {
  return <Suspense fallback={<main className={styles.page}><div className={styles.loadingPage}>正在打开史脉问答…</div></main>}><AskWorkspace /></Suspense>;
}
