/** 新线稿 Logo 在悬浮抽屉 42px / 移动端 32px 的实际渲染截图。 */
import { spawn } from "node:child_process";
import { writeFile } from "node:fs/promises";
import { setTimeout as delay } from "node:timers/promises";

const EDGE = "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
const OUT = "C:\\Users\\wiledog\\Desktop\\史脉\\.tmp\\ui";
const PORT = 9337;

const HIDE_DEV = `(() => {
  if (document.getElementById('h')) return true;
  const s = document.createElement('style');
  s.id = 'h';
  s.textContent = 'nextjs-portal{display:none!important}';
  document.head.appendChild(s);
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
  throw new Error("timeout");
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
    `--user-data-dir=${OUT}\\edge-cdp-v2b`,
    "--window-size=1440,1000",
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

  await send("Page.enable");
  await send("Runtime.enable");
  await send("Emulation.setDeviceMetricsOverride", {
    width: 1440,
    height: 900,
    deviceScaleFactor: 1,
    mobile: false,
  });

  await send("Page.navigate", { url: "http://localhost:3000/" });
  await delay(3500);
  await evaluate(HIDE_DEV);
  await evaluate(
    `document.querySelector('button[aria-label*="打开史脉问答抽屉"]').click()`,
  );
  await delay(1200);
  await shot("v2-home-drawer");

  await send("Emulation.setDeviceMetricsOverride", {
    width: 390,
    height: 844,
    deviceScaleFactor: 1,
    mobile: true,
  });
  await send("Page.navigate", { url: "http://localhost:3000/ask" });
  await delay(3500);
  await evaluate(HIDE_DEV);
  await shot("v2-ask-mobile");

  ws.close();
  console.log("DONE");
} finally {
  edge.kill();
  await delay(400);
  try {
    spawn("taskkill.exe", ["/PID", String(edge.pid), "/T", "/F"], { stdio: "ignore" });
  } catch {}
}
