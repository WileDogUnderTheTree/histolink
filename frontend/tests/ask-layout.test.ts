/**
 * `/ask` 布局偏好单测（V1.0.5.2 UI 呼吸感补丁；V1.0.5.3 布局回归补强）。
 *
 * 覆盖：localStorage 原始值解析 / 窄屏默认收起 / 宽屏尊重用户选择 / 落盘值可逆；
 * V1.0.5.3 追加源码级布局契约：100vh App Shell、三列各自独立滚动、历史悬浮「⋯」菜单。
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import {
  ASK_SIDEBAR_NARROW_QUERY,
  ASK_SIDEBAR_STORAGE_KEY,
  askSidebarPreferenceFromStored,
  askSidebarPreferenceToStored,
  resolveAskSidebarPreference,
} from "@/lib/ask-layout";

describe("askSidebarPreferenceFromStored", () => {
  it("只有明确的 collapsed 才收起", () => {
    expect(askSidebarPreferenceFromStored("collapsed")).toBe("collapsed");
    expect(askSidebarPreferenceFromStored("expanded")).toBe("expanded");
    expect(askSidebarPreferenceFromStored(null)).toBe("expanded");
    expect(askSidebarPreferenceFromStored("")).toBe("expanded");
    expect(askSidebarPreferenceFromStored("true")).toBe("expanded");
  });
});

describe("resolveAskSidebarPreference", () => {
  it("窄屏一律默认收起（把横向空间让给对话区）", () => {
    expect(resolveAskSidebarPreference(null, true)).toBe("collapsed");
    expect(resolveAskSidebarPreference("expanded", true)).toBe("collapsed");
    expect(resolveAskSidebarPreference("collapsed", true)).toBe("collapsed");
  });

  it("宽屏尊重用户上次选择，无记录时默认展开", () => {
    expect(resolveAskSidebarPreference(null, false)).toBe("expanded");
    expect(resolveAskSidebarPreference("expanded", false)).toBe("expanded");
    expect(resolveAskSidebarPreference("collapsed", false)).toBe("collapsed");
  });
});

describe("askSidebarPreferenceToStored", () => {
  it("落盘值可逆且只有两种取值", () => {
    expect(askSidebarPreferenceToStored("expanded")).toBe("expanded");
    expect(askSidebarPreferenceToStored("collapsed")).toBe("collapsed");
    expect(askSidebarPreferenceFromStored(askSidebarPreferenceToStored("collapsed"))).toBe(
      "collapsed",
    );
    expect(askSidebarPreferenceFromStored(askSidebarPreferenceToStored("expanded"))).toBe(
      "expanded",
    );
  });
});

describe("常量契约", () => {
  it("localStorage key 与窄屏断点保持稳定（回归时不要静默改值）", () => {
    expect(ASK_SIDEBAR_STORAGE_KEY).toBe("histolink.ask.sidebar.v1");
    expect(ASK_SIDEBAR_NARROW_QUERY).toBe("(max-width: 1080px)");
  });
});

/**
 * V1.0.5.3 布局回归：用源码级契约锁住「/ask 三栏固定 100vh、左右独立滚动」与
 * 「历史记录悬浮出现 ⋯ 菜单」，避免后续样式重构静默回退成整页滚动 / 菜单不可发现。
 */
function readCss(relativePath: string): string {
  return readFileSync(fileURLToPath(new URL(relativePath, import.meta.url)), "utf8");
}

const askCss = readCss("../app/ask/ask.module.css");
const sidebarCss = readCss("../components/agent/ConversationSidebar.module.css");

/** 取某个 CSS 选择器的第一条规则体（足够做契约断言，不引入 CSS 解析器依赖）。 */
function ruleBody(css: string, selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = css.match(new RegExp(`(?:^|\\n)${escaped}\\s*\\{([^}]*)\\}`));
  if (!match) throw new Error(`样式规则缺失：${selector}`);
  return match[1];
}

