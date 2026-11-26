#!/usr/bin/env node
/**
 * Targeted end-to-end check for the V1.0.6.2 streaming answer in the real /ask UI.
 *
 * - Launches headless Edge via CDP (no extra npm deps; Node 24 global WebSocket);
 * - Opens http://localhost:3000/ask?session_id=e2e_...（测试会话只写后端测试库）;
 * - Asks a history question through the real composer with “深度思考”默认关闭（快速直答）；
 * - Records transcript length growth while the model streams, waits for completion;
 * - Verifies: “深度思考” switch exists, is renamed and defaults OFF; answer rendered;
 *   streaming cursor appeared; no literal think-tag markers / “正在连接本地模型” dialog leaked;
 *   user history (/api/sessions) unchanged after the run.
 * - Saves screenshots to .tmp/ui-stream-check/.
 *
 * Run: node scripts/health-check-stream-ui.mjs [--base-url http://localhost:3000]
 */
import { spawn } from "node:child_process";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as delay } from "node:timers/promises";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const EDGE_CANDIDATES = [
  process.env.EDGE_PATH,
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
  "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
];
const OPTIONS = { baseUrl: "http://localhost:3000", port: 9461, outDir: path.join(ROOT, ".tmp", "ui-stream-check") };
const argv = process.argv.slice(2);
for (let i = 0; i < argv.length; i += 1) {
  if (argv[i] === "--base-url") OPTIONS.baseUrl = argv[++i].replace(/\/$/, "");
  else if (argv[i] === "--port") OPTIONS.port = Number(argv[++i]);
}
const EDGE = EDGE_CANDIDATES.find((candidate) => candidate && existsSync(candidate));
const QUESTION = "赤壁之战发生在哪一年？";
/** 本次验收的测试会话 id：后端只写独立测试库，不污染用户正式历史。 */
const TEST_SESSION_ID = `e2e_stream_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
const TAG_MARKERS = ["<" + "think", "think" + ">", "<" + "thinking", "thinking" + ">"];

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
        if (message.error) reject(new Error(message.error.message));
        else resolve(message.result);
      }
    });
  }

  send(method, params = {}) {
    const id = this.nextId++;
    this.ws.send(JSON.stringify({ id, method, params }));
    return new Promise((resolve, reject) => this.pending.set(id, { resolve, reject }));
  }
}

async function connectCdp(port) {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/json/list`);
      const targets = await response.json();
      const page = targets.find((target) => target.type === "page" && target.webSocketDebuggerUrl);
      if (page?.webSocketDebuggerUrl) return page.webSocketDebuggerUrl;
    } catch {
      // Browser still starting.
    }
    await delay(250);
  }
  throw new Error("CDP page target not ready");
}

