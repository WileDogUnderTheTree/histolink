/**
 * 深链接构造器单测（V1.0.1 / TC-07）。
 */
import { describe, expect, it } from "vitest";

import {
  askHref,
  graphHref,
  surfaceFromPathname,
  surfaceLinksFromHref,
  timelineHref,
} from "@/lib/routes";

describe("timelineHref", () => {
  it("无参数时就是 /timeline", () => {
    expect(timelineHref()).toBe("/timeline");
    expect(timelineHref({})).toBe("/timeline");
  });

  it("中文参数正确编码且顺序稳定", () => {
    expect(timelineHref({ event: "qin-unify", dynasty: "秦", mode: "detail" })).toBe(
      "/timeline?event=qin-unify&dynasty=%E7%A7%A6&mode=detail",
    );
  });

  it("空值 / undefined 参数被忽略", () => {
    expect(timelineHref({ dynasty: "", event: undefined })).toBe("/timeline");
  });

  it("V1.0.4：支持简阅断代 group 参数（跨页 focus_dynasty 使用）", () => {
    expect(timelineHref({ group: "qinhan", mode: "brief" })).toBe(
      "/timeline?group=qinhan&mode=brief",
    );
  });

  it("V1.0.4：from 来源标记参与构造（史引「返回聊天」闭环）", () => {
    expect(timelineHref({ event: "handong-chibi", from: "agent" })).toBe(
      "/timeline?event=handong-chibi&from=agent",
    );
  });
});

describe("graphHref", () => {
  it("构造人物与分期参数", () => {
    expect(graphHref({ person: "p-liangtaihou-xixia-0d0f", era: "xixia", mode: "browse" })).toBe(
      "/graph?person=p-liangtaihou-xixia-0d0f&era=xixia&mode=browse",
    );
  });

  it("受控选中参数参与构造（TC-08 受控关系面板）", () => {
    expect(graphHref({ person: "曹操", era: "sanguo", selected: "刘备" })).toBe(
      "/graph?person=%E6%9B%B9%E6%93%8D&era=sanguo&selected=%E5%88%98%E5%A4%87",
    );
  });

  it("V1.0.4：from 来源标记参与构造（史引「返回聊天」闭环）", () => {
    expect(graphHref({ person: "p-zhouyu-b475", from: "agent" })).toBe(
      "/graph?person=p-zhouyu-b475&from=agent",
    );
  });
});

describe("askHref", () => {
  it("空问题只返回 /ask", () => {
    expect(askHref()).toBe("/ask");
    expect(askHref("   ")).toBe("/ask");
  });

  it("问题中的中文、空格与 & 正确编码", () => {
    expect(askHref("梁太后 & 北宋")).toBe("/ask?q=%E6%A2%81%E5%A4%AA%E5%90%8E+%26+%E5%8C%97%E5%AE%8B");
  });
});

describe("surfaceFromPathname", () => {
  it("三个动作目标页映射到 surface", () => {
    expect(surfaceFromPathname("/timeline")).toBe("timeline");
    expect(surfaceFromPathname("/graph")).toBe("graph");
    expect(surfaceFromPathname("/ask")).toBe("ask");
  });

  it("忽略 query / hash / 末尾斜杠", () => {
    expect(surfaceFromPathname("/timeline/?dynasty=秦#event-1")).toBe("timeline");
    expect(surfaceFromPathname("/graph/")).toBe("graph");
  });

  it("首页与未知路径返回 null（跨页需确认）", () => {
    expect(surfaceFromPathname("/")).toBeNull();
    expect(surfaceFromPathname("/people")).toBeNull();
    expect(surfaceFromPathname(null)).toBeNull();
    expect(surfaceFromPathname(undefined)).toBeNull();
  });
});

describe("surfaceLinksFromHref（史引副驾驶 · 展开完整页面）", () => {
  it("时间轴面板：两个入口都带 from=agent，时间轴入口保留焦点事件", () => {
    expect(surfaceLinksFromHref("/timeline?event=handong-chibi")).toEqual({
      focus: "timeline",
      timeline: "/timeline?event=handong-chibi&from=agent",
      graph: "/graph?from=agent",
    });
  });

  it("时间轴面板：dynasty / group / mode 也原样带上", () => {
    expect(surfaceLinksFromHref("/timeline?dynasty=%E7%A7%A6&mode=detail")).toEqual({
      focus: "timeline",
      timeline: "/timeline?dynasty=%E7%A7%A6&mode=detail&from=agent",
      graph: "/graph?from=agent",
    });
    expect(surfaceLinksFromHref("/timeline?group=qinhan&mode=brief").timeline).toBe(
      "/timeline?group=qinhan&mode=brief&from=agent",
    );
  });

  it("人物图面板：两个入口都带 from=agent，人物图入口保留焦点人物 / 分期 / 受控选中", () => {
    expect(
      surfaceLinksFromHref("/graph?person=p-zhouyu-b475&era=sanguo&selected=p-sunquan-182"),
    ).toEqual({
      focus: "graph",
      timeline: "/timeline?from=agent",
      graph: "/graph?person=p-zhouyu-b475&era=sanguo&selected=p-sunquan-182&from=agent",
    });
  });

  it("非法 / 空链接：两个入口都回退裸路径 + from=agent，focus 为 null", () => {
    expect(surfaceLinksFromHref("/timeline")).toEqual({
      focus: "timeline",
      timeline: "/timeline?from=agent",
      graph: "/graph?from=agent",
    });
    expect(surfaceLinksFromHref("/unknown?event=x")).toEqual({
      focus: null,
      timeline: "/timeline?from=agent",
      graph: "/graph?from=agent",
    });
  });
});
