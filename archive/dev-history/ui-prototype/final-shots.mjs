/**
 * 最终验收截图 + 跳转按钮 E2E（本地临时脚本，不进生产代码）。
 * 1) /ask 空态与推荐问题 hover
 * 2) 提问后史引副驾驶 35 / 65 分屏
 * 3) 点「展开完整时间轴」验证顶层跳转并带上焦点事件
 * 4) 首页悬浮抽屉品牌图标
 * 5) 390px 移动端视图
 */
import { spawn } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { setTimeout as delay } from "node:timers/promises";

const EDGE = "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
const OUT = "C:\\Users\\wiledog\\Desktop\\史脉\\.tmp\\ui";
const PORT = 9335;

const HIDE_DEV_INDICATOR = `(() => {
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
    `--user-data-dir=${OUT}\\edge-cdp-final`,
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
    await evaluate(HIDE_DEV_INDICATOR);
  };

  await send("Page.enable");
  await send("Runtime.enable");
  await send("Emulation.setDeviceMetricsOverride", {
    width: 1440,
    height: 900,
    deviceScaleFactor: 1,
    mobile: false,
  });

  // 1) 空态 + hover
  await navigate("http://localhost:3000/ask", 4000);
  await shot("final-ask-clean");
  const chipRect = await evaluate(`(() => {
    const chip = document.querySelector('[aria-label="推荐问题"] button');
    const r = chip.getBoundingClientRect();
    return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
  })()`);
  await send("Input.dispatchMouseEvent", { type: "mouseMoved", ...chipRect });
  await delay(500);
  await shot("final-ask-hover");
  await send("Input.dispatchMouseEvent", { type: "mouseMoved", x: 5, y: 300 });

  // 2) 提问 → 史引展开
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
      if (doc && doc.head && !doc.getElementById('hide-dev-indicator')) {
        const style = doc.createElement('style');
        style.id = 'hide-dev-indicator';
        style.textContent = 'nextjs-portal{display:none!important}';
        doc.head.appendChild(style);
      }
    } catch {}
    return true;
  })()`);
  await shot("final-ask-copilot");
  const before = await evaluate(`location.pathname + location.search`);
  console.log("before jump:", before);

  // 3) 点「展开完整时间轴」→ 顶层跳转并带焦点实体
  const buttonTexts = await evaluate(
    `[...document.querySelectorAll('aside[aria-label="史引副驾驶"] header button')].map((b) => b.textContent.trim())`,
  );
  console.log("copilot buttons:", buttonTexts);
  await evaluate(
    `[...document.querySelectorAll('aside[aria-label="史引副驾驶"] header button')][0].click()`,
  );
  let after = before;
  for (let i = 0; i < 30; i += 1) {
    await delay(300);
    after = await evaluate(`location.pathname + location.search`);
    if (after !== before) break;
  }
  await evaluate(HIDE_DEV_INDICATOR);
  await delay(2500);
  await shot("final-timeline-jump");
  console.log("after jump:", after, "| has focus event:", /[?&]event=/.test(after));

  // 4) 首页悬浮抽屉
  await navigate("http://localhost:3000/", 2500);
  await evaluate(`document.querySelector('button[aria-label*="打开史脉问答抽屉"]').click()`);
  await delay(1200);
  await shot("final-home-drawer");

  // 5) 390 移动端视图（CDP 设备模拟，不受 headless 最小窗宽限制）
  await send("Emulation.setDeviceMetricsOverride", {
    width: 390,
    height: 844,
    deviceScaleFactor: 1,
    mobile: true,
  });
  await navigate("http://localhost:3000/ask", 3500);
  await shot("final-ask-mobile");

  ws.close();
  console.log("DONE");
} finally {
  edge.kill();
  await delay(400);
  try {
    spawn("taskkill.exe", ["/PID", String(edge.pid), "/T", "/F"], { stdio: "ignore" });
  } catch {}
}
