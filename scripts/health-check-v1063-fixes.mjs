#!/usr/bin/env node
/**
 * V1.0.6.3 布局专项 + 双图联动 · 真实 UI 验收（无头 Edge + CDP，无额外 npm 依赖）。
 *
 * 验收四项：
 * 1. 一句提问同时命中时间轴与人物图 → 气泡底部并排出现两个联动按钮
 *    `[查看人物图谱] [查看时间轴]`，右侧史引面板自动展开；
 * 2. 点击不同按钮 → 右侧面板 iframe 在 /timeline 与 /graph 之间切换（不再一次只能看一个图）；
 * 3. 右侧面板上下比例：时间轴轨道占主区（垂直舒展、圆点不挤成一条线），
 *    事件详情卡 ≤ 40% 且内部滚动；关系图画布撑满剩余空间、底部信息卡固定 120px；
 * 4. 内联文字关系树默认折叠：气泡里不再出现带 `├ / └` 的原始树代码块。
 *
 * 输入方式与真实用户一致：点入输入框 → CDP 文本输入（原生 value setter + input 事件）
 * → 点击「发送」。全程使用 `/ask?session_id=e2e_...` 测试会话（不污染用户正式历史）。
 *
 * Run: node scripts/health-check-v1063-fixes.mjs [--base-url http://localhost:3000]
 * 产物：.tmp/ui-v1063-check/result.json + 截图 + progress.log。
 */
import { spawn } from "node:child_process";
import { appendFile, mkdir, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as delay } from "node:timers/promises";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const EDGE_CANDIDATES = [
  process.env.EDGE_PATH,
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
  "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
];
const OPTIONS = {
  baseUrl: "http://localhost:3000",
  port: 9464,
  outDir: path.join(ROOT, ".tmp", "ui-v1063-check"),
};
const argv = process.argv.slice(2);
for (let i = 0; i < argv.length; i += 1) {
  if (argv[i] === "--base-url") OPTIONS.baseUrl = argv[++i].replace(/\/$/, "");
  else if (argv[i] === "--port") OPTIONS.port = Number(argv[++i]);
}

const QUESTION_EVENT = "玄武门之变发生在哪一年？";
const QUESTION_PERSON = "展示李世民的人物关系图";
const SESSION_PREFIX = "e2e_v1063";
const scenarioSessionId = (name) =>
  `${SESSION_PREFIX}_${name}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;

const GRAPH_TARGET = "/graph?person=p-lishimin-7efd";
const TIMELINE_TARGET = "/timeline?event=tang-04";

const EDGE = EDGE_CANDIDATES.find((candidate) => candidate && existsSync(candidate));
if (!EDGE) {
  console.error("Microsoft Edge not found (set EDGE_PATH)");
  process.exit(2);
}

const PROGRESS_LOG = path.join(OPTIONS.outDir, "progress.log");
const progress = async (label, data = {}) => {
  const line = `${new Date().toISOString()} ${label} ${JSON.stringify(data)}\n`;
  await appendFile(PROGRESS_LOG, line, "utf8").catch(() => {});
};

class Cdp {
  constructor(ws) {
    this.ws = ws;
    this.nextId = 1;
    this.pending = new Map();
    ws.addEventListener("message", (event) => {
      const message = JSON.parse(event.data);
      if (message.id && this.pending.has(message.id)) {
        const { resolve, reject, timer } = this.pending.get(message.id);
        this.pending.delete(message.id);
        clearTimeout(timer);
        if (message.error) reject(new Error(message.error.message));
        else resolve(message.result);
      }
    });
  }

  send(method, params = {}, timeoutMs = 30_000) {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`CDP timeout after ${timeoutMs}ms: ${method}`));
      }, timeoutMs);
      this.pending.set(id, { resolve, reject, timer });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }
}

async function connectCdp(port) {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/json/list`);
      const targets = await response.json();
      const page = targets.find(
        (item) => item.type === "page" && item.webSocketDebuggerUrl,
      );
      if (page?.webSocketDebuggerUrl) return page.webSocketDebuggerUrl;
    } catch {
      // Browser still starting.
    }
    await delay(250);
  }
  throw new Error("CDP page target not ready");
}

const summary = { ok: false, checks: {}, fields: {} };
let browser = null;
let cdp = null;

async function openCdp() {
  const wsUrl = await connectCdp(OPTIONS.port);
  const ws = new WebSocket(wsUrl);
  await new Promise((resolve, reject) => {
    ws.addEventListener("open", resolve, { once: true });
    ws.addEventListener("error", reject, { once: true });
  });
  cdp = new Cdp(ws);
  await cdp.send("Page.enable");
  await cdp.send("Runtime.enable");
}

