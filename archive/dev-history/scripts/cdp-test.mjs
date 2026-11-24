/**
 * V0.9.0 内测版浏览器回归（Edge headless + CDP）
 * 用 Node 内置 WebSocket 直连 DevTools 协议，不引入额外依赖。
 *
 * 环境变量：
 *   CDP_BASE   默认 http://127.0.0.1:9222
 *   PAGE_URL   默认 http://127.0.0.1:3000/
 *   SHOT_PATH  可选，截图输出路径
 */
import { writeFileSync } from "node:fs";

const CDP_BASE = process.env.CDP_BASE ?? "http://127.0.0.1:9222";
const PAGE_URL = process.env.PAGE_URL ?? "http://127.0.0.1:3000/";
const SHOT_PATH = process.env.SHOT_PATH ?? "";
const SHOT_TOAST_PATH = process.env.SHOT_TOAST_PATH ?? "";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function listTargets() {
  const res = await fetch(`${CDP_BASE}/json/list`);
  return res.json();
}

async function main() {
  const targets = await listTargets();
  const page = targets.find((t) => t.type === "page");
  if (!page) throw new Error("找不到可用的 page target");

  const ws = new WebSocket(page.webSocketDebuggerUrl);
  const pending = new Map();
  const consoleErrors = [];
  const exceptions = [];
  let seq = 0;

  const send = (method, params = {}) =>
    new Promise((resolve, reject) => {
      const id = ++seq;
      pending.set(id, { resolve, reject });
      ws.send(JSON.stringify({ id, method, params }));
    });

  ws.addEventListener("message", (event) => {
    const msg = JSON.parse(event.data);
    if (msg.id && pending.has(msg.id)) {
      const { resolve, reject } = pending.get(msg.id);
      pending.delete(msg.id);
      if (msg.error) reject(new Error(JSON.stringify(msg.error)));
      else resolve(msg.result);
      return;
    }
    if (msg.method === "Runtime.exceptionThrown") {
      exceptions.push(msg.params.exceptionDetails?.text ?? "unknown exception");
    }
    if (msg.method === "Runtime.consoleAPICalled" && msg.params.type === "error") {
      consoleErrors.push(
        msg.params.args?.map((a) => a.value ?? a.description ?? a.type).join(" ") ?? "console error",
      );
    }
  });

  await new Promise((resolve, reject) => {
    ws.addEventListener("open", resolve, { once: true });
    ws.addEventListener("error", reject, { once: true });
  });

  await send("Page.enable");
  await send("Runtime.enable");
  await send("Log.enable");
  await send("Emulation.setDeviceMetricsOverride", {
    width: 1280,
    height: 900,
    deviceScaleFactor: 1,
    mobile: false,
  });

  const evaluate = async (expression) => {
    const result = await send("Runtime.evaluate", {
      expression,
      awaitPromise: true,
      returnByValue: true,
    });
    if (result.exceptionDetails) {
      throw new Error(
        `evaluate failed: ${result.exceptionDetails.text} :: ${result.exceptionDetails.exception?.description ?? ""}`,
      );
    }
    return result.result.value;
  };

  const waitFor = async (expression, label, timeoutMs = 20000) => {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      try {
        if (await evaluate(expression)) return true;
      } catch {
        /* 页面切换过程中上下文可能短暂不可用 */
      }
      await sleep(250);
    }
    throw new Error(`等待超时：${label}`);
  };

  const report = { pageUrl: PAGE_URL };

  await send("Page.navigate", { url: PAGE_URL });
  await waitFor(`document.readyState === 'complete'`, "页面加载完成");
  // 健康检查请求完成（useEffect 已执行）说明 React 已完成水合
  await waitFor(`document.querySelector('.status')?.textContent.includes('后端已连接')`, "健康角标连接");
  await sleep(300);

  report.initial = await evaluate(`(() => {
    const muted = document.querySelector('.entry-muted');
    return {
      title: document.title,
      heading: document.querySelector('h1')?.textContent ?? '',
      version: document.querySelector('.version')?.textContent?.trim() ?? '',
      status: document.querySelector('.status')?.textContent?.trim() ?? '',
      statusClass: document.querySelector('.status')?.className ?? '',
      mutedTagName: muted?.tagName ?? '',
      mutedAriaDisabled: muted?.getAttribute('aria-disabled') ?? '',
      mutedLabel: muted?.querySelector('.entry-label')?.textContent?.replace(/\\s+/g, ' ').trim() ?? '',
      mutedHint: muted?.querySelector('.entry-hint')?.textContent?.replace(/\\s+/g, ' ').trim() ?? '',
      entries: [...document.querySelectorAll('a.entry')].map((a) => ({
        label: a.querySelector('.entry-label')?.textContent?.trim() ?? '',
        href: a.getAttribute('href'),
      })),
      location: location.href,
    };
  })()`);

  // 点击「聊天问答」：URL 不得变化，且出现 Toast
  await evaluate(`document.querySelector('.entry-muted').click(), true`);
  await sleep(350);
  report.afterChatClick = await evaluate(`(() => {
    const toast = document.querySelector('.toast');
    return {
      location: location.href,
      toastText: toast?.textContent?.trim() ?? '',
      toastVisible: toast?.classList.contains('toast-show') ?? false,
      activeRoutes: [...document.querySelectorAll('a.entry')].map((a) => a.getAttribute('href')),
    };
  })()`);

  // 「时间轴」入口可正常跳转
  await evaluate(`document.querySelector('a[href="/timeline"]').click(), true`);
  await waitFor(`location.pathname === '/timeline'`, "跳转时间轴");
  await waitFor(`document.querySelector('h1') !== null`, "时间轴渲染");
  report.timeline = {
    location: await evaluate(`location.pathname`),
    heading: await evaluate(`document.querySelector('h1')?.textContent ?? ''`),
    entryCount: await evaluate(`document.querySelectorAll('button, a').length`),
  };

  // 「人物关系图」入口可正常跳转
  const graphUrl = new URL("/graph", PAGE_URL).href;
  await send("Page.navigate", { url: graphUrl });
  await waitFor(`document.querySelector('h1') !== null`, "图谱渲染");
  report.graph = {
    location: await evaluate(`location.pathname`),
    heading: await evaluate(`document.querySelector('h1')?.textContent ?? ''`),
    eyebrow: await evaluate(`document.querySelector('p')?.textContent ?? ''`),
    hasSvg: await evaluate(`document.querySelectorAll('svg').length > 0`),
  };

  // 回到首页并截图
  await send("Page.navigate", { url: PAGE_URL });
  await waitFor(`document.querySelector('.entry-muted') !== null`, "首页渲染");
  await sleep(800);
  if (SHOT_PATH) {
    const shot = await send("Page.captureScreenshot", { format: "png" });
    writeFileSync(SHOT_PATH, Buffer.from(shot.data, "base64"));
    report.screenshot = SHOT_PATH;
  }
  if (SHOT_TOAST_PATH) {
    await evaluate(`document.querySelector('.entry-muted').click(), true`);
    await sleep(350);
    const toastShot = await send("Page.captureScreenshot", { format: "png" });
    writeFileSync(SHOT_TOAST_PATH, Buffer.from(toastShot.data, "base64"));
    report.toastScreenshot = SHOT_TOAST_PATH;
  }

  report.consoleErrors = consoleErrors;
  report.exceptions = exceptions;
  console.log(JSON.stringify(report, null, 2));
  ws.close();
}

main().catch((error) => {
  console.error("CDP TEST FAILED:", error.message);
  process.exit(1);
});
