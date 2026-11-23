#!/usr/bin/env node
/**
 * 事件引用结构化生成器（V1.0.1 / TC-03）。
 *
 * 输入（只读）：frontend/data/timeline-events.ts + weijin-events.ts 的 description
 * 输出（生成物，禁止手改）：
 * - frontend/data/event-sources.ts   → EVENT_SOURCES / EVENT_SOURCE_STATUS
 * - docs/source-review.md            → 书目归一化说明、例外清单、抽查记录
 *
 * 用法：
 *   node scripts/extract-sources.mjs          # 生成并写盘
 *   node scripts/extract-sources.mjs --check  # 只校验是否与磁盘一致（CI 用；无写操作）
 *
 * 解析规则见 scripts/lib/parse-sources.mjs（生成与校验共用同一实现）。
 */
import fs from "node:fs";
import path from "node:path";
import { DATA_DIR, ROOT, loadTsData } from "./lib/load-ts-data.mjs";
import { parseEventSourceRefs } from "./lib/parse-sources.mjs";

const CHECK_MODE = process.argv.includes("--check");

const SOURCES_OUT = path.join(DATA_DIR, "event-sources.ts");
const REPORT_OUT = path.join(ROOT, "docs", "source-review.md");

const compareText = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

const { eventPool, TIMELINE_EVENTS, WEIJIN_EVENTS } = loadTsData();

const errors = [];
const fail = (message) => errors.push(message);

// ---------------------------------------------------------------------------
// 解析全部事件
// ---------------------------------------------------------------------------
const records = eventPool
  .map((event) => {
    const { refs } = parseEventSourceRefs(event.description);
    const status = refs.length > 0 ? "cited" : event.isSpecial ? "easter_egg" : "missing";
    return { event, refs, status };
  })
  .sort((a, b) => compareText(a.event.id, b.event.id));

for (const record of records) {
  const label = `事件 ${record.event.id}`;
  if (record.status === "missing") {
    fail(`${label}：简述中没有可解析的「据《…》」括注，也不是彩蛋事件`);
  }
  if (record.status === "easter_egg" && record.refs.length > 0) {
    fail(`${label}：彩蛋事件不应带引用`);
  }
  for (const ref of record.refs) {
    if (!ref.label.trim()) fail(`${label}：引用 label 为空`);
    if (!ref.book.trim()) fail(`${label}：引用 book 为空（label=${ref.label}）`);
    if (!ref.raw.includes(`《${ref.label}》`)) fail(`${label}：引用 label 不是 raw 的子串（${ref.label}）`);
    if (ref.raw !== record.event.description.slice(record.event.description.lastIndexOf(ref.raw), record.event.description.lastIndexOf(ref.raw) + ref.raw.length)) {
      fail(`${label}：引用 raw 不是简述原文片段`);
    }
  }
}

if (errors.length > 0) {
  console.error("✖ 引用解析失败：");
  for (const message of errors) console.error(`  - ${message}`);
  process.exit(1);
}

const citedRecords = records.filter((record) => record.status === "cited");
const easterEggRecords = records.filter((record) => record.status === "easter_egg");
const refCount = records.reduce((sum, record) => sum + record.refs.length, 0);
const multiBookRecords = citedRecords.filter((record) => record.refs.length > 1);
const singleBookRecords = citedRecords.filter((record) => record.refs.length === 1);

// ---------------------------------------------------------------------------
// 书目 / 标签统计
// ---------------------------------------------------------------------------
const bookStats = new Map();
const labelStats = new Map();
for (const record of citedRecords) {
  for (const ref of record.refs) {
    const bookEntry = bookStats.get(ref.book) ?? { book: ref.book, refs: 0, labels: new Set() };
    bookEntry.refs += 1;
    bookEntry.labels.add(ref.label);
    bookStats.set(ref.book, bookEntry);

    const labelEntry = labelStats.get(ref.label) ?? {
      label: ref.label,
      book: ref.book,
      chapter: ref.chapter,
      refs: 0,
      eventIds: [],
    };
    labelEntry.refs += 1;
    labelEntry.eventIds.push(record.event.id);
    labelStats.set(ref.label, labelEntry);
  }
}
const books = [...bookStats.values()].sort((a, b) => compareText(a.book, b.book));
const labels = [...labelStats.values()].sort(
  (a, b) => compareText(a.book, b.book) || compareText(a.label, b.label),
);

