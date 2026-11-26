#!/usr/bin/env node
/**
 * V1.0.6.2 收尾 · 真实 UI 验收（无头 Edge + CDP，无额外 npm 依赖）。
 *
 * 验收三项收尾修改：
 * 1. 历史数据隔离（痛点 1）：全程使用 `/ask?session_id=e2e_...` 测试会话，
 *    运行前后 `/api/sessions` 列表数量必须一致、不得出现任何 e2e_ 测试会话；
 *    页面不得再出现「正在连接本地模型」对话框；
 * 2. 深度思考开关（痛点 2）：「逐字回答」已重命名为「深度思考」，默认关闭；
 *    点击后 aria-checked=true、再点恢复关闭；真实流式直答仍正常产出答案且无重复内容；
 * 3. 史引面板比例（痛点 3）：左对话 60% / 右史引 40%（同一网格，不再 fixed 盖住对话）；
 *    右面板 iframe 填满面板高度；iframe 内时间轴「上方 Tab+轨道 ≈50% / 下方事件详情 ≈50%」，
 *    详情卡在自己的区域滚动、轨道在 50% 区域内完整可见；整页无第二根滚动条。
 *
 * 输入方式与真实用户一致：点入输入框 → CDP 文本输入（原生 value setter + input 事件，
 * 兼容 React 受控组件）→ 点击「发送」。不使用 ?q= 预填。
 *
 * Run: node scripts/health-check-v1062-fixes.mjs [--base-url http://localhost:3000]
 * 产物：.tmp/ui-v1062-check/result.json + 截图 + progress.log。
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
  port: 9463,
  outDir: path.join(ROOT, ".tmp", "ui-v1062-check"),
};
const argv = process.argv.slice(2);
for (let i = 0; i < argv.length; i += 1) {
  if (argv[i] === "--base-url") OPTIONS.baseUrl = argv[++i].replace(/\/$/, "");
  else if (argv[i] === "--port") OPTIONS.port = Number(argv[++i]);
}

const QUESTION_EVENT = "赤壁之战发生在哪一年？";
const QUESTION_RELATION = "曹操和刘备是什么关系？";
const SESSION_PREFIX = "e2e_v1062";
/** 本次验收使用的可丢弃测试会话 id（后端只写独立测试库，不进入用户正式历史）。 */
const scenarioSessionId = (name) =>
  `${SESSION_PREFIX}_${name}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
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

const summary = { ok: false, checks: {}, fields: {}, questions: [QUESTION_EVENT, QUESTION_RELATION] };
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

const READ_TRANSCRIPT = `(() => {
  const root = document.querySelector('[data-transcript-scroll]');
  const text = root ? root.innerText : '';
  return {
    text,
    busy: root ? root.getAttribute('aria-busy') : null,
    streamingTurns: document.querySelectorAll('[data-streaming="true"]').length,
    panel: Boolean(document.querySelector('[class*="copilotPanel"]')),
  };
})()`;

/** 页面内纯函数（会被 toString 后交给 Runtime.evaluate，不能引用 Node 侧变量）。 */
function inspectCopilotInPage() {
  const panel = document.querySelector('[class*="copilotPanel"]');
  if (!panel) return { exists: false };
  const rect = panel.getBoundingClientRect();
  const style = getComputedStyle(panel);
  const chatCard = document.querySelector('section[aria-labelledby="conversation-title"]');
  const chatRect = chatCard ? chatCard.getBoundingClientRect() : null;
  const iframe = panel.querySelector("iframe");
  const frameRect = iframe ? iframe.getBoundingClientRect() : null;
  const pageText = document.body.innerText || "";
  const toggle = document.querySelector('[role="switch"][aria-label="切换深度思考模式"]');
  let inner = null;
  try {
    const doc = iframe && iframe.contentDocument;
    const win = iframe && iframe.contentWindow;
    const main = doc ? doc.querySelector("main") : null;
    const topRegion = doc ? doc.querySelector('[data-timeline-region="top"]') : null;
    const detailRegion = doc ? doc.querySelector('[data-timeline-region="detail"]') : null;
    const trackViewport = doc ? doc.querySelector('[data-timeline-track="true"]') : null;
    const track = trackViewport ? trackViewport.firstElementChild : null;
    const card = doc ? doc.querySelector('[data-timeline-event-card="true"]') : null;
    const graphSection = doc ? doc.querySelector('section[aria-label="人物关系网络"]') : null;
    const graphSvg = doc ? doc.querySelector('section[aria-label="人物关系网络"] svg') : null;
    const zoomLabels = ["放大关系图", "缩小关系图", "复位关系图视图"];
    const zoomButtons = doc
      ? [...doc.querySelectorAll("button")].filter((node) =>
          zoomLabels.includes(node.getAttribute("aria-label")),
        )
      : [];
    const topRect = topRegion ? topRegion.getBoundingClientRect() : null;
    const detailRect = detailRegion ? detailRegion.getBoundingClientRect() : null;
    const trackRect = track ? track.getBoundingClientRect() : null;
    const viewportRect = trackViewport ? trackViewport.getBoundingClientRect() : null;
    const cardRect = card ? card.getBoundingClientRect() : null;
    const detailStyle = detailRegion ? getComputedStyle(detailRegion) : null;
    inner = {
      readyState: doc ? doc.readyState : null,
      embedded: main ? main.getAttribute("data-embed") : null,
      docScrollHeight: doc ? doc.documentElement.scrollHeight : null,
      innerHeight: win ? win.innerHeight : null,
      innerScrollY: win ? win.scrollY : null,
      topRegionHeight: topRect ? Math.round(topRect.height) : null,
      detailRegionHeight: detailRect ? Math.round(detailRect.height) : null,
      detailOverflowY: detailStyle ? detailStyle.overflowY : null,
      detailScrollHeight: detailRegion ? detailRegion.scrollHeight : null,
      detailClientHeight: detailRegion ? detailRegion.clientHeight : null,
      cardHeight: cardRect ? Math.round(cardRect.height) : null,
      cardTopOffset: cardRect && detailRect ? Math.round(cardRect.top - detailRect.top) : null,
      trackViewportHeight: viewportRect ? Math.round(viewportRect.height) : null,
      trackHeight: trackRect ? Math.round(trackRect.height) : null,
      trackWidth: trackRect ? Math.round(trackRect.width) : null,
      trackInsideViewport: Boolean(
        trackRect &&
          viewportRect &&
          trackRect.top >= viewportRect.top - 2 &&
          trackRect.bottom <= viewportRect.bottom + 2,
      ),
      graphSvgHeight: graphSvg ? Math.round(graphSvg.getBoundingClientRect().height) : null,
      graphHostFound: Boolean(graphSection),
      zoomButtonCount: zoomButtons.length,
      zoomButtonLabels: zoomButtons.map((node) => node.getAttribute("aria-label")),
    };
  } catch (error) {
    inner = { error: String(error) };
  }
  return {
    exists: true,
    title: panel.querySelector("h2")?.textContent?.trim() ?? "",
    kicker: panel.querySelector('[class*="copilotKicker"]')?.textContent?.trim() ?? "",
    position: style.position,
    panelWidth: Math.round(rect.width),
    panelHeight: Math.round(rect.height),
    chatWidth: chatRect ? Math.round(chatRect.width) : null,
    panelWidthRatioOfPair:
      chatRect && chatRect.width + rect.width > 0
        ? Math.round((rect.width / (chatRect.width + rect.width)) * 100) / 100
        : null,
    viewportWidth: window.innerWidth,
    viewportHeight: window.innerHeight,
    iframeSrc: iframe ? iframe.getAttribute("src") : null,
    iframeHeight: frameRect ? Math.round(frameRect.height) : null,
    iframeHeightRatio: frameRect ? Math.round((frameRect.height / rect.height) * 100) / 100 : null,
    pageScrollY: window.scrollY,
    pageScrollHeight: document.documentElement.scrollHeight,
    pageClientHeight: document.documentElement.clientHeight,
    hasConnectingDialog: pageText.includes("正在连接本地模型"),
    thinkingToggleExists: Boolean(toggle),
    thinkingToggleChecked: toggle ? toggle.getAttribute("aria-checked") : null,
    thinkingToggleLabel: toggle ? (toggle.textContent || "").trim() : "",
    inner,
  };
}

const INSPECT_COPILOT = `(${inspectCopilotInPage.toString()})()`;

/** 原生 value setter + input 事件：兼容 React 受控 textarea。 */
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

const HYDRATED = `(() => {
  const el = document.querySelector('#ask-composer');
  if (!el) return false;
  return Object.keys(el).some((key) => key.startsWith('__reactFiber$'));
})()`;

/** 页面内检查：回答是否仍有「重复行 / 依据小节重复 / 结尾复述段」。 */
function inspectAnswerHygieneInPage() {
  const root = document.querySelector('[data-transcript-scroll]');
  const panels = root ? root.querySelectorAll("li") : [];
  const lastAssistant = [...panels].reverse().find((node) => node.innerText.includes("史令") || node.innerText.includes("史引"));
  const text = lastAssistant ? lastAssistant.innerText : root ? root.innerText : "";
  const lines = text
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length >= 12);
  const duplicateLines = lines.filter((line, index) => lines.indexOf(line) !== index);
  const paragraphs = text
    .split(/\n{2,}/)
    .map((paragraph) => paragraph.trim())
    .filter((paragraph) => paragraph.length >= 30);
  const bigrams = (value) => {
    const normalized = value.replace(/[\s，。；：、！？（）()【】“”‘’「」『』·—\-…,.!?:;|/\\~`$%^&*+=_#]/g, "");
    const result = new Set();
    for (let index = 0; index + 1 < normalized.length; index += 1) {
      result.add(normalized.slice(index, index + 2));
    }
    return result;
  };
  const restatedTails = [];
  if (paragraphs.length >= 2) {
    const tail = paragraphs[paragraphs.length - 1];
    const tailGrams = bigrams(tail);
    const earlierGrams = bigrams(paragraphs.slice(0, -1).join("\n\n"));
    let shared = 0;
    for (const gram of tailGrams) if (earlierGrams.has(gram)) shared += 1;
    const overlap = tailGrams.size === 0 ? 0 : shared / tailGrams.size;
    if (overlap >= 0.6) restatedTails.push({ overlap: Math.round(overlap * 100) / 100, tail: tail.slice(0, 120) });
  }
  return {
    answerChars: text.length,
    duplicateLines: duplicateLines.slice(0, 5),
    basisOneCount: (text.match(/依据一/g) ?? []).length,
    restatedTails,
    text,
  };
}