const evaluate = async (expression, timeoutMs = 30_000) => {
  const result = await cdp.send(
    "Runtime.evaluate",
    { expression, returnByValue: true, awaitPromise: true },
    timeoutMs,
  );
  if (result.exceptionDetails) {
    throw new Error(result.exceptionDetails.text ?? "evaluate failed");
  }
  return result.result.value;
};

async function waitFor(expression, predicate, { attempts = 300, interval = 300, label = "" } = {}) {
  let last = null;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    last = await evaluate(expression);
    if (predicate(last)) return last;
    if (attempt > 0 && attempt % 20 === 0) await progress(`wait:${label}`, { attempt });
    await delay(interval);
  }
  return last;
}

async function screenshot(name) {
  const shot = await cdp.send("Page.captureScreenshot", { format: "png" });
  const file = path.join(OPTIONS.outDir, name);
  await writeFile(file, Buffer.from(shot.data, "base64"));
  return path.relative(ROOT, file);
}

const HYDRATED = `(() => {
  const el = document.querySelector('#ask-composer');
  if (!el) return false;
  return Object.keys(el).some((key) => key.startsWith('__reactFiber$'));
})()`;

const SET_COMPOSER_VALUE = (question) => `(() => {
  const el = document.querySelector('#ask-composer');
  if (!el) return null;
  const setter = Object.getOwnPropertyDescriptor(
    window.HTMLTextAreaElement.prototype, 'value'
  ).set;
  setter.call(el, ${JSON.stringify(question)});
  el.dispatchEvent(new Event('input', { bubbles: true }));
  return el.value;
})()`;

const SUBMIT = `(() => {
  const button = document.querySelector('button[aria-label="发送问题"]');
  if (!button || button.disabled) return false;
  button.click();
  return true;
})()`;

const READ_TRANSCRIPT = `(() => {
  const root = document.querySelector('[data-transcript-scroll]');
  const text = root ? root.innerText : '';
  return {
    text,
    busy: root ? root.getAttribute('aria-busy') : null,
    streamingTurns: document.querySelectorAll('[data-streaming="true"]').length,
  };
})()`;

/** 外层 /ask 页面：副驾驶面板 / 联动按钮 / 内联关系树折叠情况。 */
function inspectAskPageInPage() {
  const panel = document.querySelector('[class*="copilotPanel"]');
  const rect = panel ? panel.getBoundingClientRect() : null;
  const panelStyle = panel ? getComputedStyle(panel) : null;
  const iframe = panel ? panel.querySelector("iframe") : null;
  const iframeRect = iframe ? iframe.getBoundingClientRect() : null;
  const chat = document.querySelector('section[aria-labelledby="conversation-title"]');
  const chatRect = chat ? chat.getBoundingClientRect() : null;
  const transcript = document.querySelector('[data-transcript-scroll]');
  const turns = transcript ? [...transcript.querySelectorAll("li")] : [];
  const withActions = turns.filter((node) => node.querySelector("[data-guide-actions]"));
  const last = withActions[withActions.length - 1] ?? null;
  const buttons = last
    ? [...last.querySelectorAll("[data-guide-actions] button")].map((node) => ({
        surface: node.getAttribute("data-surface"),
        label: (node.textContent || "").replace(/\s+/g, " ").trim(),
        left: Math.round(node.getBoundingClientRect().left),
        top: Math.round(node.getBoundingClientRect().top),
      }))
    : [];
  const tabs = panel
    ? [...panel.querySelectorAll('[role="tab"]')].map((node) => ({
        surface: node.getAttribute("data-surface"),
        selected: node.getAttribute("aria-selected"),
      }))
    : [];
  const pres = transcript ? [...transcript.querySelectorAll("pre")] : [];
  const rawTreePres = pres.filter((node) => /[├└]/.test(node.textContent || "")).length;
  const collapsedTrees = transcript
    ? transcript.querySelectorAll('[data-relation-tree="collapsed"]').length
    : 0;
  return {
    panelExists: Boolean(panel),
    panelDisplay: panelStyle ? panelStyle.display : null,
    panelFlexDirection: panelStyle ? panelStyle.flexDirection : null,
    panelFlex: panelStyle ? panelStyle.flex : null,
    panelHeight: rect ? Math.round(rect.height) : null,
    panelWidth: rect ? Math.round(rect.width) : null,
    chatHeight: chatRect ? Math.round(chatRect.height) : null,
    panelSurface: panel ? panel.getAttribute("data-copilot-surface") : null,
    iframeSrc: iframe ? iframe.getAttribute("src") : null,
    iframeHeight: iframeRect ? Math.round(iframeRect.height) : null,
    tabs,
    guideButtonCount: buttons.length,
    guideButtons: buttons,
    guideButtonSides: {
      graphLeftOfTimeline: (() => {
        const graph = buttons.find((item) => item.surface === "graph");
        const timeline = buttons.find((item) => item.surface === "timeline");
        if (!graph || !timeline) return null;
        return graph.left <= timeline.left;
      })(),
    },
    collapsedTrees,
    rawTreePres,
    pageScrollHeight: document.documentElement.scrollHeight,
    pageClientHeight: document.documentElement.clientHeight,
    pageScrollY: window.scrollY,
  };
}

