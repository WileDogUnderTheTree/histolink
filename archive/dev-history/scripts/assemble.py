# -*- coding: utf-8 -*-
"""Step 9: 组装 frontend/data/timeline-events.ts（保留现有 10 条种子 + 追加 136 条）。"""
import re, os

ROOT = r"C:\Users\wiledog\Desktop\历史"
TMP = os.path.join(ROOT, ".tmp")
SRC = os.path.join(ROOT, "frontend", "data", "timeline-events.ts")

src = open(SRC, encoding="utf-8").read()
m = re.search(r"export const TIMELINE_EVENTS: readonly TimelineEvent\[\] = \[(.*?)\n\];", src, re.S)
if not m:
    raise SystemExit("无法定位 TIMELINE_EVENTS 数组")
seed_body = m.group(1).rstrip()

new_block = open(os.path.join(TMP, "ts_block.txt"), encoding="utf-8").read().rstrip()

header = '''/**
 * 时间轴事件数据。
 *
 * 数据来源：
 * - 夏、商、西周、春秋、战国：史记知识库（shiji-kb）的章节事件索引（CC BY-NC-SA 4.0），
 *   按朝代年份窗筛选、跨章去重后精选；夏、商年代依夏商周断代工程推定，卡片描述中标注“约”。
 * - 秦、汉：首版手写种子数据（时间轴 MVP 验收用），保持不变。
 *
 * 第 1 批（夏—战国）共 136 条。后续批次继续追加；id 与既有条目的 year 只增不改。
 */

/** 朝代。时间轴选择器按 `DYNASTY_START_YEARS` 的历史顺序排列。 */
export type Dynasty = "夏" | "商" | "西周" | "春秋" | "战国" | "秦" | "汉";

export interface TimelineEvent {
  id: string;
  title: string;
  dynasty: Dynasty;
  /** 史书纪年：公元前存负数（前221 → -221），公元存正数（184 → 184），0 非法。 */
  year: number;
  description: string;
}

/** 各朝代起始年（史书纪年），仅用于选择器排序；夏、商、周依夏商周断代工程推定。 */
export const DYNASTY_START_YEARS: Readonly<Record<Dynasty, number>> = {
  夏: -2070,
  商: -1600,
  西周: -1046,
  春秋: -770,
  战国: -475,
  秦: -221,
  汉: -202,
};

export const TIMELINE_EVENTS: readonly TimelineEvent[] = ['''

out = header + seed_body + "\n" + new_block + "\n];\n"
with open(SRC, "w", encoding="utf-8", newline="\n") as f:
    f.write(out)
print("written:", SRC, len(out), "chars")
