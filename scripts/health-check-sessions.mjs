#!/usr/bin/env node
/**
 * 史脉 V1.0.6.2 · 前端会话持久化 / 刷新恢复 / 测试数据隔离无头浏览器验收（工具脚本）。
 *
 * 与 `scripts/health-check-ui.mjs`（V1.0.5.3 布局体检）互补：本脚本只验证 V1.0.6 的
 * 前端真实历史记录接入 + V1.0.6.2 的「自动化测试不污染用户正式历史」约束，不依赖演示数据。
 *
 * 覆盖：
 *   1) 使用 `e2e_` 前缀的**测试会话**打开 `/ask?session_id=...`，后端只写独立测试库；
 *   2) 侧边栏从 `GET /api/sessions` 拉取**用户正式历史**，条目数不因测试会话变化；
 *   3) 真实提问 → 流式直答写入测试库；测试会话不写入 localStorage；
 *   4) 刷新页面：聊天记录从测试库恢复（持久化能力验证），测试会话仍不出现在用户历史；
 *   5) `/api/sessions` 运行前后数量与 id 完全一致（用户正式历史零污染）；
 *   6) 刷新 / 恢复过程无产品级 console error / 未捕获异常。
 *
 * 前置条件：
 *   - 前端已在 `--base-url`（默认 http://localhost:3000）运行，且 `/api` 代理指向新后端；
 *   - 本机有 Microsoft Edge / Chrome（或用 `--edge` 指定可执行文件）。
 *
 * 运行：
 *   node scripts/health-check-sessions.mjs
 *   node scripts/health-check-sessions.mjs --base-url http://localhost:3000 --out-dir .tmp/health-sessions
 *
 * 退出码：0 = 全部断言通过；1 = 断言失败或脚本异常。
 * 产物：`--out-dir` 下的截图与 `results.json`（默认 .tmp/health-sessions，已被 .gitignore 忽略）。
 */
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as delay } from "node:timers/promises";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
/** 验收用历史问题（事件题会触发史引时间轴，同时验证回答落测试库）。 */
const QUESTION = "赤壁之战发生在哪一年？";

function parseArgs(argv) {
  const options = {
    baseUrl: "http://localhost:3000",
    outDir: path.join(ROOT, ".tmp", "health-sessions"),
    port: 9334,
    edge: process.env.EDGE_PATH ?? "",
    sessionId: "",
    timeoutMs: 30000,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = () => argv[++index];
    if (arg === "--base-url") options.baseUrl = next().replace(/\/$/, "");
    else if (arg === "--out-dir") options.outDir = path.resolve(ROOT, next());
    else if (arg === "--port") options.port = Number(next());
    else if (arg === "--edge") options.edge = next();
    else if (arg === "--session-id") options.sessionId = next();
    else if (arg === "--help" || arg === "-h") {
      console.log("用法：node scripts/health-check-sessions.mjs [--base-url URL] [--session-id ID] [--out-dir DIR] [--port N] [--edge PATH]");
      process.exit(0);
    } else {
      throw new Error(`未知参数：${arg}`);
    }
  }
  return options;
}

function resolveEdge(explicit) {
  const candidates = [
    explicit,
    process.env.EDGE_PATH,
    "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
    "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
    "/usr/bin/microsoft-edge",
    "/usr/bin/google-chrome",
    "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
  ].filter(Boolean);
  const found = candidates.find((candidate) => existsSync(candidate));
  if (!found) {
    throw new Error("找不到 Chromium 浏览器，请用 --edge 指定 msedge / chrome 可执行文件路径。");
  }
  return found;
}

const OPTIONS = parseArgs(process.argv.slice(2));
const EDGE = resolveEdge(OPTIONS.edge);
const OUT = OPTIONS.outDir;
const PORT = OPTIONS.port;
const BASE = OPTIONS.baseUrl;
const results = [];
const consoleIssues = [];
let assertionCount = 0;

function log(name, payload) {
  console.log(`\n[${name}]`);
  console.log(JSON.stringify(payload, null, 2));
  results.push({ name, payload });
}

function assert(name, condition, detail) {
  assertionCount += 1;
  if (!condition) throw new Error(`ASSERT FAILED [${name}] ${detail ?? ""}`);
  console.log(`  ✓ ${name}`);
}

async function waitForEndpoint() {
  for (let i = 0; i < 100; i += 1) {
    try {
      const res = await fetch(`http://127.0.0.1:${PORT}/json/version`);
      if (res.ok) return;
    } catch {}
    await delay(250);
  }
  throw new Error("CDP endpoint timeout");
}