/** iframe 内部：时间轴 / 关系图的自适应布局指标。 */
function inspectCopilotInnerInPage() {
  const panel = document.querySelector('[class*="copilotPanel"]');
  const iframe = panel ? panel.querySelector("iframe") : null;
  if (!iframe) return { exists: false };
  const doc = iframe.contentDocument;
  const win = iframe.contentWindow;
  if (!doc || !win) return { exists: true, ready: false };
  const main = doc.querySelector("main");
  const embedded = main ? main.getAttribute("data-embed") : null;
  const base = {
    exists: true,
    ready: doc.readyState === "complete",
    embedded,
    innerHeight: win.innerHeight,
    docScrollHeight: doc.documentElement.scrollHeight,
    scrollY: win.scrollY,
  };
  const topRegion = doc.querySelector('[data-timeline-region="top"]');
  if (topRegion) {
    const topRect = topRegion.getBoundingClientRect();
    const detailRegion = doc.querySelector('[data-timeline-region="detail"]');
    const detailRect = detailRegion ? detailRegion.getBoundingClientRect() : null;
    const detailStyle = detailRegion ? getComputedStyle(detailRegion) : null;
    const viewport = doc.querySelector('[data-timeline-track="true"]');
    const track = viewport ? viewport.firstElementChild : null;
    const trackRect = track ? track.getBoundingClientRect() : null;
    const viewportRect = viewport ? viewport.getBoundingClientRect() : null;
    const card = doc.querySelector('[data-timeline-event-card="true"]');
    const cardRect = card ? card.getBoundingClientRect() : null;
    const dots = track ? [...track.querySelectorAll("button")] : [];
    const dotRects = dots.map((node) => node.getBoundingClientRect());
    const dotTop = dotRects.length ? Math.min(...dotRects.map((item) => item.top)) : null;
    const dotBottom = dotRects.length ? Math.max(...dotRects.map((item) => item.bottom)) : null;
    return {
      ...base,
      kind: "timeline",
      topRegionHeight: Math.round(topRect.height),
      detailRegionHeight: detailRect ? Math.round(detailRect.height) : null,
      detailOverflowY: detailStyle ? detailStyle.overflowY : null,
      trackViewportHeight: viewportRect ? Math.round(viewportRect.height) : null,
      trackHeight: trackRect ? Math.round(trackRect.height) : null,
      trackInsideViewport: Boolean(
        trackRect &&
          viewportRect &&
          trackRect.top >= viewportRect.top - 2 &&
          trackRect.bottom <= viewportRect.bottom + 2,
      ),
      trackFillsViewport: Boolean(
        trackRect && viewportRect && trackRect.height >= viewportRect.height - 12,
      ),
      dotCount: dotRects.length,
      dotVerticalSpan:
        dotTop !== null && dotBottom !== null ? Math.round(dotBottom - dotTop) : null,
      dotVerticalRatio:
        dotTop !== null && dotBottom !== null && trackRect && trackRect.height > 0
          ? Math.round(((dotBottom - dotTop) / trackRect.height) * 100) / 100
          : null,
      cardHeight: cardRect ? Math.round(cardRect.height) : null,
    };
  }

  const graphSection = doc.querySelector('section[aria-label="人物关系网络"]');
  const graphHost = doc.querySelector('[data-graph-host="true"]');
  const infoCard = doc.querySelector('[data-graph-info-card="true"]');
  const svg = graphSection ? graphSection.querySelector("svg") : null;
  const svgRect = svg ? svg.getBoundingClientRect() : null;
  const hostRect = graphHost ? graphHost.getBoundingClientRect() : null;
  const cardRect = infoCard ? infoCard.getBoundingClientRect() : null;
  const nodeNodes = svg
    ? [...svg.querySelectorAll('[role="button"], [role="img"]')]
    : [];
  const nodeRects = nodeNodes
    .map((node) => node.getBoundingClientRect())
    .filter((rect) => rect.width > 0 && rect.height > 0);
  const union = nodeRects.length
    ? nodeRects.reduce(
        (acc, rect) => ({
          left: Math.min(acc.left, rect.left),
          top: Math.min(acc.top, rect.top),
          right: Math.max(acc.right, rect.right),
          bottom: Math.max(acc.bottom, rect.bottom),
        }),
        {
          left: Number.POSITIVE_INFINITY,
          top: Number.POSITIVE_INFINITY,
          right: Number.NEGATIVE_INFINITY,
          bottom: Number.NEGATIVE_INFINITY,
        },
      )
    : null;
  const infoCardText = infoCard ? (infoCard.innerText || "").replace(/\s+/g, " ") : "";
  const neighborMatch = /当前显示\s*(\d+)\s*位直接关系人/.exec(infoCardText);
  const zoomButtons = graphSection
    ? [...graphSection.querySelectorAll("button")].filter((node) =>
        ["放大关系图", "缩小关系图", "复位关系图视图"].includes(
          node.getAttribute("aria-label"),
        ),
      )
    : [];
  return {
    ...base,
    kind: "graph",
    infoCardText,
    neighborCount: neighborMatch ? Number(neighborMatch[1]) : null,
    graphHostHeight: hostRect ? Math.round(hostRect.height) : null,
    graphHostWidth: hostRect ? Math.round(hostRect.width) : null,
    graphSvgHeight: svgRect ? Math.round(svgRect.height) : null,
    graphSvgWidth: svgRect ? Math.round(svgRect.width) : null,
    infoCardHeight: cardRect ? Math.round(cardRect.height) : null,
    infoCardRatio:
      cardRect && rect0(hostRect) > 0
        ? Math.round((cardRect.height / (cardRect.height + hostRect.height)) * 100) / 100
        : null,
    nodeCount: nodeRects.length,
    nodeCoverageWidth:
      union && svgRect && svgRect.width > 0
        ? Math.round(((union.right - union.left) / svgRect.width) * 100) / 100
        : null,
    nodeCoverageHeight:
      union && svgRect && svgRect.height > 0
        ? Math.round(((union.bottom - union.top) / svgRect.height) * 100) / 100
        : null,
    zoomButtonCount: zoomButtons.length,
  };
  // eslint-disable-next-line no-unreachable
  function rect0(value) {
    return value ? value.height : 0;
  }
}

