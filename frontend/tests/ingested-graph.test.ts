/**
 * V1.0.5.4 图谱扩充入库回归测试（夏、商、西周）。
 *
 * 覆盖本批数据入库的四条硬性验收：
 * 1. `person-graph.ts` 新增「夏 / 商 / 西周」三个细览分期（/graph Tab 自动跟随）；
 * 2. 扩充表「重要度 3」事件进入时间轴简阅（`importance === 3`），既有事件按就高覆盖；
 * 3. 别名归一化：「夏桀」为唯一主键、`桀` 为别名可命中；`大禹` → `禹`；
 * 4. 同名异人：「周公旦」与「周定公」必须两条独立记录、两个独立 person_id，绝不合并。
 */

import { describe, expect, it } from "vitest";

import { INGESTED_EVENT_RECORDS, INGESTED_IMPORTANCE_OVERRIDES } from "@/data/ingested-graph-data.generated";
import {
  ERA_TO_SCOPE,
  KEY_FIGURES,
  PERSON_GRAPH_ERAS,
  PERSON_GRAPH_SCOPES,
  PERSON_NAME_ALIASES,
  SCOPE_TO_ERA,
} from "@/data/person-graph";
import { PERSON_RELATIONS, pairKey } from "@/data/person-relations";
import { getPersonById, resolvePersonCandidates } from "@/data/persons";
import { TIMELINE_EVENTS, importanceOf } from "@/data/timeline-events";
import { resolvePersonInGraph } from "@/lib/deep-links";

const eraById = (eraId: string) => {
  const era = PERSON_GRAPH_ERAS.find((item) => item.id === eraId);
  if (!era) throw new Error(`缺少图谱分期 ${eraId}`);
  return era;
};
const scopeById = (scopeId: string) => {
  const scope = PERSON_GRAPH_SCOPES.find((item) => item.id === scopeId);
  if (!scope) throw new Error(`缺少简阅断代 ${scopeId}`);
  return scope;
};
const eventById = (eventId: string) => {
  const event = TIMELINE_EVENTS.find((item) => item.id === eventId);
  if (!event) throw new Error(`缺少时间轴事件 ${eventId}`);
  return event;
};
const relationPairKeys = new Set(PERSON_RELATIONS.map((record) => pairKey(record.a, record.b)));

describe("图谱分期：夏 / 商 / 西周", () => {
  it("新增三个细览分期，并按史序排在最前（/graph Tab 自动跟随）", () => {
    expect(PERSON_GRAPH_ERAS.slice(0, 3).map((era) => era.id)).toEqual([
      "xia",
      "shang",
      "xizhou",
    ]);
    expect(PERSON_GRAPH_ERAS.slice(0, 3).map((era) => era.label)).toEqual(["夏", "商", "西周"]);
  });

  it("每期都有足够的人物节点 / 关系边，默认中心在图中", () => {
    for (const eraId of ["xia", "shang", "xizhou"] as const) {
      const era = eraById(eraId);
      expect(era.graph.nodes.length).toBeGreaterThanOrEqual(10);
      expect(era.graph.edges.length).toBeGreaterThanOrEqual(10);
      expect(era.graph.nodes.some((node) => node.name === era.defaultCenterPersonId)).toBe(true);
      expect(KEY_FIGURES[era.label]).toContain(era.defaultCenterPersonId);
    }
    expect(eraById("xia").defaultCenterPersonId).toBe("禹");
    expect(eraById("shang").defaultCenterPersonId).toBe("商汤");
    expect(eraById("xizhou").defaultCenterPersonId).toBe("周公旦");
  });

  it("先秦简阅断代已接入夏商西周人物与关系", () => {
    const xianqin = scopeById("xianqin");
    const names = new Set(xianqin.graph.nodes.map((node) => node.name));
    for (const name of ["禹", "夏桀", "商汤", "伊尹", "妇好", "周文王", "周武王", "周公旦", "周定公"]) {
      expect(names.has(name), `先秦图缺少人物：${name}`).toBe(true);
    }
    expect(ERA_TO_SCOPE.xia).toBe("xianqin");
    expect(ERA_TO_SCOPE.shang).toBe("xianqin");
    expect(ERA_TO_SCOPE.xizhou).toBe("xianqin");
    expect(SCOPE_TO_ERA.xianqin).toBe("xia");
  });
});

describe("重要度映射：重要度 3 进简阅", () => {
  it("扩充表 importance===3 的新事件全部进入时间轴简阅层", () => {
    const important = INGESTED_EVENT_RECORDS.filter((event) => event.importance === 3);
    expect(important.length).toBeGreaterThanOrEqual(2);
    for (const event of important) {
      expect(importanceOf(eventById(event.id)), `${event.title} 未进入简阅`).toBe(3);
    }
    expect(important.map((event) => event.title)).toEqual(
      expect.arrayContaining(["启建夏·钧台之享", "褒姒惑周·废嫡立庶"]),
    );
  });

  it("既有事件按扩充表「就高」覆盖为重要度 3（三监之乱 / 周公制礼作乐 …）", () => {
    const overridden = Object.entries(INGESTED_IMPORTANCE_OVERRIDES);
    expect(overridden.length).toBeGreaterThanOrEqual(5);
    for (const [eventId] of overridden) {
      expect(importanceOf(eventById(eventId)), `${eventId} 未按扩容表提升重要度`).toBe(3);
    }
    expect(importanceOf(eventById("xizhou-05"))).toBe(3);
    expect(importanceOf(eventById("xizhou-10"))).toBe(3);
  });

  it("既有事件参与人按扩充表追加（不复制事件，只补 participants）", () => {
    expect(eventById("xia-01").participants).toEqual(expect.arrayContaining(["舜", "禹"]));
    expect(eventById("xizhou-12").participants).toEqual(
      expect.arrayContaining(["周穆王", "祭公谋父"]),
    );
    // 同一史实复用既有 id：文档里的「大禹治水 / 太康失国 / 伊尹放太甲」不重复造事件。
    expect(TIMELINE_EVENTS.filter((event) => event.title === "大禹治水")).toHaveLength(1);
    expect(TIMELINE_EVENTS.filter((event) => event.title === "伊尹放太甲")).toHaveLength(1);
  });
});

