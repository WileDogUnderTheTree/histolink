#!/usr/bin/env node
/**
 * 史脉 · `/ask` 页面 UI / UX 无头浏览器体检（V1.0.5.3 全面体检专项 · 工具 1）。
 *
 * 覆盖（对照 V1.0.5.2 UI 呼吸感补丁 + V1.0.5.2-layout 布局与侧边栏修复补丁的验收口径）：
 *  1) 1600×1000 默认视图：100vh App Shell（无整页滚动）、侧边栏/聊天/史引三栏独立滚动、
 *     气泡 85% / 行高 1.8、模型按钮位置；
 *  2) 会话列表排序稳定性：点击最下面一条历史记录必须**原位变灰**、不重排；聊天列表自动到底部；
 *     中间 / 左侧滚轮互不联动且整页不动；
 *  3) 历史侧边栏交互：悬浮「⋯」菜单（置顶 / 重命名 / 删除）、新建对话清空回欢迎语；
 *  4) 侧边栏收起 + localStorage 持久化 + 刷新后保持收起 + 顶栏「展开历史对话」入口；
 *  5) 引用 >3 默认折叠、「展开全部 N 条引用」、展开后全部可见；
 *  6) 引用点击打开史引副驾驶：左对话 40% / 右面板 60% 分屏，右面板高度锁定在视口内；
 *  7) 窄屏 820px：侧边栏默认收起、展开为浮层 + 遮罩、点击遮罩可收起、整页仍不滚动；
 *  8) （--live）真实提问：新问题 / 新回答自动滚动到底部 + 长回答 / 引用 / 史引自动分屏。
 *
 * 前置条件：
 *   - 前端已在 `--base-url`（默认 http://localhost:3000）运行（dev 或 next start 均可）；
 *   - 本机可用 Microsoft Edge（Chromium），或通过 `--edge` 指定浏览器可执行文件。
 *
 * 运行：
 *   node scripts/health-check-ui.mjs
 *   node scripts/health-check-ui.mjs --live               # 连真实后端做一次真实问答
 *   node scripts/health-check-ui.mjs --base-url http://localhost:3000 --out-dir .tmp/health-ui
 *
 * 退出码：0 = 全部断言通过；1 = 任一断言失败或脚本异常。
 * 产物：--out-dir 下的 *.png 截图与 results.json（默认 .tmp/health-ui，已被 .gitignore 忽略）。
 */
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as delay } from "node:timers/promises";

const ROOT = fileURLToPath(new URL("..", import.meta.url));

function parseArgs(argv) {
  const options = {
    baseUrl: "http://localhost:3000",
    outDir: path.join(ROOT, ".tmp", "health-ui"),
    port: 9333,
    edge: process.env.EDGE_PATH ?? "",
    live: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = () => argv[++index];
    if (arg === "--base-url") options.baseUrl = next().replace(/\/$/, "");
    else if (arg === "--out-dir") options.outDir = path.resolve(ROOT, next());
    else if (arg === "--port") options.port = Number(next());
    else if (arg === "--edge") options.edge = next();
    else if (arg === "--live") options.live = true;
    else if (arg === "--help" || arg === "-h") {
      console.log("用法：node scripts/health-check-ui.mjs [--base-url URL] [--out-dir DIR] [--port N] [--edge PATH] [--live]");
      process.exit(0);
    } else {
      throw new Error(`未知参数：${arg}`);
    }
  }
  return options;
}

function resolveEdge(explicit) {
  const candidates = [
    explicit,
    process.env.EDGE_PATH,
    "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
    "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
    "/usr/bin/microsoft-edge",
    "/usr/bin/google-chrome",
    "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
  ].filter(Boolean);
  const found = candidates.find((candidate) => existsSync(candidate));
  if (!found) {
    throw new Error("找不到 Chromium 浏览器，请用 --edge 指定 msedge / chrome 可执行文件路径。");
  }
  return found;
}

const OPTIONS = parseArgs(process.argv.slice(2));
const EDGE = resolveEdge(OPTIONS.edge);
const OUT = OPTIONS.outDir;
const PORT = OPTIONS.port;
const BASE = OPTIONS.baseUrl;

const results = [];
const consoleIssues = [];
/** 断言计数器：结果汇总同时给出「检查点 / 断言」两个维度。 */
let assertionCount = 0;

function log(name, payload) {
  console.log(`\n[${name}]`);
  console.log(JSON.stringify(payload, null, 2));
  results.push({ name, payload });
}

function assert(name, condition, detail) {
  assertionCount += 1;
  if (!condition) throw new Error(`ASSERT FAILED [${name}] ${detail ?? ""}`);
  console.log(`  ✓ ${name}`);
}

async function waitForEndpoint() {
  for (let i = 0; i < 80; i += 1) {
    try {
      const res = await fetch(`http://127.0.0.1:${PORT}/json/version`);
      if (res.ok) return;
    } catch {}
    await delay(250);
  }
  throw new Error("CDP endpoint timeout");
}

/** 运行一个系统命令并等待结束（10s 超时兜底，避免清理阶段卡死）。 */
function runAndWait(exe, args) {
  return new Promise((resolve) => {
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      resolve();
    };
    const timer = setTimeout(finish, 10_000);
    try {
      const child = spawn(exe, args, { stdio: "ignore" });
      child.on("exit", () => {
        clearTimeout(timer);
        finish();
      });
      child.on("error", () => {
        clearTimeout(timer);
        finish();
      });
    } catch {
      clearTimeout(timer);
      finish();
    }
  });
}

/**
 * 结束本次体检启动的 Edge（V1.0.5.3 体检 F-13）。
 *
 * 注意：`--headless=new` 的启动进程可能很快退出并让实际浏览器进程变成孤儿，
 * 因此「只杀 `edge.pid`」会留下 gpu / renderer / crashpad 子进程占用 profile 锁；
 * Windows 下再用「命令行包含本次 profile 目录」精确补杀（不会误伤用户自己开的 Edge），
 * 非 Windows 平台退化为 kill 主进程。
 */