function runAndWait(exe, args) {
  return new Promise((resolve) => {
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      resolve();
    };
    const timer = setTimeout(finish, 10_000);
    try {
      const child = spawn(exe, args, { stdio: "ignore" });
      child.on("exit", () => {
        clearTimeout(timer);
        finish();
      });
      child.on("error", () => {
        clearTimeout(timer);
        finish();
      });
    } catch {
      clearTimeout(timer);
      finish();
    }
  });
}

async function killEdge(pid, profileDir) {
  if (process.platform !== "win32") {
    try {
      process.kill(pid, "SIGKILL");
    } catch {}
    return;
  }
  if (pid) await runAndWait("taskkill.exe", ["/PID", String(pid), "/T", "/F"]);
  const escapedProfile = String(profileDir).replace(/'/g, "''");
  await runAndWait("powershell.exe", [
    "-NoLogo",
    "-NoProfile",
    "-NonInteractive",
    "-Command",
    `$ErrorActionPreference='SilentlyContinue'; Get-CimInstance Win32_Process -Filter "Name='msedge.exe'" | Where-Object { $_.CommandLine -and $_.CommandLine.Contains('${escapedProfile}') } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force }`,
  ]);
}

async function main() {
  await mkdir(OUT, { recursive: true });
  let profileDir = path.join(OUT, "edge-profile");
  try {
    await rm(profileDir, { recursive: true, force: true, maxRetries: 2, retryDelay: 250 });
  } catch {
    profileDir = path.join(OUT, `edge-profile-${process.pid}-${Date.now()}`);
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
      `--user-data-dir=${profileDir}`,
      "--window-size=1600,1000",
      "about:blank",
    ],
    { stdio: "ignore" },
  );

  let ws;
  try {
    await waitForEndpoint();
    const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
    const target = list.find((item) => item.type === "page");
    if (!target) throw new Error("no page target");
    ws = new WebSocket(target.webSocketDebuggerUrl);
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
        return;
      }
      if (message.method === "Runtime.consoleAPICalled" && message.params.type === "error") {
        consoleIssues.push({
          kind: "console.error",
          text: message.params.args.map((arg) => arg.value ?? arg.description ?? "").join(" "),
        });
      }
      if (message.method === "Runtime.exceptionThrown") {
        consoleIssues.push({
          kind: "exception",
          text: message.params.exceptionDetails?.exception?.description ?? "unknown",
        });
      }
      if (message.method === "Log.entryAdded" && message.params.entry.level === "error") {
        const entry = message.params.entry;
        consoleIssues.push({ kind: "log", text: entry.text, url: entry.url ?? "" });
      }
    });
    const isDevNoise = (issue) =>
      /_next\/hmr|WebSocket connection to .*failed|Download the React DevTools/i.test(issue.text) ||
      /favicon\.ico|Failed to load resource: the server responded with a status of 404/i.test(
        `${issue.text} ${issue.url ?? ""}`,
      );
    const productIssues = () => consoleIssues.filter((issue) => !isDevNoise(issue));
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
    const shoot = async (name) => {
      await evaluate(`(() => {
        if (!document.getElementById('__dsh_hide_dev_indicator')) {
          const style = document.createElement('style');
          style.id = '__dsh_hide_dev_indicator';
          style.textContent = 'nextjs-portal { display: none !important; }';
          document.head.appendChild(style);
        }
        return true;
      })()`);
      await delay(120);
      const { data } = await send("Page.captureScreenshot", { format: "png" });
      await writeFile(path.join(OUT, `${name}.png`), Buffer.from(data, "base64"));
      console.log(`  📸 ${name}.png`);
    };
    const waitFor = async (
      expression,
      predicate = Boolean,
      { timeoutMs = OPTIONS.timeoutMs, intervalMs = 250 } = {},
    ) => {
      const deadline = Date.now() + timeoutMs;
      let last;
      while (Date.now() < deadline) {
        try {
          last = await evaluate(expression);
        } catch {
          last = undefined;
        }
        try {
          if (predicate(last)) return last;
        } catch {
          // 谓词在数据结构尚未就绪时可能抛错：继续轮询。
        }
        await delay(intervalMs);
      }
      return last;
    };
    const go = async (targetPath, settle = 2200) => {
      await send("Page.navigate", { url: `${BASE}${targetPath}` });
      await delay(settle);
      await waitFor('document.readyState === "complete"', Boolean, { timeoutMs: 20000 });
    };

    /** 回答自带史引动作时 /ask 会自动展开右侧副驾驶面板并暂时收起侧边栏；验收前先关闭它。 */
    const closeCopilotIfOpen = async () => {
      const appeared = await waitFor(
        `Boolean(document.querySelector('[aria-label="史引副驾驶"]'))`,
        Boolean,
        { timeoutMs: 3000 },
      );
      if (!appeared) return false;
      const closed = await evaluate(`(() => {
        const panel = document.querySelector('[aria-label="史引副驾驶"]');
        if (!panel) return false;
        const button = Array.from(panel.querySelectorAll('button')).find((item) => (item.innerText || '').includes('返回聊天'));
        if (!button) return false;
        button.click();
        return true;
      })()`);
      if (closed) await delay(900);
      return closed;
    };
    await send("Page.enable");
    await send("Runtime.enable");
    await send("Log.enable");
    await send("Emulation.setDeviceMetricsOverride", {
      width: 1600,
      height: 1000,
      deviceScaleFactor: 1,
      mobile: false,
    });

    // ---- 0. 基线：用户正式历史（E2E 全程使用 e2e_ 测试会话，绝不写入这里） ----
    const readSessions = async () => {
      const response = await fetch(`${BASE}/api/sessions`);
      assert(`前端 /api 代理可用（HTTP ${response.status}）`, response.ok);
      const payload = await response.json();
      assert("代理返回 V1.0.6 会话结构", payload.ok === true && Array.isArray(payload.sessions));
      return payload.sessions;
    };
    const sessionsBefore = await readSessions();
    const idsBefore = sessionsBefore.map((item) => item.session_id).sort();
    log("用户正式历史基线", { count: sessionsBefore.length, ids: idsBefore });
    /** 可丢弃测试会话：后端只写独立测试库，不进入用户正式历史 / localStorage。 */
    const testSessionId = `e2e_sessions_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
    log("E2E 测试会话", { testSessionId, question: QUESTION });

    // ---- 1. 用测试会话打开 /ask：侧边栏不得出现测试会话 ----
    await send("Page.navigate", {
      url: `${BASE}/ask?session_id=${encodeURIComponent(testSessionId)}`,
    });
    await delay(2400);
    const hydrated = await waitFor(
      `(() => { const el = document.querySelector('#ask-composer'); return el ? Object.keys(el).some((key) => key.startsWith('__reactFiber$')) : false; })()`,
      Boolean,
      { timeoutMs: 30000 },
    );
    assert("composer 完成 React hydration", Boolean(hydrated));
    const sidebarCountBefore = await evaluate(
      `document.querySelectorAll('[data-conversation-id]').length`,
    );
    assert(
      "侧边栏条目数与用户正式历史一致（不含测试会话）",
      sidebarCountBefore === sessionsBefore.length,
      `${sidebarCountBefore} vs ${sessionsBefore.length}`,
    );
    const storedBefore = await evaluate(`localStorage.getItem('histolink.agent.session.v1')`);
    assert(
      "测试会话不写入 localStorage",
      !String(storedBefore || "").startsWith("e2e_"),
      String(storedBefore),
    );
    await shoot("01-ask-test-session");

    // ---- 2. 真实提问：流式直答 + 服务端写入测试库 ----
    const typed = await evaluate(`(() => {
      const el = document.querySelector('#ask-composer');
      if (!el) return null;
      const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set;
      setter.call(el, ${JSON.stringify(QUESTION)});
      el.dispatchEvent(new Event('input', { bubbles: true }));
      return el.value;
    })()`);
    assert("输入框写入问题", typed === QUESTION, String(typed));
    await delay(300);
    const submitted = await evaluate(`(() => {
      const button = document.querySelector('button[aria-label="发送问题"]');
      if (!button || button.disabled) return false;
      button.click();
      return true;
    })()`);
    assert("点击发送", submitted === true);
    const answered = await waitFor(
      `(() => {
        const root = document.querySelector('[data-transcript-scroll]');
        if (!root) return null;
        const text = root.innerText || "";
        return {
          text,
          busy: root.getAttribute('aria-busy'),
          streaming: document.querySelectorAll('[data-streaming="true"]').length,
          connecting: text.includes("正在连接本地模型"),
        };
      })()`,
      (state) =>
        state &&
        state.busy === "false" &&
        state.streaming === 0 &&
        state.text.includes(QUESTION) &&
        state.text.length > QUESTION.length + 80,
      { timeoutMs: 120000 },
    );
    assert("真实流式回答完成", Boolean(answered), JSON.stringify({ chars: answered?.text?.length }));
    assert("不再出现「正在连接本地模型」对话框", answered?.connecting === false);
    await closeCopilotIfOpen();
    await shoot("02-test-session-answered");

    // ---- 3. API：测试会话在独立测试库可读，但不出现在用户历史列表 ----
    const detailResponse = await fetch(
      `${BASE}/api/sessions/${encodeURIComponent(testSessionId)}`,
    );
    assert("测试会话在后端测试库中可恢复", detailResponse.ok, `HTTP ${detailResponse.status}`);
    const detailPayload = await detailResponse.json();
    assert(
      "测试会话包含完整问答轮次",
      Array.isArray(detailPayload.session?.turns) && detailPayload.session.turns.length >= 2,
      `turns=${detailPayload.session?.turns?.length ?? 0}`,
    );
    const listedPayload = await (await fetch(`${BASE}/api/sessions`)).json();
    assert(
      "测试会话不出现在用户正式历史列表",
      !listedPayload.sessions.some((item) => item.session_id === testSessionId),
    );

    // ---- 4. 刷新同一测试会话：聊天记录从测试库恢复 ----
    await send("Page.reload", { ignoreCache: true });
    await delay(2400);
    const restoredText = await waitFor(
      `(() => { const root = document.querySelector('[data-transcript-scroll]'); return root ? root.innerText : ''; })()`,
      (text) =>
        typeof text === "string" && text.includes(QUESTION) && text.length > QUESTION.length + 80,
      { timeoutMs: 30000 },
    );
    assert("刷新后测试会话聊天记录从测试库恢复", Boolean(restoredText));
    const storedAfterReload = await evaluate(
      `localStorage.getItem('histolink.agent.session.v1')`,
    );
    assert(
      "刷新后 localStorage 仍不包含测试会话 id",
      !String(storedAfterReload || "").startsWith("e2e_"),
      String(storedAfterReload),
    );
    await closeCopilotIfOpen();
    await shoot("03-after-reload-restored");

    // ---- 5. 基线不变：用户正式历史未被污染 ----
    const sessionsAfter = await readSessions();
    const idsAfter = sessionsAfter.map((item) => item.session_id).sort();
    assert(
      "用户正式历史数量不变",
      sessionsAfter.length === sessionsBefore.length,
      `${sessionsBefore.length} → ${sessionsAfter.length}`,
    );
    assert(
      "用户正式历史 id 完全不变",
      JSON.stringify(idsBefore) === JSON.stringify(idsAfter),
      `${JSON.stringify(idsAfter)}`,
    );
    assert(
      "用户正式历史无测试前缀会话",
      !sessionsAfter.some((item) => /^(test_|e2e_|pytest_|smoke_|probe-)/.test(String(item.session_id))),
    );

    // ---- 6. 无产品级前端异常 ----
    const issues = productIssues();
    assert("无产品级 console error / 未捕获异常", issues.length === 0, JSON.stringify(issues));

    const summary = {
      baseUrl: BASE,
      testSessionId,
      question: QUESTION,
      userSessionCountBefore: sessionsBefore.length,
      userSessionCountAfter: sessionsAfter.length,
      assertions: assertionCount,
      screenshots: [
        "01-ask-test-session.png",
        "02-test-session-answered.png",
        "03-after-reload-restored.png",
      ],
      consoleIssues,
    };
    log("汇总", summary);
    await writeFile(path.join(OUT, "results.json"), JSON.stringify({ ok: true, ...summary, results }, null, 2));
    console.log(`\n✅ V1.0.6.2 会话持久化 + 测试数据隔离验收通过：${assertionCount} 项断言全部通过`);
  } finally {
    try {
      if (ws) ws.close();
    } catch {}
    await killEdge(edge.pid, profileDir);
  }
}

const forceExit = setTimeout(() => {
  console.error("超时（6 分钟），强制退出");
  process.exit(1);
}, 6 * 60 * 1000);
forceExit.unref?.();

main()
  .then(() => process.exit(0))
  .catch(async (error) => {
    console.error("\n❌ 验收失败：", error.message);
    try {
      await writeFile(
        path.join(OUT, "results.json"),
        JSON.stringify({ ok: false, error: error.message, results, consoleIssues }, null, 2),
      );
    } catch {}
    process.exit(1);
  });