describe("别名归一化：夏桀是唯一主键", () => {
  it("persons 主数据以「夏桀」为唯一主键，「桀」是它的别名", () => {
    const byPrimary = resolvePersonCandidates("夏桀");
    const byAlias = resolvePersonCandidates("桀");
    expect(byPrimary).toHaveLength(1);
    expect(byAlias).toHaveLength(1);
    expect(byAlias[0].id).toBe(byPrimary[0].id);
    expect(byAlias[0].displayName).toBe("夏桀");
    expect(byPrimary[0].id).toBe("p-xia-xiajie-01");
    expect(byPrimary[0].aliases).toContain("桀");
    expect(PERSON_NAME_ALIASES["桀"]).toBe("夏桀");
  });

  it("图谱搜索用「桀」能命中「夏桀」节点（不新增独立节点）", () => {
    const xia = eraById("xia").graph;
    expect(xia.nodes.some((node) => node.id === "夏桀")).toBe(true);
    expect(xia.nodes.some((node) => node.id === "桀")).toBe(false);
    expect(resolvePersonInGraph("桀", xia)).toBe("夏桀");
    expect(resolvePersonInGraph("夏桀", xia)).toBe("夏桀");
  });

  it("「大禹」归一为「禹」，RAG 语料中的大禹可命中图谱", () => {
    expect(PERSON_NAME_ALIASES["大禹"]).toBe("禹");
    expect(resolvePersonCandidates("大禹")[0]?.displayName).toBe("禹");
    expect(resolvePersonInGraph("大禹", eraById("xia").graph)).toBe("禹");
  });
});

describe("同名异人：周公旦 vs 周定公", () => {
  it("两位「周公」各自独立 person_id，绝不被合并", () => {
    const regent = resolvePersonCandidates("周公旦")[0];
    const duke = resolvePersonCandidates("周定公")[0];
    expect(regent?.id).toBe("p-xizhou-zhougongdan-01");
    expect(duke?.id).toBe("p-xizhou-zhoudinggong-01");
    expect(regent.id).not.toBe(duke.id);
    expect(regent.displayName).toBe("周公旦");
    expect(duke.displayName).toBe("周定公");
    // 两人的事件集合互不重叠：摄政周公在成王 / 东征，周定公在共和行政。
    const regentEvents = new Set(getPersonById(regent.id)?.eventIds ?? []);
    const dukeEvents = new Set(getPersonById(duke.id)?.eventIds ?? []);
    expect([...regentEvents].some((eventId) => dukeEvents.has(eventId))).toBe(false);
  });

  it("西周图同时存在两个节点，且两者之间没有关系边（没有串人）", () => {
    const xizhou = eraById("xizhou").graph;
    const names = xizhou.nodes.map((node) => node.name);
    expect(names).toContain("周公旦");
    expect(names).toContain("周定公");
    const crossed = xizhou.edges.filter(
      (edge) =>
        (edge.source === "周公旦" && edge.target === "周定公") ||
        (edge.source === "周定公" && edge.target === "周公旦"),
    );
    expect(crossed).toHaveLength(0);
  });

  it("「周公（周定公）」只指向周定公，不会解析到摄政周公旦", () => {
    expect(PERSON_NAME_ALIASES["周公（周定公）"]).toBe("周定公");
    expect(resolvePersonCandidates("周公（周定公）")[0]?.id).toBe("p-xizhou-zhoudinggong-01");
  });
});

describe("人物关系：扩充表 34 条的去重合并", () => {
  it("新增关系对全部进入关系库，且锚点是两人的共同事件", () => {
    const expectedPairs: [string, string][] = [
      ["鲧", "禹"],
      ["禹", "伯益"],
      ["禹", "夏启"],
      ["夏启", "太康"],
      ["后羿", "寒浞"],
      ["商纣王", "箕子"],
      ["武丁", "妇好"],
      ["盘庚", "阳甲"],
      ["周文王", "周武王"],
      ["周公旦", "武庚"],
      ["周厉王", "召穆公"],
      ["周厉王", "周定公"],
      ["周幽王", "申侯"],
    ];
    for (const [a, b] of expectedPairs) {
      expect(relationPairKeys.has(pairKey(a, b)), `缺少关系：${a} × ${b}`).toBe(true);
    }

    const relation = PERSON_RELATIONS.find(
      (record) => pairKey(record.a, record.b) === pairKey("禹", "夏启"),
    );
    expect(relation).toBeDefined();
    for (const eventId of Object.keys(relation!.eventSummaries)) {
      const participants = eventById(eventId).participants;
      expect(participants).toEqual(expect.arrayContaining(["禹", "夏启"]));
    }
  });

  it("与手写关系重复的人物对不重复收录（pairKey 唯一）", () => {
    const keys = PERSON_RELATIONS.map((record) => pairKey(record.a, record.b));
    expect(new Set(keys).size).toBe(keys.length);
    expect(keys.filter((key) => key === pairKey("夏桀", "商汤"))).toHaveLength(1);
    expect(keys.filter((key) => key === pairKey("商汤", "伊尹"))).toHaveLength(1);
  });
});