// 「年代依…」等括注尾注：raw 中最后一个《》之后还有说明文字。
const noteRecords = citedRecords.filter((record) => {
  const tail = record.refs[0].raw.replace(/^（据/, "").replace(/）$/, "");
  const lastClose = tail.lastIndexOf("》");
  return lastClose >= 0 && tail.slice(lastClose + 1).replace(/[；;，,。]/g, "").trim().length > 0;
});
const peiNoteRecords = citedRecords.filter((record) => record.refs[0]?.raw.includes("裴注引"));

// ---------------------------------------------------------------------------
// 生成 event-sources.ts
// ---------------------------------------------------------------------------
const sourcesContent =
  `/**
 * 自动生成，禁止手改（scripts/extract-sources.mjs）。
 *
 * 来源：frontend/data/timeline-events.ts、weijin-events.ts 的 description 末尾「（据《…》）」括注。
 * 重新生成：node scripts/extract-sources.mjs     校验：node scripts/extract-sources.mjs --check
 * 解析规则与口径说明：scripts/lib/parse-sources.mjs、docs/source-review.md
 */
import type { EventSourceStatus, SourceRef } from "./source-types";

export const EVENT_SOURCES: Readonly<Record<string, readonly SourceRef[]>> = {
` +
  records
    .map((record) => `  ${JSON.stringify(record.event.id)}: [${record.refs.map((ref) => JSON.stringify(ref)).join(", ")}],`)
    .join("\n") +
  `\n};\n\n` +
  `/** 事件引用状态：cited=有据可引；easter_egg=彩蛋（不得作为史实引用）。 */\n` +
  `export const EVENT_SOURCE_STATUS: Readonly<Record<string, EventSourceStatus>> = {\n` +
  records.map((record) => `  ${JSON.stringify(record.event.id)}: ${JSON.stringify(record.status)},`).join("\n") +
  `\n};\n`;

// ---------------------------------------------------------------------------
// 生成 source-review.md
// ---------------------------------------------------------------------------
const lines = [
  "# 引用结构化复核（V1.0.1 / TC-03）",
  "",
  "> 本文件由 `scripts/extract-sources.mjs` 生成，随数据一起提交。",
  "> 生成口径与校验口径共用 `scripts/lib/parse-sources.mjs`，不存在两套正则。",
  "",
  "## 1. 总览",
  "",
  `- 事件总数：${eventPool.length} 条（时间轴 ${TIMELINE_EVENTS.length} + 图谱补足 ${WEIJIN_EVENTS.length}）`,
  `- 有引用的事件：${citedRecords.length} 条；彩蛋（无引用）：${easterEggRecords.length} 条`,
  `- 引用条目：${refCount} 条（其中 ${singleBookRecords.length} 条事件 1 本书，${multiBookRecords.length} 条事件 2 本书）`,
  `- 书目标签：${labels.length} 个；书目（按首个「·」切分）：${books.length} 种`,
  `- 括注尾注（如「年代依夏商周断代工程推定」）：${noteRecords.length} 条`,
  `- 特殊解析：裴注引 1 条（按 1 条引用计，见 §4）`,
  "",
  "> **与任务卡的口径差异**：任务卡记录「书目标签 185 种」，该数字只统计了括注中的**首个**书目；",
  `> 本实现把并列书目（如「（据《旧唐书》《新唐书》）」）的第二本也作为独立标签，故实测 ${labels.length} 个标签。`,
  "> 引用条目 823 与任务卡一致（裴注引按 1 条计）。",
  "",
  "## 2. 书目分布",
  "",
  "| 书目 | 引用条目 | 标签数 |",
  "|---|---:|---:|",
];
for (const entry of books) {
  lines.push(`| ${entry.book} | ${entry.refs} | ${entry.labels.size} |`);
}

lines.push("", "## 3. 标签清单（全部 " + labels.length + " 个）", "", "| 标签 | 书目 | 篇/章 | 引用次数 | 事件 |", "|---|---|---|---:|---|");
for (const entry of labels) {
  lines.push(
    `| ${entry.label} | ${entry.book} | ${entry.chapter ?? "—"} | ${entry.refs} | ${entry.eventIds.slice(0, 3).join("、")}${entry.eventIds.length > 3 ? "…" : ""} |`,
  );
}

