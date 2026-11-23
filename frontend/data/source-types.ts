/**
 * 引用（SourceRef）类型（V1.0.1 / TC-03）。
 *
 * 引用单元 = 一条事件简述末尾的「（据《…》）」括注。
 * 字段口径（冻结）：
 * - `label`：原样标签，如「史记·秦始皇本纪」；
 * - `book`：按首个「·」切分，如「史记」；
 * - `chapter`：切分后的剩余部分（可选），如「秦始皇本纪」；
 * - `raw`：原文括注片段（含「（据…）」），用于回查与审计。
 *
 * 关系类引用不新增书目：构造时取该关系 `eventSummaries` 指向的共同事件的书目；
 * 关系定性本身标注「史脉关系库（人工校订）」。规则见 `docs/source-review.md`。
 */
export interface SourceRef {
  label: string;
  book: string;
  chapter?: string;
  raw: string;
}

/** 事件的引用状态；`easter_egg` 表示刻意不参与事实回答的彩蛋节点。 */
export type EventSourceStatus = "cited" | "easter_egg" | "missing";
