/* eslint-disable no-console */
// 通过 CDP 驱动无头 Edge 实测 /graph 页面：顶部文案、? 气泡、清图谱切换与「康熙」搜索。
const fs = require("node:fs");
const path = require("node:path");

const CDP_HTTP = "http://127.0.0.1:9222";
const PAGE_URL = "http://localhost:3000/graph";
const OUT_DIR = __dirname;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function waitForJson(url, tries = 80) {
  for (let index = 0; index < tries; index += 1) {
    try {
      const response = await fetch(url);
      if (response.ok) return await response.json();
    } catch {}
    await sleep(250);
  }
  throw new Error(`CDP 未就绪：${url}`);
}

class Cdp {
  constructor(ws) {
    this.ws = ws;
    this.nextId = 1;
    this.pending = new Map();
    this.events = [];
    this.consoleErrors = [];
    ws.addEventListener("message", (event) => {
      const message = JSON.parse(event.data);
      if (message.id && this.pending.has(message.id)) {
        const { resolve, reject } = this.pending.get(message.id);
        this.pending.delete(message.id);
        if (message.error) reject(new Error(JSON.stringify(message.error)));
        else resolve(message.result);
        return;
      }
      this.events.push(message);
      if (message.method === "Runtime.exceptionThrown") {
        this.consoleErrors.push(
          `exception: ${message.params.exceptionDetails?.exception?.description ?? JSON.stringify(message.params)}`,
        );
      }
      if (message.method === "Runtime.consoleAPICalled" && message.params.type === "error") {
        this.consoleErrors.push(
          `console.error: ${message.params.args.map((arg) => arg.value ?? arg.description ?? "").join(" ")}`,
        );
      }
    });
  }

  send(method, params = {}) {
    const id = this.nextId;
    this.nextId += 1;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ id, method, params }));
      setTimeout(() => {
        if (this.pending.has(id)) {
          this.pending.delete(id);
          reject(new Error(`CDP 超时：${method}`));
        }
      }, 30000);
    });
  }

  async eval(expression) {
    const result = await this.send("Runtime.evaluate", {
      expression,
      returnByValue: true,
      awaitPromise: true,
    });
    if (result.exceptionDetails) {
      throw new Error(`页面执行异常：${JSON.stringify(result.exceptionDetails)}`);
    }
    return result.result.value;
  }
}

