/**
 * V1.0.1 受控选中手工验收（Edge headless + CDP，临时脚本，不入库）。
 * 打开 /graph?person=曹操&era=sanguo&selected=刘备，验证受控 props 打开关系面板。
 */
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const EDGE = "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
const PROFILE = path.resolve(".tmp/edge-cdp-profile-2");
const DEBUG_PORT = 9223;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function waitForDebugger() {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    try {
      const response = await fetch(`http://127.0.0.1:${DEBUG_PORT}/json/version`);
      if (response.ok) return;
    } catch {
      // not ready
    }
    await sleep(250);
  }
  throw new Error("Edge 远程调试端口未就绪");
}

class CDP {
  constructor(url) {
    this.ws = new WebSocket(url);
    this.id = 0;
    this.pending = new Map();
    this.ws.addEventListener("message", (event) => {
      const message = JSON.parse(event.data);
      if (message.id && this.pending.has(message.id)) {
        const { resolve, reject } = this.pending.get(message.id);
        this.pending.delete(message.id);
        if (message.error) reject(new Error(JSON.stringify(message.error)));
        else resolve(message.result);
      }
    });
  }
  ready() {
    return new Promise((resolve, reject) => {
      this.ws.addEventListener("open", resolve, { once: true });
      this.ws.addEventListener("error", reject, { once: true });
    });
  }
  send(method, params = {}) {
    const id = (this.id += 1);
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }
}

async function main() {
  const edge = spawn(
    EDGE,
    [
      "--headless=new",
      "--disable-gpu",
      "--no-first-run",
      "--no-default-browser-check",
      "--hide-scrollbars",
      `--remote-debugging-port=${DEBUG_PORT}`,
      `--user-data-dir=${PROFILE}`,
      "about:blank",
    ],
    { stdio: "ignore" },
  );
  try {
    await waitForDebugger();
    const list = await (await fetch(`http://127.0.0.1:${DEBUG_PORT}/json/list`)).json();
    const target = list.find((item) => item.type === "page");
    const cdp = new CDP(target.webSocketDebuggerUrl);
    await cdp.ready();
    await cdp.send("Page.enable");
    await cdp.send("Runtime.enable");
    await cdp.send("Emulation.setDeviceMetricsOverride", {
      width: 1440,
      height: 1000,
      deviceScaleFactor: 1,
      mobile: false,
    });

    const url = "http://127.0.0.1:3100/graph?person=" + encodeURIComponent("曹操") + "&era=sanguo&selected=" + encodeURIComponent("刘备");
    await cdp.send("Page.navigate", { url });
    await sleep(3800);
    const result = await cdp.send("Runtime.evaluate", {
      expression: `(() => {
        const body = document.body.innerText;
        const panel = [...document.querySelectorAll('aside')].map((node) => node.innerText).join('\\n---\\n');
        const nodes = [...document.querySelectorAll('g[role="button"]')];
        const selectedNode = nodes.find((node) => node.getAttribute('aria-pressed') === 'true');
        return {
          route: location.pathname + location.search,
          svgLabel: document.querySelector('svg[role="img"]')?.getAttribute('aria-label') ?? '',
          hasRelationPanel: body.includes('人物关系') && body.includes('曹操 × 刘备'),
          panelExcerpt: panel.split('\\n').slice(0, 12),
          selectedNodeLabel: selectedNode?.getAttribute('aria-label') ?? null,
          selectedCount: nodes.filter((node) => node.getAttribute('aria-pressed') === 'true').length,
        };
      })()`,
      returnByValue: true,
    });

    const shot = await cdp.send("Page.captureScreenshot", { format: "png" });
    fs.mkdirSync(path.resolve("docs/images"), { recursive: true });
    fs.writeFileSync(
      path.resolve("docs/images/v1.0.1-deeplink-controlled-selection.png"),
      Buffer.from(shot.data, "base64"),
    );

    const out = path.resolve(".tmp/cdp-controlled-report.json");
    fs.writeFileSync(out, JSON.stringify(result.result.value, null, 2), "utf8");
    console.log(JSON.stringify(result.result.value, null, 2));
  } finally {
    edge.kill();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