describe("V1.0.5.3 /ask 三栏布局回归（源码契约）", () => {
  it("App Shell 锁死 100vh / 100dvh 且禁止整页滚动", () => {
    const appFrame = ruleBody(askCss, ".appFrame");
    expect(appFrame).toMatch(/height:\s*100vh/);
    expect(appFrame).toMatch(/height:\s*100dvh/);
    expect(appFrame).toMatch(/max-height:\s*100dvh/);
    expect(appFrame).toMatch(/overflow:\s*hidden/);
  });

  it("工作区改为严格 Flex Row 左右分屏（V1.0.6.3），子列 min-height: 0 各自内部滚动", () => {
    const workspace = ruleBody(askCss, ".workspaceLayout");
    expect(workspace).toMatch(/display:\s*flex/);
    expect(workspace).toMatch(/flex-direction:\s*row/);
    expect(workspace).toMatch(/height:\s*100%/);
    expect(workspace).toMatch(/min-height:\s*0/);
    expect(workspace).toMatch(/overflow:\s*hidden/);
    // 左侧聊天列自适应宽度；右侧史引面板固定 40% 宽（min/max 兜底）并由 App Shell 拉满高度。
    const chatCard = ruleBody(askCss, ".chatCard");
    expect(chatCard).toMatch(/flex:\s*1 1/);
    expect(chatCard).toMatch(/overflow:\s*hidden/);
    const copilot = ruleBody(askCss, ".copilotPanel");
    expect(copilot).toMatch(/flex:\s*0 0 40%/);
    expect(copilot).toMatch(/height:\s*100%/);
    expect(copilot).toMatch(/flex-direction:\s*column/);
    expect(copilot).toMatch(/overflow:\s*hidden/);
    // iframe 区域 `flex: 1 + min-height: 0` 填满面板剩余高度。
    const frameWrap = ruleBody(askCss, ".copilotFrameWrap");
    expect(frameWrap).toMatch(/flex:\s*1 1 auto/);
    expect(frameWrap).toMatch(/min-height:\s*0/);
  });

  it("左侧历史侧边栏独立滚动（scrollArea overflow-y: auto + min-height: 0）", () => {
    const scrollArea = ruleBody(sidebarCss, ".scrollArea");
    expect(scrollArea).toMatch(/overflow-y:\s*auto/);
    expect(scrollArea).toMatch(/min-height:\s*0/);
    expect(scrollArea).toMatch(/overscroll-behavior:\s*contain/);
  });
});

describe("V1.0.5.3 历史记录「⋯」菜单回归（源码契约）", () => {
  it("悬浮 / 聚焦才显示菜单触发器，避免常驻噪声", () => {
    const trigger = ruleBody(sidebarCss, ".menuTrigger");
    expect(trigger).toMatch(/opacity:\s*0/);
    expect(sidebarCss).toMatch(/\.item:hover\s+\.menuTrigger/);
    expect(sidebarCss).toMatch(/\.item:focus-within\s+\.menuTrigger/);
    expect(sidebarCss).toMatch(/\.menuTrigger\[aria-expanded="true"\]/);
  });

  it("菜单触发器挂在每条历史记录上，且有展开态 / 无障碍语义", () => {
    const sidebarTsx = readFileSync(
      fileURLToPath(new URL("../components/agent/ConversationSidebar.tsx", import.meta.url)),
      "utf8",
    );
    expect(sidebarTsx).toContain("data-conversation-menu-trigger");
    expect(sidebarTsx).toContain('aria-haspopup="menu"');
    // 置顶 / 删除都是本地内存逻辑（数据层接口），不允许走网络请求。
    expect(sidebarTsx).toContain("onPinConversation");
    expect(sidebarTsx).toContain("onDeleteConversation");
    expect(sidebarTsx).not.toMatch(/fetch\(/);
  });
});