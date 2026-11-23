/**
 * 图谱受控状态辅助函数单测（V1.0.1 / TC-08）。
 *
 * 覆盖：一跳邻居解析、中心自己 / 非邻居 / 未知 id 的安全降级、高亮集合过滤去重。
 */
import { describe, expect, it } from "vitest";

import type { PersonGraphData, PersonGraphEdge, PersonGraphNode } from "@/data/person-graph";
import {
  findRelationship,
  normalizeHighlightedPersonIds,
  resolveSelectedRelationship,
} from "@/lib/graph-selection";

function node(id: string): PersonGraphNode {
  return {
    id,
    name: id,
    dynasty: "春秋",
    relatedPeople: [],
    relatedEvents: [],
  };
}

function edge(source: string, target: string, weight = 1): PersonGraphEdge {
  return {
    id: `${source}__${target}`,
    source,
    target,
    weight,
    sharedEvents: [],
  };
}

const DATA: PersonGraphData = {
  nodes: [node("孔子"), node("子路"), node("颜回"), node("老子")],
  edges: [edge("孔子", "子路", 2), edge("孔子", "颜回"), edge("子路", "颜回")],
};

describe("findRelationship", () => {
  it("无向匹配（source/target 顺序不影响）", () => {
    expect(findRelationship(DATA.edges, "孔子", "子路")?.weight).toBe(2);
    expect(findRelationship(DATA.edges, "子路", "孔子")?.weight).toBe(2);
  });

  it("非邻居返回 undefined", () => {
    expect(findRelationship(DATA.edges, "孔子", "老子")).toBeUndefined();
  });
});

describe("resolveSelectedRelationship", () => {
  it("合法的一跳邻居返回人物与关系边", () => {
    const result = resolveSelectedRelationship(DATA, "孔子", "子路");
    expect(result?.person.id).toBe("子路");
    expect(result?.edge.weight).toBe(2);
  });

  it("null / 空值 / 中心自己 → 不打开面板", () => {
    expect(resolveSelectedRelationship(DATA, "孔子", null)).toBeNull();
    expect(resolveSelectedRelationship(DATA, "孔子", undefined)).toBeNull();
    expect(resolveSelectedRelationship(DATA, "孔子", "")).toBeNull();
    expect(resolveSelectedRelationship(DATA, "孔子", "孔子")).toBeNull();
  });

  it("未知 id 不崩溃、不打开面板", () => {
    expect(resolveSelectedRelationship(DATA, "孔子", "不存在的人物")).toBeNull();
  });

  it("非邻居 id 不打开面板（只支持 1 跳）", () => {
    expect(resolveSelectedRelationship(DATA, "孔子", "老子")).toBeNull();
  });
});

describe("normalizeHighlightedPersonIds", () => {
  it("缺省 / 空数组 → 空集合", () => {
    expect(normalizeHighlightedPersonIds(undefined, DATA.nodes)).toEqual([]);
    expect(normalizeHighlightedPersonIds(null, DATA.nodes)).toEqual([]);
    expect(normalizeHighlightedPersonIds([], DATA.nodes)).toEqual([]);
  });

  it("过滤未知 id、去重并保持输入顺序", () => {
    expect(
      normalizeHighlightedPersonIds(
        ["子路", "不存在", "孔子", "子路"],
        DATA.nodes,
      ),
    ).toEqual(["子路", "孔子"]);
  });
});
