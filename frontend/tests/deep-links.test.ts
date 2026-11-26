/**
 * 深链接解析单测（V1.0.1 / TC-08）。
 *
 * 覆盖：事件 / 朝代 / 断代恢复、简阅可见性回退、彩蛋事件、
 * person_id / 姓名 / 别名解析、非法参数安全回落。
 */
import { describe, expect, it } from "vitest";

import { PERSON_GRAPH_ERAS } from "@/data/person-graph";
import {
  resolveGraphDeepLink,
  resolvePersonInGraph,
  resolveTimelineDeepLink,
} from "@/lib/deep-links";

describe("resolveTimelineDeepLink", () => {
  it("event 参数恢复朝代、断代与选中事件", () => {
    const resolved = resolveTimelineDeepLink("event=qin-unify");
    expect(resolved.mode).toBe("detail");
    expect(resolved.dynasty).toBe("秦");
    expect(resolved.groupId).toBe("qinhan");
    expect(resolved.selectedEventId).toBe("qin-unify");
    expect(resolved.openEasterEgg).toBe(false);
  });

  it("彩蛋事件会打开彩蛋状态", () => {
    const resolved = resolveTimelineDeepLink("event=special-star-1893");
    expect(resolved.selectedEventId).toBe("special-star-1893");
    expect(resolved.openEasterEgg).toBe(true);
  });

  it("简阅模式下顶级事件保留简阅，非顶级事件回退细览", () => {
    expect(resolveTimelineDeepLink("event=chunqiu-40&mode=brief").mode).toBe("brief");
    expect(resolveTimelineDeepLink("event=chunqiu-37&mode=brief").mode).toBe("detail");
  });

  it("dynasty 参数进入细览并定位分组", () => {
    const resolved = resolveTimelineDeepLink("dynasty=唐");
    expect(resolved.mode).toBe("detail");
    expect(resolved.dynasty).toBe("唐");
    expect(resolved.groupId).toBe("suitang");
    expect(resolved.selectedEventId).toBeNull();
  });

  it("group 参数进入简阅", () => {
    const resolved = resolveTimelineDeepLink("group=sanguo");
    expect(resolved.mode).toBe("brief");
    expect(resolved.groupId).toBe("sanguo");
    expect(resolved.dynasty).toBe("三国");
  });

  it("无参数 / 非法参数回落默认细览第一个朝代", () => {
    for (const search of ["", "dynasty=不存在", "event=不存在", "mode=unknown"]) {
      const resolved = resolveTimelineDeepLink(search);
      expect(resolved.mode).toBe("detail");
      expect(resolved.dynasty).toBe("夏");
      expect(resolved.selectedEventId).toBeNull();
    }
  });

  it("只有 mode=brief 时默认第一个断代", () => {
    const resolved = resolveTimelineDeepLink("mode=brief");
    expect(resolved.mode).toBe("brief");
    expect(resolved.groupId).toBe("xianqin");
  });
});

describe("resolvePersonInGraph", () => {
  const chunqiu = PERSON_GRAPH_ERAS.find((era) => era.id === "chunqiu")!.graph;
  const qing = PERSON_GRAPH_ERAS.find((era) => era.id === "qing")!.graph;

  it("姓名直接命中图节点", () => {
    expect(resolvePersonInGraph("孔子", chunqiu)).toBe("孔子");
  });

  it("人物主数据 person_id 可解析成图节点（V1.0.1 图节点仍以姓名为 id）", () => {
    expect(resolvePersonInGraph("p-kongzi-e89c", chunqiu)).toBe("孔子");
    expect(resolvePersonInGraph("p-kangxidi-aaa3", qing)).toBe("康熙帝");
  });

  it("图谱别名（庙号）可解析", () => {
    expect(resolvePersonInGraph("清圣祖", qing)).toBe("康熙帝");
  });

  it("人物不在当期图中 / 未知值 → null（调用方回落默认中心）", () => {
    expect(resolvePersonInGraph("李世民", chunqiu)).toBeNull();
    expect(resolvePersonInGraph("不存在的人物", chunqiu)).toBeNull();
  });
});

