/**
 * 事件引用解析器（TC-03 唯一实现）。
 *
 * 输入是事件 `description` 原文，输出结构化 `SourceRef[]`。
 * 解析规则（与 SPEC / 任务卡一致）：
 * 1. 只取**最后一个**包含「据」的圆括号括注（正文中若出现其他括注不影响）；
 * 2. 括注内以《…》界定书目，可并列多本（如「（据《旧唐书》《新唐书》）」）；
 * 3. 特例「裴注引」：`（据《三国志·蜀书·诸葛亮传》裴注引《襄阳记》）`
 *    按 1 条引用计（label = 三国志·蜀书·诸葛亮传），`raw` 保留完整括注，
 *    因为《襄阳记》是裴注转引，不是该事件的主要叙事来源；
 * 4. 括注内「据《…》」之后的其他说明（如「年代依夏商周断代工程推定」）保留在 `raw` 中，
 *    不单独建引用条目。
 *
 * 该解析器同时被 `scripts/extract-sources.mjs`（生成）与 `scripts/validate-data.mjs`
 * （双向校验）调用，保证「生成口径 = 校验口径」。
 */
const PAREN_PATTERN = /（[^（）]*据[^（）]*）/g;
const BOOK_PATTERN = /《([^》]+)》/g;

/**
 * @param {string} description 事件简述原文
 * @returns {{ refs: { label: string; book: string; chapter?: string; raw: string }[] }}
 */
export function parseEventSourceRefs(description) {
  const matches = description.match(PAREN_PATTERN) ?? [];
  if (matches.length === 0) return { refs: [] };

  const raw = matches[matches.length - 1];
  const labels = [...raw.matchAll(BOOK_PATTERN)].map((match) => match[1]);
  if (labels.length === 0) return { refs: [] };

  const isPeiNote = raw.includes("裴注引");
  const effectiveLabels = isPeiNote ? [labels[0]] : labels;

  return {
    refs: effectiveLabels.map((label) => {
      const parts = label.split("·");
      return {
        label,
        book: parts[0],
        ...(parts.length > 1 ? { chapter: parts.slice(1).join("·") } : {}),
        raw,
      };
    }),
  };
}
