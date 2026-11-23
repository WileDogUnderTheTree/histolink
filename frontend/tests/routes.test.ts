/**
 * 深链接构造器单测（V1.0.1 / TC-07）。
 */
import { describe, expect, it } from "vitest";

import { askHref, graphHref, surfaceFromPathname, timelineHref } from "@/lib/routes";

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
});

describe("graphHref", () => {
  it("构造人物与分期参数", () => {
    expect(graphHref({ person: "p-liangtaihou-xixia-0d0f", era: "xixia", mode: "browse" })).toBe(
      "/graph?person=p-liangtaihou-xixia-0d0f&era=xixia&mode=browse",
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
