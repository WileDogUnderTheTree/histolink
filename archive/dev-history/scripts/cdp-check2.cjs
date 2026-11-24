/* eslint-disable no-console */
// 第二轮 CDP 实测：默认态截图、元/明/清默认中心、简阅分组、搜索下拉截图。
const fs = require("node:fs");
const path = require("node:path");

const CDP_HTTP = "http://127.0.0.1:9222";
const PAGE_URL = "http://localhost:3000/graph";
const OUT_DIR = __dirname;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

class Cdp {
  constructor(ws) {
    this.ws = ws;
    this.nextId = 1;
    this.pending = new Map();
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
      if (message.method === "Runtime.exceptionThrown") {
        this.consoleErrors.push(`exception: ${JSON.stringify(message.params.exceptionDetails?.exception?.description ?? message.params)}`);
      }
      if (message.method === "Runtime.consoleAPICalled" && message.params.type === "error") {
        this.consoleErrors.push(`console.error: ${message.params.args.map((arg) => arg.value ?? arg.description ?? "").join(" ")}`);
      }
    });
  }
  send(method, params = {}) {
    const id = this.nextId++;
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
    const result = await this.send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
    if (result.exceptionDetails) throw new Error(`页面执行异常：${JSON.stringify(result.exceptionDetails)}`);
    return result.result.value;
  }
}

const clickTab = (label) => `(async () => {
  const button = [...document.querySelectorAll("button")].find((node) => node.textContent.trim() === ${JSON.stringify(label)});
  if (!button) return { ok: false };
  button.click();
  await new Promise((resolve) => setTimeout(resolve, 900));
  const meta = [...document.querySelectorAll("p")].map((p) => p.textContent.trim()).find((text) => text.includes("当前中心")) ?? "";
  const center = [...document.querySelectorAll("svg g text")].map((node) => node.textContent.trim());
  return { ok: true, meta, center };
})()`;

async function main() {
  const list = await fetch(`${CDP_HTTP}/json/list`).then((response) => response.json());
  const target = list.find((item) => item.type === "page");
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    ws.addEventListener("open", resolve, { once: true });
    ws.addEventListener("error", reject, { once: true });
  });
  const cdp = new Cdp(ws);
  await cdp.send("Page.enable");
  await cdp.send("Runtime.enable");
  await cdp.send("Emulation.setDeviceMetricsOverride", { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
  await cdp.send("Page.navigate", { url: PAGE_URL });

  for (let index = 0; index < 120; index += 1) {
    const ready = await cdp
      .eval(`Boolean(document.querySelector("svg g circle") && document.querySelector('input[role="combobox"]'))`)
      .catch(() => false);
    if (ready) break;
    await sleep(250);
  }

  const report = {};

  // 顶部副标题：精确取标题后第一个 p
  report.subtitle = await cdp.eval(`(() => {
    const title = document.querySelector("h1");
    const paragraph = title ? title.nextElementSibling : null;
    const rect = paragraph ? paragraph.getBoundingClientRect() : null;
    const style = paragraph ? getComputedStyle(paragraph) : null;
    return {
      text: paragraph ? paragraph.textContent.trim() : null,
      heightPx: rect ? Math.round(rect.height) : null,
      lineHeightPx: style ? style.lineHeight : null,
      hasDynastyList: paragraph ? /春秋 \\/ 战国|共 \\d+ 期|15 期/.test(paragraph.textContent) : null,
      helpDefaultHidden: (() => {
        const tip = document.getElementById("graph-help-tip");
        const tipStyle = tip ? getComputedStyle(tip) : null;
        return tipStyle ? tipStyle.visibility : "missing";
      })(),
      tipOverflows: (() => {
        const tip = document.getElementById("graph-help-tip");
        if (!tip) return "missing";
        const rect = tip.getBoundingClientRect();
        return rect.right > window.innerWidth || rect.left < 0;
      })(),
    };
  })()`);

  // 切到「元」与「明」，确认默认中心
  report.yuan = await cdp.eval(clickTab("元"));
  report.ming = await cdp.eval(clickTab("明"));
  report.qing = await cdp.eval(clickTab("清"));

  // 搜索「康熙」并截图下拉
  await cdp.eval(`(async () => {
    const input = document.querySelector('input[role="combobox"]');
    const setValue = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
    setValue.call(input, "康熙");
    input.dispatchEvent(new Event("input", { bubbles: true }));
    await new Promise((resolve) => setTimeout(resolve, 400));
  })()`);
  report.searchState = await cdp.eval(`(() => {
    const options = [...document.querySelectorAll('#person-search-results [role="option"] button')].map((node) => node.textContent.trim());
    const list = document.getElementById("person-search-results");
    const rect = list ? list.getBoundingClientRect() : null;
    return { options, dropdownVisible: Boolean(list), dropdownRect: rect ? { top: Math.round(rect.top), left: Math.round(rect.left), width: Math.round(rect.width) } : null };
  })()`);
  const shotSearch = await cdp.send("Page.captureScreenshot", { format: "png", fromSurface: true });
  fs.writeFileSync(path.join(OUT_DIR, "graph-search.png"), Buffer.from(shotSearch.data, "base64"));

  // 关闭搜索，回默认态截图
  await cdp.eval(`(() => {
    const input = document.querySelector('input[role="combobox"]');
    const setValue = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
    setValue.call(input, "");
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.blur();
    document.body.click();
  })()`);
  await sleep(400);
  const shotDefault = await cdp.send("Page.captureScreenshot", { format: "png", fromSurface: true });
  fs.writeFileSync(path.join(OUT_DIR, "graph-default.png"), Buffer.from(shotDefault.data, "base64"));

  // 简阅模式：7 个分组 + 元明清默认中心
  report.brief = await cdp.eval(`(async () => {
    const button = [...document.querySelectorAll("button")].find((node) => node.textContent.trim() === "简阅");
    if (!button) return { ok: false };
    button.click();
    await new Promise((resolve) => setTimeout(resolve, 900));
    const tabLabels = [...document.querySelectorAll('[role="tab"]')].map((node) => node.textContent.trim());
    const ymg = [...document.querySelectorAll("button")].find((node) => node.textContent.trim() === "元明清");
    if (!ymg) return { ok: false, tabLabels };
    ymg.click();
    await new Promise((resolve) => setTimeout(resolve, 900));
    const meta = [...document.querySelectorAll("p")].map((p) => p.textContent.trim()).find((text) => text.includes("当前中心")) ?? "";
    return { ok: true, tabLabels, meta };
  })()`);

  report.consoleErrors = cdp.consoleErrors;
  fs.writeFileSync(path.join(OUT_DIR, "report2.json"), JSON.stringify(report, null, 2), "utf8");
  console.log(JSON.stringify(report, null, 2));
  ws.close();
}

main().catch((error) => {
  console.error("CDP_CHECK2_FAILED:", error.message);
  process.exitCode = 1;
});
