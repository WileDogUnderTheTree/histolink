/**
 * V1.0.6.3 内联文字关系树折叠单测。
 *
 * 覆盖：
 * - 典型家族树（李渊 + 5 位子女）识别为关系树，折叠文案与需求一致；
 * - 普通正文 / 普通列表 / 单个连接符不会被误判；
 * - 代码块内的关系树同样可折叠；
 * - 根节点行 / 空白行 / 行尾制表符容错。
 */
import { describe, expect, it } from "vitest";

import {
  collectInlineTreeBlock,
  parseInlineRelationBlock,
  parseRelationGraphLines,
  parseRelationTreeLines,
  relationTreeNotice,
} from "@/lib/relation-tree";

const LIYUAN_TREE = [
  "李渊",
  "├── 李建成（长子）",
  "├── 李世民（次子）",
  "├── 李玄霸（三子，早逝）",
  "├── 李元吉（四子）",
  "└── 李凤（五子，封蜀王）",
];

describe("parseRelationTreeLines", () => {
  it("识别「李渊 + 5 位子女」家族树并生成折叠文案", () => {
    const tree = parseRelationTreeLines(LIYUAN_TREE);
    expect(tree).not.toBeNull();
    expect(tree?.root).toBe("李渊");
    expect(tree?.count).toBe(5);
    expect(relationTreeNotice(tree!)).toBe(
      "已为您提取到李渊家族的 5 位核心亲属，请点击右侧展开图谱查看",
    );
  });

  it("过滤空行与行尾空白后仍能识别", () => {
    const tree = parseRelationTreeLines([
      "  ",
      "李渊  ",
      "  ├── 李建成  ",
      "  └── 李世民  ",
      "",
    ]);
    expect(tree?.root).toBe("李渊");
    expect(tree?.count).toBe(2);
  });

  it("普通正文 / 普通列表不当作关系树", () => {
    expect(parseRelationTreeLines(["赤壁之战发生在公元208年。", "曹操率军南下。"])).toBeNull();
    expect(parseRelationTreeLines(["- 赤壁之战", "- 官渡之战", "- 夷陵之战"])).toBeNull();
    expect(parseRelationTreeLines(["李渊", "李世民"])).toBeNull();
  });

  it("单个连接符行不足以判定为关系树（保守阈值）", () => {
    expect(
      parseRelationTreeLines(["李渊", "├── 李世民", "这是普通正文续行。"]),
    ).toBeNull();
  });

  it("根节点行带连接符时不重复当作根", () => {
    expect(
      parseRelationTreeLines(["├── 李渊", "├── 李建成", "└── 李世民"]),
    ).toBeNull();
  });
});

describe("collectInlineTreeBlock", () => {
  it("从正文中间截取关系树块并返回结束位置", () => {
    const lines = ["先看下面的家族关系：", "", ...LIYUAN_TREE, "", "以上为家族成员。"];
    const result = collectInlineTreeBlock(lines, 2);
    expect(result).not.toBeNull();
    expect(result?.tree.count).toBe(5);
    expect(result?.end).toBe(2 + LIYUAN_TREE.length);
  });

  it("普通段落行返回 null（不误吞正文）", () => {
    expect(collectInlineTreeBlock(["赤壁之战", "曹操率军南下"], 0)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// V1.0.6.3 第二轮：箭头式关系图（Mermaid / ASCII 边列表）同样默认折叠
// ---------------------------------------------------------------------------

describe("parseRelationGraphLines（箭头式关系图）", () => {
  it("Mermaid 节点定义 + 箭头边：识别根节点与亲属数量", () => {
    const tree = parseRelationGraphLines([
      "graph TD",
      "A[李渊] --> B[李建成]",
      "A --> C[李世民]",
      "A --> D[李元吉]",
      "A --> E[李凤]",
    ]);
    expect(tree).not.toBeNull();
    expect(tree?.root).toBe("李渊");
    expect(tree?.count).toBe(4);
    expect(relationTreeNotice(tree!)).toBe(
      "已为您提取到李渊家族的 4 位核心亲属，请点击右侧展开图谱查看",
    );
  });

  it("纯中文姓名的箭头边（无 Mermaid 节点定义）也能识别", () => {
    const tree = parseRelationGraphLines([
      "李渊 --> 李建成",
      "李渊 --> 李世民",
      "李渊 --> 李元吉",
    ]);
    expect(tree?.root).toBe("李渊");
    expect(tree?.count).toBe(3);
  });

  it("只出现裸 ID + 目标显示名（模型精简输出）时仍折叠，文案缺省家族名", () => {
    const tree = parseRelationGraphLines([
      "C --> AE[李元礼]",
      "C --> AF[李元则]",
      "C --> AG[李元婴]",
    ]);
    expect(tree).not.toBeNull();
    expect(tree?.root).toBe("");
    expect(tree?.count).toBe(3);
    expect(relationTreeNotice(tree!)).toContain("3 位核心亲属");
  });

  it("代码块内的箭头式关系图走统一解析入口", () => {
    const tree = parseInlineRelationBlock([
      "flowchart LR",
      "A[李渊] --> B[李世民]",
      "A --> C[李建成]",
      "A --> D[李元吉]",
    ]);
    expect(tree?.root).toBe("李渊");
    expect(tree?.count).toBe(3);
  });

  it("普通两行箭头 / 普通正文不误判", () => {
    expect(parseRelationGraphLines(["读取数据 --> 展示图表"])).toBeNull();
    expect(parseRelationGraphLines(["赤壁之战发生在208年。", "曹操率军南下。"])).toBeNull();
  });
});