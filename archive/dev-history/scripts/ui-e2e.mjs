/**
 * HistoLink V1.0.5.1 前端验收脚本（Edge headless + CDP）。
 *
 * 前置：
 *   1. 后端 8000（uvicorn main:app，已配置 LLM、已构建 RAG 向量库）
 *   2. 前端 3000（next start）
 *   3. Edge 以 --remote-debugging-port=9222 启动
 *
 * 运行：node .tmp/ui-e2e.mjs
 * 截图输出：docs/images/v1.0.5.1-*.png
 */

import { writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";

const BASE = "http://127.0.0.1:3000";
const DEBUG = "http://127.0.0.1:9222";
const ROOT = "C:/Users/wiledog/Desktop/histolink";
const IMAGE_DIR = join(ROOT, "docs/images");

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const report = { steps: [], consoleErrors: [] };

function check(name, condition, detail) {
  const ok = Boolean(condition);
  report.steps.push({ name, ok, detail: detail ?? null });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? "  -> " + JSON.stringify(detail) : ""}`);
  return ok;
}

class CDP {
  constructor(ws) {
    this.ws = ws;
    this.id = 0;
    this.pending = new Map();
    ws.onmessage = (event) => {
      const message = JSON.parse(event.data);
      if (message.id) {
        const pending = this.pending.get(message.id);
        if (pending) {
          this.pending.delete(message.id);
          if (message.error) pending.reject(new Error(JSON.stringify(message.error)));
          else pending.resolve(message.result);
        }
        return;
      }
      if (message.method === "Runtime.consoleAPICalled") {
        const entry = message.params;
        if (entry.type === "error" || entry.type === "assert") {
          report.consoleErrors.push(
            (entry.args || []).map((arg) => arg.value ?? arg.description ?? "").join(" "),
          );
        }
      }
      if (message.method === "Runtime.exceptionThrown") {
        report.consoleErrors.push(
          message.params.exceptionDetails.exception?.description ??
            message.params.exceptionDetails.text,
        );
      }
    };
  }

  static async connect(wsUrl) {
    const ws = new WebSocket(wsUrl);
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
      userGesture: true,
    });
    if (result.exceptionDetails) {
      throw new Error(
        "eval failed: " +
          (result.exceptionDetails.exception?.description ?? result.exceptionDetails.text),
      );
    }
    return result.result.value;
  }

  async waitFor(expression, { timeout = 30000, interval = 300 } = {}) {
    const started = Date.now();
    let last;
    while (Date.now() - started < timeout) {
      try {
        const value = await this.evaluate(expression);
        if (value) return value;
        last = value;
      } catch (error) {
        last = error.message;
      }
      await sleep(interval);
    }
    throw new Error(`waitFor timeout: ${expression} (last=${JSON.stringify(last)})`);
  }

  async screenshot(name, { fullPage = false } = {}) {
    if (fullPage) {
      const dimensions = await this.evaluate(
        "({w: Math.max(document.documentElement.scrollWidth, document.body.scrollWidth), h: document.documentElement.scrollHeight})",
      );
      await this.send("Emulation.setDeviceMetricsOverride", {
        width: Math.max(dimensions.w, 1024),
        height: Math.min(dimensions.h, 7000),
        deviceScaleFactor: 1,
        mobile: false,
      });
      await sleep(400);
    }
    const { data } = await this.send("Page.captureScreenshot", { format: "png" });
    const path = join(IMAGE_DIR, name);
    await writeFile(path, Buffer.from(data, "base64"));
    if (fullPage) await this.send("Emulation.clearDeviceMetricsOverride");
    console.log(`SHOT  ${name}`);
    return path;
  }
}

const metricsExpression = `(() => {
  const doc = document.documentElement;
  const transcript = document.querySelector('section[aria-labelledby="conversation-title"] ol');
  const items = transcript ? [...transcript.querySelectorAll(':scope > li')] : [];
  const userTurns = items.filter((li) => li.className.includes('userTurn'));
  const agentTurns = items.filter((li) => li.className.includes('agentTurn'));
  const composer = document.querySelector('#ask-composer');
  const composerRect = composer ? composer.getBoundingClientRect() : null;
  const clippedTurns = items.filter((li) => li.scrollHeight > li.clientHeight + 2).length;
  const hiddenTurns = items.filter((li) => {
    const style = getComputedStyle(li);
    return ['hidden', 'clip'].includes(style.overflowY) || ['hidden', 'clip'].includes(style.overflowX);
  }).length;
  const nested = [...document.querySelectorAll('*')].filter((el) => {
    if (['TEXTAREA', 'INPUT', 'SELECT'].includes(el.tagName)) return false;
    const style = getComputedStyle(el);
    return (style.overflowY === 'auto' || style.overflowY === 'scroll') && el.scrollHeight > el.clientHeight + 2;
  }).map((el) => ({
    tag: el.tagName,
    className: typeof el.className === 'string' ? el.className.slice(0, 60) : '',
    overflowY: getComputedStyle(el).overflowY,
    scrollHeight: el.scrollHeight,
    clientHeight: el.clientHeight,
  }));
  const nestedScrollers = nested.length;
  const chatCard = document.querySelector('section[aria-labelledby="conversation-title"]');
  const cardRect = chatCard ? chatCard.getBoundingClientRect() : null;
  const panel = document.querySelector('aside[aria-label="史引副驾驶"]');
  const panelRect = panel ? panel.getBoundingClientRect() : null;
  const last = agentTurns.length ? agentTurns[agentTurns.length - 1] : null;
  const lastRect = last ? last.getBoundingClientRect() : null;
  const lastMarkdown = last ? last.querySelector('[class*="markdown"]') : null;
  const horizontalClippedTurns = items.filter((li) => li.scrollWidth > li.clientWidth + 2).length;
  return {
    viewport: { width: innerWidth, height: innerHeight },
    document: {
      scrollHeight: doc.scrollHeight,
      scrollWidth: doc.scrollWidth,
      scrollTop: Math.round(scrollY),
    },
    horizontalOverflow: doc.scrollWidth > innerWidth + 2,
    transcriptItems: items.length,
    turnCount: userTurns.length + agentTurns.length,
    userTurns: userTurns.map((li) => li.innerText.replace(/\\s+/g, ' ').slice(0, 80)),
    assistantReplyLength: last ? last.innerText.length : 0,
    assistantReplyText: last ? last.innerText.replace(/\\s+/g, ' ').slice(0, 160) : '',
    clippedTurns,
    hiddenTurns,
    nestedScrollers,
    nestedScrollerInfo: nested,
    horizontalClippedTurns,
    chatCard: cardRect
      ? { left: Math.round(cardRect.left), right: Math.round(cardRect.right), width: Math.round(cardRect.width) }
      : null,
    copilotPanel: panelRect
      ? { left: Math.round(panelRect.left), right: Math.round(panelRect.right), width: Math.round(panelRect.width) }
      : null,
    answerOverflowsCard: lastRect && cardRect ? lastRect.right > cardRect.right + 1 : null,
    cardOverlapsPanel: cardRect && panelRect ? cardRect.right > panelRect.left + 1 : null,
    composer: composerRect
      ? {
          top: Math.round(composerRect.top),
          bottom: Math.round(composerRect.bottom),
          visible: composerRect.top < innerHeight && composerRect.bottom > 0,
        }
      : null,
    statusBadges: [...document.querySelectorAll('[class*="statusBadge"]')].map((el) => el.innerText),
    citationGroups: document.querySelectorAll('[aria-label="回答引用"]').length,
    tables: document.querySelectorAll('table').length,
    codeBlocks: document.querySelectorAll('pre').length,
    headings: document.querySelectorAll('h1, h2, h3, h4').length,
    copilotOpen: Boolean(document.querySelector('aside[aria-label="史引副驾驶"]')),
    lastMarkdown: lastMarkdown
      ? {
          scrollHeight: lastMarkdown.scrollHeight,
          clientHeight: lastMarkdown.clientHeight,
          overflowY: getComputedStyle(lastMarkdown).overflowY,
        }
      : null,
  };
})()`;

async function main() {
  await mkdir(IMAGE_DIR, { recursive: true });

  const targets = await (await fetch(`${DEBUG}/json/list`)).json();
  const page = targets.find((target) => target.type === "page");
  if (!page) throw new Error("no Edge page target; start Edge with --remote-debugging-port=9222");
  const cdp = await CDP.connect(page.webSocketDebuggerUrl);

  await cdp.send("Page.enable");
  await cdp.send("Runtime.enable");
  await cdp.send("Network.enable");
  await cdp.send("Emulation.setDeviceMetricsOverride", {
    width: 1440,
    height: 900,
    deviceScaleFactor: 1,
    mobile: false,
  });

  async function goto(url) {
    await cdp.send("Page.navigate", { url });
    await cdp.waitFor("document.readyState === 'complete'", { timeout: 30000 });
    await sleep(800);
  }

  async function waitAskReady() {
    await cdp.waitFor("Boolean(document.querySelector('#ask-composer'))", { timeout: 30000 });
  }

  // -----------------------------------------------------------------------
  // 场景二：真实提问 → 回答 → 刷新 / 返回聊天，验证问题与上下文保留
  // -----------------------------------------------------------------------
  console.log("\n== 场景二：真实提问 + 返回聊天状态保留 ==");
  await goto(`${BASE}/ask`);
  await waitAskReady();
  // 清空上一次 E2E 的会话与滚动位置，保证从零开始验收。
  await cdp.evaluate("sessionStorage.clear(); true");
  await cdp.send("Page.reload");
  await waitAskReady();
  await sleep(800);

  const question = "王安石变法和商鞅变法的区别";
  await cdp.evaluate(`(() => {
    const textarea = document.querySelector('#ask-composer');
    const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set;
    setter.call(textarea, ${JSON.stringify(question)});
    textarea.dispatchEvent(new Event('input', { bubbles: true }));
    return textarea.value;
  })()`);
  await sleep(300);
  await cdp.evaluate(`(() => {
    const form = document.querySelector('#ask-composer').closest('form');
    form.requestSubmit();
    return true;
  })()`);

  const answerTimeout = 240000;
  await cdp.waitFor(
    `(() => {
      const ol = document.querySelector('section[aria-labelledby="conversation-title"] ol');
      if (!ol || ol.getAttribute('aria-busy') === 'true') return false;
      const agents = [...ol.querySelectorAll('[class*="agentTurn"]')];
      return agents.length >= 2 && agents[agents.length - 1].innerText.length > 60;
    })()`,
    { timeout: answerTimeout, interval: 1500 },
  );
  await sleep(1200);

  let state = await cdp.evaluate(metricsExpression);
  check("真实提问后问题出现在对话中", state.userTurns.some((text) => text.includes("王安石变法")), state.userTurns);
  check("真实提问拿到 AI 回答（非错误态）", state.assistantReplyLength > 60 && !/服务暂时不可用/.test(state.assistantReplyText), {
    length: state.assistantReplyLength,
    preview: state.assistantReplyText,
  });
  check("页面级滚动承载长回答（无嵌套滚动条）", state.nestedScrollers === 0, { nestedScrollers: state.nestedScrollers });
  check("回答容器未裁切内容", state.clippedTurns === 0 && state.hiddenTurns === 0, {
    clippedTurns: state.clippedTurns,
    hiddenTurns: state.hiddenTurns,
  });
  check("无横向溢出", state.horizontalOverflow === false, state.document);
  check("回答气泡不超出对话卡片", state.answerOverflowsCard !== true, {
    answerOverflowsCard: state.answerOverflowsCard,
    chatCard: state.chatCard,
  });
  check("对话卡片不被副驾驶面板遮挡", state.cardOverlapsPanel !== true, {
    cardOverlapsPanel: state.cardOverlapsPanel,
    chatCard: state.chatCard,
    copilotPanel: state.copilotPanel,
  });
  check("回答无横向裁切", state.horizontalClippedTurns === 0, {
    horizontalClippedTurns: state.horizontalClippedTurns,
  });
  check("底部输入区可见且未遮挡正文", state.composer?.visible === true, state.composer);
  await cdp.screenshot("v1.0.5.1-02-live-answer.png");

  // 滚动到最底部，确认最后一段回答与输入区同时可见
  await cdp.evaluate("window.scrollTo({ top: document.documentElement.scrollHeight, behavior: 'instant' }); true");
  await sleep(600);
  const bottomState = await cdp.evaluate(`(() => {
    const composer = document.querySelector('#ask-composer');
    const composerRect = composer ? composer.getBoundingClientRect() : null;
    const agents = [...document.querySelectorAll('[class*="agentTurn"]')];
    const last = agents[agents.length - 1];
    const markdown = last ? last.querySelector('[class*="markdown"]') : null;
    const lastBlock = markdown ? markdown.lastElementChild : null;
    const lastRect = lastBlock ? lastBlock.getBoundingClientRect() : null;
    return {
      scrollTop: Math.round(scrollY),
      scrollHeight: document.documentElement.scrollHeight,
      lastBlockBottom: lastRect ? Math.round(lastRect.bottom) : null,
      composerTop: composerRect ? Math.round(composerRect.top) : null,
      composerVisible: composerRect ? composerRect.top < innerHeight && composerRect.bottom > 0 : false,
    };
  })()`);
  check("滚动到底部最后一段回答完整可见", bottomState.lastBlockBottom !== null && bottomState.lastBlockBottom <= 900, bottomState);
  check("滚到底部时输入区仍在视口内", bottomState.composerVisible === true && bottomState.composerTop >= bottomState.lastBlockBottom, bottomState);
  await cdp.screenshot("v1.0.5.1-03-live-answer-bottom.png");

  // 刷新后问题 / 回答仍在（sessionStorage 会话恢复）
  await cdp.send("Page.reload");
  await waitAskReady();
  await sleep(1200);
  const afterReload = await cdp.evaluate(metricsExpression);
  check("刷新后用户问题仍在对话中", afterReload.userTurns.some((text) => text.includes("王安石变法")), afterReload.userTurns);
  check("刷新后 AI 回答仍在对话中", afterReload.assistantReplyLength > 60, afterReload.assistantReplyLength);

  // 状态类 UI 检查（引用点击 / 返回聊天 / 滚动恢复）需要一条一定带引用、足够长的会话：
  // 若真实模型本轮返回 insufficient（无引用 / 页面太短），注入静态保底会话后重载，
  // 继续验证 UI 行为；真实 grounded 能力由后端真实 LLM 验收脚本单独覆盖。
  const citationState = await cdp.evaluate(`(() => ({
    citations: document.querySelectorAll('[aria-label="回答引用"] button').length,
    docHeight: document.documentElement.scrollHeight,
    viewportHeight: innerHeight,
  }))()`);
  let stateFallbackUsed = false;
  if (citationState.citations === 0 || citationState.docHeight < citationState.viewportHeight + 300) {
    stateFallbackUsed = true;
    await cdp.evaluate(`(() => {
      const sections = [
        '## 王安石变法与商鞅变法对比（UI 验收保底会话）',
        '> 真实模型本轮返回 insufficient 时，本段静态数据仅用于继续验证「引用点击 / 返回聊天 / 滚动位置恢复」等 UI 行为，不参与 Agent grounded 验收判断；Agent 能力由真实 LLM 验收脚本覆盖。',
        '### 商鞅变法（战国，前359年）',
        '商鞅变法发生于战国秦孝公时期，以废井田、开阡陌、推行县制、实行连坐法与军功爵制、重农抑商为核心措施，奠定秦国富国强兵与统一六国的制度基础。',
        '### 王安石变法（北宋，1069年）',
        '王安石变法发生于北宋熙宁年间，由宋神宗与王安石主导，以青苗法、免役法、市易法、方田均税法为核心，试图缓解北宋冗官、冗兵、冗费「三冗」积弊。',
        '### 对比维度',
        '- 时代：战国 vs 北宋；\\n- 目的：富国强兵 / 耕战秩序 vs 理财强兵 / 缓解积弊；\\n- 影响：奠定统一制度基础 vs 改革理念影响深远、党争加剧；\\n- 局限：执行严苛、旧贵族阻力 vs 执行走样、党争反复。',
        '| 维度 | 商鞅变法 | 王安石变法 |\\n| --- | --- | --- |\\n| 时代 | 战国秦孝公时期 | 北宋熙宁年间 |\\n| 核心 | 耕战与军功爵 | 理财与强兵 |',
      ];
      const text = sections.join('\\n\\n') + '\\n\\n' + sections.slice(2, 5).join('\\n\\n').repeat(4);
      const turns = [
        { id: 'e2e-state-user', role: 'user', content: '王安石变法和商鞅变法的区别' },
        {
          id: 'e2e-state-assistant',
          role: 'assistant',
          content: text,
          answer: {
            mode: 'grounded',
            markdown: '',
            certainty: 'high',
            missing: [],
            reasonCode: null,
            citations: [
              { id: 'cite-zhanguo-05-0', kind: 'event', title: '商鞅变法', event_id: 'zhanguo-05', attribution: '史脉历史数据', license: 'CC BY-NC-SA 4.0', source_label: '史记' },
              { id: 'cite-beisong-10-0', kind: 'event', title: '熙宁变法', event_id: 'beisong-10', attribution: '史脉历史数据', license: 'CC BY-NC-SA 4.0', source_label: '宋史' },
            ],
            entities: [],
            uiActions: [],
            snapshotVersion: 'e2e',
            requestId: 'e2e',
            modelUsed: null,
          },
        },
      ];
      sessionStorage.setItem('histolink.agent.transcript.v1', JSON.stringify(turns));
      sessionStorage.removeItem('histolink.ask.scroll.v1');
      return true;
    })()`);
    await cdp.send("Page.reload");
    await waitAskReady();
    await sleep(1500);
    console.log("NOTE  真实模型本轮无引用 / 页面过短，已切换静态保底会话继续 UI 验收");
  }

  // 滚动到对话中部后打开引用 → 完整时间轴 → 点击「返回聊天」
  await cdp.evaluate(
    "window.scrollTo({ top: Math.min(240, document.documentElement.scrollHeight - innerHeight), behavior: 'instant' }); true",
  );
  await sleep(600);
  const savedScroll = await cdp.evaluate("sessionStorage.getItem('histolink.ask.scroll.v1')");
  check("离开聊天前滚动位置已保存", Number(savedScroll) > 100, { savedScroll });
  const citationClicked = await cdp.evaluate(`(() => {
    const button = document.querySelector('[aria-label="回答引用"] button');
    if (!button) return false;
    button.click();
    return true;
  })()`);
  check("回答引用可点击", citationClicked);
  await sleep(800);
  const copilotOpened = await cdp.waitFor(
    "Boolean(document.querySelector('aside[aria-label=\\\"史引副驾驶\\\"]'))",
    { timeout: 15000 },
  ).then(() => true).catch(() => false);
  check("引用打开史引副驾驶面板", copilotOpened);

  if (copilotOpened) {
    await cdp.evaluate(`(() => {
      const buttons = [...document.querySelectorAll('aside[aria-label="史引副驾驶"] button')];
      const target = buttons.find((button) => button.innerText.includes('展开完整时间轴'));
      if (!target) return false;
      target.click();
      return true;
    })()`);
    await cdp.waitFor("location.pathname === '/timeline'", { timeout: 30000 });
    await sleep(1200);
    const timelineHasReturn = await cdp.waitFor(
      `Boolean([...document.querySelectorAll('button')].find((button) => button.innerText.includes('返回聊天')))`,
      { timeout: 20000 },
    ).then(() => true).catch(() => false);
    check("时间轴页出现「返回聊天」入口", timelineHasReturn);
    if (timelineHasReturn) {
      await cdp.evaluate(`(() => {
        const button = [...document.querySelectorAll('button')].find((item) => item.innerText.includes('返回聊天'));
        if (!button) return false;
        button.click();
        return true;
      })()`);
      await cdp.waitFor("location.pathname === '/ask'", { timeout: 30000 });
      await waitAskReady();
      await sleep(1800);
      const afterReturn = await cdp.evaluate(metricsExpression);
      check("返回聊天后原问题仍在", afterReturn.userTurns.some((text) => text.includes("王安石变法")), afterReturn.userTurns);
      check("返回聊天后回答上下文仍在", afterReturn.assistantReplyLength > 60, afterReturn.assistantReplyLength);
      check("返回聊天后未被旧副驾驶面板遮挡", afterReturn.copilotOpen === false, { copilotOpen: afterReturn.copilotOpen });
      check("返回聊天后恢复滚动位置（不在页顶）", afterReturn.document.scrollTop > 100, afterReturn.document);
      await cdp.screenshot("v1.0.5.1-04-return-chat.png");
    }
  }

  // -----------------------------------------------------------------------
  // 场景一：超长回答完整性（静态注入 4000+ 字回答，验证无裁切 / 自然滚动）
  // -----------------------------------------------------------------------
  console.log("\n== 场景一：超长回答完整显示 ==");
  const seeded = await cdp.evaluate(`(() => {
    const paragraph = '史脉长回答完整性验证：这一段用于确认长文本不会被固定高度容器裁切，页面滚动可以完整读到文末。';
    const sections = Array.from({ length: 40 }, (_, index) => '### 小节 ' + (index + 1) + '\\n\\n' + paragraph.repeat(3));
    const long = '## 超长回答完整性验证\\n\\n' + sections.join('\\n\\n') + '\\n\\n**文末标记：LONG_ANSWER_END**';
    sessionStorage.setItem('histolink.agent.transcript.v1', JSON.stringify([
      { id: 'e2e-long-user', role: 'user', content: '请验证超长回答能否完整显示' },
      { id: 'e2e-long-assistant', role: 'assistant', content: long },
    ]));
    sessionStorage.removeItem('histolink.ask.scroll.v1');
    sessionStorage.removeItem('histolink.agent.transcript.v1');
    sessionStorage.setItem('histolink.agent.transcript.v1', JSON.stringify([
      { id: 'e2e-long-user', role: 'user', content: '请验证超长回答能否完整显示' },
      { id: 'e2e-long-assistant', role: 'assistant', content: long },
    ]));
    return long.length;
  })()`);
  await goto(`${BASE}/ask`);
  await cdp.waitFor(`document.body.innerText.includes('请验证超长回答能否完整显示')`, { timeout: 30000 });
  await sleep(800);
  const longState = await cdp.evaluate(`(() => {
    const users = [...document.querySelectorAll('[class*="userTurn"]')];
    const agents = [...document.querySelectorAll('[class*="agentTurn"]')];
    const last = agents[agents.length - 1];
    const markdown = last ? last.querySelector('[class*="markdown"]') : null;
    const doc = document.documentElement;
    return {
      answerLength: last ? last.innerText.length : 0,
      markdownScrollHeight: markdown ? markdown.scrollHeight : 0,
      markdownClientHeight: markdown ? markdown.clientHeight : 0,
      clippedTurns: [...users, ...agents].filter((li) => li.scrollHeight > li.clientHeight + 2).length,
      hiddenTurns: [...users, ...agents].filter((li) => ['hidden', 'clip'].includes(getComputedStyle(li).overflowY)).length,
      documentScrollHeight: doc.scrollHeight,
      viewportHeight: innerHeight,
      horizontalOverflow: doc.scrollWidth > innerWidth + 2,
      composerVisible: (() => {
        const rect = document.querySelector('#ask-composer').getBoundingClientRect();
        return rect.top < innerHeight && rect.bottom > 0;
      })(),
    };
  })()`);
  check("超长回答渲染为完整 DOM 文本（> 4000 字）", longState.answerLength > 4000, {
    answerLength: longState.answerLength,
    seeded,
  });
  check("超长回答容器无固定高度裁切", longState.clippedTurns === 0 && longState.hiddenTurns === 0 && longState.markdownScrollHeight <= longState.markdownClientHeight + 2, longState);
  check("超长回答页面可自然滚动（远超一屏）", longState.documentScrollHeight > longState.viewportHeight * 3, {
    scrollHeight: longState.documentScrollHeight,
    viewportHeight: longState.viewportHeight,
  });
  check("超长回答无横向溢出", longState.horizontalOverflow === false);
  check("超长回答时输入区仍在视口内", longState.composerVisible === true);

  // 滚到文末，确认最后一段可以读到（不被输入区遮挡）
  await cdp.evaluate("window.scrollTo({ top: document.documentElement.scrollHeight, behavior: 'instant' }); true");
  await sleep(600);
  const longBottom = await cdp.evaluate(`(() => {
    const agents = [...document.querySelectorAll('[class*="agentTurn"]')];
    const last = agents[agents.length - 1];
    const markdown = last ? last.querySelector('[class*="markdown"]') : null;
    const lastBlock = markdown ? markdown.lastElementChild : null;
    const blockRect = lastBlock ? lastBlock.getBoundingClientRect() : null;
    const composerRect = document.querySelector('#ask-composer').getBoundingClientRect();
    return {
      text: lastBlock ? lastBlock.innerText : '',
      blockBottom: blockRect ? Math.round(blockRect.bottom) : null,
      composerTop: Math.round(composerRect.top),
      blockVisible: blockRect ? blockRect.top >= 0 && blockRect.bottom <= innerHeight : false,
    };
  })()`);
  check("超长回答文末可完整读到且不被输入区遮挡", longBottom.blockVisible === true && longBottom.blockBottom <= longBottom.composerTop && longBottom.text.includes("LONG_ANSWER_END"), longBottom);
  await cdp.screenshot("v1.0.5.1-05-long-answer-bottom.png");

  // -----------------------------------------------------------------------
  // 场景三：多轮对话布局预览（静态占位数据）
  // -----------------------------------------------------------------------
  console.log("\n== 场景三：多轮对话布局预览 ==");
  await goto(`${BASE}/ask?preview=multiturn`);
  await cdp.waitFor("document.querySelectorAll('section[aria-labelledby=\\\"conversation-title\\\"] ol > li').length >= 5", { timeout: 30000 });
  await sleep(600);
  const preview = await cdp.evaluate(metricsExpression);
  check("预览展示 2 轮问答（4 条消息）", preview.turnCount === 4, { turnCount: preview.turnCount, userTurns: preview.userTurns });
  check("预览包含 Markdown 表格 / 代码块 / 标题", preview.tables >= 1 && preview.codeBlocks >= 1 && preview.headings >= 2, {
    tables: preview.tables,
    codeBlocks: preview.codeBlocks,
    headings: preview.headings,
  });
  check("每轮回答独立状态徽标（已核验 / 资料不足）", preview.statusBadges.includes("已核验") && preview.statusBadges.includes("资料不足"), preview.statusBadges);
  check("每轮回答独立引用区", preview.citationGroups >= 1, preview.citationGroups);
  check("预览无裁切 / 无嵌套滚动 / 无横向溢出", preview.clippedTurns === 0 && preview.hiddenTurns === 0 && preview.nestedScrollers === 0 && preview.horizontalOverflow === false, preview);
  check("预览输入区可见（V1.0.6 预留）", preview.composer?.visible === true, preview.composer);
  await cdp.screenshot("v1.0.5.1-06-preview-multiturn.png", { fullPage: true });

  // -----------------------------------------------------------------------
  // 场景四：窄屏响应式（390 × 844）
  // -----------------------------------------------------------------------
  console.log("\n== 场景四：窄屏响应式 ==");
  await cdp.send("Emulation.setDeviceMetricsOverride", {
    width: 390,
    height: 844,
    deviceScaleFactor: 2,
    mobile: true,
  });
  await goto(`${BASE}/ask?preview=multiturn`);
  await waitAskReady();
  await sleep(1000);
  const mobilePreview = await cdp.evaluate(metricsExpression);
  const mobileLayout = await cdp.evaluate(`(() => {
    const card = document.querySelector('section[aria-labelledby="conversation-title"]');
    const rect = card.getBoundingClientRect();
    const composer = document.querySelector('#ask-composer').getBoundingClientRect();
    return {
      cardWidth: Math.round(rect.width),
      viewportWidth: innerWidth,
      composerVisible: composer.top < innerHeight && composer.bottom > 0,
      documentScrollWidth: document.documentElement.scrollWidth,
    };
  })()`);
  check("窄屏无横向溢出", mobilePreview.horizontalOverflow === false && mobileLayout.documentScrollWidth <= 390 + 2, mobileLayout);
  check("窄屏对话区单列铺满可用宽度", mobileLayout.cardWidth <= 390 && mobileLayout.cardWidth > 300, mobileLayout);
  check("窄屏无嵌套滚动 / 无裁切", mobilePreview.nestedScrollers === 0 && mobilePreview.clippedTurns === 0, {
    nestedScrollers: mobilePreview.nestedScrollers,
    clippedTurns: mobilePreview.clippedTurns,
  });
  check("窄屏输入区可见", mobileLayout.composerVisible === true && mobilePreview.composer?.visible === true, mobileLayout);
  await cdp.screenshot("v1.0.5.1-07-mobile-preview.png");

  // 窄屏下超长回答（复用已注入的长文本会话）
  await goto(`${BASE}/ask`);
  await cdp.waitFor(`document.body.innerText.includes('LONG_ANSWER_END') || document.body.innerText.includes('超长回答完整性验证')`, { timeout: 30000 });
  await sleep(800);
  const mobileLong = await cdp.evaluate(metricsExpression);
  check("窄屏超长回答无横向溢出 / 无裁切", mobileLong.horizontalOverflow === false && mobileLong.clippedTurns === 0, mobileLong);
  check("窄屏超长回答输入区可见", mobileLong.composer?.visible === true, mobileLong.composer);
  await cdp.evaluate("window.scrollTo({ top: document.documentElement.scrollHeight, behavior: 'instant' }); true");
  await sleep(500);
  await cdp.screenshot("v1.0.5.1-08-mobile-long-answer.png");

  // -----------------------------------------------------------------------
  // 汇总
  // -----------------------------------------------------------------------
  await cdp.send("Emulation.clearDeviceMetricsOverride");
  const failed = report.steps.filter((step) => !step.ok);
  const errors = report.consoleErrors.filter((line) => !line.includes("favicon"));
  report.summary = {
    total: report.steps.length,
    passed: report.steps.length - failed.length,
    failed: failed.length,
    consoleErrors: errors,
  };
  console.log("\n==== SUMMARY ====");
  console.log(JSON.stringify(report.summary, null, 2));
  if (failed.length) {
    console.log("FAILED STEPS:", JSON.stringify(failed, null, 2));
  }
  if (errors.length) {
    console.log("CONSOLE ERRORS:", JSON.stringify(errors.slice(0, 10), null, 2));
  }
  await writeFile(join(ROOT, ".tmp/ui-e2e-report.json"), JSON.stringify(report, null, 2));
  process.exit(failed.length || errors.length ? 1 : 0);
}

main().catch((error) => {
  console.error("E2E FATAL:", error);
  process.exit(2);
});
