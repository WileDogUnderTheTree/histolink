/**
 * TC-07 手工验收（Edge headless + CDP）：
 * - /ask?q=test 显示问题占位；
 * - 抽屉与 /ask 共享同一份占位会话（客户端路由后仍保留 transcript）；
 * - 三页均可打开/关闭抽屉，ESC 可关；
 * - 首页「聊天问答」入口仍保持 V0.9.0 封印行为；
 * - 无 hydration 报错 / console error。
 */
import { writeFileSync } from "node:fs";

const CDP_BASE = "http://127.0.0.1:9222";
const BASE = "http://127.0.0.1:3000";
const SHOT_DIR = "C:/Users/wiledog/Desktop/史脉/.tmp";

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function listTargets() {
  const res = await fetch(`${CDP_BASE}/json/list`);
  return res.json();
}

async function main() {
  const targets = await listTargets();
  const page = targets.find((t) => t.type === "page");
  if (!page) throw new Error("找不到 page target");

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
      exceptions.push(msg.params.exceptionDetails?.exception?.description ?? msg.params.exceptionDetails?.text ?? "unknown");
    }
    if (msg.method === "Log.entryAdded" && msg.params.entry?.level === "error") {
      consoleErrors.push(msg.params.entry.text ?? "log error");
    }
    if (msg.method === "Runtime.consoleAPICalled" && msg.params.type === "error") {
      consoleErrors.push(
        (msg.params.args ?? []).map((a) => a.value ?? a.description ?? a.type).join(" "),
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
  await send("Emulation.setDeviceMetricsOverride", { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false });

  const evaluate = async (expression) => {
    const result = await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
    if (result.exceptionDetails) {
      throw new Error(`evaluate failed: ${result.exceptionDetails.text}`);
    }
    return result.result.value;
  };

  const waitFor = async (expression, label, timeoutMs = 25000) => {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      try {
        if (await evaluate(expression)) return true;
      } catch {
        /* navigating */
      }
      await sleep(250);
    }
    throw new Error(`等待超时：${label}`);
  };

  const report = {};

  // 1) /ask?q=test
  await send("Page.navigate", { url: `${BASE}/ask?q=test` });
  await waitFor(`document.readyState === 'complete'`, "ask 加载");
  await waitFor(`document.body.innerText.includes('test')`, "ask 问题占位");
  report.askInitial = await evaluate(`(() => ({
    pathname: location.pathname,
    search: location.search,
    question: document.querySelector('[data-testid="ask-question"]')?.textContent ?? '',
    transcriptCount: document.querySelectorAll('ol li').length,
    heading: document.querySelector('h1')?.textContent ?? ''
  }))()`);

  // 2) 占位提问 → transcript 增加 2 条
  await evaluate(`[...document.querySelectorAll('button')].find(b => b.textContent.includes('占位提问')).click(), true`);
  await waitFor(`document.querySelectorAll('ol li').length >= 3`, "占位提问写入 transcript");
  report.afterPlaceholderAsk = await evaluate(`document.querySelectorAll('ol li').length`);

  // 3) 客户端路由到 /timeline（layout 不重挂载 → 会话应保留）
  await evaluate(`document.querySelector('a[href="/timeline"]').click(), true`);
  await waitFor(`location.pathname === '/timeline'`, "客户端跳转时间轴");
  await waitFor(`document.querySelector('button[aria-haspopup="dialog"]') !== null`, "抽屉触发器出现");

  // 4) 打开抽屉：应看到同一份 transcript（seed + 占位提问 2 条 = >=3 条）
  await evaluate(`document.querySelector('button[aria-haspopup="dialog"]').click(), true`);
  await waitFor(`document.querySelector('[role="dialog"]') !== null`, "抽屉打开");
  report.drawer = await evaluate(`(() => {
    const dialog = document.querySelector('[role="dialog"]');
    return {
      title: dialog.querySelector('h2')?.textContent ?? '',
      note: dialog.querySelector('p')?.textContent ?? '',
      ariaModal: dialog.getAttribute('aria-modal'),
      turns: dialog.querySelectorAll('ol li').length,
      hasEscHint: dialog.innerText.includes('ESC'),
      noNetworkHint: dialog.innerText.includes('不发送网络请求')
    };
  })()`);

  const shot1 = await send("Page.captureScreenshot", { format: "png" });
  writeFileSync(`${SHOT_DIR}/tc07-drawer-timeline.png`, Buffer.from(shot1.data, "base64"));

  // 5) ESC 关闭
  await send("Input.dispatchKeyEvent", { type: "keyDown", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 });
  await send("Input.dispatchKeyEvent", { type: "keyUp", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 });
  await waitFor(`document.querySelector('[role="dialog"]') === null`, "ESC 关闭抽屉");
  report.escClosed = true;

  // 6) /graph 抽屉可打开、关闭按钮可关
  await send("Page.navigate", { url: `${BASE}/graph` });
  await waitFor(`document.querySelector('button[aria-haspopup="dialog"]') !== null`, "图谱页加载");
  await evaluate(`document.querySelector('button[aria-haspopup="dialog"]').click(), true`);
  await waitFor(`document.querySelector('[role="dialog"]') !== null`, "图谱页抽屉打开");
  await evaluate(`document.querySelector('[role="dialog"] button[aria-label="关闭抽屉"]').click(), true`);
  await waitFor(`document.querySelector('[role="dialog"]') === null`, "关闭按钮关闭抽屉");
  report.graphDrawer = true;

  // 7) 首页：抽屉可用 + 「聊天问答」入口保持封印
  await send("Page.navigate", { url: `${BASE}/` });
  await waitFor(`document.body.innerText.includes('中国历史探索') || document.querySelector('h1') !== null`, "首页加载");
  report.homeSealedBefore = await evaluate(`(() => {
    const muted = document.querySelector('.entry-muted');
    return {
      exists: !!muted,
      tag: muted?.tagName ?? '',
      href: muted?.getAttribute('href') ?? null,
      label: muted?.querySelector('.entry-label')?.textContent?.replace(/\\s+/g, ' ').trim() ?? ''
    };
  })()`);
  await evaluate(`document.querySelector('.entry-muted')?.click(); true`);
  await sleep(400);
  report.homeAfterClick = await evaluate(`(() => ({
    pathname: location.pathname,
    toast: document.querySelector('.toast')?.textContent?.trim() ?? '',
    toastVisible: document.querySelector('.toast')?.classList.contains('toast-show') ?? false
  }))()`);
  await evaluate(`document.querySelector('button[aria-haspopup="dialog"]').click(), true`);
  await waitFor(`document.querySelector('[role="dialog"]') !== null`, "首页抽屉打开");
  report.homeDrawer = true;

  const shot2 = await send("Page.captureScreenshot", { format: "png" });
  writeFileSync(`${SHOT_DIR}/tc07-drawer-home.png`, Buffer.from(shot2.data, "base64"));

  report.consoleErrors = consoleErrors;
  report.exceptions = exceptions;
  report.hydrationErrors = [...consoleErrors, ...exceptions].filter((text) => /hydrat|did not match|server rendered/i.test(text));
  console.log(JSON.stringify(report, null, 2));
  ws.close();
}

main().catch((error) => {
  console.error("CDP TEST FAILED:", error.message);
  process.exit(1);
});
