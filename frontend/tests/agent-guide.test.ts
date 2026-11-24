/**
 * 史引副驾驶联动目标单测（V1.0.4 收尾修复 P2）。
 *
 * 覆盖：
 * - 动作写在 payload / target.params 任一处都能算出深链接（模型两种写法都见过）；
 * - 动作类型不在白名单时忽略；
 * - 动作缺失时回退到 grounded 回答的第一条可定位引用（事件 → 时间轴，人物 → 关系图）；
 * - 只取最近一条回答，错误 / 澄清 / 非 grounded 不会让旧联动重新弹出。
 */
import { describe, expect, it } from "vitest";

import type { AgentAnswerView, Citation, UIAction } from "@/lib/agent-client";
import {
  isGuideActionType,
  resolveGuideFromTranscript,
  type GuideSourceTurn,
} from "@/lib/agent-guide";

function makeAction(
  type: UIAction["type"],
  payload: Record<string, unknown> = {},
  params?: Record<string, string | number | boolean | null>,
): UIAction {
  return {
    id: `act-${type}`,
    type,
    payload,
    target: { surface: "timeline", params },
    auto: false,
    label: "查看",
  };
}

function makeCitation(overrides: Partial<Citation> = {}): Citation {
  return {
    id: "cite-1",
    kind: "event",
    title: "赤壁之战",
    attribution: "史脉历史数据",
    license: "CC BY-NC-SA 4.0",
    ...overrides,
  };
}

function makeAnswer(overrides: Partial<AgentAnswerView> = {}): AgentAnswerView {
  return {
    mode: "grounded",
    markdown: "赤壁之战（东汉，208年）……",
    certainty: "high",
    missing: [],
    reasonCode: null,
    citations: [],
    entities: [],
    uiActions: [],
    snapshotVersion: "v1-test",
    requestId: "req-1",
    modelUsed: null,
    modelRequested: null,
    sources: { timeline: true, graph: false },
    ...overrides,
  } as AgentAnswerView;
}

function makeTurn(id: string, answer: AgentAnswerView | null): GuideSourceTurn {
  return { id, role: "assistant", answer };
}

describe("isGuideActionType", () => {
  it("时间轴 / 图谱聚焦动作可驱动副驾驶，其它动作不行", () => {
    expect(isGuideActionType("timeline.focus_event")).toBe(true);
    expect(isGuideActionType("timeline.focus_dynasty")).toBe(true);
    expect(isGuideActionType("graph.focus_person")).toBe(true);
    expect(isGuideActionType("graph.focus_relation")).toBe(true);
    expect(isGuideActionType("ask.suggest")).toBe(false);
  });
});

describe("resolveGuideFromTranscript", () => {
  it("timeline.focus_event 从 payload 展开时间轴面板", () => {
    const guide = resolveGuideFromTranscript([
      makeTurn(
        "turn-1",
        makeAnswer({
          uiActions: [makeAction("timeline.focus_event", { event_id: "handong-chibi" })],
        }),
      ),
    ]);

    expect(guide).toMatchObject({
      turnId: "turn-1",
      kind: "action",
      surface: "timeline",
      title: "时间轴",
      href: "/timeline?event=handong-chibi",
    });
  });

  it("实体 ID 只写在 target.params 时也能展开（后端只校验合并字段）", () => {
    const guide = resolveGuideFromTranscript([
      makeTurn(
        "turn-1",
        makeAnswer({
          uiActions: [
            makeAction("timeline.focus_event", {}, { event_id: "handong-chibi", mode: "detail" }),
          ],
        }),
      ),
    ]);

    expect(guide?.href).toBe("/timeline?event=handong-chibi&mode=detail");
  });

  it("graph.focus_person → 人物关系图深链接", () => {
    const guide = resolveGuideFromTranscript([
      makeTurn(
        "turn-2",
        makeAnswer({
          uiActions: [makeAction("graph.focus_person", { person_id: "p-zhouyu-b475" })],
        }),
      ),
    ]);

    expect(guide).toMatchObject({
      surface: "graph",
      title: "人物关系图",
      href: "/graph?person=p-zhouyu-b475",
    });
  });

  it("动作缺失时回退到 grounded 回答的事件引用", () => {
    const guide = resolveGuideFromTranscript([
      makeTurn(
        "turn-3",
        makeAnswer({
          citations: [makeCitation({ id: "cite-chibi", event_id: "handong-chibi" })],
        }),
      ),
    ]);

    expect(guide).toMatchObject({
      turnId: "turn-3",
      kind: "citation",
      surface: "timeline",
      href: "/timeline?event=handong-chibi&mode=detail",
      action: null,
    });
  });

  it("没有事件引用时回退到人物引用", () => {
    const guide = resolveGuideFromTranscript([
      makeTurn(
        "turn-4",
        makeAnswer({
          citations: [
            makeCitation({
              id: "cite-person",
              kind: "person",
              title: "周瑜",
              event_id: null,
              person_id: "p-zhouyu-b475",
            }),
          ],
        }),
      ),
    ]);

    expect(guide).toMatchObject({
      surface: "graph",
      href: "/graph?person=p-zhouyu-b475&mode=detail",
    });
  });

  it("只有最近一条回答参与派生：错误 / 非 grounded 不会复活旧联动", () => {
    const withAction = makeTurn(
      "turn-5",
      makeAnswer({
        uiActions: [makeAction("timeline.focus_event", { event_id: "handong-chibi" })],
      }),
    );
    const insufficient = makeTurn(
      "turn-6",
      makeAnswer({ mode: "insufficient", citations: [], uiActions: [] }),
    );

    expect(resolveGuideFromTranscript([withAction, insufficient])).toBeNull();
    expect(resolveGuideFromTranscript([insufficient, withAction])?.turnId).toBe("turn-5");
  });

  it("动作算不出深链接时不误报，继续尝试下一条动作", () => {
    const guide = resolveGuideFromTranscript([
      makeTurn(
        "turn-7",
        makeAnswer({
          uiActions: [
            makeAction("timeline.focus_event", {}),
            makeAction("graph.focus_person", { person_id: "p-zhouyu-b475" }),
          ],
        }),
      ),
    ]);

    expect(guide?.href).toBe("/graph?person=p-zhouyu-b475");
  });

  it("欢迎语 / 无回答的 transcript 返回 null", () => {
    expect(resolveGuideFromTranscript([])).toBeNull();
    expect(resolveGuideFromTranscript([{ id: "turn-welcome", role: "assistant", answer: null }])).toBeNull();
  });
});