async function main() {
  const target = await waitForJson(`${CDP_HTTP}/json/list`).then(async (list) => {
    const existing = list.find((item) => item.type === "page" && item.url.includes("localhost:3000"));
    if (existing) return existing;
    const created = await fetch(`${CDP_HTTP}/json/new?${encodeURIComponent(PAGE_URL)}`, { method: "PUT" });
    return created.json();
  });

  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    ws.addEventListener("open", resolve, { once: true });
    ws.addEventListener("error", reject, { once: true });
  });
  const cdp = new Cdp(ws);
  await cdp.send("Page.enable");
  await cdp.send("Runtime.enable");
  await cdp.send("Emulation.setDeviceMetricsOverride", {
    width: 1440,
    height: 900,
    deviceScaleFactor: 1,
    mobile: false,
  });

  if (!target.url.includes("localhost:3000")) {
    await cdp.send("Page.navigate", { url: PAGE_URL });
  } else {
    await cdp.send("Page.reload", { ignoreCache: false });
  }

  // 等待页面水合完成
  let hydrated = false;
  for (let index = 0; index < 120; index += 1) {
    const state = await cdp
      .eval(`(() => {
        const h1 = document.querySelector("h1");
        const tabs = document.querySelectorAll('[role="tab"], button');
        return {
          title: h1 ? h1.textContent : "",
          buttonCount: tabs.length,
          graphNodes: document.querySelectorAll("svg g circle").length,
        };
      })()`)
      .catch(() => null);
    if (state && state.title.includes("人物关系图") && state.graphNodes > 0) {
      hydrated = true;
      break;
    }
    await sleep(250);
  }
  if (!hydrated) throw new Error("页面未完成水合（找不到标题或图谱节点）");

  const report = {};

  // 1) 顶部文案
  report.lead = await cdp.eval(`(() => {
    const lead = document.querySelector("main p");
    return {
      text: lead ? lead.textContent.trim() : null,
      visibleTextLength: lead ? lead.textContent.trim().length : 0,
      hasHelpButton: Boolean(document.querySelector('button[aria-label="人物关系图补充说明"]')),
    };
  })()`);

  // 1b) ? 气泡：聚焦后可见，失焦后隐藏
  report.helpBefore = await cdp.eval(`(() => {
    const tip = document.getElementById("graph-help-tip");
    if (!tip) return "missing";
    const style = getComputedStyle(tip);
    return style.visibility + "/" + style.opacity;
  })()`);
  await cdp.eval(`document.querySelector('button[aria-label="人物关系图补充说明"]').focus()`);
  await sleep(260);
  report.helpAfterFocus = await cdp.eval(`(() => {
    const tip = document.getElementById("graph-help-tip");
    const style = getComputedStyle(tip);
    return { visibility: style.visibility, opacity: style.opacity, text: tip.textContent.trim() };
  })()`);
  await cdp.eval(`document.activeElement.blur()`);

  // 2) 切到「清」分期
  report.tabSwitch = await cdp.eval(`(async () => {
    const buttons = [...document.querySelectorAll("button")];
    const qing = buttons.find((button) => button.textContent.trim() === "清");
    if (!qing) return { ok: false, tabs: buttons.map((b) => b.textContent.trim()).filter(Boolean) };
    qing.click();
    await new Promise((resolve) => setTimeout(resolve, 900));
    const meta = [...document.querySelectorAll("p")].map((p) => p.textContent.trim()).find((text) => text.includes("当前中心")) ?? "";
    const centerLabels = [...document.querySelectorAll("svg g text")].map((node) => node.textContent.trim());
    return { ok: true, meta, centerLabels };
  })()`);

  // 3) 在清图谱搜索「康熙」
  report.search = await cdp.eval(`(async () => {
    const input = document.querySelector('input[role="combobox"]');
    if (!input) return { ok: false, reason: "找不到搜索框" };
    const setValue = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
    setValue.call(input, "康熙");
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
    await new Promise((resolve) => setTimeout(resolve, 400));
    const options = [...document.querySelectorAll('#person-search-results [role="option"] button')].map((node) => node.textContent.trim());
    const empty = document.querySelector("#person-search-results .searchEmpty");
    return { ok: true, options, emptyText: empty ? empty.textContent.trim() : null, placeholder: input.placeholder };
  })()`);

  // 4) 点击搜索结果，验证中心切换为康熙帝
  report.applySearch = await cdp.eval(`(async () => {
    const first = document.querySelector('#person-search-results [role="option"] button');
    if (!first) return { ok: false };
    first.click();
    await new Promise((resolve) => setTimeout(resolve, 900));
    const meta = [...document.querySelectorAll("p")].map((p) => p.textContent.trim()).find((text) => text.includes("当前中心")) ?? "";
    const svgLabel = document.querySelector("svg")?.getAttribute("aria-label") ?? "";
    return { ok: true, meta, svgLabel };
  })()`);

  // 截图：先把帮助气泡聚焦展示，随后截顶部区域
  await cdp.eval(`document.querySelector('button[aria-label="人物关系图补充说明"]').focus()`);
  await sleep(300);
  const shot = await cdp.send("Page.captureScreenshot", { format: "png", fromSurface: true });
  fs.writeFileSync(path.join(OUT_DIR, "graph-top.png"), Buffer.from(shot.data, "base64"));

  report.consoleErrors = cdp.consoleErrors;
  fs.writeFileSync(path.join(OUT_DIR, "report.json"), JSON.stringify(report, null, 2), "utf8");
  console.log(JSON.stringify(report, null, 2));

  ws.close();
}

main().catch((error) => {
  console.error("CDP_CHECK_FAILED:", error.message);
  process.exitCode = 1;
});
