import { spawn } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";

const EDGE = "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
const OUT = "C:\\Users\\wiledog\\Desktop\\史脉\\.tmp\\ui";
const PORT = 9334;

async function waitForEndpoint() {
  for (let i = 0; i < 60; i += 1) {
    try {
      const res = await fetch(`http://127.0.0.1:${PORT}/json/version`);
      if (res.ok) return;
    } catch {}
    await delay(300);
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
    `--user-data-dir=${OUT}\\edge-cdp-metrics`,
    "--window-size=390,844",
    "about:blank",
  ],
  { stdio: "ignore" },
);

try {
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
    const result = await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
    if (result.exceptionDetails) throw new Error(JSON.stringify(result.exceptionDetails));
    return result.result?.value;
  };

  await send("Page.enable");
  await send("Runtime.enable");
  await send("Emulation.setDeviceMetricsOverride", {
    width: 390,
    height: 844,
    deviceScaleFactor: 1,
    mobile: true,
  });
  await send("Page.navigate", { url: "http://localhost:3000/ask" });
  await delay(3500);
  const info = await evaluate(`(() => {
    const pick = (el) => el ? { tag: el.tagName, cls: String(el.className).slice(0,120), w: Math.round(el.getBoundingClientRect().width), x: Math.round(el.getBoundingClientRect().x) } : null;
    const all = [...document.querySelectorAll('main, main > *, main > * > *, main > * > * > *')];
    const wide = all.map(pick).filter((x) => x && x.w > 392).slice(0, 20);
    return {
      inner: window.innerWidth,
      scrollW: document.documentElement.scrollWidth,
      bodyW: document.body.getBoundingClientRect().width,
      main: pick(document.querySelector('main')),
      shell: pick(document.querySelector('main > *')),
      topbar: pick(document.querySelector('header')),
      suggestion: pick(document.querySelector('[aria-label="推荐问题"]')),
      chips: [...document.querySelectorAll('[aria-label="推荐问题"] button')].map(pick),
      workspace: pick(document.querySelector('[aria-label="推荐问题"] + *')),
      wide,
    };
  })()`);
  console.log(JSON.stringify(info, null, 2));
  ws.close();
} finally {
  edge.kill();
  await delay(400);
  try {
    spawn("taskkill.exe", ["/PID", String(edge.pid), "/T", "/F"], { stdio: "ignore" });
  } catch {}
}