const INSPECT_ASK = `(${inspectAskPageInPage.toString()})()`;
const INSPECT_INNER = `(${inspectCopilotInnerInPage.toString()})()`;

const CLICK_GUIDE_BUTTON = (surface) => `(() => {
  const transcript = document.querySelector('[data-transcript-scroll]');
  const buttons = transcript
    ? [...transcript.querySelectorAll('[data-guide-actions] button')]
    : [];
  const target = [...buttons].reverse().find((node) => node.getAttribute('data-surface') === ${JSON.stringify(surface)});
  if (!target) return false;
  target.click();
  return true;
})()`;

async function runScenario({ question, name, expectPrimary, wantSwitchTo }) {
  const scenario = { question, checks: {}, fields: {} };
  const sessionId = scenarioSessionId(name);
  scenario.fields.sessionId = sessionId;
  await progress("scenario:start", { question, sessionId });

  await cdp.send("Page.navigate", {
    url: `${OPTIONS.baseUrl}/ask?session_id=${encodeURIComponent(sessionId)}`,
  });
  scenario.checks.hydrated = (await waitFor(HYDRATED, Boolean, {
    attempts: 240,
    interval: 250,
    label: "hydrated",
  })) === true;
  await waitFor(`Boolean(document.querySelector('button[aria-label="发送问题"]'))`, Boolean, {
    attempts: 80,
    interval: 250,
    label: "send-button",
  });

  const typed = await evaluate(SET_COMPOSER_VALUE(question));
  scenario.fields.typed = typed;
  scenario.checks.typedQuestion = typed === question;
  await delay(200);
  scenario.checks.submitted = (await evaluate(SUBMIT)) === true;

  const settled = await waitFor(
    READ_TRANSCRIPT,
    (state) =>
      Boolean(
        state &&
          state.busy === "false" &&
          state.streamingTurns === 0 &&
          state.text.length > question.length + 100,
      ),
    { attempts: 600, interval: 350, label: "answer-settled" },
  );
  scenario.checks.answerSettled = Boolean(settled && settled.busy === "false");
  await progress("scenario:settled", { chars: settled?.text?.length ?? 0 });

  // ---- 1. 面板自动展开 + 双图按钮 ----
  const page = await waitFor(
    INSPECT_ASK,
    (state) => Boolean(state?.panelExists && state.guideButtonCount >= 2),
    { attempts: 120, interval: 250, label: "copilot-panel" },
  );
  scenario.fields.page = page;
  scenario.checks.panelOpened = Boolean(page?.panelExists);
  scenario.checks.dualButtons =
    page?.guideButtonCount === 2 &&
    new Set((page?.guideButtons ?? []).map((item) => item.surface)).size === 2;
  scenario.checks.buttonLabels = JSON.stringify(
    (page?.guideButtons ?? []).map((item) => item.label),
  ).includes("人物图谱");
  scenario.checks.graphButtonLeftOfTimeline = page?.guideButtonSides?.graphLeftOfTimeline === true;
  scenario.checks.primarySurfaceCorrect = page?.panelSurface === expectPrimary.surface;
  scenario.checks.primaryTargetCorrect = Boolean(
    page?.iframeSrc?.startsWith(expectPrimary.pathPrefix) &&
      page?.iframeSrc?.includes(expectPrimary.entity),
  );
  scenario.checks.panelFlexColumn =
    page?.panelDisplay === "flex" && page?.panelFlexDirection === "column";
  scenario.checks.panelHeightMatchesChat =
    typeof page?.panelHeight === "number" &&
    typeof page?.chatHeight === "number" &&
    Math.abs(page.panelHeight - page.chatHeight) <= 2;
  scenario.checks.iframeFillsPanel =
    typeof page?.iframeHeight === "number" &&
    typeof page?.panelHeight === "number" &&
    page.iframeHeight / page.panelHeight >= 0.84;
  scenario.checks.noPageScroll = Boolean(
    page?.panelExists &&
      page.pageScrollHeight <= page.pageClientHeight + 2 &&
      page.pageScrollY === 0,
  );
  scenario.checks.inlineTreeCollapsed = (page?.rawTreePres ?? 0) === 0;

  // ---- 2. 点击按钮切换视图 ----
  let innerBefore = await waitFor(
    INSPECT_INNER,
    (state) =>
      Boolean(
        state?.ready &&
          state.embedded === "true" &&
          state.kind === (expectPrimary.surface === "timeline" ? "timeline" : "graph"),
      ),
    { attempts: 120, interval: 300, label: "inner-ready" },
  );
  scenario.fields.innerPrimary = innerBefore;
  if (expectPrimary.surface === "timeline") {
    scenario.checks.timelineEmbedded = innerBefore?.embedded === "true";
    scenario.checks.timelineTrackDominates =
      (innerBefore?.trackViewportHeight ?? 0) > (innerBefore?.detailRegionHeight ?? 0);
    scenario.checks.timelineTrackFillsViewport = innerBefore?.trackFillsViewport === true;
    scenario.checks.timelineTrackInsideViewport = innerBefore?.trackInsideViewport === true;
    scenario.checks.timelineDotsSpread = (innerBefore?.dotVerticalRatio ?? 0) >= 0.5;
    scenario.checks.timelineDetailMaxFortyPercent =
      (innerBefore?.detailRegionHeight ?? 0) <=
      Math.ceil(((innerBefore?.innerHeight ?? 0) * 0.44));
    scenario.checks.timelineDetailScrollable = innerBefore?.detailOverflowY === "auto";
    scenario.checks.innerNoPageScroll = Boolean(
      innerBefore && innerBefore.docScrollHeight <= innerBefore.innerHeight + 2,
    );
    scenario.checks.screenshotPrimary = Boolean(
      await screenshot(`01-${name}-timeline-primary.png`),
    );

    const clicked = await evaluate(CLICK_GUIDE_BUTTON(wantSwitchTo.surface));
    scenario.checks.switchButtonClicked = clicked === true;
    const switched = await waitFor(
      `(() => {
        const panel = document.querySelector('[class*="copilotPanel"]');
        const iframe = panel ? panel.querySelector('iframe') : null;
        return panel ? {
          surface: panel.getAttribute('data-copilot-surface'),
          src: iframe ? iframe.getAttribute('src') : null,
          tabs: [...panel.querySelectorAll('[role="tab"]')].map((node) => ({
            surface: node.getAttribute('data-surface'),
            selected: node.getAttribute('aria-selected'),
          })),
        } : null;
      })()`,
      (state) =>
        Boolean(
          state &&
            state.surface === wantSwitchTo.surface &&
            state.src?.startsWith(wantSwitchTo.pathPrefix) &&
            state.src?.includes(wantSwitchTo.entity),
        ),
      { attempts: 80, interval: 250, label: "switched-" + wantSwitchTo.surface },
    );
    scenario.fields.switched = switched;
    scenario.checks.viewSwitched = Boolean(
      switched &&
        switched.surface === wantSwitchTo.surface &&
        switched.src?.startsWith(wantSwitchTo.pathPrefix),
    );
    scenario.checks.viewSwitchTabState = Boolean(
      (switched?.tabs ?? []).some(
        (tab) => tab.surface === wantSwitchTo.surface && tab.selected === "true",
      ),
    );
  } else {
    // 关系图首帧会跑力导向 + 自动适配视图：等节点真正铺满画布后再取指标，避免采样到动画中间态。
    innerBefore = await waitFor(
      INSPECT_INNER,
      (state) =>
        Boolean(
          state?.ready &&
            state.kind === "graph" &&
            (state.nodeCoverageWidth ?? 0) >= 0.55 &&
            (state.nodeCoverageHeight ?? 0) >= 0.55,
        ),
      { attempts: 80, interval: 250, label: "graph-fit-settle" },
    );
    scenario.fields.innerBeforeGraph = innerBefore;
    // 人物图为主目标：直接校验画布撑满 + 底部信息卡固定 120px。
    scenario.checks.graphEmbedded = innerBefore?.embedded === "true";
    scenario.checks.graphCanvasDominates =
      (innerBefore?.graphHostHeight ?? 0) / (innerBefore?.innerHeight ?? 1) >= 0.5;
    scenario.checks.graphCanvasFillsWidth =
      Math.abs(
        (innerBefore?.graphSvgWidth ?? 0) - (innerBefore?.graphHostWidth ?? 0),
      ) <= 2;
    scenario.checks.graphInfoCardFixed120 =
      Math.abs((innerBefore?.infoCardHeight ?? 0) - 120) <= 2;
    scenario.checks.graphInfoCardCompact =
      (innerBefore?.infoCardHeight ?? 999) / (innerBefore?.innerHeight ?? 1) <= 0.25;
    scenario.checks.graphZoomControls = (innerBefore?.zoomButtonCount ?? 0) >= 3;
    scenario.checks.graphNodesSpreadWidth = (innerBefore?.nodeCoverageWidth ?? 0) >= 0.55;
    scenario.checks.graphNodesSpreadHeight = (innerBefore?.nodeCoverageHeight ?? 0) >= 0.55;
    // 跨分期人物（李世民同时出现在隋 / 唐）必须落到关系更完整的「唐」，而不是只有 3 位邻居的「隋」。
    scenario.checks.graphEraCorrect =
      (innerBefore?.neighborCount ?? 0) >= 5 &&
      (innerBefore?.infoCardText ?? "").includes("李世民");
    scenario.checks.innerNoPageScroll = Boolean(
      innerBefore && innerBefore.docScrollHeight <= innerBefore.innerHeight + 2,
    );
    scenario.checks.screenshotPrimary = Boolean(
      await screenshot(`02-${name}-graph-primary.png`),
    );

    const clicked = await evaluate(CLICK_GUIDE_BUTTON(wantSwitchTo.surface));
    scenario.checks.switchButtonClicked = clicked === true;
    const switched = await waitFor(
      `(() => {
        const panel = document.querySelector('[class*="copilotPanel"]');
        const iframe = panel ? panel.querySelector('iframe') : null;
        return panel ? {
          surface: panel.getAttribute('data-copilot-surface'),
          src: iframe ? iframe.getAttribute('src') : null,
        } : null;
      })()`,
      (state) =>
        Boolean(
          state &&
            state.surface === wantSwitchTo.surface &&
            state.src?.startsWith(wantSwitchTo.pathPrefix) &&
            state.src?.includes(wantSwitchTo.entity),
        ),
      { attempts: 80, interval: 250, label: "switched-" + wantSwitchTo.surface },
    );
    scenario.fields.switched = switched;
    scenario.checks.viewSwitched = Boolean(
      switched && switched.surface === wantSwitchTo.surface,
    );
    const innerAfter = await waitFor(
      INSPECT_INNER,
      (state) =>
        Boolean(
          state?.ready && state.embedded === "true" && state.kind === "timeline",
        ),
      { attempts: 120, interval: 300, label: "timeline-ready" },
    );
    scenario.fields.innerAfter = innerAfter;
    scenario.checks.timelineTrackDominatesAfterSwitch =
      (innerAfter?.trackViewportHeight ?? 0) > (innerAfter?.detailRegionHeight ?? 0);
    scenario.checks.timelineTrackFillsViewportAfterSwitch =
      innerAfter?.trackFillsViewport === true;
    scenario.checks.screenshotSwitch = Boolean(
      await screenshot(`03-${name}-switch-timeline.png`),
    );
  }

  scenario.checks.screenshot = Boolean(await screenshot(`04-${name}-final.png`));
  await progress("scenario:done", { checks: scenario.checks });
  return scenario;
}

