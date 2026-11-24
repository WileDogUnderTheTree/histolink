/** V1.0.1 受控选中手工验收（连接已启动的 Edge headless 9224，临时脚本）。 */
import fs from "node:fs";
import path from "node:path";

const DEBUG_PORT = 9224;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

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
  console.log("step: fetch targets");
  const list = await (await fetch(`http://127.0.0.1:${DEBUG_PORT}/json/list`, {
    signal: AbortSignal.timeout(5000),
  })).json();
  const target = list.find((item) => item.type === "page");
  if (!target) throw new Error("no page target");
  console.log("step: connect ws");
  const cdp = new CDP(target.webSocketDebuggerUrl);
  await cdp.ready();
  console.log("step: enable domains");
  await cdp.send("Page.enable");
  await cdp.send("Runtime.enable");
  await cdp.send("Emulation.setDeviceMetricsOverride", {
    width: 1440,
    height: 1000,
    deviceScaleFactor: 1,
    mobile: false,
  });

  const url =
    "http://127.0.0.1:3100/graph?person=" +
    encodeURIComponent("曹操") +
    "&era=sanguo&selected=" +
    encodeURIComponent("刘备");
  console.log("step: navigate", url);
  await cdp.send("Page.navigate", { url });
  await sleep(3800);
  console.log("step: evaluate");
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
        panelExcerpt: panel.split('\\n').slice(0, 14),
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

  const value = result.result.value;
  fs.writeFileSync(path.resolve(".tmp/cdp-controlled-report.json"), JSON.stringify(value, null, 2), "utf8");
  console.log(JSON.stringify(value, null, 2));
  cdp.ws.close();
}

main().catch((error) => {
  console.error("FAILED:", error);
  process.exit(1);
});
