/**
 * 动作 → 深链接单测（V1.0.4）。
 *
 * 覆盖 5 个 available 动作的跨页导航 URL，以及非法 payload 的容错（返回 null 而不是坏链接）。
 */
import { describe, expect, it } from "vitest";

import { hrefForAction } from "@/lib/action-navigation";
import type { UIAction } from "@/lib/action-policy";

function makeAction(type: UIAction["type"], payload: Record<string, unknown> = {}): UIAction {
  return {
    id: "act-1",
    type,
    payload,
    target: { surface: "timeline" },
    auto: false,
    label: "查看",
  };
}

describe("hrefForAction", () => {
  it("timeline.focus_event → /timeline?event=&mode=", () => {
    expect(hrefForAction(makeAction("timeline.focus_event", { event_id: "handong-chibi" }))).toBe(
      "/timeline?event=handong-chibi",
    );
    expect(
      hrefForAction(makeAction("timeline.focus_event", { event_id: "handong-chibi", mode: "brief" })),
    ).toBe("/timeline?event=handong-chibi&mode=brief");
  });

  it("timeline.focus_dynasty 优先 dynasty，其次 group_id", () => {
    expect(hrefForAction(makeAction("timeline.focus_dynasty", { dynasty: "东汉" }))).toBe(
      "/timeline?dynasty=%E4%B8%9C%E6%B1%89",
    );
    expect(
      hrefForAction(makeAction("timeline.focus_dynasty", { group_id: "qinhan", mode: "brief" })),
    ).toBe("/timeline?group=qinhan&mode=brief");
  });

  it("graph.focus_person 支持 person_id / person 与 era", () => {
    expect(
      hrefForAction(
        makeAction("graph.focus_person", { person_id: "p-zhouyu-b475", era_id: "sanguo" }),
      ),
    ).toBe("/graph?person=p-zhouyu-b475&era=sanguo");
    expect(hrefForAction(makeAction("graph.focus_person", { person: "周瑜" }))).toBe(
      "/graph?person=%E5%91%A8%E7%91%9C",
    );
  });

  it("graph.focus_relation → person + selected", () => {
    expect(
      hrefForAction(
        makeAction("graph.focus_relation", {
          person_id_a: "p-caocao-b012",
          person_id_b: "p-zhouyu-b475",
        }),
      ),
    ).toBe("/graph?person=p-caocao-b012&selected=p-zhouyu-b475");
  });

  it("ask.suggest → /ask?q=", () => {
    expect(hrefForAction(makeAction("ask.suggest", { question: "赤壁之战" }))).toBe(
      "/ask?q=%E8%B5%A4%E5%A3%81%E4%B9%8B%E6%88%98",
    );
    expect(hrefForAction(makeAction("ask.suggest", {}))).toBe("/ask");
  });

  it("非法 / 未知动作返回 null", () => {
    expect(hrefForAction(makeAction("timeline.focus_event", {}))).toBeNull();
    expect(hrefForAction(makeAction("timeline.focus_event", { event_id: 42 }))).toBeNull();
    expect(hrefForAction(makeAction("graph.focus_relation", { person_id_a: "A" }))).toBeNull();
    expect(hrefForAction(makeAction("unknown.type" as UIAction["type"]))).toBeNull();
  });

  it("mode 只接受 detail / brief", () => {
    expect(
      hrefForAction(makeAction("timeline.focus_event", { event_id: "x", mode: "evil" })),
    ).toBe("/timeline?event=x");
  });
});
