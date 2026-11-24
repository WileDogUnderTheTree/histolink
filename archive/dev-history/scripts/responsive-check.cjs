/* 响应式复核：桌面与 390px 窄屏下 ? 气泡不溢出视口。 */
const fs = require("node:fs");
const path = require("node:path");
const OUT_DIR = __dirname;
const CDP_HTTP = "http://127.0.0.1:9222";
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

class Cdp {
  constructor(ws) {
    this.ws = ws;
    this.nextId = 1;
    this.pending = new Map();
    ws.addEventListener("message", (event) => {
      const message = JSON.parse(event.data);
      if (message.id && this.pending.has(message.id)) {
        const { resolve, reject } = this.pending.get(message.id);
        this.pending.delete(message.id);
        if (message.error) reject(new Error(JSON.stringify(message.error)));
        else resolve(message.result);
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
    if (result.exceptionDetails) throw new Error(JSON.stringify(result.exceptionDetails));
    return result.result.value;
  }
}

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

  const inspect = async (width, height, name) => {
    await cdp.send("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: 1, mobile: width < 720 });
    await cdp.send("Page.navigate", { url: "http://localhost:3000/graph" });
    for (let index = 0; index < 120; index += 1) {
      const ready = await cdp.eval(`Boolean(document.querySelector('button[aria-label="人物关系图补充说明"]'))`).catch(() => false);
      if (ready) break;
      await sleep(250);
    }
    await cdp.eval(`document.querySelector('button[aria-label="人物关系图补充说明"]').focus()`);
    await sleep(300);
    const result = await cdp.eval(`(() => {
      const tip = document.getElementById("graph-help-tip");
      const lead = document.querySelector("h1").nextElementSibling;
      const rect = tip.getBoundingClientRect();
      const leadRect = lead.getBoundingClientRect();
      return {
        viewport: [window.innerWidth, window.innerHeight],
        tipVisible: getComputedStyle(tip).visibility,
        tipRect: { top: Math.round(rect.top), left: Math.round(rect.left), right: Math.round(rect.right), width: Math.round(rect.width) },
        tipOverflowLeft: rect.left < 0,
        tipOverflowRight: rect.right > window.innerWidth,
        subtitleLines: Math.round(leadRect.height / parseFloat(getComputedStyle(lead).lineHeight)),
        tipBelowSubtitle: rect.top >= leadRect.bottom - 1,
      };
    })()`);
    const shot = await cdp.send("Page.captureScreenshot", { format: "png", fromSurface: true });
    fs.writeFileSync(path.join(OUT_DIR, `responsive-${name}.png`), Buffer.from(shot.data, "base64"));
    return result;
  };

  const report = {
    desktop: await inspect(1440, 900, "desktop"),
    mobile: await inspect(390, 844, "mobile"),
  };
  console.log(JSON.stringify(report, null, 2));
  ws.close();
}

main().catch((error) => {
  console.error("RESPONSIVE_CHECK_FAILED:", error.message);
  process.exitCode = 1;
});
