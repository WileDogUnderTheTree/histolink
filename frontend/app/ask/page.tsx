"use client";

import { Suspense, useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";

import { BrandMark } from "@/components/BrandMark";
import { ConversationSidebar } from "@/components/agent/ConversationSidebar";
import { GuideActionButtons } from "@/components/agent/GuideActionButtons";
import { MarkdownMessage } from "@/components/agent/MarkdownMessage";
import { ModelSwitcher } from "@/components/agent/ModelSwitcher";
import { useAgentSession, type AgentAnswerView, type AgentTurn } from "@/contexts/AgentContext";
import {
  MODEL_FALLBACK_HINT,
  factCheckHint,
  shouldShowModelFallbackHint,
  type Citation,
} from "@/lib/agent-client";
import { resolveAnswerGuideTargets } from "@/lib/agent-guide";
import type { AgentGuideTarget, AgentGuideTargets } from "@/lib/agent-guide";
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
    comparisonAnalysis: null,
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
      "## 主要维度对照\n\n| 维度 | 商鞅变法 | 王安石变法 |\n| --- | --- | --- |\n| 核心目标 | 富国强兵、建立耕战秩序 | 理财、强兵、缓解北宋积弊 |\n| 推行时代 | 战国秦孝公时期 | 北宋熙宁年间 |\n| 历史影响 | 奠定秦国制度基础 | 改革理念影响深远，但执行与党争加剧阻力 |\n\n- 后续回答可以继续沿着某一个维度展开；\n- 每一轮回答都可以独立挂载证据、状态与引用；\n- 输入区固定在对话工作区底部，长回答由页面滚动承载。\n\n```text\nV1.0.6.1 composer slot —— 多轮发送、上下文延续将在下一版接入\n```\n\n> 本轮用「资料不足」状态做视觉占位，用于验证每轮回答独立的状态徽标与引用区。",
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

type CopilotSurface = AgentGuideTarget["surface"];

/** 副驾驶面板状态（V1.0.6.3）：同时携带时间轴 / 人物图目标，`active` 决定当前 iframe。 */
interface CopilotState {
  targets: AgentGuideTarget[];
  active: CopilotSurface;
}

/** 面板头部视图切换的顺序（与气泡按钮一致：人物图谱在左、时间轴在右）。 */
const COPILOT_TABS: ReadonlyArray<{ surface: CopilotSurface; label: string }> = [
  { surface: "graph", label: "人物图谱" },
  { surface: "timeline", label: "时间轴" },
];

/** 引用等单链接入口 → 单个联动目标（不属于动作联动，保持 V1.0.5 行为）。 */
function guideTargetFromHref(href: string, title: string): AgentGuideTarget {
  const surface: CopilotSurface = href.startsWith("/timeline") ? "timeline" : "graph";
  return { surface, href, title, kind: "citation", action: null };
}

/**
 * 史引副驾驶面板（V1.0.6.3 · 双视图）。
 *
 * - 头部保留「展开完整时间轴 / 展开完整人物图 / 返回聊天」；
 * - 同时存在时间轴与人物图联动目标时，头部多一组视图切换（气泡按钮点击也会切到这里）；
 * - iframe 区域 `flex:1 + min-height:0` 填满面板高度，面板本身不再随页面滚动。
 */
function CopilotPanel({
  state,
  onSwitch,
  onClose,
}: {
  state: CopilotState;
  onSwitch: (surface: CopilotSurface) => void;
  onClose: () => void;
}) {
  const router = useRouter();
  const activeTarget =
    state.targets.find((target) => target.surface === state.active) ?? state.targets[0];
  const links = surfaceLinksFromHref(activeTarget.href);
  const availableSurfaces = new Set(state.targets.map((target) => target.surface));
  return (
    <aside className={styles.copilotPanel} role="dialog" aria-label="史引副驾驶" data-copilot-surface={state.active}>
      <header className={styles.copilotHeader}>
        <div className={styles.copilotTitle}><span className={styles.copilotKicker}>史引 · 副驾驶</span><h2>{activeTarget.title}</h2></div>
        <div className={styles.copilotActions}>
          {state.targets.length > 1 ? (
            <div className={styles.copilotViewSwitch} role="tablist" aria-label="切换史引视图">
              {COPILOT_TABS.filter((tab) => availableSurfaces.has(tab.surface)).map((tab) => (
                <button
                  key={tab.surface}
                  type="button"
                  role="tab"
                  aria-selected={state.active === tab.surface}
                  className={styles.copilotViewTab}
                  data-active={state.active === tab.surface ? "true" : undefined}
                  data-surface={tab.surface}
                  onClick={() => onSwitch(tab.surface)}
                >
                  <span>{tab.label}</span>
                </button>
              ))}
            </div>
          ) : null}
          <button
            type="button"
            className={styles.copilotExternal}
            data-active={links.focus === state.active ? "true" : undefined}
            onClick={() => router.push(links.focus === "timeline" ? links.timeline : links.graph)}
            title={state.active === "timeline" ? "带当前焦点事件打开完整时间轴" : "带当前焦点人物打开完整人物图"}
          >
            完整{activeTarget.title}<span aria-hidden="true">↗</span>
          </button>
          <button type="button" className={styles.closeCopilot} onClick={onClose} title="关闭副驾驶，返回聊天" aria-label="关闭副驾驶，返回聊天">×</button>
        </div>
      </header>
      <div className={styles.copilotFrameWrap}>
        <iframe
          key={activeTarget.href}
          className={styles.copilotFrame}
          title={`史引 · ${activeTarget.title}`}
          src={activeTarget.href}
        />
      </div>
    </aside>
  );
}

/**
 * 「💡 史令对比分析」卡片（V1.0.5.4）。
 *
 * 与正文分离的独立区块：正文（`answer.markdown`）是服务端写死的事实实证，
 * 本卡片展示模型基于本轮事实块做的二次归纳（服务端已通过年份 / 人物白名单校验）。
 * 非对比 / 总结类问题或校验失败时后端不返回该字段，这里整块不渲染。
 */
function ComparisonAnalysisBlock({ text }: { text: string }) {
  return (
    <section className={styles.comparisonAnalysis} aria-label="史令对比分析">
      <div className={styles.comparisonHeading}>
        <span className={styles.comparisonIcon} aria-hidden="true">💡</span>
        <h3 className={styles.comparisonTitle}>史令对比分析</h3>
        <span className={styles.comparisonTag}>基于上方事实归纳</span>
      </div>
      <div className={styles.comparisonBody}>
        <MarkdownMessage content={text} />
      </div>
      <p className={styles.comparisonNote}>
        以上对比由模型仅根据本轮已核验史料归纳，事实与引用以上方「史料实证」为准。
      </p>
    </section>
  );
}

function Message({ turn, guide, streaming, pendingLabel, onOpenReference, onOpenGuide }: { turn: AgentTurn; guide: boolean; streaming?: boolean; pendingLabel?: string | null; onOpenReference: (href: string) => void; onOpenGuide: (targets: readonly AgentGuideTarget[], surface: CopilotSurface) => void }) {
  const streamed = turn.answer?.streamed === true;
  const answerStatus = turn.answer
    ? streamed
      ? "直答"
      : ANSWER_STATUS_LABEL[turn.answer.mode]
    : null;
  const metaLabel = turn.role === "user"
    ? "提问"
    : pendingLabel ?? (guide ? "联动向导" : "日常问答");
  // V1.0.6.3：本轮回答的时间轴 / 人物图联动目标（用于气泡底部双按钮）。
  const answerTargets = turn.role === "assistant" && turn.answer
    ? resolveAnswerGuideTargets(turn.answer, turn.id)
    : null;
  return (
    <li className={`${turn.role === "user" ? styles.userTurn : styles.agentTurn} ${streaming ? styles.streamingTurn : ""}`} data-error={turn.isError === true ? "true" : undefined} data-streaming={streaming ? "true" : undefined}>
      <div className={styles.messageMeta}>{turn.role === "user" ? <span>你</span> : <Persona guide={guide} />}<span>{metaLabel}</span></div>
      <div className={styles.messageText}>{turn.role === "assistant" ? <MarkdownMessage content={turn.content} /> : turn.content}{streaming ? <span className={styles.streamCaret} aria-hidden="true" /> : null}</div>
      {turn.role === "assistant" && turn.answer ? <div className={styles.answerMeta} data-mode={streamed ? "streamed" : turn.answer.mode}>
        <span className={styles.statusBadge}>{answerStatus}</span>
        <span>{streamed ? (turn.answer.uiActions.length > 0 ? "史引已联动 · 可展开右侧面板" : "模型直答 · 未检索图谱") : turn.answer.citations.length > 0 ? `${turn.answer.citations.length} 条可核验来源` : "证据待补充"}</span>
        {!streamed && factCheckHint(turn.answer.factCheck) ? <span className={styles.factCheckHint}>{factCheckHint(turn.answer.factCheck)}</span> : null}
      </div> : null}
      {answerTargets && answerTargets.targets.length > 0 ? (
        <GuideActionButtons
          targets={answerTargets.targets}
          onOpen={(target) => onOpenGuide(answerTargets.targets, target.surface)}
        />
      ) : null}
      {turn.role === "assistant" && turn.answer ? <Citations citations={turn.answer.citations} onOpenReference={onOpenReference} /> : null}
      {turn.role === "assistant" && turn.answer?.comparisonAnalysis ? <ComparisonAnalysisBlock text={turn.answer.comparisonAnalysis.text} /> : null}
      {turn.role === "assistant" && turn.answer && shouldShowModelFallbackHint(turn.answer.modelUsed, turn.answer.modelRequested) ? <p className={styles.modelFallbackHint}>{MODEL_FALLBACK_HINT}</p> : null}
    </li>
  );
}

/** 从查询参数读取副驾驶初始视图（`?panel=timeline|graph`）。 */
function readCopilotSurfaceParam(params: URLSearchParams | string | null | undefined): CopilotSurface | null {
  if (!params) return null;
  const search = typeof params === "string" ? params : params.toString();
  const value = new URLSearchParams(search).get("panel");
  return value === "timeline" || value === "graph" ? value : null;
}

function AskWorkspace() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const question = searchParams.get("q")?.trim() ?? "";
  const isPreviewMode = searchParams.get("preview") === "multiturn";
  const { transcript, isRestored, isAsking, pendingActions, ask, cancelAction, openDrawer, guide, guideTargets,
    models, defaultModelId, selectedModelId, selectModel, modelsReady, modelsFromFallback,
    thinkingEnabled, setThinkingEnabled, streamingTurnId,
    conversationGroups, activeConversationId, conversationsLoading, isCurrentConversationEmpty,
    newConversation, loadConversation, renameConversation, deleteConversation,
    pinConversation } = useAgentSession();
  const visibleTranscript = isPreviewMode ? PREVIEW_TRANSCRIPT : transcript;
  // 预览模式不消费真实会话的联动目标，避免静态布局被上一次真实回答的副驾驶面板干扰。
  const activeGuide = isPreviewMode ? null : guide;
  const activeGuideTargets = isPreviewMode ? null : guideTargets;
  const [draft, setDraft] = useState(question);
  /**
   * 副驾驶面板状态（V1.0.6.3）：同时携带时间轴 / 人物图目标，`active` 决定当前 iframe 视图。
   * 气泡底部的双按钮与面板头部的视图切换都改这一个状态，避免「一次只能看一个图」。
   */
  const [copilot, setCopilot] = useState<CopilotState | null>(null);
  /**
   * 从悬浮抽屉点击「查看人物图谱 / 查看时间轴」跳转过来时携带 `?panel=<surface>`：
   * 进页面后自动定位到对应视图（由下面的 effect 消费一次并清除 query）。
   */
  const [pendingPanelSurface, setPendingPanelSurface] = useState<CopilotSurface | null>(() =>
    readCopilotSurfaceParam(searchParams),
  );
  /**
   * SPA 导航（悬浮抽屉 → `/ask?panel=graph`）时 `useSearchParams` 偶尔会晚一帧才更新，
   * 这里挂载后再用 `window.location.search` 兜底读一次，保证「点击哪个视图就打开哪个视图」。
   */
  useEffect(() => {
    if (pendingPanelSurface) return;
    const fromLocation = readCopilotSurfaceParam(window.location.search);
    if (fromLocation) setPendingPanelSurface(fromLocation);
    // 只在挂载时兜底一次：之后面板切换全部走 React 状态，不再回读 URL。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const transcriptRef = useRef<HTMLOListElement>(null);
  /** 已经自动展开过的联动 turn：用户主动关掉面板后，同一轮不会被强行重新弹开。 */
  const lastAutoOpenedTurn = useRef<string | null>(null);
  const guideInitialized = useRef(false);
  /**
   * 中间聊天区滚动（V1.0.5.2-layout 补丁）。
   *
   * 滚动容器从文档改为 `.transcript` 自身（App Shell 内独立滚动）：
   * - 首屏 / 切换历史会话 / 发送新问题 / AI 返回新回答 → 自动回到底部（显示最新消息）；
   * - 首次挂载用 auto（瞬时）避免长会话出现从顶部滑到底的动画。
   */
  const transcriptScrollReady = useRef(false);
  const lastTranscriptTurnCount = useRef(0);
  const lastConversationId = useRef<string | null>(null);
  /**
   * 用户是否仍贴在聊天列表底部（V1.0.5.2-layout 补丁）。
   *
   * 回答落地 / 史引分屏导致列宽变化会触发文本重排，内容高度在滚动动画之后还会增长；
   * 用 ResizeObserver 在「用户没有主动往上翻」时把这些增量补齐，保证真正停在最新消息。
   */
  const stickToBottom = useRef(true);
  const scrollTranscriptToBottom = useCallback((behavior: ScrollBehavior = "smooth") => {
    const node = transcriptRef.current;
    if (!node) return;
    stickToBottom.current = true;
    node.scrollTo({ top: node.scrollHeight, behavior });
  }, []);
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
  /** 史引分屏时自动收起侧边栏，把横向空间让给 60% / 40% 分屏；关闭分屏后恢复用户选择。 */
  const sidebarVisible = !isPreviewMode && sidebarReady && !sidebarCollapsed && !copilot;
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
   * 100vh App Shell 锁（V1.0.5.2-layout 补丁）。
   *
   * `/ask` 最外层容器本身就是 100dvh + overflow: hidden；这里再给 html / body 加锁，
   * 确保任何子元素（史引 iframe / 超长回答 / 浮层）都不会把文档撑出第二根滚动条。
   * 离开页面时移除，不影响 `/`、`/timeline`、`/graph` 的正常文档滚动。
   */
  useEffect(() => {
    const root = document.documentElement;
    root.classList.add("askAppShell");
    document.body.classList.add("askAppShell");
    return () => {
      root.classList.remove("askAppShell");
      document.body.classList.remove("askAppShell");
    };
  }, []);

  // 中间聊天区自动滚动（V1.0.5.2-layout 补丁）：
  // 首屏 / 切换会话 / 新问题 / AI 新回答 → 滚动到聊天列表底部（最新消息）。
  useEffect(() => {
    if (isPreviewMode || !isRestored) return;
    const conversationChanged =
      lastConversationId.current !== activeConversationId;
    const hasNewTurn =
      visibleTranscript.length > lastTranscriptTurnCount.current;
    const firstPaint = !transcriptScrollReady.current;
    if (!firstPaint && !conversationChanged && !hasNewTurn && !isAsking) return;

    transcriptScrollReady.current = true;
    lastConversationId.current = activeConversationId;
    lastTranscriptTurnCount.current = visibleTranscript.length;
    const behavior: ScrollBehavior = firstPaint || conversationChanged ? "auto" : "smooth";
    // 等一帧让 React 把新消息 / 新会话内容写进 DOM 后再量 scrollHeight。
    const frame = window.requestAnimationFrame(() =>
      scrollTranscriptToBottom(behavior),
    );
    return () => window.cancelAnimationFrame(frame);
  }, [
    isPreviewMode,
    isRestored,
    visibleTranscript.length,
    isAsking,
    activeConversationId,
    scrollTranscriptToBottom,
  ]);

  /**
   * 补滚（V1.0.5.2-layout 补丁）：聊天容器尺寸变化时（史引 40/60 分屏、窗口缩放、
   * 引用折叠等）如果用户仍贴在底部，就重新对齐到最新消息，避免「回答明明更新了却停在中间」。
   */
  useEffect(() => {
    if (isPreviewMode) return;
    const node = transcriptRef.current;
    if (!node || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() => {
      if (!stickToBottom.current) return;
      node.scrollTop = node.scrollHeight;
    });
    observer.observe(node);
    return () => observer.disconnect();
  }, [isPreviewMode]);

  /** 打开 / 切换右侧史引面板到指定视图（V1.0.6.3）。 */
  const openGuide = useCallback(
    (targets: readonly AgentGuideTarget[], surface: CopilotSurface) => {
      const available = targets.map((target) => target.surface);
      const nextActive = available.includes(surface) ? surface : targets[0]?.surface;
      if (!nextActive) return;
      setCopilot({ targets: [...targets], active: nextActive });
    },
    [],
  );

  /**
   * P2：回答落地后自动展开史引副驾驶（V1.0.6.3 起双图联动）。
   *
   * `guideTargets` 由 AgentContext 从 transcript 派生：同一轮回答里时间轴 / 人物图
   * 任一（或同时）有可渲染深链接，就立刻打开右侧面板；同时存在两个目标时默认展示
   * 动作顺序里的主目标（问题焦点），用户可点气泡按钮或面板 tab 切换。
   *
   * 恢复旧会话（刷新 / 从完整时间轴返回）时不自动弹旧面板，保证落点仍是对话列表；
   * 但新回答（turnId 变化）**无论如何都会展开**，不再受「内联文字渲染」影响。
   */
  useEffect(() => {
    if (!isRestored) return;
    if (!activeGuideTargets) {
      if (!guideInitialized.current) guideInitialized.current = true;
      return;
    }
    if (!guideInitialized.current) {
      guideInitialized.current = true;
      lastAutoOpenedTurn.current = activeGuideTargets.turnId;
      return;
    }
    if (lastAutoOpenedTurn.current === activeGuideTargets.turnId) return;
    lastAutoOpenedTurn.current = activeGuideTargets.turnId;
    openGuide(activeGuideTargets.targets, activeGuideTargets.primary.surface);
  }, [activeGuideTargets, isRestored, openGuide]);

  /** 从悬浮抽屉跳转进来（`?panel=<surface>`）：自动展示用户点击的那个视图。 */
  useEffect(() => {
    if (!isRestored || !pendingPanelSurface || !activeGuideTargets) return;
    openGuide(activeGuideTargets.targets, pendingPanelSurface);
    setPendingPanelSurface(null);
    router.replace("/ask");
  }, [isRestored, pendingPanelSurface, activeGuideTargets, openGuide, router]);

  // 副驾驶面板已接管联动展示：同页待确认动作直接取消，避免 /ask 上残留跨页确认条。
  useEffect(() => {
    if (!activeGuide || pendingActions.length === 0) return;
    pendingActions.forEach((action) => cancelAction(action.id));
  }, [activeGuide, pendingActions, cancelAction]);

  /** 引用等单链接入口：打开面板并展示对应表面（V1.0.5 行为）。 */
  const openCopilot = (href: string, target: string) => {
    const guideTarget = guideTargetFromHref(href, target);
    setCopilot({ targets: [guideTarget], active: guideTarget.surface });
  };

  const submit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (isPreviewMode || isAsking || !draft.trim()) return;
    void ask(draft);
    setDraft("");
  };

  const chooseSuggestion = (suggestion: string) => setDraft(suggestion);

  const userTurnCount = visibleTranscript.filter((turn) => turn.role === "user").length;
  /**
   * V1.0.6.2：直答占位轮次（已落空 assistant turn）。首字到达前不再弹「正在连接本地模型」
   * 独立对话框，只在轮次 meta 上标注「深度思考中 / 生成中」，答案到达后自动替换为正文。
   */
  const streamTurn = visibleTranscript.find((turn) => turn.id === streamingTurnId);
  const streamHasContent = Boolean(streamTurn && streamTurn.content.trim());
  const pendingLabel = streamingTurnId
    ? streamHasContent
      ? null
      : thinkingEnabled
        ? "深度思考中"
        : "生成中"
    : null;
  /** 折叠按钮只在「有侧边栏可开合」时出现：预览模式 / 史引分屏自动让位时不显示。 */
  const canToggleSidebar = sidebarReady && !isPreviewMode && !copilot;

  return (
    <div className={`${styles.appFrame} ${sidebarSpaceFreed ? styles.sidebarCollapsed : ""}`} data-app-shell="100vh">
      {sidebarVisible ? (
        <ConversationSidebar
          groups={conversationGroups}
          activeConversationId={activeConversationId}
          isCurrentConversationEmpty={isCurrentConversationEmpty}
          onNewConversation={() => void newConversation()}
          onSelectConversation={(id) => void loadConversation(id)}
          onRenameConversation={(id, title) => void renameConversation(id, title)}
          onDeleteConversation={(id) => void deleteConversation(id)}
          onPinConversation={(id, pinned) => void pinConversation(id, pinned)}
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
        <div className={`${styles.shell} ${copilot ? styles.copilotMode : ""}`}>
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
                <span className={styles.workspaceKicker}>CONVERSATION WORKSPACE · V1.0.7</span>
                <h2 id="conversation-title">{isPreviewMode ? "多轮对话布局预览" : "你的历史对话"}</h2>
              </div>
              <div className={styles.chatHeaderMeta}>
                <span className={styles.syncNote}>
                  <i />
                  {isPreviewMode
                    ? "静态占位数据 · 不发送请求"
                    : isRestored
                      ? `${userTurnCount} 轮 · 会话已持久化`
                      : "正在载入会话…"}
                </span>
                <Link className={styles.previewLink} href={isPreviewMode ? "/ask" : "/ask?preview=multiturn"}>
                  {isPreviewMode ? "← 返回当前对话" : "多轮布局预览"}
                </Link>
              </div>
            </div>
            <div className={styles.conversationBody}>
              <ol
                className={styles.transcript}
                aria-live="polite"
                aria-busy={isAsking}
                ref={transcriptRef}
                data-transcript-scroll="true"
                onScroll={() => {
                  const node = transcriptRef.current;
                  if (!node) return;
                  stickToBottom.current =
                    node.scrollTop + node.clientHeight >= node.scrollHeight - 24;
                }}
              >
                {isPreviewMode ? <li className={styles.previewNotice}>静态数据仅用于验证多轮对话布局（时间线 / 长文本 / 每轮状态与引用），未连接发送与多轮业务逻辑。</li> : null}
                {visibleTranscript.map((turn) => <Message key={turn.id} turn={turn} guide={Boolean(turn.answer?.uiActions.length) || turn.id === activeGuide?.turnId} streaming={turn.id === streamingTurnId} pendingLabel={turn.id === streamingTurnId ? pendingLabel : null} onOpenReference={(href) => openCopilot(href, "史料关联事件")} onOpenGuide={openGuide} />)}
              </ol>
              {activeGuideTargets && !copilot ? <aside className={styles.guideRail} aria-label="史引联动区"><div className={styles.guideSeal} aria-hidden="true">引</div><span className={styles.guideLabel}>史引 · 副驾驶</span><strong>联动已就绪</strong><p>史令为您查阅史料，史引为您推演脉络。</p><div className={styles.guideRailActions}><GuideActionButtons compact targets={activeGuideTargets.targets} onOpen={(target) => openGuide(activeGuideTargets.targets, target.surface)} /></div></aside> : null}
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
                {/* V1.0.6.2：深度思考开关（替换原「逐字回答」，默认关闭 = 快速直答）。 */}
                <div className={styles.thinkingToggle}>
                  <button
                    type="button"
                    role="switch"
                    aria-checked={thinkingEnabled}
                    aria-label="切换深度思考模式"
                    className={styles.thinkingToggleButton}
                    data-active={thinkingEnabled ? "true" : undefined}
                    disabled={isPreviewMode || isAsking}
                    onClick={() => setThinkingEnabled(!thinkingEnabled)}
                    title={thinkingEnabled ? "关闭深度思考：直接生成最终答案，速度更快" : "开启深度思考：模型先推理再回答，更准但稍慢"}
                  >
                    <span className={styles.thinkingToggleDot} aria-hidden="true" />
                    <span>深度思考</span>
                  </button>
                  <span className={styles.composerTopNote}>
                    {thinkingEnabled
                      ? "先推理再回答 · 思考过程不上屏"
                      : "直接生成最终答案 · 速度快"}
                  </span>
                </div>
              </div>
              <form className={styles.composer} onSubmit={submit}>
                <label className={styles.srOnly} htmlFor="ask-composer">输入问题</label>
                <textarea id="ask-composer" value={draft} onChange={(event) => setDraft(event.target.value)} placeholder={isPreviewMode ? "V1.0.6.1 追问输入区预留" : "输入一个历史问题，例如：赤壁之战发生在哪一年"} rows={1} disabled={isAsking || isPreviewMode} onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); event.currentTarget.form?.requestSubmit(); } }} />
                <div className={styles.composerActions}>
                  <button type="button" className={styles.composerIconButton} title="附件上传（暂未开放）" aria-label="附件上传（暂未开放）" disabled>
                    <span aria-hidden="true">📎</span>
                  </button>
                  <button type="button" className={styles.composerIconButton} title="新建对话" aria-label="新建对话" disabled={isPreviewMode || isAsking} onClick={() => void newConversation()}>
                    <span aria-hidden="true">＋</span>
                  </button>
                  <button type="submit" disabled={isPreviewMode || isAsking || !draft.trim()} aria-label="发送问题"><span>{isAsking ? "检索中" : "发送"}</span><b aria-hidden="true">↗</b></button>
                </div>
              </form>
              <p className={styles.composerHint}>
                Enter 发送 · Shift + Enter 换行 ·{" "}
                {thinkingEnabled
                  ? "深度思考已开启：模型先推理再给出最终答案"
                  : "深度思考已关闭：直接输出最终答案，速度快"}
                {isPreviewMode ? "" : " · 历史对话已持久化，刷新不丢失"}
              </p>
            </div>
          </section>
          {copilot ? (
            <CopilotPanel
              state={copilot}
              onSwitch={(surface) => setCopilot((previous) => (previous ? { ...previous, active: surface } : previous))}
              onClose={() => setCopilot(null)}
            />
          ) : null}
        </div>
      </div>
      </main>
    </div>
  );
}

export default function AskPage() {
  return <Suspense fallback={<main className={styles.page}><div className={styles.loadingPage}>正在打开史脉问答…</div></main>}><AskWorkspace /></Suspense>;
}
