/**
 * `/ask` 布局偏好单测（V1.0.5.2 UI 呼吸感补丁）。
 *
 * 覆盖：localStorage 原始值解析 / 窄屏默认收起 / 宽屏尊重用户选择 / 落盘值可逆。
 */

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