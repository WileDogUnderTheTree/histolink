import { writeFile } from "node:fs/promises";

const DEBUG = "http://127.0.0.1:9222";
const BASE = "http://127.0.0.1:3000";

class CDP {
  constructor(ws) {
    this.ws = ws;
    this.id = 0;
    this.pending = new Map();
    ws.onmessage = (event) => {
      const message = JSON.parse(event.data);
      if (!message.id) return;
      const pending = this.pending.get(message.id);
      if (!pending) return;
      this.pending.delete(message.id);
      if (message.error) pending.reject(new Error(JSON.stringify(message.error)));
      else pending.resolve(message.result);
    };
  }
  static async connect(url) {
    const ws = new WebSocket(url);
    await new Promise((resolve, reject) => {
      ws.onopen = resolve;
      ws.onerror = reject;
    });
    return new CDP(ws);
  }
  send(method, params = {}) {
    return new Promise((resolve, reject) => {
      const id = ++this.id;
      this.pending.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }
  async evaluate(expression) {
    const result = await this.send("Runtime.evaluate", {
      expression,
      awaitPromise: true,
      returnByValue: true,
    });
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description ?? result.exceptionDetails.text);
    return result.result.value;
  }
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const targets = await (await fetch(`${DEBUG}/json/list`)).json();
const page = targets.find((target) => target.type === "page");
const cdp = await CDP.connect(page.webSocketDebuggerUrl);
await cdp.send("Page.enable");
await cdp.send("Runtime.enable");
await cdp.send("Emulation.setDeviceMetricsOverride", { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
await cdp.send("Page.navigate", { url: `${BASE}/ask` });
await sleep(2500);

const info = await cdp.evaluate(`(() => {
  const describe = (el) => {
    const style = getComputedStyle(el);
    const rect = el.getBoundingClientRect();
    return {
      tag: el.tagName,
      id: el.id || null,
      className: typeof el.className === 'string' ? el.className.slice(0, 80) : null,
      overflowX: style.overflowX,
      overflowY: style.overflowY,
      scrollHeight: el.scrollHeight,
      clientHeight: el.clientHeight,
      rectTop: Math.round(rect.top),
      rectHeight: Math.round(rect.height),
    };
  };
  const all = [...document.querySelectorAll('*')];
  return {
    html: describe(document.documentElement),
    body: describe(document.body),
    scrollers: all
      .map((el) => ({ el, style: getComputedStyle(el) }))
      .filter(({ style }) => ['auto', 'scroll'].includes(style.overflowY) || ['auto', 'scroll'].includes(style.overflowX))
      .map(({ el }) => describe(el)),
    overflowing: all
      .filter((el) => el.scrollHeight > el.clientHeight + 2)
      .map((el) => describe(el))
      .slice(0, 12),
    transcript: [...document.querySelectorAll('section[aria-labelledby="conversation-title"] ol > li')].map((li) => ({ cls: li.className.slice(0, 60), scrollHeight: li.scrollHeight, clientHeight: li.clientHeight })),
    copilot: Boolean(document.querySelector('aside[aria-label="史引副驾驶"]')),
    url: location.href,
    scrollY: Math.round(scrollY),
  };
})()`);
console.log(JSON.stringify(info, null, 2));
await writeFile("C:/Users/wiledog/Desktop/histolink/.tmp/diag-result.json", JSON.stringify(info, null, 2));
process.exit(0);
