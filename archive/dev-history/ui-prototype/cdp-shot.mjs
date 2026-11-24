/**
 * 本地验收用 CDP 截图脚本（不进入生产代码）：
 * 启动一个隔离的 headless Edge，打开史脉前端，模拟推荐问题 → 等待史引副驾驶展开，
 * 截图 /ask 分屏、推荐问题 hover、首页悬浮抽屉，用于 UI 精修人工验收。
 */
import { spawn } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { setTimeout as delay } from "node:timers/promises";

const EDGE = "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
const OUT = "C:\\Users\\wiledog\\Desktop\\史脉\\.tmp\\ui";
const PORT = 9333;

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

async function main() {
  await mkdir(OUT, { recursive: true });
  const edge = spawn(
    EDGE,
    [
      "--headless=new",
      "--disable-gpu",
      "--hide-scrollbars",
      "--no-first-run",
      "--no-default-browser-check",
      `--remote-debugging-port=${PORT}`,
      `--user-data-dir=${OUT}\\edge-cdp-profile`,
      "--window-size=1440,1000",
      "about:blank",
    ],
    { stdio: "ignore" },
  );

  try {
    await waitForEndpoint();
    const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
    const target = list.find((item) => item.type === "page");
    if (!target) throw new Error("no page target");

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

    // ---- 1. /ask 空态 + 推荐问题 hover ----
    await send("Page.navigate", { url: "http://localhost:3000/ask" });
    await delay(3500);
    await evaluate("document.fonts ? document.fonts.ready.then(() => true) : true");

    const chipRect = await evaluate(`(() => {
      const chip = document.querySelector('[aria-label="推荐问题"] button');
      if (!chip) return null;
      const r = chip.getBoundingClientRect();
      return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
    })()`);
    if (chipRect) {
      await send("Input.dispatchMouseEvent", {
        type: "mouseMoved",
        x: chipRect.x,
        y: chipRect.y,
      });
      await delay(500);
      await shot("ask-hover");
    }
    await shot("ask-clean");

    // ---- 2. 点推荐问题，等史引副驾驶自动展开 ----
    await evaluate(`(() => {
      const chip = document.querySelector('[aria-label="推荐问题"] button');
      if (chip) chip.click();
      return true;
    })()`);
    await delay(400);
    await evaluate(`(() => {
      const form = document.querySelector('form');
      if (form) form.requestSubmit();
      return true;
    })()`);

    let opened = false;
    for (let i = 0; i < 120; i += 1) {
      await delay(1000);
      const state = await evaluate(`(() => {
        const panel = document.querySelector('aside[aria-label="史引副驾驶"]');
        const asking = document.querySelector('ol[aria-live="polite"] [aria-busy], ol[aria-busy="true"]');
        return { panel: Boolean(panel), busy: Boolean(asking) };
      })()`);
      if (state?.panel) {
        opened = true;
        break;
      }
      if (i % 5 === 0) console.log("waiting...", i, state);
    }
    if (!opened) throw new Error("史引副驾驶未展开（后端回答可能失败/超时）");
    await delay(3500);
    await shot("ask-copilot");

    // ---- 3. 首页悬浮问答抽屉 ----
    await send("Page.navigate", { url: "http://localhost:3000/" });
    await delay(2500);
    await evaluate(`(() => {
      const launcher = document.querySelector('button[aria-label*="打开史脉问答抽屉"]');
      if (launcher) launcher.click();
      return true;
    })()`);
    await delay(1200);
    await shot("home-drawer");

    ws.close();
  } finally {
    edge.kill();
    await delay(500);
    try {
      spawn("taskkill.exe", ["/PID", String(edge.pid), "/T", "/F"], { stdio: "ignore" });
    } catch {}
  }
}

main().catch((error) => {
  console.error("FAILED:", error);
  process.exitCode = 1;
});