async function main() {
  if (!EDGE) throw new Error("Microsoft Edge not found (set EDGE_PATH)");
  await mkdir(OPTIONS.outDir, { recursive: true });
  const userDataDir = path.join(OPTIONS.outDir, "edge-profile");
  await rm(userDataDir, { recursive: true, force: true });

  const browser = spawn(
    EDGE,
    [
      "--headless=new",
      "--disable-gpu",
      "--no-first-run",
      "--no-default-browser-check",
      "--disable-features=msEdgeSidebarV2",
      `--remote-debugging-port=${OPTIONS.port}`,
      `--user-data-dir=${userDataDir}`,
      "--window-size=1600,1000",
      "about:blank",
    ],
    { stdio: "ignore" },
  );

  const summary = { ok: false, question: QUESTION, sessionId: TEST_SESSION_ID, checks: {}, samples: [], fields: {} };
  let cdp = null;
  try {
    const wsUrl = await connectCdp(OPTIONS.port);
    const ws = new WebSocket(wsUrl);
    await new Promise((resolve, reject) => {
      ws.addEventListener("open", resolve, { once: true });
      ws.addEventListener("error", reject, { once: true });
    });
    cdp = new Cdp(ws);
    await cdp.send("Page.enable");
    await cdp.send("Runtime.enable");

    // 痛点 1：运行前后用户正式历史必须完全一致（测试会话只进后端测试库）。
    const readUserSessions = async () => {
      const response = await fetch(`${OPTIONS.baseUrl}/api/sessions`);
      const payload = await response.json();
      return Array.isArray(payload?.sessions) ? payload.sessions : [];
    };
    const sessionsBefore = await readUserSessions();
    summary.fields.userSessionCountBefore = sessionsBefore.length;

    await cdp.send("Page.navigate", {
      url: `${OPTIONS.baseUrl}/ask?q=${encodeURIComponent(QUESTION)}&session_id=${encodeURIComponent(TEST_SESSION_ID)}`,
    });

    const evaluate = async (expression) => {
      const result = await cdp.send("Runtime.evaluate", {
        expression,
        returnByValue: true,
        awaitPromise: true,
      });
      if (result.exceptionDetails) {
        throw new Error(result.exceptionDetails.text ?? "evaluate failed");
      }
      return result.result.value;
    };

    // 等待 composer 挂载（Next dev 首次编译可能较慢）。
    let composerReady = false;
    for (let attempt = 0; attempt < 120; attempt += 1) {
      composerReady = Boolean(await evaluate(`Boolean(document.querySelector('#ask-composer'))`));
      if (composerReady) break;
      await delay(250);
    }
    summary.checks.composerReady = composerReady;
    if (!composerReady) throw new Error("composer did not mount");

    // V1.0.6.2「深度思考」开关（替换「逐字回答」）：默认关闭 = 快速直答。
    summary.fields.thinkingToggle = await evaluate(`(() => {
      const el = document.querySelector('[role="switch"][aria-label="切换深度思考模式"]');
      return el ? { exists: true, checked: el.getAttribute('aria-checked'), text: el.textContent.trim() } : { exists: false };
    })()`);
    summary.checks.thinkingToggleExists = summary.fields.thinkingToggle?.exists === true;
    summary.checks.thinkingToggleRenamed = summary.fields.thinkingToggle?.text?.includes("深度思考") === true;
    summary.checks.thinkingToggleDefaultOff = summary.fields.thinkingToggle?.checked === "false";

    // 模型切换窗口：等待注册表异步加载完成（首帧是静态兜底 Qwen 表），再断言展示名。
    let modelReady = false;
    for (let attempt = 0; attempt < 80; attempt += 1) {
      const state = await evaluate(`(() => {
        const el = document.querySelector('button[aria-haspopup="listbox"]');
        return el ? { text: el.textContent.trim(), disabled: el.disabled } : null;
      })()`);
      if (state && !state.disabled && !state.text.includes("Qwen/")) {
        modelReady = true;
        break;
      }
      await delay(250);
    }
    summary.checks.modelReady = modelReady;
    summary.fields.modelTrigger = await evaluate(`(() => {
      const el = document.querySelector('button[aria-haspopup="listbox"]');
      return el ? { text: el.textContent.trim(), label: el.getAttribute('aria-label') } : null;
    })()`);
    summary.checks.modelNameShort = Boolean(
      summary.fields.modelTrigger?.text.includes("XiaoHong-v1") &&
        !summary.fields.modelTrigger?.text.includes("GGUF"),
    );
    await evaluate(`(() => {
      const el = document.querySelector('button[aria-haspopup="listbox"]');
      if (el && !el.disabled) el.click();
      return true;
    })()`);
    await delay(450);
    summary.fields.modelMenu = await evaluate(`(() => {
      const menu = document.querySelector('[role="listbox"]');
      if (!menu) return null;
      const option = menu.querySelector('[role="option"]');
      return {
        heading: menu.querySelector('li')?.textContent?.trim() ?? "",
        options: [...menu.querySelectorAll('[role="option"]')].map((item) => item.textContent.trim()),
        firstOption: option?.textContent?.trim() ?? "",
      };
    })()`);
    summary.checks.modelMenuCompact = Boolean(
      summary.fields.modelMenu &&
        !summary.fields.modelMenu.firstOption.includes("默认用于回答所有历史问题") &&
        !summary.fields.modelMenu.heading.includes("所选模型异常时") &&
        !summary.fields.modelMenu.options.join(" ").includes("所选模型异常时"),
    );
    if (summary.fields.modelMenu) {
      const menuShot = await cdp.send("Page.captureScreenshot", { format: "png" });
      await writeFile(path.join(OPTIONS.outDir, "model-switcher-menu.png"), Buffer.from(menuShot.data, "base64"));
      summary.fields.modelMenuScreenshot = path.relative(ROOT, path.join(OPTIONS.outDir, "model-switcher-menu.png"));
    }
    await evaluate(`(() => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
      return true;
    })()`);
    await delay(300);

    // 通过 ?q= 预填问题（页面初始 draft 即问题文本），直接点击发送。
    summary.fields.focused = await evaluate(`(() => {
      const el = document.querySelector('#ask-composer');
      el.focus();
      return document.activeElement === el;
    })()`);
    summary.fields.typed = await evaluate(`document.querySelector('#ask-composer').value`);
    await delay(300);
    summary.fields.sendDisabledBeforeClick = await evaluate(`document.querySelector('button[aria-label="发送问题"]').disabled`);
    summary.checks.typedQuestion = summary.fields.typed === QUESTION;
    summary.checks.sendEnabled = summary.fields.sendDisabledBeforeClick === false;
    summary.fields.submitted = await evaluate(`(() => {
      const button = document.querySelector('button[aria-label="发送问题"]');
      if (!button || button.disabled) return false;
      button.click();
      return true;
    })()`);

    const readTranscript = () =>
      evaluate(`(() => {
        const root = document.querySelector('[data-transcript-scroll]');
        const text = root ? root.innerText : "";
        return {
          text,
          busy: root ? root.getAttribute('aria-busy') : null,
          streamingTurns: document.querySelectorAll('[data-streaming="true"]').length,
          carets: document.querySelectorAll('[class*="streamCaret"]').length,
          connectingDialog: text.includes("正在连接本地模型"),
        };
      })()`);

    // Phase A：等用户问题出现在 transcript 里（说明 ask() 已被触发）。
    let questionTurnSeen = false;
    for (let attempt = 0; attempt < 40; attempt += 1) {
      const state = await readTranscript();
      if (state.text.includes(QUESTION)) {
        questionTurnSeen = true;
        break;
      }
      await delay(250);
    }
    summary.checks.questionTurnSeen = questionTurnSeen;

    let lastLength = 0;
    let sawStreamingTurn = false;
    let sawCaret = false;
    let sawConnectingDialog = false;
    let midScreenshotTaken = false;
    let finished = false;
    for (let attempt = 0; attempt < 400; attempt += 1) {
      const state = await readTranscript();
      if (state.streamingTurns > 0) sawStreamingTurn = true;
      if (state.carets > 0) sawCaret = true;
      if (state.connectingDialog) sawConnectingDialog = true;
      if (state.text.length > lastLength) {
        summary.samples.push({ atMs: attempt * 350, chars: state.text.length });
        lastLength = state.text.length;
        if (!midScreenshotTaken && state.streamingTurns > 0 && state.text.length > 120) {
          midScreenshotTaken = true;
          const shot = await cdp.send("Page.captureScreenshot", { format: "png" });
          await writeFile(path.join(OPTIONS.outDir, "streaming-midway.png"), Buffer.from(shot.data, "base64"));
        }
      }
      // 完成条件：问题已出现、回答正文已增长、busy 结束且没有流式轮次。
      if (
        questionTurnSeen &&
        state.busy === "false" &&
        state.streamingTurns === 0 &&
        state.text.length > QUESTION.length + 80
      ) {
        await delay(600);
        const settled = await readTranscript();
        if (settled.busy === "false" && settled.streamingTurns === 0) {
          finished = true;
          summary.fields.final = settled;
          break;
        }
      }
      await delay(350);
    }

    const finalText = summary.fields.final?.text ?? "";
    summary.checks.finished = finished;
    summary.checks.answerRendered = finalText.includes("赤壁") && finalText.length > 80;
    summary.checks.sawStreamingTurn = sawStreamingTurn;
    summary.checks.sawCaret = sawCaret;
    summary.checks.streamedProgressively = summary.samples.length >= 3;
    summary.checks.noThinkTagLeak = !TAG_MARKERS.some((marker) => finalText.toLowerCase().includes(marker));
    // 痛点 2.3：「正在连接本地模型」对话框已删除。
    summary.checks.noConnectingDialog = sawConnectingDialog === false;
    // 痛点 1：用户正式历史不得被 E2E 测试会话污染。
    const sessionsAfter = await readUserSessions();
    const idsBefore = sessionsBefore.map((item) => item.session_id).sort();
    const idsAfter = sessionsAfter.map((item) => item.session_id).sort();
    summary.fields.userSessionCountAfter = sessionsAfter.length;
    summary.checks.userHistoryUnchanged =
      sessionsAfter.length === sessionsBefore.length &&
      JSON.stringify(idsBefore) === JSON.stringify(idsAfter) &&
      !idsAfter.some((id) => /^(test_|e2e_|pytest_|smoke_)/.test(String(id)));
    summary.fields.answerHead = finalText
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean)
      .slice(-6)
      .join(" / ")
      .slice(0, 400);

    const shot = await cdp.send("Page.captureScreenshot", { format: "png" });
    const shotPath = path.join(OPTIONS.outDir, "stream-answer-final.png");
    await writeFile(shotPath, Buffer.from(shot.data, "base64"));
    summary.fields.screenshot = path.relative(ROOT, shotPath);

    summary.ok = Object.values(summary.checks).every(Boolean);
  } catch (error) {
    summary.error = String(error?.stack ?? error);
  } finally {
    if (cdp) {
      try {
        await cdp.send("Browser.close");
      } catch {
        // ignore
      }
    }
    browser.kill("SIGKILL");
    await delay(400);
    await rm(userDataDir, { recursive: true, force: true }).catch(() => {});
  }

  await writeFile(
    path.join(OPTIONS.outDir, "result.json"),
    `${JSON.stringify(summary, null, 2)}\n`,
    "utf8",
  );
  console.log(JSON.stringify(summary, null, 2));
  if (!summary.ok) process.exitCode = 1;
}

await main();
if (!existsSync(path.join(OPTIONS.outDir, "result.json"))) process.exitCode = 1;