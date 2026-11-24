#!/usr/bin/env node
/**
 * 史脉 · `/ask` 页面 UI / UX 无头浏览器体检（V1.0.5.3 全面体检专项 · 工具 1）。
 *
 * 覆盖（对照 V1.0.5.2 UI 呼吸感补丁的验收口径）：
 *  1) 1600×1000 默认视图：侧边栏展开、聊天区加宽、气泡 85% / 行高 1.8、模型按钮位置；
 *  2) 侧边栏收起 + localStorage 持久化 + 刷新后保持收起 + 顶栏「展开历史对话」入口；
 *  3) 预览模式不渲染侧边栏、无侧边栏时对话区 60%–70% 宽版居中；
 *  4) 引用 >3 默认折叠、「展开全部 N 条引用」、展开后全部可见；
 *  5) 引用点击打开史引副驾驶：左对话 40% / 右面板 60% 分屏；
 *  6) 窄屏 820px：侧边栏默认收起、展开为浮层 + 遮罩、点击遮罩可收起；
 *  7) （--live）真实提问：长回答 / 引用 / 史引自动分屏 + 侧边栏自动让位。
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

function log(name, payload) {
  console.log(`\n[${name}]`);
  console.log(JSON.stringify(payload, null, 2));
  results.push({ name, payload });
}

function assert(name, condition, detail) {
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
    // 2) 侧边栏收起 → 宽版居中 → 持久化 → 刷新保持
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
    log("02-sidebar-collapsed", collapsed);
    assert("收起后侧边栏不再占位", collapsed.sidebar === false);
    assert("顶栏出现展开入口", collapsed.toggle === true);
    assert("对话区放宽到视口 60%–70%", collapsed.chat / 1600 >= 0.55 && collapsed.chat / 1600 <= 0.75, `${collapsed.chat}/1600`);
    assert("对话区水平居中", Math.abs(collapsed.shellOffsetX - (1600 - collapsed.shell) / 2) < 24, JSON.stringify({ x: collapsed.shellOffsetX, expected: (1600 - collapsed.shell) / 2 }));
    assert("折叠偏好已落盘", collapsed.stored === "collapsed", collapsed.stored);
    await shoot("02-sidebar-collapsed");

    await go("/ask", 3000);
    const persisted = await evaluate(`(() => ({
      sidebar: Boolean(document.querySelector('aside[aria-label="历史对话"]')),
      toggle: Boolean(document.querySelector('button[aria-label="展开历史对话侧边栏"]')),
      stored: localStorage.getItem('histolink.ask.sidebar.v1'),
    }))()`);
    log("03-sidebar-persisted-after-reload", persisted);
    assert("刷新后保持收起", persisted.sidebar === false && persisted.toggle === true);
    await shoot("03-sidebar-persisted-after-reload");

    // 恢复展开，供后续真实问答 / 分屏对比
    await evaluate(`document.querySelector('button[aria-label="展开历史对话侧边栏"]').click()`);
    await delay(600);
    const reExpanded = await evaluate(`(() => ({
      sidebar: Boolean(document.querySelector('aside[aria-label="历史对话"]')),
      stored: localStorage.getItem('histolink.ask.sidebar.v1'),
    }))()`);
    assert("可重新展开侧边栏", reExpanded.sidebar === true && reExpanded.stored === "expanded", JSON.stringify(reExpanded));

    // =====================================================================
    // 3) 引用折叠：多轮预览（6 条引用 → 默认 3 条）
    // =====================================================================
    await go("/ask?preview=multiturn", 3000);
    const previewLayout = await evaluate(`(() => {
      const chat = document.querySelector('section[aria-labelledby="conversation-title"]');
      return {
        sidebar: Boolean(document.querySelector('aside[aria-label="历史对话"]')),
        chatWidth: chat ? Math.round(chat.getBoundingClientRect().width) : null,
      };
    })()`);
    log("04a-preview-layout", previewLayout);
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
    log("04-citations-collapsed", citationBefore);
    assert("默认只展示前 3 条引用", citationBefore.visibleCards === 3, JSON.stringify(citationBefore));
    assert("折叠按钮文案含「展开全部 6 条引用」", citationBefore.expandText?.includes("展开全部 6 条引用"), citationBefore.expandText);
    assert("折叠按钮 aria-expanded=false", citationBefore.expandAriaExpanded === "false");
    await shoot("04-citations-collapsed");

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
    log("05-citations-expanded", citationAfter);
    assert("展开后 6 条引用全部可见", citationAfter.visibleCards === 6, JSON.stringify(citationAfter));
    assert("展开后按钮变为「收起引用」", citationAfter.expandText?.includes("收起引用"), citationAfter.expandText);
    await shoot("05-citations-expanded");

    // =====================================================================
    // 4) 史引副驾驶分屏：左对话 40% / 右面板 60%
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
    log("06-copilot-split", split);
    assert("史引面板已打开", split.panel !== false);
    assert("分屏比例约 40% / 60%", Math.abs(split.ratio - 0.4) < 0.03, split.ratio);
    assert("史引面板含时间轴 iframe", split.panelHasIframe === true);
    await shoot("06-copilot-split");

    // =====================================================================
    // 5) 窄屏 820px：默认收起 + 浮层展开
    // =====================================================================
    await viewport(820, 1000);
    await go("/ask", 3200);
    const narrowDefault = await evaluate(`(() => ({
      sidebar: Boolean(document.querySelector('aside[aria-label="历史对话"]')),
      toggle: Boolean(document.querySelector('button[aria-label="展开历史对话侧边栏"]')),
      overflow: document.documentElement.scrollWidth > innerWidth,
      chatWidth: Math.round(document.querySelector('section[aria-labelledby="conversation-title"]').getBoundingClientRect().width),
    }))()`);
    log("07-narrow-default", narrowDefault);
    assert("窄屏默认收起侧边栏", narrowDefault.sidebar === false && narrowDefault.toggle === true, JSON.stringify(narrowDefault));
    assert("窄屏无横向溢出", narrowDefault.overflow === false);
    await shoot("07-narrow-default");

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
        coversLeft: s ? Math.round(s.left) <= 1 : null,
      };
    })()`);
    log("08-narrow-overlay", narrowOverlay);
    assert("窄屏展开为左侧浮层", narrowOverlay.position === "fixed" && narrowOverlay.coversLeft === true, JSON.stringify(narrowOverlay));
    assert("浮层带遮罩", narrowOverlay.backdrop === true);
    await shoot("08-narrow-overlay");

    await evaluate(`document.querySelector('button[aria-label="关闭历史对话浮层"]').click()`);
    await delay(500);
    const narrowClosed = await evaluate(`(() => ({
      sidebar: Boolean(document.querySelector('aside[aria-label="历史对话"]')),
      backdrop: Boolean(document.querySelector('button[aria-label="关闭历史对话浮层"]')),
    }))()`);
    assert("点击遮罩可收起浮层", narrowClosed.sidebar === false && narrowClosed.backdrop === false, JSON.stringify(narrowClosed));

    // =====================================================================
    // 6) 真实问答（--live 时启用；失败只记录不阻断 UI 体检）
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
          return { busy, turns, citations, panel };
        })()`);
        if (!state.busy && state.turns >= 2) {
          answered = true;
          log("09-real-answer", state);
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
          return {
            turns: bubbles.length,
            longestBubble: longest,
            citationGroups: document.querySelectorAll('div[aria-label="回答引用"]').length,
            citationsVisible: document.querySelectorAll('div[aria-label="回答引用"] .citation, div[aria-label="回答引用"] button[class*="citation"]').length,
            expandText: expand ? expand.textContent.trim() : null,
            copilot: Boolean(panel),
            sidebar: Boolean(document.querySelector('aside[aria-label="历史对话"]')),
            split: c && p ? { chat: Math.round(c.width), panel: Math.round(p.width), ratio: +(c.width / (c.width + p.width)).toFixed(3) } : null,
          };
        })()`);
        log("09-real-answer-metrics", realMetrics);
        if (realMetrics.copilot) {
          assert("真实回答触发史引时侧边栏自动让位", realMetrics.sidebar === false, JSON.stringify(realMetrics));
          assert("真实回答分屏比例约 40% / 60%", Math.abs(realMetrics.split.ratio - 0.4) < 0.05, JSON.stringify(realMetrics.split));
          await shoot("09-real-answer-guide-split");
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
        await shoot("09-real-answer");
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
    console.log(`\n全部 UI 体检场景通过（${results.length} 组断言），截图目录：${OUT}`);
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