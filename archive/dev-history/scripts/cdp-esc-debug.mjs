const CDP_BASE = "http://127.0.0.1:9222";
const BASE = "http://127.0.0.1:3000";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const targets = await (await fetch(`${CDP_BASE}/json/list`)).json();
const page = targets.find((t) => t.type === "page");
const ws = new WebSocket(page.webSocketDebuggerUrl);
const pending = new Map();
let seq = 0;
const send = (method, params = {}) =>
  new Promise((resolve, reject) => {
    const id = ++seq;
    pending.set(id, { resolve, reject });
    ws.send(JSON.stringify({ id, method, params }));
  });
ws.addEventListener("message", (e) => {
  const msg = JSON.parse(e.data);
  if (msg.id && pending.has(msg.id)) {
    const { resolve, reject } = pending.get(msg.id);
    pending.delete(msg.id);
    msg.error ? reject(new Error(JSON.stringify(msg.error))) : resolve(msg.result);
  }
});
await new Promise((r) => ws.addEventListener("open", r, { once: true }));
await send("Page.enable");
await send("Runtime.enable");
const evaluate = async (expression) => {
  const result = await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.text);
  return result.result.value;
};
const waitFor = async (expr, label, timeout = 20000) => {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (await evaluate(expr)) return true;
    await sleep(200);
  }
  throw new Error(`timeout: ${label}`);
};

await send("Page.navigate", { url: `${BASE}/timeline` });
await waitFor(`document.querySelector('button[aria-haspopup="dialog"]') !== null`, "trigger");
await evaluate(`document.querySelector('button[aria-haspopup="dialog"]').click(), true`);
await waitFor(`document.querySelector('[role="dialog"]') !== null`, "dialog");
console.log("dialog open, activeElement:", await evaluate(`document.activeElement?.tagName`));

// 记录是否收到 keydown
await evaluate(`window.__escSeen = 0; window.addEventListener('keydown', () => { window.__escSeen += 1; }, true); true`);

await send("Input.dispatchKeyEvent", { type: "rawKeyDown", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27, nativeVirtualKeyCode: 27 });
await send("Input.dispatchKeyEvent", { type: "keyUp", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27, nativeVirtualKeyCode: 27 });
await sleep(500);
console.log("after rawKeyDown: dialog?", await evaluate(`document.querySelector('[role="dialog"]') !== null`), "escSeen:", await evaluate(`window.__escSeen`));

if (await evaluate(`document.querySelector('[role="dialog"]') !== null`)) {
  // 用合成事件验证 React 监听器本身是否工作
  await evaluate(`window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); true`);
  await sleep(300);
  console.log("after synthetic: dialog?", await evaluate(`document.querySelector('[role="dialog"]') !== null`));
}
ws.close();