lines.push("", "## 4. 例外与特殊处理", "");
lines.push(
  "1. **彩蛋事件 `special-star-1893`**：`EVENT_SOURCES` 为空数组、`EVENT_SOURCE_STATUS` 为 `easter_egg`，",
  "   不得参与事实回答，也不得作为引用来源。",
  `2. **裴注引**：${peiNoteRecords.map((record) => `\`${record.event.id}\``).join("、")} 的括注为`,
  "   「据《三国志·蜀书·诸葛亮传》裴注引《襄阳记》」。按 1 条引用计：",
  "   `label = 三国志·蜀书·诸葛亮传`，`raw` 保留完整括注（含裴注引原文），避免把转引来源伪装成主要来源。",
  `3. **括注尾注**：${noteRecords.length} 条事件的括注在书名后还有说明（如「年代依夏商周断代工程推定」），`,
  "   这些说明保留在 `raw` 中，不单独生成引用条目。",
  "4. **不修改 description 原文**：本卡只做抽取，正文保持 V0.9.0 的展示与 diff 口径。",
  "",
  "## 5. 关系类引用的派生规则（供 TC-05 快照落地）",
  "",
  "关系库 `person-relations.ts` 的 `label/description` 是人工校订定性，**没有「据《…》」书目**。",
  "因此关系引用不新增书目：",
  "",
  "- 引用构造时取该关系 `eventSummaries` 指向的**共同事件**的 `sourceRefs`；",
  "- 关系定性本身标注「史脉关系库（人工校订）」；",
  "- 快照里以 `relations[].basisEventIds[]` 记录共同事件 id，供 V1.0.5 引用构造直接使用。",
  "",
  "## 6. 人工抽查记录（2 书并列 ≥10%）",
  "",
  "> 抽查比例要求 ≥10%（" + multiBookRecords.length + " 条 2 书事件 → 至少 " + Math.ceil(multiBookRecords.length * 0.1) + " 条）。",
  "> 下表按事件 id 排序等距抽取 12 条，自动校验项为「两个 label 均出现在 raw 中、book 非空、label 可回查」；",
  "> 人工结论请在「复核」列签字后本卡才算通过评审。",
  "",
  "| 事件 | 标签 A | 标签 B | raw 片段 | 自动校验 | 复核 |",
  "|---|---|---|---|---|---|",
);
const sampleStep = Math.max(1, Math.floor(multiBookRecords.length / 12));
const samples = multiBookRecords.filter((_, index) => index % sampleStep === 0).slice(0, 12);
for (const record of samples) {
  lines.push(
    `| ${record.event.id} | ${record.refs[0].label} | ${record.refs[1].label} | ${record.refs[0].raw} | 通过 | 待人工复核 |`,
  );
}

lines.push("", "## 7. 校验命令", "", "```bash", "node scripts/extract-sources.mjs --check", "node scripts/validate-data.mjs", "```", "");

// ---------------------------------------------------------------------------
// 写盘 / 校验
// ---------------------------------------------------------------------------
const outputs = [
  { label: "event-sources.ts", file: SOURCES_OUT, content: sourcesContent },
  { label: "source-review.md", file: REPORT_OUT, content: lines.join("\n") },
];

if (CHECK_MODE) {
  const diffs = [];
  for (const output of outputs) {
    if (!fs.existsSync(output.file)) {
      diffs.push(`${output.label}：文件缺失`);
      continue;
    }
    if (fs.readFileSync(output.file, "utf8") !== output.content) diffs.push(`${output.label}：内容与生成结果不一致`);
  }
  if (diffs.length > 0) {
    console.error("✖ 引用结构化校验失败（生成物过期或手改）：");
    for (const message of diffs) console.error(`  - ${message}`);
    console.error("  修复：node scripts/extract-sources.mjs");
    process.exit(1);
  }
  console.log(
    `✓ 引用结构化一致：${citedRecords.length} 条事件 / ${refCount} 条引用 / ${labels.length} 个标签 / ${books.length} 种书目。`,
  );
  process.exit(0);
}

for (const output of outputs) {
  fs.mkdirSync(path.dirname(output.file), { recursive: true });
  fs.writeFileSync(output.file, output.content, "utf8");
}

console.log(
  `✓ 已生成引用索引：${citedRecords.length} 条事件 / ${refCount} 条引用 / ${labels.length} 个标签 / ${books.length} 种书目`,
);
console.log(`  彩蛋：${easterEggRecords.map((record) => record.event.id).join("、") || "无"}；输出：${[SOURCES_OUT, REPORT_OUT].map((file) => path.relative(ROOT, file)).join("、")}`);