async function runDrawerScenario() {
  const scenario = { checks: {}, fields: {} };
  const sessionId = scenarioSessionId("drawer");
  scenario.fields.sessionId = sessionId;
  await progress("drawer:start", { sessionId });

  await cdp.send("Page.navigate", {
    url: `${OPTIONS.baseUrl}/?session_id=${encodeURIComponent(sessionId)}`,
  });
  const hydrated = await waitFor(
    `(() => {
      const el = document.querySelector('button[aria-label="打开史脉问答抽屉"]');
      if (!el) return false;
      return Object.keys(el).some(
        (key) => key.startsWith('__reactFiber$') || key.startsWith('__reactProps$')
      );
    })()`,
    Boolean,
    { attempts: 160, interval: 250, label: "drawer-launcher" },
  );
  scenario.checks.hydrated = hydrated === true;
  await delay(300);

  // 打开悬浮问答抽屉（用 aria-label 精确定位，避免首页其他 launcher 样式元素干扰）。
  scenario.checks.drawerOpened = (await evaluate(`(() => {
    const launcher = document.querySelector('button[aria-label="打开史脉问答抽屉"]');
    if (!launcher) return false;
    launcher.click();
    return true;
  })()`)) === true;
  const drawerReady = await waitFor(
    `Boolean(document.querySelector('#shimai-agent-input'))`,
    Boolean,
    { attempts: 80, interval: 250, label: "drawer-input" },
  );
  scenario.checks.drawerReady = drawerReady === true;

  const typed = await evaluate(`(() => {
    const el = document.querySelector('#shimai-agent-input');
    if (!el) return null;
    const setter = Object.getOwnPropertyDescriptor(
      window.HTMLInputElement.prototype, 'value'
    ).set;
    setter.call(el, ${JSON.stringify(QUESTION_EVENT)});
    el.dispatchEvent(new Event('input', { bubbles: true }));
    return el.value;
  })()`);
  scenario.fields.typed = typed;
  scenario.checks.typedQuestion = typed === QUESTION_EVENT;
  await delay(150);
  scenario.checks.submitted = (await evaluate(`(() => {
    const form = document.querySelector('#shimai-agent-input')?.closest('form');
    if (!form) return false;
    form.requestSubmit();
    return true;
  })()`)) === true;

  const drawerButtons = await waitFor(
    `(() => {
      const dialog = document.querySelector('section[role="dialog"]');
      const transcript = dialog ? dialog.querySelector('[class*="transcript"]') : null;
      const buttons = transcript
        ? [...transcript.querySelectorAll('[data-guide-actions] button')]
        : [];
      return buttons.map((node) => ({
        surface: node.getAttribute('data-surface'),
        label: (node.textContent || '').replace(/\\s+/g, ' ').trim(),
      }));
    })()`,
    (buttons) => Array.isArray(buttons) && buttons.length >= 2,
    { attempts: 600, interval: 350, label: "drawer-buttons" },
  );
  scenario.fields.drawerButtons = drawerButtons;
  scenario.checks.drawerDualButtons =
    Array.isArray(drawerButtons) &&
    new Set(drawerButtons.map((item) => item.surface)).size === 2;

  // 点击「人物图谱」→ 跳转完整对话并直接展开右侧人物图面板。
  scenario.checks.clicked = (await evaluate(`(() => {
    const buttons = [...document.querySelectorAll('[data-guide-actions] button')];
    const target = buttons.find((node) => node.getAttribute('data-surface') === 'graph');
    if (!target) return false;
    target.click();
    return true;
  })()`)) === true;
  const navigated = await waitFor(
    `(() => ({ href: window.location.pathname + window.location.search }))()`,
    // `/ask` 页会消费 `?panel=` 后立刻 replace 成 `/ask`，两种落点都视为导航成功。
    (state) => Boolean(state?.href === "/ask" || state?.href?.startsWith("/ask?")),
    { attempts: 80, interval: 250, label: "drawer-navigate" },
  );
  scenario.fields.navigated = navigated;
  scenario.checks.navigatedToAsk = navigated?.href === "/ask" || navigated?.href?.startsWith("/ask?");
  const panel = await waitFor(
    INSPECT_ASK,
    (state) =>
      Boolean(
        state?.panelExists &&
          state.panelSurface === "graph" &&
          state.iframeSrc?.startsWith("/graph"),
      ),
    { attempts: 120, interval: 300, label: "drawer-panel" },
  );
  scenario.fields.panel = panel;
  scenario.checks.drawerOpensTargetPanel = Boolean(
    panel?.panelExists &&
      panel.panelSurface === "graph" &&
      panel.iframeSrc?.includes("person=p-lishimin-7efd"),
  );
  scenario.checks.screenshot = Boolean(
    await screenshot("05-drawer-graph-panel.png"),
  );
  await progress("drawer:done", { checks: scenario.checks });
  return scenario;
}

