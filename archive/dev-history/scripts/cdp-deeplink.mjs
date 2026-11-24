/**
 * V1.0.1 深链接手工验收（Edge headless + CDP，临时脚本，不入库）。
 * 输出 JSON 供 docs/V1.0.1-验收记录.md 引用，并保存两张截图。
 */
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const EDGE = "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
const BASE = "http://127.0.0.1:3100";
const PROFILE = path.resolve(".tmp/edge-cdp-profile");
const DEBUG_PORT = 9222;
const IMAGES = path.resolve("docs/images");
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function waitForDebugger() {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    try {
      const response = await fetch(`http://127.0.0.1:${DEBUG_PORT}/json/version`);
      if (response.ok) return await response.json();
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
  close() {
    this.ws.close();
  }
}

async function main() {
  fs.mkdirSync(IMAGES, { recursive: true });
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
    { stdio: "ignore", detached: false },
  );

  try {
    await waitForDebugger();
    const list = await (await fetch(`http://127.0.0.1:${DEBUG_PORT}/json/list`)).json();
    const pageTarget = list.find((target) => target.type === "page");
    if (!pageTarget) throw new Error("未找到可用的 page target");

    const cdp = new CDP(pageTarget.webSocketDebuggerUrl);
    await cdp.ready();
    await cdp.send("Page.enable");
    await cdp.send("Runtime.enable");
    await cdp.send("Emulation.setDeviceMetricsOverride", {
      width: 1440,
      height: 1000,
      deviceScaleFactor: 1,
      mobile: false,
    });

    async function visit(url, waitMs = 2600) {
      await cdp.send("Page.navigate", { url });
      await sleep(waitMs);
      const result = await cdp.send("Runtime.evaluate", {
        expression: "document.readyState + '|' + location.href",
        returnByValue: true,
      });
      return result.result.value;
    }

    async function evaluate(expression) {
      const result = await cdp.send("Runtime.evaluate", {
        expression,
        returnByValue: true,
        awaitPromise: true,
      });
      if (result.exceptionDetails) throw new Error(JSON.stringify(result.exceptionDetails));
      return result.result.value;
    }

    async function screenshot(file) {
      const shot = await cdp.send("Page.captureScreenshot", { format: "png", captureBeyondViewport: false });
      fs.writeFileSync(path.join(IMAGES, file), Buffer.from(shot.data, "base64"));
    }

    const report = {};

    // 1) /timeline?event=qin-unify
    await visit(`${BASE}/timeline?event=qin-unify`);
    report.timelineEvent = await evaluate(`(() => {
      const body = document.body.innerText;
      const pressed = [...document.querySelectorAll('button[aria-pressed="true"]')]
        .map((button) => button.getAttribute('aria-label'));
      return {
        route: location.pathname + location.search,
        h1: document.querySelector('h1')?.textContent ?? '',
        hasQinUnify: body.includes('秦始皇统一六国'),
        hasBc221: body.includes('公元前 221'),
        pressedLabels: pressed,
        cardTitle: [...document.querySelectorAll('h2')].map((h) => h.textContent).filter(Boolean).slice(0, 3),
      };
    })()`);
    await screenshot("v1.0.1-deeplink-timeline.png");

    // 2) /timeline?event=special-star-1893（彩蛋）
    await visit(`${BASE}/timeline?event=special-star-1893`, 1800);
    report.timelineEgg = await evaluate(`(() => {
      const banner = document.querySelector('aside[aria-label="致敬纪念横幅"]');
      return {
        route: location.pathname + location.search,
        eggVisible: banner?.getAttribute('aria-hidden') === 'false',
        hasCouplet: (banner?.textContent ?? '').includes('四海翻腾云水怒'),
      };
    })()`);

    // 3) /graph?person=p-kangxidi-aaa3&era=qing（person_id + 分期）
    await visit(`${BASE}/graph?person=p-kangxidi-aaa3&era=qing`, 3600);
    report.graphPersonId = await evaluate(`(() => {
      const body = document.body.innerText;
      return {
        route: location.pathname + location.search,
        h1: document.querySelector('h1')?.textContent ?? '',
        hasKangxi: body.includes('康熙帝'),
        svgLabel: document.querySelector('svg[role="img"]')?.getAttribute('aria-label') ?? '',
        panel: document.querySelector('aside')?.innerText.slice(0, 120) ?? '',
      };
    })()`);
    await screenshot("v1.0.1-deeplink-graph.png");

    // 4) /graph?person=清圣祖&era=qing（别名）与非法 person 回落
    await visit(`${BASE}/graph?person=%E6%B8%85%E5%9C%A3%E7%A5%96&era=qing`, 3600);
    report.graphAlias = await evaluate(`(() => ({
      route: location.pathname + location.search,
      svgLabel: document.querySelector('svg[role="img"]')?.getAttribute('aria-label') ?? '',
      hasKangxi: document.body.innerText.includes('康熙帝'),
    }))()`);

    await visit(`${BASE}/graph?person=not-exist&era=qing`, 3600);
    report.graphInvalidFallback = await evaluate(`(() => ({
      route: location.pathname + location.search,
      svgLabel: document.querySelector('svg[role="img"]')?.getAttribute('aria-label') ?? '',
      hasKangxi: document.body.innerText.includes('康熙帝'),
    }))()`);

    // 5) 非深链接默认行为回归：/timeline 与 /graph 默认中心
    await visit(`${BASE}/timeline`, 2200);
    report.timelineDefault = await evaluate(`(() => ({
      route: location.pathname + location.search,
      h1: document.querySelector('h1')?.textContent ?? '',
      hasXiaTab: document.body.innerText.includes('夏'),
    }))()`);

    await visit(`${BASE}/graph`, 3600);
    report.graphDefault = await evaluate(`(() => ({
      route: location.pathname + location.search,
      h1: document.querySelector('h1')?.textContent ?? '',
      svgLabel: document.querySelector('svg[role="img"]')?.getAttribute('aria-label') ?? '',
      hasKongzi: document.body.innerText.includes('孔子'),
    }))()`);

    const out = path.resolve(".tmp/cdp-deeplink-report.json");
    fs.writeFileSync(out, JSON.stringify(report, null, 2), "utf8");
    console.log(JSON.stringify(report, null, 2));
    cdp.close();
  } finally {
    edge.kill();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
