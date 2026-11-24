/**
 * V1.0.4 第二轮 UI 验收：
 * 1) 新线稿 Logo
 * 2) 聊天 → 展开完整时间轴（带 from=agent）→ 时间轴出现「返回聊天」→ 点击回 /ask
 * 3) 无 from 的 /timeline 不出现按钮
 * 4) /graph?from=agent 出现按钮
 */
import { spawn } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { setTimeout as delay } from "node:timers/promises";

const EDGE = "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
const OUT = "C:\\Users\\wiledog\\Desktop\\史脉\\.tmp\\ui";
const PORT = 9336;

const HIDE_DEV = `(() => {
  if (document.getElementById('hide-dev-indicator')) return true;
  const style = document.createElement('style');
  style.id = 'hide-dev-indicator';
  style.textContent = 'nextjs-portal{display:none!important}';
  document.head.appendChild(style);
  return true;
})()`;

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

const edge = spawn(
  EDGE,
  [
    "--headless=new",
    "--disable-gpu",
    "--hide-scrollbars",
    "--no-first-run",
    "--no-default-browser-check",
    `--remote-debugging-port=${PORT}`,
    `--user-data-dir=${OUT}\\edge-cdp-v2`,
    "--window-size=1440,1000",
    "about:blank",
  ],
  { stdio: "ignore" },
);

try {
  await mkdir(OUT, { recursive: true });
  await waitForEndpoint();
  const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
  const target = list.find((item) => item.type === "page");
  const ws = new WebSocket(target.webSocketDebuggerUrl);
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
    }
  });
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
  const shot = async (name) => {
    const { data } = await send("Page.captureScreenshot", { format: "png" });
    await writeFile(`${OUT}\\${name}.png`, Buffer.from(data, "base64"));
    console.log("saved", name);
  };
  const navigate = async (url, settle = 3000) => {
    await send("Page.navigate", { url });
    await delay(settle);
    await evaluate(HIDE_DEV);
  };
  const waitForUrlIncludes = async (fragment, timeout = 15000) => {
    for (let i = 0; i < timeout / 300; i += 1) {
      await delay(300);
      const url = await evaluate("location.pathname + location.search");
      if (url.includes(fragment)) return url;
    }
    return await evaluate("location.pathname + location.search");
  };

  await send("Page.enable");
  await send("Runtime.enable");
  await send("Emulation.setDeviceMetricsOverride", {
    width: 1440,
    height: 900,
    deviceScaleFactor: 1,
    mobile: false,
  });

  // 1) /ask 新 logo
  await navigate("http://localhost:3000/ask", 4000);
  await shot("v2-ask-logo");

  // 2) 提问 → 副驾驶 → 展开完整时间轴
  await evaluate(`document.querySelector('[aria-label="推荐问题"] button').click()`);
  await delay(350);
  await evaluate(`document.querySelector('form').requestSubmit()`);
  let opened = false;
  for (let i = 0; i < 120; i += 1) {
    await delay(1000);
    if (await evaluate(`Boolean(document.querySelector('aside[aria-label="史引副驾驶"]'))`)) {
      opened = true;
      break;
    }
  }
  if (!opened) throw new Error("史引副驾驶未展开");
  await delay(4000);
  await evaluate(`(() => {
    const frame = document.querySelector('aside[aria-label="史引副驾驶"] iframe');
    try {
      const doc = frame && frame.contentDocument;
      if (doc && doc.head) {
        const style = doc.createElement('style');
        style.textContent = 'nextjs-portal{display:none!important}';
        doc.head.appendChild(style);
      }
    } catch {}
    return true;
  })()`);
  await shot("v2-copilot");

  await evaluate(
    `[...document.querySelectorAll('aside[aria-label="史引副驾驶"] header button')][0].click()`,
  );
  const timelineUrl = await waitForUrlIncludes("/timeline");
  await delay(2500);
  await evaluate(HIDE_DEV);
  await shot("v2-timeline-return");
  const timelineButton = await evaluate(`(() => {
    const btn = [...document.querySelectorAll('button')].find((b) => b.textContent.includes('返回聊天'));
    return btn ? { text: btn.textContent.trim(), visible: Boolean(btn.offsetParent) } : null;
  })()`);
  console.log("timeline url:", timelineUrl);
  console.log("timeline return button:", timelineButton);

  // 3) 点返回聊天 → /ask
  if (timelineButton) {
    await evaluate(
      `[...document.querySelectorAll('button')].find((b) => b.textContent.includes('返回聊天')).click()`,
    );
    const backUrl = await waitForUrlIncludes("/ask");
    await delay(2000);
    console.log("back to:", backUrl);
    await evaluate(HIDE_DEV);
    await shot("v2-ask-returned");
  }

  // 4) 无 from 的 /timeline 不显示按钮
  await navigate("http://localhost:3000/timeline", 3000);
  const plainTimelineButton = await evaluate(
    `Boolean([...document.querySelectorAll('button')].find((b) => b.textContent.includes('返回聊天')))`,
  );
  console.log("plain timeline has return button:", plainTimelineButton);

  // 5) /graph?from=agent 显示按钮
  await navigate("http://localhost:3000/graph?from=agent", 4500);
  await shot("v2-graph-return");
  const graphButton = await evaluate(`(() => {
    const btn = [...document.querySelectorAll('button')].find((b) => b.textContent.includes('返回聊天'));
    return btn ? { text: btn.textContent.trim(), visible: Boolean(btn.offsetParent) } : null;
  })()`);
  console.log("graph return button:", graphButton);

  ws.close();
  console.log("DONE");
} finally {
  edge.kill();
  await delay(400);
  try {
    spawn("taskkill.exe", ["/PID", String(edge.pid), "/T", "/F"], { stdio: "ignore" });
  } catch {}
}