describe("resolveGraphDeepLink", () => {
  it("era 细览 id → 细览并定位中心", () => {
    const resolved = resolveGraphDeepLink("person=p-kangxidi-aaa3&era=qing");
    expect(resolved.mode).toBe("detail");
    expect(resolved.eraId).toBe("qing");
    expect(resolved.scopeId).toBe("yuanmingqing");
    expect(resolved.centerPersonId).toBe("康熙帝");
  });

  it("era 简阅 id → 简阅", () => {
    const resolved = resolveGraphDeepLink("era=suitang");
    expect(resolved.mode).toBe("brief");
    expect(resolved.scopeId).toBe("suitang");
    expect(resolved.eraId).toBe("tang");
    expect(resolved.centerPersonId).toBe("李世民");
  });

  it("mode 显式覆盖并自动换算另一个视图", () => {
    const brief = resolveGraphDeepLink("era=qing&mode=brief");
    expect(brief.mode).toBe("brief");
    expect(brief.scopeId).toBe("yuanmingqing");

    const detail = resolveGraphDeepLink("era=suitang&mode=detail");
    expect(detail.mode).toBe("detail");
    expect(detail.eraId).toBe("tang");
  });

  it("无参数 / 非法参数回落细览最早分期（V1.0.5.4 起为「夏」）", () => {
    for (const search of ["", "era=不存在", "person=不存在", "mode=unknown"]) {
      const resolved = resolveGraphDeepLink(search);
      expect(resolved.mode).toBe("detail");
      expect(resolved.eraId).toBe("xia");
      expect(resolved.centerPersonId).toBe("禹");
    }
  });

  it("人物不在当期图内时回落该期默认中心", () => {
    const resolved = resolveGraphDeepLink("person=李世民&era=chunqiu");
    expect(resolved.centerPersonId).toBe("孔子");
  });

  it("只给 person_id（史引面板 / 引用跳转）时跨分期找到人物所属图", () => {
    const resolved = resolveGraphDeepLink("person=p-zhouyu-b475&mode=detail");
    expect(resolved.mode).toBe("detail");
    expect(resolved.eraId).toBe("sanguo");
    expect(resolved.scopeId).toBe("sanguo");
    expect(resolved.centerPersonId).toBe("周瑜");

    // 简阅模式下同样跨断代查找。
    const brief = resolveGraphDeepLink("person=p-wuzetian-2920&mode=brief");
    expect(brief.mode).toBe("brief");
    expect(brief.centerPersonId).toBe("武则天");
  });

  it("selected 参数驱动受控选中（刷新可复现关系面板）", () => {
    const resolved = resolveGraphDeepLink(
      "person=p-caocao-b012&era=sanguo&selected=p-liubei-0c86",
    );
    expect(resolved.centerPersonId).toBe("曹操");
    expect(resolved.selectedPersonId).toBe("刘备");
  });

  it("selected 非法 / 等于中心 → 非受控（不打开面板）", () => {
    expect(
      resolveGraphDeepLink("person=曹操&era=sanguo&selected=不存在的人物").selectedPersonId,
    ).toBeUndefined();
    expect(
      resolveGraphDeepLink("person=曹操&era=sanguo&selected=曹操").selectedPersonId,
    ).toBeUndefined();
    expect(resolveGraphDeepLink("person=曹操&era=sanguo").selectedPersonId).toBeUndefined();
  });

  it("同一人物跨多个分期时优先「默认中心 / 关系更完整」的分期（V1.0.6.3）", () => {
    // 李世民同时出现在隋与唐：唐是其默认中心、关系网更完整（12 位邻居 vs 隋 3 位）。
    const resolved = resolveGraphDeepLink("person=p-lishimin-7efd&mode=detail");
    expect(resolved.eraId).toBe("tang");
    expect(resolved.centerPersonId).toBe("李世民");
  });
});