const INSPECT_ANSWER = `(${inspectAnswerHygieneInPage.toString()})()`;

async function runQuestionScenario({ question, expectSurface, name }) {
  const scenario = { question, expectSurface, checks: {}, fields: {} };
  const sessionId = scenarioSessionId(expectSurface);
  scenario.fields.sessionId = sessionId;
  await progress("scenario:start", { question, expectSurface, sessionId });
  // 测试会话（e2e_ 前缀）→ 后端只写独立测试库，绝不进入用户正式历史。
  await cdp.send("Page.navigate", {
    url: `${OPTIONS.baseUrl}/ask?session_id=${encodeURIComponent(sessionId)}`,
  });

  const hydrated = await waitFor(HYDRATED, Boolean, {
    attempts: 240,
    interval: 250,
    label: "hydrated",
  });
  scenario.checks.hydrated = hydrated === true;

  // 等首屏异步恢复（模型注册表 / 会话历史）落定：发送按钮存在即视为可交互。
  await waitFor(`Boolean(document.querySelector('button[aria-label="发送问题"]'))`, Boolean, {
    attempts: 80,
    interval: 250,
    label: "send-button",
  });

  // 模型注册表异步就绪（首帧是前端静态兜底 Qwen 表；本地 Ollama 只注册 XiaoHong-v1）。
  const modelTrigger = await waitFor(
    `(() => {
      const el = document.querySelector('button[aria-haspopup="listbox"]');
      return el ? (el.textContent || '').trim() : '';
    })()`,
    (text) => typeof text === "string" && text.length > 0 && !text.includes("Qwen/"),
    { attempts: 80, interval: 250, label: "model-registry" },
  );
  scenario.fields.modelTrigger = modelTrigger;
  scenario.checks.modelRegistryReady =
    typeof modelTrigger === "string" && !modelTrigger.includes("Qwen/");

  // ---- 痛点 2：深度思考开关（重命名 + 默认关闭 + 可切换） ----
  const readToggle = `(() => {
    const el = document.querySelector('[role="switch"][aria-label="切换深度思考模式"]');
    return el ? { checked: el.getAttribute('aria-checked'), text: (el.textContent || '').trim() } : null;
  })()`;
  const toggleBefore = await evaluate(readToggle);
  scenario.fields.thinkingToggle = toggleBefore;
  scenario.checks.thinkingToggleExists = Boolean(toggleBefore);
  scenario.checks.thinkingToggleDefaultOff = toggleBefore?.checked === "false";
  scenario.checks.thinkingToggleRenamed = toggleBefore?.text?.includes("深度思考") === true;
  await evaluate(`(() => {
    const el = document.querySelector('[role="switch"][aria-label="切换深度思考模式"]');
    if (el) el.click();
    return true;
  })()`);
  const toggleOn = await waitFor(readToggle, (state) => state?.checked === "true", {
    attempts: 40,
    interval: 100,
    label: "thinking-on",
  });
  await evaluate(`(() => {
    const el = document.querySelector('[role="switch"][aria-label="切换深度思考模式"]');
    if (el) el.click();
    return true;
  })()`);
  const toggleOff = await waitFor(readToggle, (state) => state?.checked === "false", {
    attempts: 40,
    interval: 100,
    label: "thinking-off",
  });
  scenario.checks.thinkingToggleSwitches =
    toggleOn?.checked === "true" && toggleOff?.checked === "false";

  const typed = await evaluate(SET_COMPOSER_VALUE(question));
  scenario.fields.typed = typed;
  scenario.checks.typedQuestion = typed === question;
  await delay(250);

  const submitted = await evaluate(`(() => {
    const button = document.querySelector('button[aria-label="发送问题"]');
    if (!button || button.disabled) return false;
    button.click();
    return true;
  })()`);
  scenario.checks.submitted = submitted === true;

  // 等提问进入 transcript（说明 ask() 已被触发）。
  const questionSeen = await waitFor(READ_TRANSCRIPT, (state) =>
    Boolean(state && state.text.includes(question)),
  { attempts: 80, interval: 250, label: "question-seen" });
  scenario.checks.questionSeen = Boolean(questionSeen?.text?.includes(question));

  // 等流式回答结束。
  const settled = await waitFor(
    READ_TRANSCRIPT,
    (state) =>
      Boolean(
        state &&
          state.busy === "false" &&
          state.streamingTurns === 0 &&
          state.text.length > question.length + 120,
      ),
    { attempts: 500, interval: 350, label: "answer-settled" },
  );
  scenario.fields.settledChars = settled?.text?.length ?? 0;
  scenario.checks.answerSettled = Boolean(
    settled && settled.busy === "false" && settled.streamingTurns === 0,
  );
  await progress("scenario:settled", { chars: settled?.text?.length ?? 0 });

  // 痛点 1：史引副驾驶自动展开（不需要用户点按钮）。
  const panel = await waitFor(INSPECT_COPILOT, (state) => state && state.exists === true, {
    attempts: 80,
    interval: 250,
    label: "copilot-panel",
  });
  scenario.fields.panel = panel;
  scenario.checks.guidePanelOpened = Boolean(panel && panel.exists);
  scenario.checks.guideTitleCorrect =
    panel?.title === (expectSurface === "timeline" ? "时间轴" : "人物关系图");
  scenario.checks.guideTargetCorrect = Boolean(
    panel?.exists &&
      (expectSurface === "timeline"
        ? panel.iframeSrc?.startsWith("/timeline") && panel.iframeSrc?.includes("event=")
        : panel.iframeSrc?.startsWith("/graph") && panel.iframeSrc?.includes("person=")),
  );

  // 痛点 3：面板网格 60/40 + iframe 内时间轴 50/50 + 详情卡独立滚动（等 iframe 内容加载完成）。
  const chart = await waitFor(
    INSPECT_COPILOT,
    (state) => {
      if (!state?.exists || !state.inner || state.inner.error) return false;
      if (state.inner.embedded !== "true") return false;
      return expectSurface === "timeline"
        ? (state.inner.trackHeight ?? 0) > 40 && (state.inner.topRegionHeight ?? 0) > 80
        : (state.inner.graphSvgHeight ?? 0) > 200;
    },
    { attempts: 100, interval: 300, label: "chart-ready" },
  );
  scenario.fields.chart = chart;
  // 桌面端面板回到网格流内（不再 fixed 盖住对话），左·右 ≈ 60% · 40%。
  scenario.checks.panelInFlow = Boolean(chart?.exists && chart.position !== "fixed");
  scenario.checks.panelSplit60_40 = Boolean(
    chart?.panelWidthRatioOfPair !== null &&
      chart?.panelWidthRatioOfPair !== undefined &&
      Math.abs(chart.panelWidthRatioOfPair - 0.4) <= 0.06,
  );
  scenario.checks.noPageScroll = Boolean(
    chart?.exists &&
      chart.pageScrollHeight <= chart.pageClientHeight + 2 &&
      chart.pageScrollY === 0,
  );
  scenario.checks.iframeFillsPanel = Boolean(
    chart?.exists && (chart.iframeHeightRatio ?? 0) >= 0.78,
  );
  scenario.checks.iframeNoPageScroll = Boolean(
    chart?.inner &&
      !chart.inner.error &&
      chart.inner.docScrollHeight <= chart.inner.innerHeight + 2,
  );
  scenario.checks.embeddedMode = chart?.inner?.embedded === "true";
  // 痛点 2.3：「正在连接本地模型」对话框已删除（直答占位轮次只在 meta 上标「生成中」）。
  scenario.checks.noConnectingDialog = chart?.hasConnectingDialog === false;
  if (expectSurface === "timeline") {
    const inner = chart?.inner ?? {};
    const topHeight = inner.topRegionHeight ?? 0;
    const detailHeight = inner.detailRegionHeight ?? 0;
    const total = topHeight + detailHeight;
    scenario.checks.timelineTopHalf = Boolean(
      total > 0 && Math.abs(topHeight / total - 0.5) <= 0.08,
    );
    scenario.checks.timelineTrackVisible = Boolean((inner.trackHeight ?? 0) > 40);
    scenario.checks.timelineTrackInsideHalf = inner.trackInsideViewport === true;
    scenario.checks.timelineDetailScrollable = inner.detailOverflowY === "auto";
    // 详情卡顶部对齐（不留「巨大空白」），且在自己的区域内（可滚动）显示。
    scenario.checks.timelineCardInDetail = Boolean(
      inner.cardHeight !== null &&
        inner.cardHeight !== undefined &&
        inner.cardTopOffset !== null &&
        inner.cardTopOffset !== undefined &&
        inner.cardTopOffset <= 20,
    );
  } else {
    scenario.checks.graphFills = Boolean((chart?.inner?.graphSvgHeight ?? 0) > 200);
    scenario.checks.graphZoomControls = chart?.inner?.zoomButtonCount >= 3;
  }
  const toggleAfter = await evaluate(readToggle);
  scenario.fields.thinkingToggleAfter = toggleAfter;
  scenario.checks.thinkingToggleStillOffAfterAnswer = toggleAfter?.checked === "false";

  // 痛点 2：重复内容治理（气泡里同一事实 / 依据只出现一次）。
  const hygiene = await evaluate(INSPECT_ANSWER);
  scenario.fields.hygiene = { ...hygiene, text: undefined };
  scenario.fields.answerText = hygiene?.text?.slice(-800) ?? "";
  scenario.checks.noDuplicateLines = (hygiene?.duplicateLines ?? []).length === 0;
  scenario.checks.noBasisBlockRepeat = (hygiene?.basisOneCount ?? 0) <= 1;
  scenario.checks.noRestatedTail = (hygiene?.restatedTails ?? []).length === 0;

  scenario.checks.screenshot = Boolean(await screenshot(`${name}.png`));
  scenario.fields.screenshot = path.relative(ROOT, path.join(OPTIONS.outDir, `${name}.png`));
  await progress("scenario:done", { checks: scenario.checks });
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

    // ---- 痛点 1：测试会话隔离基线（真实用户历史列表） ----
    const readUserSessions = async () => {
      const response = await fetch(`${OPTIONS.baseUrl}/api/sessions`);
      const payload = await response.json();
      return Array.isArray(payload?.sessions) ? payload.sessions : [];
    };
    const sessionsBefore = await readUserSessions();
    summary.fields.userSessionCountBefore = sessionsBefore.length;

    const timelineScenario = await runQuestionScenario({
      question: QUESTION_EVENT,
      expectSurface: "timeline",
      name: "01-timeline-copilot",
    });
    summary.fields.timelineScenario = timelineScenario.fields;
    summary.checks.timelineScenario = Object.fromEntries(
      Object.entries(timelineScenario.checks).filter(([, value]) => typeof value === "boolean"),
    );

    const relationScenario = await runQuestionScenario({
      question: QUESTION_RELATION,
      expectSurface: "graph",
      name: "02-graph-copilot",
    });
    summary.fields.relationScenario = relationScenario.fields;
    summary.checks.relationScenario = Object.fromEntries(
      Object.entries(relationScenario.checks).filter(([, value]) => typeof value === "boolean"),
    );

    // ---- 痛点 1：e2e 测试会话绝不写进用户正式历史 ----
    const sessionsAfter = await readUserSessions();
    const idsBefore = sessionsBefore.map((item) => item.session_id).sort();
    const idsAfter = sessionsAfter.map((item) => item.session_id).sort();
    summary.fields.userSessionCountAfter = sessionsAfter.length;
    summary.checks.sessionIsolation = {
      userSessionCountUnchanged: sessionsAfter.length === sessionsBefore.length,
      userSessionIdsUnchanged: JSON.stringify(idsAfter) === JSON.stringify(idsBefore),
      noTestSessionIdsInHistory: sessionsAfter.every(
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