async function main() {
  await mkdir(OPTIONS.outDir, { recursive: true });
  await writeFile(PROGRESS_LOG, "", "utf8");
  const userDataDir = path.join(OPTIONS.outDir, "edge-profile");
  await rm(userDataDir, { recursive: true, force: true });
  browser = spawn(
    EDGE,
    [
      "--headless=new",
      "--disable-gpu",
      "--no-first-run",
      "--no-default-browser-check",
      "--disable-sync",
      "--disable-features=msEdgeSidebarV2",
      `--remote-debugging-port=${OPTIONS.port}`,
      `--user-data-dir=${userDataDir}`,
      "--window-size=1440,960",
      "about:blank",
    ],
    { stdio: "ignore" },
  );
  try {
    await openCdp();

    // 场景 1：事件题 → 时间轴为主，气泡双按钮，点击切到人物图。
    const eventScenario = await runScenario({
      question: QUESTION_EVENT,
      name: "xuanwumen",
      expectPrimary: { surface: "timeline", pathPrefix: "/timeline", entity: "event=tang-04" },
      wantSwitchTo: { surface: "graph", pathPrefix: "/graph", entity: "person=p-lishimin-7efd" },
    });
    summary.fields.eventScenario = eventScenario.fields;
    summary.checks.eventScenario = eventScenario.checks;

    // 场景 2：人物题 → 人物图为主，画布撑满 / 信息卡 120px，点击切到时间轴。
    const personScenario = await runScenario({
      question: QUESTION_PERSON,
      name: "lishimin",
      expectPrimary: { surface: "graph", pathPrefix: "/graph", entity: "person=p-lishimin-7efd" },
      wantSwitchTo: { surface: "timeline", pathPrefix: "/timeline", entity: "event=tang-04" },
    });
    summary.fields.personScenario = personScenario.fields;
    summary.checks.personScenario = personScenario.checks;

    // 场景 3：悬浮抽屉（AgentDrawer）同样有双按钮，点击后跳转完整对话并打开对应视图。
    const drawerScenario = await runDrawerScenario();
    summary.fields.drawerScenario = drawerScenario.fields;
    summary.checks.drawerScenario = drawerScenario.checks;

    // 测试会话隔离：e2e_ 前缀只写后端测试库，不进入用户正式历史。
    const sessions = await fetch(`${OPTIONS.baseUrl}/api/sessions`)
      .then((response) => response.json())
      .then((payload) => (Array.isArray(payload?.sessions) ? payload.sessions : []))
      .catch(() => []);
    summary.checks.sessionIsolation = {
      noTestSessionIdsInHistory: sessions.every(
        (item) => !/^(test_|e2e_|pytest_|smoke_|probe-)/.test(String(item.session_id)),
      ),
    };

    summary.ok = Object.values(summary.checks).every((value) =>
      typeof value === "boolean" ? value : Object.values(value).every(Boolean),
    );
  } catch (error) {
    summary.error = String(error?.stack ?? error);
    await progress("error", { error: summary.error });
  } finally {
    if (cdp) {
      try {
        await cdp.send("Browser.close", {}, 5000);
      } catch {
        // ignore
      }
    }
    browser?.kill("SIGKILL");
    await delay(400);
    await rm(userDataDir, { recursive: true, force: true }).catch(() => {});
  }
  await writeFile(
    path.join(OPTIONS.outDir, "result.json"),
    `${JSON.stringify(summary, null, 2)}\n`,
    "utf8",
  );
  console.log(
    JSON.stringify({ ok: summary.ok, checks: summary.checks, error: summary.error }, null, 2),
  );
  if (!summary.ok) process.exitCode = 1;
}

await main();