async function killEdge(pid, profileDir) {
  if (process.platform !== "win32") {
    try {
      process.kill(pid, "SIGKILL");
    } catch {}
    return;
  }
  if (pid) await runAndWait("taskkill.exe", ["/PID", String(pid), "/T", "/F"]);
  const escapedProfile = String(profileDir).replace(/'/g, "''");
  await runAndWait("powershell.exe", [
    "-NoLogo",
    "-NoProfile",
    "-NonInteractive",
    "-Command",
    `$ErrorActionPreference='SilentlyContinue'; Get-CimInstance Win32_Process -Filter "Name='msedge.exe'" | Where-Object { $_.CommandLine -and $_.CommandLine.Contains('${escapedProfile}') } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force }`,
  ]);
}

async function main() {
  await mkdir(OUT, { recursive: true });
  // 每次体检从干净的浏览器 profile 起步：避免上次的 localStorage（侧边栏折叠 / 会话）污染首帧断言。
  // 若旧 profile 仍被异常退出的 Edge 子进程占用（EBUSY），自动退化为本次运行专属目录。
  let profileDir = path.join(OUT, "edge-profile");
  try {
    await rm(profileDir, { recursive: true, force: true, maxRetries: 2, retryDelay: 250 });
  } catch {
    profileDir = path.join(OUT, `edge-profile-${process.pid}-${Date.now()}`);
    console.warn(`  ! 旧浏览器 profile 仍被占用，改用临时目录：${profileDir}`);
  }
  const edge = spawn(
    EDGE,
    [
      "--headless=new",
      "--disable-gpu",
      "--hide-scrollbars",
      "--no-first-run",
      "--no-default-browser-check",
      `--remote-debugging-port=${PORT}`,
      `--user-data-dir=${profileDir}`,
      "--window-size=1600,1000",
      "about:blank",
    ],
    { stdio: "ignore" },
  );

  let ws;
  try {
    await waitForEndpoint();
    const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
    const target = list.find((item) => item.type === "page");
    if (!target) throw new Error("no page target");

    ws = new WebSocket(target.webSocketDebuggerUrl);
    await new Promise((resolve, reject) => {
      ws.addEventListener("open", resolve, { once: true });
      ws.addEventListener("error", reject, { once: true });
    });

    let nextId = 0;
    const pending = new Map();
    ws.addEventListener("message", (event) => {
      const message = JSON.parse(event.data);
      if (message.id && pending.has(message.id)) {
        const { resolve, reject } = pending.get(message.id);
        pending.delete(message.id);
        if (message.error) reject(new Error(JSON.stringify(message.error)));
        else resolve(message.result);
        return;
      }
      if (message.method === "Runtime.consoleAPICalled" && message.params.type === "error") {
        consoleIssues.push({
          kind: "console.error",
          text: message.params.args.map((arg) => arg.value ?? arg.description ?? "").join(" "),
        });
      }
      if (message.method === "Runtime.exceptionThrown") {
        consoleIssues.push({
          kind: "exception",
          text: message.params.exceptionDetails?.exception?.description ?? "unknown",
        });
      }
      if (message.method === "Log.entryAdded" && message.params.entry.level === "error") {
        const entry = message.params.entry;
        consoleIssues.push({
          kind: "log",
          text: entry.text,
          url: entry.url ?? "",
        });
      }
    });
    /** dev 模式 HMR / favicon 404 / React DevTools 提示是环境噪声，不算产品缺陷。 */
    const isDevNoise = (issue) =>
      /_next\/hmr|WebSocket connection to .*failed|Download the React DevTools/i.test(issue.text) ||
      /favicon\.ico|Failed to load resource: the server responded with a status of 404/i.test(
        `${issue.text} ${issue.url ?? ""}`,
      );
    const productIssues = () => consoleIssues.filter((issue) => !isDevNoise(issue));
    const send = (method, params = {}) =>
      new Promise((resolve, reject) => {
        const id = ++nextId;
        pending.set(id, { resolve, reject });
        ws.send(JSON.stringify({ id, method, params }));
      });
    const evaluate = async (expression) => {
      const result = await send("Runtime.evaluate", {
        expression,
        returnByValue: true,
        awaitPromise: true,
      });
      if (result.exceptionDetails) throw new Error(JSON.stringify(result.exceptionDetails));
      return result.result?.value;
    };
    /** 真实鼠标滚轮：用于验证「哪一栏在滚、整页是否跟着动」。 */
    const mouseWheel = async (x, y, deltaY) => {
      await send("Input.dispatchMouseEvent", {
        type: "mouseWheel",
        x: Math.round(x),
        y: Math.round(y),
        deltaX: 0,
        deltaY,
        pointerType: "mouse",
      });
      await delay(400);
    };
    /** 真实鼠标移动：触发 CSS :hover（悬浮菜单断言需要）。 */
    const mouseMove = async (x, y) => {
      await send("Input.dispatchMouseEvent", {
        type: "mouseMoved",
        x: Math.round(x),
        y: Math.round(y),
      });
      await delay(200);
    };
    const shoot = async (name) => {
      // 隐藏 Next.js 开发模式左下角指示器，保证归档截图只包含产品 UI。
      await evaluate(`(() => {
        if (!document.getElementById('__dsh_hide_dev_indicator')) {
          const style = document.createElement('style');
          style.id = '__dsh_hide_dev_indicator';
          style.textContent = 'nextjs-portal { display: none !important; }';
          document.head.appendChild(style);
        }
        return true;
      })()`);
      await delay(120);
      const { data } = await send("Page.captureScreenshot", { format: "png" });
      await writeFile(path.join(OUT, `${name}.png`), Buffer.from(data, "base64"));
      console.log(`  📸 ${name}.png`);
    };
    const viewport = async (width, height) => {
      await send("Emulation.setDeviceMetricsOverride", {
        width,
        height,
        deviceScaleFactor: 1,
        mobile: false,
      });
    };
    const waitFor = async (expression, timeoutMs = 15000, intervalMs = 250) => {
      const deadline = Date.now() + timeoutMs;
      let last;
      while (Date.now() < deadline) {
        try {
          last = await evaluate(expression);
        } catch {
          last = undefined;
        }
        if (last) return last;
        await delay(intervalMs);
      }
      return last;
    };
    const go = async (path, settle = 2200) => {
      await send("Page.navigate", { url: `${BASE}${path}` });
      await delay(settle);
      await waitFor('document.readyState === "complete" && Boolean(document.querySelector("main"))', 20000);
      await evaluate("document.fonts ? document.fonts.ready.then(() => true) : true");
    };

    await send("Page.enable");
    await send("Runtime.enable");
    await send("Log.enable");

    // =====================================================================
    // 1) 默认视图（1600×1000，侧边栏展开）
    // =====================================================================
    await viewport(1600, 1000);
    await go("/ask", 5200);

    const layoutMetrics = await evaluate(`(() => {
      const sidebar = document.querySelector('aside[aria-label="历史对话"]');
      const shell = document.querySelector('main section[aria-labelledby="conversation-title"]')?.parentElement;
      const chat = document.querySelector('section[aria-labelledby="conversation-title"]');
      const transcript = document.querySelector('ol[aria-live="polite"]');
      const message = document.querySelector('div[class*="messageText"]');
      const modelTrigger = document.querySelector('button[aria-haspopup="listbox"]');
      const rect = (el) => el ? { x: Math.round(el.getBoundingClientRect().x), width: Math.round(el.getBoundingClientRect().width) } : null;
      const style = message ? getComputedStyle(message) : null;
      const bubbles = [...document.querySelectorAll('ol[aria-live="polite"] > li')].filter((li) => li.querySelector('div[class*="messageText"]'));
      const widestBubble = bubbles.length ? Math.max(...bubbles.map((li) => li.getBoundingClientRect().width)) : null;
      const tStyle = transcript ? getComputedStyle(transcript) : null;
      const transcriptInner = transcript && tStyle
        ? transcript.clientWidth - parseFloat(tStyle.paddingLeft) - parseFloat(tStyle.paddingRight)
        : null;
      return {
        viewport: { width: innerWidth, height: innerHeight },
        sidebar: rect(sidebar),
        shell: rect(shell),
        chat: rect(chat),
        transcript: transcript ? { clientWidth: transcript.clientWidth, padding: getComputedStyle(transcript).padding, gap: getComputedStyle(transcript).gap } : null,
        widestBubble,
        bubbleRatio: widestBubble && chat ? +(widestBubble / chat.getBoundingClientRect().width).toFixed(3) : null,
        bubbleRatioOfTranscript: widestBubble && transcriptInner ? +(widestBubble / transcriptInner).toFixed(3) : null,
        messageLineHeight: style?.lineHeight,
        messageFontSize: style?.fontSize,
        modelTrigger: rect(modelTrigger),
        modelTriggerAboveComposer: (() => {
          const form = document.querySelector('form');
          if (!modelTrigger || !form) return null;
          const t = modelTrigger.getBoundingClientRect();
          const f = form.getBoundingClientRect();
          return { above: t.bottom <= f.top + 1, leftDelta: Math.round(t.left - f.left) };
        })(),
        horizontalOverflow: document.documentElement.scrollWidth > innerWidth,
        toggleButton: Boolean(document.querySelector('button[aria-label="展开历史对话侧边栏"]')),
      };
    })()`);
    log("01-default-1600", layoutMetrics);
    assert("默认视图侧边栏可见", Boolean(layoutMetrics.sidebar), JSON.stringify(layoutMetrics.sidebar));
    assert("默认聊天区宽度 > 900px", layoutMetrics.chat.width > 900, `chat=${layoutMetrics.chat.width}`);
    assert("气泡最大宽度约为聊天内容区的 85%", layoutMetrics.bubbleRatioOfTranscript >= 0.82 && layoutMetrics.bubbleRatioOfTranscript <= 0.88, layoutMetrics.bubbleRatioOfTranscript);
    assert("正文行高 1.8", layoutMetrics.messageLineHeight === "27px", layoutMetrics.messageLineHeight);
    assert("模型切换按钮位于输入框正上方左侧", layoutMetrics.modelTriggerAboveComposer?.above && layoutMetrics.modelTriggerAboveComposer.leftDelta < 12, JSON.stringify(layoutMetrics.modelTriggerAboveComposer));
    assert("无横向溢出", layoutMetrics.horizontalOverflow === false);
    await shoot("01-default-1600");

    // =====================================================================
    // 1b) 100vh App Shell：整页不滚动，左 / 中 / 右各自独立滚动
    // =====================================================================
    const appShell = await evaluate(`(() => {
      const rect = (el) => el ? el.getBoundingClientRect() : null;
      const app = document.querySelector('[data-app-shell]');
      const sidebar = document.querySelector('aside[aria-label="历史对话"]');
      const transcript = document.querySelector('[data-transcript-scroll]');
      const dock = document.querySelector('div[class*="composerDock"]');
      const appRect = rect(app);
      const sidebarRect = rect(sidebar);
      return {
        innerHeight,
        innerWidth,
        docScrollHeight: document.documentElement.scrollHeight,
        docScrollWidth: document.documentElement.scrollWidth,
        docScrollY: scrollY,
        bodyOverflow: getComputedStyle(document.body).overflow,
        app: appRect ? { height: Math.round(appRect.height), overflow: getComputedStyle(app).overflow } : null,
        sidebarHeight: sidebarRect ? Math.round(sidebarRect.height) : null,
        transcript: transcript ? { overflowY: getComputedStyle(transcript).overflowY, clientHeight: transcript.clientHeight, scrollHeight: transcript.scrollHeight } : null,
        composerBottom: dock ? Math.round(rect(dock).bottom) : null,
      };
    })()`);
    log("01b-app-shell", appShell);
    assert("整页无文档滚动（100vh App Shell）", appShell.docScrollHeight <= appShell.innerHeight + 1, JSON.stringify(appShell));
    assert("App Shell 高度锁定视口且 overflow hidden", appShell.app?.height === appShell.innerHeight && appShell.app?.overflow === "hidden", JSON.stringify(appShell.app));
    assert("左侧历史栏高度 = 视口高度（自身内部滚动）", appShell.sidebarHeight === appShell.innerHeight, JSON.stringify({ sidebarHeight: appShell.sidebarHeight, innerHeight: appShell.innerHeight }));
    assert("中间聊天列表是独立滚动容器", appShell.transcript?.overflowY === "auto");
    assert("底部输入区位于视口内", appShell.composerBottom <= appShell.innerHeight + 1, JSON.stringify({ composerBottom: appShell.composerBottom, innerHeight: appShell.innerHeight }));
    assert("页面上仍无横向溢出", appShell.docScrollWidth <= appShell.innerWidth);
    await shoot("01b-app-shell");

    // =====================================================================
    // 2) 排序稳定性 + 三栏独立滚动（矮窗口：两侧内容必须溢出才可验证）
    // =====================================================================
    await viewport(1600, 400);
    await go("/ask", 2800);
    const beforeClick = await evaluate(`(() => {
      const s = document.querySelector('aside[aria-label="历史对话"] div[class*="scrollArea"]');
      const t = document.querySelector('[data-transcript-scroll]');
      return {
        order: [...document.querySelectorAll('[data-conversation-id]')].map((el) => el.getAttribute('data-conversation-id')),
        sidebar: s ? { scrollHeight: s.scrollHeight, clientHeight: s.clientHeight, scrollTop: s.scrollTop } : null,
        transcript: t ? { scrollHeight: t.scrollHeight, clientHeight: t.clientHeight, scrollTop: t.scrollTop } : null,
        docScrollHeight: document.documentElement.scrollHeight,
        innerHeight,
      };
    })()`);
    log("02a-sort-and-scroll-before", beforeClick);
    assert("矮窗口下左侧历史列表内部可滚动", Boolean(beforeClick.sidebar && beforeClick.sidebar.scrollHeight > beforeClick.sidebar.clientHeight), JSON.stringify(beforeClick.sidebar));
    assert("矮窗口下整页依旧无文档滚动", beforeClick.docScrollHeight <= beforeClick.innerHeight + 1, JSON.stringify({ doc: beforeClick.docScrollHeight, viewport: beforeClick.innerHeight }));

    // 滚左侧列表：只有左侧内部滚动，整页与聊天区都不动
    await mouseWheel(120, 230, 420);
    const sidebarWheel = await evaluate(`(() => {
      const s = document.querySelector('aside[aria-label="历史对话"] div[class*="scrollArea"]');
      const t = document.querySelector('[data-transcript-scroll]');
      return { docScrollY: scrollY, sidebarScrollTop: s.scrollTop, chatScrollTop: t.scrollTop };
    })()`);
    log("02b-sidebar-wheel", sidebarWheel);
    assert("滚左侧列表：只有左侧内部滚动，整页 / 聊天区不动", sidebarWheel.sidebarScrollTop > 0 && sidebarWheel.docScrollY === 0 && sidebarWheel.chatScrollTop === beforeClick.transcript.scrollTop, JSON.stringify(sidebarWheel));

    // 点击最下面一条历史记录：必须「原位变灰」，绝不弹到列表顶部
    const clickedItem = await evaluate(`(() => {
      const items = [...document.querySelectorAll('[data-conversation-id]')];
      const target = items[items.length - 1];
      if (!target) return null;
      const id = target.getAttribute('data-conversation-id');
      target.querySelector('button[class*="conversationButton"]').click();
      return { id, index: items.length - 1, order: items.map((el) => el.getAttribute('data-conversation-id')) };
    })()`);
    await delay(1000);
    const afterClick = await evaluate(`(() => {
      const items = [...document.querySelectorAll('[data-conversation-id]')];
      const transcript = document.querySelector('[data-transcript-scroll]');
      return {
        order: items.map((el) => el.getAttribute('data-conversation-id')),
        activeId: items.find((el) => el.getAttribute('data-active') === "true")?.getAttribute('data-conversation-id') ?? null,
        activeIndex: items.findIndex((el) => el.getAttribute('data-active') === "true"),
        transcript: transcript ? { scrollTop: transcript.scrollTop, scrollHeight: transcript.scrollHeight, clientHeight: transcript.clientHeight, atBottom: transcript.scrollTop + transcript.clientHeight >= transcript.scrollHeight - 4 } : null,
        docScrollY: scrollY,
        docScrollHeight: document.documentElement.scrollHeight,
        innerHeight,
      };
    })()`);
    log("02c-click-last-conversation", { clicked: clickedItem, after: afterClick });
    assert("点击最下面一条历史记录后列表物理顺序完全不变", JSON.stringify(afterClick.order) === JSON.stringify(beforeClick.order), JSON.stringify({ before: beforeClick.order, after: afterClick.order }));
    assert("点击项只改变高亮（选中态），位置不变", afterClick.activeId === clickedItem?.id && afterClick.activeIndex === clickedItem?.index, JSON.stringify({ clicked: clickedItem, activeId: afterClick.activeId, activeIndex: afterClick.activeIndex }));
    assert("加载历史对话后聊天列表自动滚动到底部", afterClick.transcript?.atBottom === true, JSON.stringify(afterClick.transcript));
    assert("加载历史对话期间整页仍不滚动", afterClick.docScrollHeight <= afterClick.innerHeight + 1, JSON.stringify({ doc: afterClick.docScrollHeight, viewport: afterClick.innerHeight }));

    // 滚中间聊天区：只有聊天列表内部滚动，整页与左侧列表都不动
    await mouseWheel(760, 210, -520);
    const chatWheel = await evaluate(`(() => {
      const s = document.querySelector('aside[aria-label="历史对话"] div[class*="scrollArea"]');
      const t = document.querySelector('[data-transcript-scroll]');
      return { docScrollY: scrollY, chatScrollTop: t.scrollTop, sidebarScrollTop: s.scrollTop };
    })()`);
    log("02d-chat-wheel", chatWheel);
    assert("滚中间聊天区：只有聊天列表内部滚动，整页 / 左侧不动", chatWheel.chatScrollTop < afterClick.transcript.scrollTop && chatWheel.docScrollY === 0 && chatWheel.sidebarScrollTop === sidebarWheel.sidebarScrollTop, JSON.stringify(chatWheel));
    await shoot("02-sort-and-scroll");

    // 恢复大视口，进入侧边栏交互场景
    await viewport(1600, 1000);
    await go("/ask", 2800);

    // =====================================================================
    // 3) 历史侧边栏交互：悬浮「⋯」菜单（置顶 / 重命名 / 删除）+ 新建对话
    // =====================================================================
    const freshOrder = await evaluate(`[...document.querySelectorAll('[data-conversation-id]')].map((el) => el.getAttribute('data-conversation-id'))`);
    const menuTrigger = await evaluate(`(() => {
      const item = [...document.querySelectorAll('[data-conversation-id]')].at(-1);
      const trigger = item?.querySelector('[data-conversation-menu-trigger]');
      const rect = trigger?.getBoundingClientRect();
      return {
        id: item?.getAttribute('data-conversation-id') ?? null,
        rect: rect ? { x: rect.x, y: rect.y, w: rect.width, h: rect.height } : null,
        opacity: trigger ? getComputedStyle(trigger).opacity : null,
      };
    })()`);
    assert("每条历史记录带「⋯」更多操作按钮", Boolean(menuTrigger.id && menuTrigger.rect), JSON.stringify(menuTrigger));
    await mouseMove(menuTrigger.rect.x + menuTrigger.rect.w / 2, menuTrigger.rect.y + menuTrigger.rect.h / 2);
    const hoveredOpacity = await evaluate(`(() => {
      const item = [...document.querySelectorAll('[data-conversation-id]')].at(-1);
      return getComputedStyle(item.querySelector('[data-conversation-menu-trigger]')).opacity;
    })()`);
    log("03-hover-opacity", { idle: menuTrigger.opacity, hover: hoveredOpacity });
    assert("鼠标悬浮历史记录时「⋯」图标出现", hoveredOpacity === "1", hoveredOpacity);

    await evaluate(`(() => { [...document.querySelectorAll('[data-conversation-id]')].at(-1).querySelector('[data-conversation-menu-trigger]').click(); return true; })()`);
    await waitFor(`Boolean(document.querySelector('[role="menu"][aria-label="历史对话操作"]'))`, 4000);
    const menuState = await evaluate(`(() => {
      const menu = document.querySelector('[role="menu"][aria-label="历史对话操作"]');
      if (!menu) return null;
      const rect = menu.getBoundingClientRect();
      return {
        items: [...menu.querySelectorAll('[role="menuitem"]')].map((item) => item.textContent.trim()),
        inViewport: rect.top >= 0 && rect.left >= 0 && rect.bottom <= innerHeight && rect.right <= innerWidth,
      };
    })()`);
    log("03a-hover-menu", menuState);
    assert("悬浮菜单包含「置顶 / 重命名 / 删除」", JSON.stringify(menuState?.items) === JSON.stringify(["置顶", "重命名", "删除"]), JSON.stringify(menuState));
    assert("悬浮菜单完整落在视口内", menuState?.inViewport === true);
    await shoot("03-hover-menu");

    // 置顶：用户主动点击后进入最上方「置顶」分组
    await evaluate(`(() => { [...document.querySelectorAll('[role="menuitem"]')].find((btn) => btn.textContent.trim() === "置顶")?.click(); return true; })()`);
    await delay(700);
    const pinnedState = await evaluate(`(() => {
      const groups = [...document.querySelectorAll('section[aria-labelledby^="conversation-group"] h2')].map((el) => el.textContent);
      const items = [...document.querySelectorAll('[data-conversation-id]')];
      return {
        groups,
        firstId: items[0]?.getAttribute('data-conversation-id') ?? null,
        pinnedIds: items.filter((el) => el.getAttribute('data-pinned') === "true").map((el) => el.getAttribute('data-conversation-id')),
        order: items.map((el) => el.getAttribute('data-conversation-id')),
      };
    })()`);
    log("03b-pinned", pinnedState);
    assert("置顶后出现「置顶」分组且该项移到列表最上方", pinnedState.groups[0] === "置顶" && pinnedState.firstId === menuTrigger.id && pinnedState.pinnedIds.includes(menuTrigger.id), JSON.stringify(pinnedState));
    await shoot("03b-pinned");

    // 取消置顶：恢复原时间顺序
    await evaluate(`(() => { [...document.querySelectorAll('[data-conversation-id]')][0].querySelector('[data-conversation-menu-trigger]').click(); return true; })()`);
    await waitFor(`Boolean(document.querySelector('[role="menu"][aria-label="历史对话操作"]'))`, 4000);
    await evaluate(`(() => { [...document.querySelectorAll('[role="menuitem"]')].find((btn) => btn.textContent.trim() === "取消置顶")?.click(); return true; })()`);
    await delay(700);
    const unpinnedOrder = await evaluate(`[...document.querySelectorAll('[data-conversation-id]')].map((el) => el.getAttribute('data-conversation-id'))`);
    assert("取消置顶后恢复原顺序", JSON.stringify(unpinnedOrder) === JSON.stringify(freshOrder), JSON.stringify({ freshOrder, unpinnedOrder }));

    // 重命名：只改标题，不改变列表位置
    await evaluate(`(() => { [...document.querySelectorAll('[data-conversation-id]')].at(-1).querySelector('[data-conversation-menu-trigger]').click(); return true; })()`);
    await waitFor(`Boolean(document.querySelector('[role="menu"][aria-label="历史对话操作"]'))`, 4000);
    await evaluate(`(() => { [...document.querySelectorAll('[role="menuitem"]')].find((btn) => btn.textContent.trim() === "重命名")?.click(); return true; })()`);
    await waitFor(`Boolean(document.querySelector('input[aria-label="重命名历史对话"]'))`, 4000);
    const renameDraft = "重命名后的会话标题";
    await evaluate(`(() => {
      const input = document.querySelector('input[aria-label="重命名历史对话"]');
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
      setter.call(input, ${JSON.stringify("重命名后的会话标题")});
      input.dispatchEvent(new Event("input", { bubbles: true }));
      return true;
    })()`);
    await delay(200);
    await evaluate(`(() => { document.querySelector('input[aria-label="重命名历史对话"]')?.closest("form")?.requestSubmit(); return true; })()`);
    await delay(700);
    const renamedState = await evaluate(`(() => {
      const items = [...document.querySelectorAll('[data-conversation-id]')];
      const titles = items.map((el) => el.querySelector('span[class*="conversationTitle"]')?.textContent ?? "");
      return { titles, order: items.map((el) => el.getAttribute('data-conversation-id')), renamedId: items.at(-1)?.getAttribute('data-conversation-id') ?? null };
    })()`);
    log("03c-renamed", renamedState);
    assert("重命名后标题更新且位置不变", renamedState.renamedId === menuTrigger.id && renamedState.titles.at(-1) === renameDraft && JSON.stringify(renamedState.order) === JSON.stringify(freshOrder), JSON.stringify(renamedState));
    await shoot("03c-renamed");

    // 删除：该条消失，其余项相对顺序不变
    const deleteTarget = await evaluate(`(() => {
      const items = [...document.querySelectorAll('[data-conversation-id]')];
      const target = items[0];
      const id = target.getAttribute('data-conversation-id');
      target.querySelector('[data-conversation-menu-trigger]').click();
      return { id, order: items.map((el) => el.getAttribute('data-conversation-id')) };
    })()`);
    await waitFor(`Boolean(document.querySelector('[role="menu"][aria-label="历史对话操作"]'))`, 4000);
    await evaluate(`(() => { [...document.querySelectorAll('[role="menuitem"]')].find((btn) => btn.textContent.trim() === "删除")?.click(); return true; })()`);
    await delay(700);
    const afterDelete = await evaluate(`(() => {
      const items = [...document.querySelectorAll('[data-conversation-id]')];
      return { order: items.map((el) => el.getAttribute('data-conversation-id')), count: items.length };
    })()`);
    const expectedAfterDelete = deleteTarget.order.filter((id) => id !== deleteTarget.id);
    log("03d-deleted", { deleted: deleteTarget.id, afterDelete });
    assert("删除后该条消失且其余项顺序不变", afterDelete.count === deleteTarget.order.length - 1 && JSON.stringify(afterDelete.order) === JSON.stringify(expectedAfterDelete), JSON.stringify({ expectedAfterDelete, afterDelete }));

    // 新建对话：清空聊天区回欢迎语，新会话出现在列表最上方
    const newConversationState = await evaluate(`(() => {
      const before = [...document.querySelectorAll('[data-conversation-id]')].map((el) => el.getAttribute('data-conversation-id'));
      document.querySelector('div[class*="newConversationDock"] button').click();
      return { before };
    })()`);
    await delay(1000);
    const afterNewConversation = await evaluate(`(() => {
      const items = [...document.querySelectorAll('[data-conversation-id]')];
      const transcript = document.querySelector('[data-transcript-scroll]');
      const newButton = document.querySelector('div[class*="newConversationDock"] button');
      const chatTurns = transcript ? [...transcript.querySelectorAll(":scope > li")] : [];
      return {
        order: items.map((el) => el.getAttribute('data-conversation-id')),
        transcriptTurnCount: chatTurns.length,
        transcriptText: transcript ? transcript.textContent.slice(0, 60) : "",
        transcriptAtBottom: transcript ? transcript.scrollTop + transcript.clientHeight >= transcript.scrollHeight - 4 : null,
        newButtonActive: newButton?.getAttribute('data-active'),
        docScrollHeight: document.documentElement.scrollHeight,
        innerHeight,
      };
    })()`);
    const addedId = afterNewConversation.order.find((id) => !newConversationState.before.includes(id));
    log("03e-new-conversation", { before: newConversationState.before, after: afterNewConversation });
    assert("点击「新建对话」清空聊天区回欢迎语", afterNewConversation.transcriptTurnCount === 1 && afterNewConversation.transcriptText.includes("你好，我是史脉问答"), JSON.stringify(afterNewConversation));
    assert("新建对话后新会话出现在列表最上方", Boolean(addedId) && afterNewConversation.order.indexOf(addedId) === 0, JSON.stringify({ addedId, order: afterNewConversation.order }));
    assert("新建对话按钮进入选中态", afterNewConversation.newButtonActive === "true");
    assert("新建对话后整页仍不滚动", afterNewConversation.docScrollHeight <= afterNewConversation.innerHeight + 1);
    await shoot("03e-new-conversation");

    // 刷新页面，回到干净的演示列表，供后续折叠 / 分屏场景使用
    await go("/ask", 2800);

    // =====================================================================
    // 4) 侧边栏收起 → 宽版居中 → 持久化 → 刷新保持
    // =====================================================================
    await evaluate(`document.querySelector('button[aria-label="收起历史对话侧边栏"]').click()`);
    await delay(700);
    const collapsed = await evaluate(`(() => {
      const shell = document.querySelector('main section[aria-labelledby="conversation-title"]')?.parentElement;
      const chat = document.querySelector('section[aria-labelledby="conversation-title"]');
      return {
        sidebar: Boolean(document.querySelector('aside[aria-label="历史对话"]')),
        toggle: Boolean(document.querySelector('button[aria-label="展开历史对话侧边栏"]')),
        shell: shell ? Math.round(shell.getBoundingClientRect().width) : null,
        chat: chat ? Math.round(chat.getBoundingClientRect().width) : null,
        shellOffsetX: shell ? Math.round(shell.getBoundingClientRect().x) : null,
        stored: localStorage.getItem('histolink.ask.sidebar.v1'),
      };
    })()`);
    log("04-sidebar-collapsed", collapsed);
    assert("收起后侧边栏不再占位", collapsed.sidebar === false);
    assert("顶栏出现展开入口", collapsed.toggle === true);
    assert("对话区放宽到视口 60%–70%", collapsed.chat / 1600 >= 0.55 && collapsed.chat / 1600 <= 0.75, `${collapsed.chat}/1600`);
    assert("对话区水平居中", Math.abs(collapsed.shellOffsetX - (1600 - collapsed.shell) / 2) < 24, JSON.stringify({ x: collapsed.shellOffsetX, expected: (1600 - collapsed.shell) / 2 }));
    assert("折叠偏好已落盘", collapsed.stored === "collapsed", collapsed.stored);
    await shoot("04-sidebar-collapsed");

    await go("/ask", 3000);
    const persisted = await evaluate(`(() => ({
      sidebar: Boolean(document.querySelector('aside[aria-label="历史对话"]')),
      toggle: Boolean(document.querySelector('button[aria-label="展开历史对话侧边栏"]')),
      stored: localStorage.getItem('histolink.ask.sidebar.v1'),
    }))()`);
    log("05-sidebar-persisted-after-reload", persisted);
    assert("刷新后保持收起", persisted.sidebar === false && persisted.toggle === true);
    await shoot("05-sidebar-persisted-after-reload");

    // 恢复展开，供后续真实问答 / 分屏对比
    await evaluate(`document.querySelector('button[aria-label="展开历史对话侧边栏"]').click()`);
    await delay(600);
    const reExpanded = await evaluate(`(() => ({
      sidebar: Boolean(document.querySelector('aside[aria-label="历史对话"]')),
      stored: localStorage.getItem('histolink.ask.sidebar.v1'),
    }))()`);
    assert("可重新展开侧边栏", reExpanded.sidebar === true && reExpanded.stored === "expanded", JSON.stringify(reExpanded));

    // =====================================================================
    // 5) 引用折叠：多轮预览（6 条引用 → 默认 3 条）
    // =====================================================================
    await go("/ask?preview=multiturn", 3000);
    const previewLayout = await evaluate(`(() => {
      const chat = document.querySelector('section[aria-labelledby="conversation-title"]');
      return {
        sidebar: Boolean(document.querySelector('aside[aria-label="历史对话"]')),
        chatWidth: chat ? Math.round(chat.getBoundingClientRect().width) : null,
      };
    })()`);
    log("06a-preview-layout", previewLayout);
    assert("预览模式不渲染历史侧边栏", previewLayout.sidebar === false, JSON.stringify(previewLayout));
    assert("预览模式（无侧边栏）对话区为 60%–70% 宽版", previewLayout.chatWidth / 1600 >= 0.6, `${previewLayout.chatWidth}/1600`);

    const citationBefore = await evaluate(`(() => {
      const citations = [...document.querySelectorAll('div[aria-label="回答引用"]')][0];
      if (!citations) return null;
      const expand = citations.querySelector('button[aria-expanded]');
      return {
        shown: citations.querySelectorAll('.citation, [class*="citation"]').length,
        visibleCards: [...citations.children[1].children].length,
        expandText: expand ? expand.textContent.trim() : null,
        expandAriaExpanded: expand ? expand.getAttribute('aria-expanded') : null,
      };
    })()`);
    log("06-citations-collapsed", citationBefore);
    assert("默认只展示前 3 条引用", citationBefore.visibleCards === 3, JSON.stringify(citationBefore));
    assert("折叠按钮文案含「展开全部 6 条引用」", citationBefore.expandText?.includes("展开全部 6 条引用"), citationBefore.expandText);
    assert("折叠按钮 aria-expanded=false", citationBefore.expandAriaExpanded === "false");
    await shoot("06-citations-collapsed");

    await evaluate(`document.querySelector('div[aria-label="回答引用"] button[aria-expanded]').click()`);
    await delay(450);
    await waitFor('[...document.querySelectorAll(\'div[aria-label="回答引用"] button\')].length >= 6', 5000);
    const citationAfter = await evaluate(`(() => {
      const citations = document.querySelector('div[aria-label="回答引用"]');
      const expand = citations.querySelector('button[aria-expanded]');
      return {
        visibleCards: [...citations.children[1].children].length,
        expandText: expand ? expand.textContent.trim() : null,
        expandAriaExpanded: expand ? expand.getAttribute('aria-expanded') : null,
      };
    })()`);
    log("07-citations-expanded", citationAfter);
    assert("展开后 6 条引用全部可见", citationAfter.visibleCards === 6, JSON.stringify(citationAfter));
    assert("展开后按钮变为「收起引用」", citationAfter.expandText?.includes("收起引用"), citationAfter.expandText);
    await shoot("07-citations-expanded");

    // =====================================================================
    // 6) 史引副驾驶分屏：左对话 40% / 右面板 60%
    // =====================================================================
    const citationClick = await evaluate(`(() => {
      const button = document.querySelector('div[aria-label="回答引用"] button[class*="citation"]');
      if (!button) return { clicked: false, reason: "no citation button" };
      button.click();
      return { clicked: true, text: button.textContent.slice(0, 40) };
    })()`);
    console.log("  · 点击引用：", JSON.stringify(citationClick));
    let panelReady = await waitFor(`Boolean(document.querySelector('aside[aria-label="史引副驾驶"]'))`, 10000);
    if (!panelReady) {
      // 兜底：dev 服务器偶发整页刷新会丢预览态，重新进入预览后再点一次。
      console.warn("  ! 首次点击未出现史引面板，重试一次");
      await go("/ask?preview=multiturn", 2600);
      await evaluate(`document.querySelector('div[aria-label="回答引用"] button[class*="citation"]').click()`);
      panelReady = await waitFor(`Boolean(document.querySelector('aside[aria-label="史引副驾驶"]'))`, 12000);
    }
    await delay(1200);
    const split = await evaluate(`(() => {
      const chat = document.querySelector('section[aria-labelledby="conversation-title"]');
      const panel = document.querySelector('aside[aria-label="史引副驾驶"]');
      if (!chat || !panel) return { chat: false, panel: false };
      const c = chat.getBoundingClientRect();
      const p = panel.getBoundingClientRect();
      return {
        chat: Math.round(c.width),
        panel: Math.round(p.width),
        ratio: +(c.width / (c.width + p.width)).toFixed(3),
        sidebar: Boolean(document.querySelector('aside[aria-label="历史对话"]')),
        panelHasIframe: Boolean(panel.querySelector('iframe')),
      };
    })()`);
    log("08-copilot-split", split);
    assert("史引面板已打开", split.panel !== false);
    assert("分屏比例约 40% / 60%", Math.abs(split.ratio - 0.4) < 0.03, split.ratio);
    assert("史引面板含时间轴 iframe", split.panelHasIframe === true);
    await shoot("08-copilot-split");

    // =====================================================================
    // 7) 窄屏 820px：默认收起 + 浮层展开
    // =====================================================================
    await viewport(820, 1000);
    await go("/ask", 3200);
    const narrowDefault = await evaluate(`(() => ({
      sidebar: Boolean(document.querySelector('aside[aria-label="历史对话"]')),
      toggle: Boolean(document.querySelector('button[aria-label="展开历史对话侧边栏"]')),
      overflow: document.documentElement.scrollWidth > innerWidth,
      docScrollHeight: document.documentElement.scrollHeight,
      innerHeight,
      chatWidth: Math.round(document.querySelector('section[aria-labelledby="conversation-title"]').getBoundingClientRect().width),
    }))()`);
    log("09-narrow-default", narrowDefault);
    assert("窄屏默认收起侧边栏", narrowDefault.sidebar === false && narrowDefault.toggle === true, JSON.stringify(narrowDefault));
    assert("窄屏无横向溢出", narrowDefault.overflow === false);
    assert("窄屏整页无文档滚动", narrowDefault.docScrollHeight <= narrowDefault.innerHeight + 1, JSON.stringify(narrowDefault));
    await shoot("09-narrow-default");

    await evaluate(`document.querySelector('button[aria-label="展开历史对话侧边栏"]').click()`);
    await delay(650);
    const narrowOverlay = await evaluate(`(() => {
      const sidebar = document.querySelector('aside[aria-label="历史对话"]');
      const backdrop = document.querySelector('button[aria-label="关闭历史对话浮层"]');
      const s = sidebar?.getBoundingClientRect();
      return {
        sidebar: Boolean(sidebar),
        backdrop: Boolean(backdrop),
        position: sidebar ? getComputedStyle(sidebar).position : null,
        width: s ? Math.round(s.width) : null,
        height: s ? Math.round(s.height) : null,
        coversLeft: s ? Math.round(s.left) <= 1 : null,
        docScrollHeight: document.documentElement.scrollHeight,
        innerHeight,
      };
    })()`);
    log("10-narrow-overlay", narrowOverlay);
    assert("窄屏展开为左侧浮层", narrowOverlay.position === "fixed" && narrowOverlay.coversLeft === true, JSON.stringify(narrowOverlay));
    assert("浮层带遮罩", narrowOverlay.backdrop === true);
    assert("窄屏浮层高度 = 视口高度且不撑开文档", narrowOverlay.height === narrowOverlay.innerHeight && narrowOverlay.docScrollHeight <= narrowOverlay.innerHeight + 1, JSON.stringify(narrowOverlay));
    await shoot("10-narrow-overlay");

    // 窄屏浮层内「⋯」菜单按视口定位（浮层动画 / transform 不能把 fixed 菜单带偏）
    await evaluate(`(() => { document.querySelector('[data-conversation-id] [data-conversation-menu-trigger]')?.click(); return true; })()`);
    await waitFor(`Boolean(document.querySelector('[role="menu"][aria-label="历史对话操作"]'))`, 4000);
    const narrowMenu = await evaluate(`(() => {
      const menu = document.querySelector('[role="menu"][aria-label="历史对话操作"]');
      if (!menu) return null;
      const r = menu.getBoundingClientRect();
      return {
        top: Math.round(r.top), left: Math.round(r.left), right: Math.round(r.right), bottom: Math.round(r.bottom),
        innerWidth, innerHeight,
        inViewport: r.top >= 0 && r.left >= 0 && r.right <= innerWidth && r.bottom <= innerHeight,
      };
    })()`);
    log("10b-narrow-menu", narrowMenu);
    assert("窄屏浮层内「⋯」菜单按视口定位且不超出屏幕", narrowMenu?.inViewport === true, JSON.stringify(narrowMenu));
    await shoot("10b-narrow-menu");
    // 只关闭菜单（点击外部），保留浮层，供下一段验证点击遮罩收起。
    await evaluate(`document.body.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }))`);
    await delay(250);
    const narrowMenuClosed = await evaluate(`Boolean(document.querySelector('[role="menu"][aria-label="历史对话操作"]'))`);
    assert("点击外部关闭悬浮菜单", narrowMenuClosed === false);

    await evaluate(`document.querySelector('button[aria-label="关闭历史对话浮层"]').click()`);
    await delay(500);
    const narrowClosed = await evaluate(`(() => ({
      sidebar: Boolean(document.querySelector('aside[aria-label="历史对话"]')),
      backdrop: Boolean(document.querySelector('button[aria-label="关闭历史对话浮层"]')),
    }))()`);
    assert("点击遮罩可收起浮层", narrowClosed.sidebar === false && narrowClosed.backdrop === false, JSON.stringify(narrowClosed));

    // =====================================================================
    // 8) 真实问答（--live 时启用；失败只记录不阻断 UI 体检）
    // =====================================================================
    if (!OPTIONS.live) {
      console.log("\n  · 跳过真实问答场景（加 --live 启用，需要后端与模型可用）");
    } else {
    await viewport(1600, 1000);
    await go("/ask", 2600);
    const needExpand = await evaluate(`Boolean(document.querySelector('button[aria-label="展开历史对话侧边栏"]'))`);
    if (needExpand) {
      await evaluate(`document.querySelector('button[aria-label="展开历史对话侧边栏"]').click()`);
      await delay(550);
    }
    const sidebarBeforeAsk = await evaluate(`Boolean(document.querySelector('aside[aria-label="历史对话"]'))`);
    console.log(`  · 真实问答前侧边栏展开：${sidebarBeforeAsk}`);
    try {
      await evaluate(`(() => {
        const chip = document.querySelector('[aria-label="推荐问题"] button');
        chip?.click();
        return Boolean(chip);
      })()`);
      await delay(350);
      await evaluate(`document.querySelector('form')?.requestSubmit()`);
      let answered = false;
      for (let i = 0; i < 90; i += 1) {
        await delay(1000);
        const state = await evaluate(`(() => {
          const list = document.querySelector('ol[aria-live="polite"]');
          const busy = list?.getAttribute('aria-busy') === 'true';
          const turns = list ? list.querySelectorAll(':scope > li').length : 0;
          const citations = document.querySelectorAll('div[aria-label="回答引用"]').length;
          const panel = Boolean(document.querySelector('aside[aria-label="史引副驾驶"]'));
          const t = document.querySelector('[data-transcript-scroll]');
          return {
            busy,
            turns,
            citations,
            panel,
            transcriptAtBottom: t ? t.scrollTop + t.clientHeight >= t.scrollHeight - 4 : null,
            docScrollHeight: document.documentElement.scrollHeight,
            innerHeight,
          };
        })()`);
        if (!state.busy && state.turns >= 2) {
          answered = true;
          log("11-real-answer", state);
          break;
        }
        if (i % 10 === 0) console.log("  … waiting answer", i, JSON.stringify(state));
      }
      await delay(1600);
      if (answered) {
        const realMetrics = await evaluate(`(() => {
          const bubbles = [...document.querySelectorAll('ol[aria-live="polite"] > li')].filter((li) => li.querySelector('div[class*="messageText"]'));
          const longest = bubbles.map((li) => ({ h: Math.round(li.getBoundingClientRect().height), w: Math.round(li.getBoundingClientRect().width) })).sort((a, b) => b.h - a.h)[0] ?? null;
          const chat = document.querySelector('section[aria-labelledby="conversation-title"]');
          const panel = document.querySelector('aside[aria-label="史引副驾驶"]');
          const c = chat?.getBoundingClientRect();
          const p = panel?.getBoundingClientRect();
          const expand = document.querySelector('div[aria-label="回答引用"] button[aria-expanded]');
          const t = document.querySelector('[data-transcript-scroll]');
          return {
            turns: bubbles.length,
            longestBubble: longest,
            citationGroups: document.querySelectorAll('div[aria-label="回答引用"]').length,
            citationsVisible: document.querySelectorAll('div[aria-label="回答引用"] .citation, div[aria-label="回答引用"] button[class*="citation"]').length,
            expandText: expand ? expand.textContent.trim() : null,
            copilot: Boolean(panel),
            sidebar: Boolean(document.querySelector('aside[aria-label="历史对话"]')),
            split: c && p ? { chat: Math.round(c.width), panel: Math.round(p.width), ratio: +(c.width / (c.width + p.width)).toFixed(3) } : null,
            transcript: t ? { scrollTop: t.scrollTop, scrollHeight: t.scrollHeight, clientHeight: t.clientHeight, atBottom: t.scrollTop + t.clientHeight >= t.scrollHeight - 4 } : null,
            panelHeight: p ? Math.round(p.height) : null,
            panelBottom: p ? Math.round(p.bottom) : null,
            docScrollHeight: document.documentElement.scrollHeight,
            innerHeight,
          };
        })()`);
        log("11-real-answer-metrics", realMetrics);
        assert("新问题 / 新回答落地后聊天列表自动滚动到底部", realMetrics.transcript?.atBottom === true, JSON.stringify(realMetrics.transcript));
        assert("真实回答 / 史引分屏后整页仍无文档滚动", realMetrics.docScrollHeight <= realMetrics.innerHeight + 1, JSON.stringify({ doc: realMetrics.docScrollHeight, viewport: realMetrics.innerHeight }));
        if (realMetrics.panelHeight) {
          assert("史引面板高度锁定在视口内", realMetrics.panelBottom <= realMetrics.innerHeight + 1, JSON.stringify({ panelHeight: realMetrics.panelHeight, panelBottom: realMetrics.panelBottom, innerHeight: realMetrics.innerHeight }));
        }
        if (realMetrics.copilot) {
          assert("真实回答触发史引时侧边栏自动让位", realMetrics.sidebar === false, JSON.stringify(realMetrics));
          assert("真实回答分屏比例约 40% / 60%", Math.abs(realMetrics.split.ratio - 0.4) < 0.05, JSON.stringify(realMetrics.split));
          await shoot("11-real-answer-guide-split");
          await evaluate(`(() => {
            const btn = [...document.querySelectorAll('aside[aria-label="史引副驾驶"] button')].find((b) => b.textContent.includes('返回聊天'));
            btn?.click();
            return Boolean(btn);
          })()`);
          await delay(800);
          const afterClose = await evaluate(`(async () => {
            await new Promise((r) => setTimeout(r, 300));
            return {
              panel: Boolean(document.querySelector('aside[aria-label="史引副驾驶"]')),
              sidebar: Boolean(document.querySelector('aside[aria-label="历史对话"]')),
            };
          })()`);
          console.log("  · 关闭史引后：", JSON.stringify(afterClose));
        }
        await shoot("11-real-answer");
        console.log("  ✓ 真实问答截图完成（长回答在加宽后的工作区内铺开）");
      } else {
        console.warn("  ! 真实问答超时（未阻断验收，仅记录）");
      }
    } catch (error) {
      console.warn("  ! 真实问答场景失败（未阻断验收）:", error.message);
    }
    }

    // ---------------------------------------------------------------------
    log("console-issues", productIssues());
    await writeFile(
      path.join(OUT, "results.json"),
      JSON.stringify({ baseUrl: BASE, live: OPTIONS.live, results, consoleIssues }, null, 2),
      "utf8",
    );

    const issues = productIssues();
    if (issues.length > 0) {
      console.warn(`\n⚠️ 浏览器控制台记录 ${issues.length} 条产品级 error（详见 results.json）`);
    } else {
      console.log("\n✓ 浏览器控制台无产品级 error");
    }
    console.log(`\n全部 UI 体检场景通过（${results.length} 个检查点 / ${assertionCount} 条断言），截图目录：${OUT}`);
  } finally {
    try {
      ws?.close();
    } catch {}
    // 先精确清理本次启动的 Edge（含孤儿子进程），等锁文件释放后再删 profile。
    await killEdge(edge.pid, profileDir);
    try {
      edge.kill();
    } catch {}
    await delay(600);
    try {
      await rm(profileDir, { recursive: true, force: true, maxRetries: 3, retryDelay: 300 });
    } catch {
      // 清理失败只留下 gitignore 内的临时目录，不影响体检结论。
    }
  }
}

// 兜底：CDP WebSocket / 浏览器子进程句柄可能让 Node 迟迟不退出；超过 6 分钟强制结束。
const watchdog = setTimeout(() => {
  console.error("✖ UI 体检脚本超过 6 分钟未结束，强制退出（可能是清理阶段被阻塞）。");
  process.exit(2);
}, 6 * 60 * 1000);
watchdog.unref?.();

// 用 process.exit 显式收尾：先留 250ms 让 stdout 落盘，再退出，避免管道下输出被截断。
main()
  .then(() => {
    setTimeout(() => process.exit(0), 250);
  })
  .catch((error) => {
    console.error("FAILED:", error);
    if (results.length) console.error("已采集验收结果：", JSON.stringify(results.map((r) => r.name)));
    console.error("浏览器控制台问题：", JSON.stringify(consoleIssues, null, 2));
    setTimeout(() => process.exit(1), 250);
  });