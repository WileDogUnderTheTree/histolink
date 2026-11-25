#!/usr/bin/env node
/**
 * 人物主数据生成器（V1.0.1 / TC-02）。
 *
 * 输入（全部只读）：
 * - frontend/data/timeline-events.ts / weijin-events.ts：事件与参与者
 * - frontend/data/timeline-participants.ts：参与姓名索引（与事件双向一致）
 * - frontend/data/person-graph.ts：人物图分期 / 简阅断代、别名（数量随数据自动变化）
 * - frontend/data/person-overrides.ts：人工裁决层（唯一允许手改）
 * - frontend/data/ingested-graph-data.generated.ts：图谱扩充生成物（人物 ID 固定表等）
 *
 * 输出（生成物，禁止手改）：
 * - frontend/data/persons.generated.ts
 * - frontend/data/person-aliases.ts
 * - frontend/data/locks/person-ids.lock.json
 * - docs/person-same-name-report.md
 *
 * 用法：
 *   node scripts/build-persons.mjs          # 生成并写盘
 *   node scripts/build-persons.mjs --check  # 只校验是否与磁盘一致（CI 用；无写操作）
 *
 * 确定性约定：输出不含时间戳；所有排序使用码位比较（不依赖 ICU 排序规则）；
 * 同一输入连续执行两次字节级一致。
 */
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { createRequire } from "node:module";
import { ROOT, DATA_DIR, loadTsData, loadDataModule } from "./lib/load-ts-data.mjs";
import { sameText } from "./lib/text-compare.mjs";

const CHECK_MODE = process.argv.includes("--check");
const requireFromFrontend = createRequire(path.join(ROOT, "frontend", "package.json"));
const { pinyin } = requireFromFrontend("pinyin-pro");

const PERSONS_OUT = path.join(DATA_DIR, "persons.generated.ts");
const ALIASES_OUT = path.join(DATA_DIR, "person-aliases.ts");
const LOCK_OUT = path.join(DATA_DIR, "locks", "person-ids.lock.json");
const REPORT_OUT = path.join(ROOT, "docs", "person-same-name-report.md");

/** 码位排序，避免 localeCompare 在不同 ICU 版本下漂移。 */
const compareText = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
const compareEvents = (a, b) => a.year - b.year || compareText(a.id, b.id);

const errors = [];
const fail = (message) => errors.push(message);

// ---------------------------------------------------------------------------
// 读取输入
// ---------------------------------------------------------------------------
const data = loadTsData();
const {
  eventPool,
  eventIndex,
  PERSON_GRAPH_ERAS,
  PERSON_GRAPH_SCOPES,
  ERA_TO_SCOPE,
  PERSON_NAME_ALIASES,
} = data;
const overrides = loadDataModule("person-overrides");
const {
  PERSON_SPLIT_RULES,
  PERSON_ALIAS_OVERRIDES,
  PERSON_REVIEW_NOTES,
  PERSON_ALIAS_MERGE_REVIEWER,
} = overrides;

/**
 * 图谱扩充生成物里的「人物 ID 固定表」（V1.0.5.4 起）。
 *
 * 值形如 `p-xizhou-zhougongdan-01` / `p-xia-xiajie-01`：可读、稳定、跨批次不变。
 * 固定 ID 优先于自动 hash ID；未列入的人物仍走原有 `<romanized>-<hash>` 规则。
 */
const INGESTED_PERSON_ID_PINS = loadDataModule("ingested-graph-data.generated").INGESTED_PERSON_ID_PINS ?? {};

/** 姓名 → 事件列表。 */
const eventsByName = new Map();
for (const event of eventPool) {
  for (const name of new Set((event.participants ?? []).map((item) => item.trim()).filter(Boolean))) {
    const bucket = eventsByName.get(name) ?? [];
    bucket.push(event);
    eventsByName.set(name, bucket);
  }
}

/** 姓名 → eraId[]（节点在哪些图里出现）。 */
const erasOfName = new Map();
for (const era of PERSON_GRAPH_ERAS) {
  for (const node of era.graph.nodes) {
    const bucket = erasOfName.get(node.name) ?? [];
    bucket.push({ id: era.id, eventIds: new Set(node.relatedEvents.map((ref) => ref.id)) });
    erasOfName.set(node.name, bucket);
  }
}
const scopesOfName = new Map();
for (const scope of PERSON_GRAPH_SCOPES) {
  for (const node of scope.graph.nodes) {
    const bucket = scopesOfName.get(node.name) ?? [];
    bucket.push({ id: scope.id, eventIds: new Set(node.relatedEvents.map((ref) => ref.id)) });
    scopesOfName.set(node.name, bucket);
  }
}

/** 姓名 → 别名列表（PERSON_NAME_ALIASES 反查）。 */
const aliasesByTarget = new Map();
for (const [alias, target] of Object.entries(PERSON_NAME_ALIASES)) {
  const bucket = aliasesByTarget.get(target) ?? [];
  bucket.push(alias);
  aliasesByTarget.set(target, bucket);
}
for (const aliases of aliasesByTarget.values()) aliases.sort(compareText);


// ---------------------------------------------------------------------------
// 生成草稿（同名拆分在这里发生）
// ---------------------------------------------------------------------------
const splitRulesByName = new Map();
for (const rule of PERSON_SPLIT_RULES) {
  if (splitRulesByName.has(rule.displayName)) {
    fail(`person-overrides：拆分规则重复（${rule.displayName}）`);
    continue;
  }
  splitRulesByName.set(rule.displayName, rule);
}

/**
 * 「异名同一人」：别名本身也作为事件参与者姓名出现时，把两条姓名记录合并。
 *
 * 数据层证据（别名表）已经明确「别名 → 本名」，若不合并，同一历史人物会拿到两个
 * person_id，正是 V1.0 要修掉的 P0 问题。合并是**显式**的：事件取并集、别名保留，
 * 明细写入同名报告，评审可在报告中逐条复核。
 */
const mergedNameToTarget = new Map();
for (const [alias, target] of Object.entries(PERSON_NAME_ALIASES)) {
  if (!eventsByName.has(alias) || alias === target) continue;
  if (splitRulesByName.has(alias) || splitRulesByName.has(target)) {
    fail(
      `person-overrides：别名「${alias}」本身也是参与者姓名，但该姓名已被拆分规则占用；请先处理拆分规则`,
    );
    continue;
  }
  if (!eventsByName.has(target)) {
    fail(`person-overrides：别名「${alias}」指向的「${target}」不是事件参与者姓名，无法合并`);
    continue;
  }
  mergedNameToTarget.set(alias, target);
}
const mergedNamesByTarget = new Map();
for (const [alias, target] of mergedNameToTarget) {
  const bucket = mergedNamesByTarget.get(target) ?? [];
  bucket.push(alias);
  mergedNamesByTarget.set(target, bucket);
}
for (const names of mergedNamesByTarget.values()) names.sort(compareText);

const drafts = [];

const pushDraft = ({ displayName, events, split, aliases, sourceNames }) => {
  const sorted = [...events].sort(compareEvents);
  const dynasties = [];
  for (const event of sorted) {
    if (!dynasties.includes(event.dynasty)) dynasties.push(event.dynasty);
  }
  const assignedIds = new Set(sorted.map((event) => event.id));

  /** 在细览分期 / 简阅断代里，只要有一个姓名的节点命中被分配的事件，即视为成员。 */
  const collectMembership = (index) => {
    const ids = new Set();
    for (const name of sourceNames) {
      for (const entry of index.get(name) ?? []) {
        if ([...entry.eventIds].some((id) => assignedIds.has(id))) ids.add(entry.id);
      }
    }
    return [...ids].sort(compareText);
  };

  const eraIds = collectMembership(erasOfName);
  const scopeIds = collectMembership(scopesOfName);
  drafts.push({
    displayName,
    events: sorted,
    split,
    aliases: aliases ?? [],
    firstYear: sorted[0].year,
    lastYear: sorted[sorted.length - 1].year,
    primaryDynasty: split?.primaryDynasty ?? sorted[sorted.length - 1].dynasty,
    dynasties,
    eraIds,
    scopeIds,
    idTag: split?.idTag ?? null,
    disambiguator: {
      period: split?.period ?? sorted[sorted.length - 1].dynasty,
      role: split?.role ?? null,
    },
  });
};

for (const [displayName, ownEvents] of eventsByName) {
  // 被合并的别名姓名不单独生成记录。
  if (mergedNameToTarget.has(displayName)) continue;

  const rule = splitRulesByName.get(displayName);
  if (!rule) {
    const mergedNames = mergedNamesByTarget.get(displayName) ?? [];
    const eventIds = new Set(ownEvents.map((event) => event.id));
    for (const mergedName of mergedNames) {
      for (const event of eventsByName.get(mergedName) ?? []) eventIds.add(event.id);
    }
    pushDraft({
      displayName,
      events: [...eventIds].map((eventId) => eventIndex.get(eventId)),
      split: null,
      aliases: aliasesByTarget.get(displayName) ?? [],
      sourceNames: [displayName, ...mergedNames],
    });
    continue;
  }

  // 拆分覆盖校验：同一姓名的每条事件必须恰好归属一个候选。
  const covered = new Map();
  for (const candidate of rule.candidates) {
    for (const eventId of candidate.eventIds) {
      if (covered.has(eventId)) {
        fail(`person-overrides：${displayName} 的事件 ${eventId} 被多个候选重复声明`);
      }
      covered.set(eventId, candidate);
    }
  }
  for (const event of ownEvents) {
    if (!covered.has(event.id)) {
      fail(
        `person-overrides：${displayName} 的事件 ${event.id}（${event.year} ${event.dynasty}）没有归入任何候选，请补裁决`,
      );
    }
  }
  for (const [eventId, candidate] of covered) {
    if (!eventIndex.has(eventId)) {
      fail(`person-overrides：${displayName} 候选「${candidate.idTag}」引用了不存在的事件 ${eventId}`);
    } else if (!ownEvents.some((event) => event.id === eventId)) {
      fail(`person-overrides：${displayName} 候选「${candidate.idTag}」的事件 ${eventId} 未把该人物列为参与者`);
    }
  }
  if (errors.length > 0) continue;

  for (const candidate of rule.candidates) {
    const assigned = ownEvents.filter((event) => candidate.eventIds.includes(event.id));
    const aliasList = candidate.aliases ?? aliasesByTarget.get(displayName) ?? [];
    if (!candidate.aliases && aliasList.length > 0) {
      fail(
        `person-overrides：${displayName} 已被拆分，但其别名（${aliasList.join("、")}）未指定归属；请在候选的 aliases 字段显式给出`,
      );
      continue;
    }
    pushDraft({
      displayName,
      events: assigned,
      split: candidate,
      aliases: [...aliasList].sort(compareText),
      sourceNames: [displayName],
    });
  }
}

// 未被事件引用、但被裁决规则登记的姓名（数据变更后的残留规则）。
for (const displayName of splitRulesByName.keys()) {
  if (!eventsByName.has(displayName)) {
    fail(`person-overrides：拆分规则「${displayName}」在当前数据中没有任何事件，请删除或修正`);
  }
}

// ---------------------------------------------------------------------------
// ID 生成
// ---------------------------------------------------------------------------
const romanize = (text) => {
  const pieces = pinyin(text, { toneType: "none", type: "array", v: true });
  const joined = pieces.join("").toLowerCase().replace(/[^a-z0-9]/g, "");
  return joined || "unknown";
};

const identityHash = (draft, salt) =>
  crypto
    .createHash("sha1")
    .update(
      [draft.displayName, draft.firstYear, draft.primaryDynasty, draft.idTag ?? "", salt].join("|"),
    )
    .digest("hex")
    .slice(0, 4);

const identityFingerprint = (draft) =>
  crypto
    .createHash("sha1")
    .update(
      [
        draft.displayName,
        draft.firstYear,
        draft.lastYear,
        draft.primaryDynasty,
        draft.idTag ?? "",
        draft.events.map((event) => event.id).join(","),
      ].join("|"),
    )
    .digest("hex")
    .slice(0, 8);

// 先给每份草稿一个稳定排序，再按「同基名冲突」逐个加盐，保证跨机器一致。
drafts.sort(
  (a, b) =>
    compareText(a.displayName, b.displayName) ||
    compareText(a.idTag ?? "", b.idTag ?? "") ||
    a.firstYear - b.firstYear ||
    compareText(a.primaryDynasty, b.primaryDynasty),
);

const usedBase = new Map();
const pinnedIds = new Set();
const draftNames = new Set(drafts.map((draft) => draft.displayName));
for (const [displayName, personId] of Object.entries(INGESTED_PERSON_ID_PINS)) {
  if (!draftNames.has(displayName)) {
    fail(
      `图谱扩充生成物：人物 ID 固定「${displayName}」→「${personId}」在当前数据中不存在（请检查 docs 数据或删除该固定）`,
    );
    continue;
  }
  if (pinnedIds.has(personId)) {
    fail(`图谱扩充生成物：人物 ID 固定值重复：${personId}`);
    continue;
  }
  pinnedIds.add(personId);
}
for (const draft of drafts) {
  draft.romanized = romanize(draft.displayName);
  const pinned = INGESTED_PERSON_ID_PINS[draft.displayName];
  if (pinned) {
    draft.id = pinned;
    draft.suffixHash = pinned.slice(pinned.lastIndexOf("-") + 1);
    continue;
  }
  const base = draft.idTag ? `p-${draft.romanized}-${draft.idTag}` : `p-${draft.romanized}`;
  const taken = usedBase.get(base) ?? new Set();

  let salt = 0;
  let suffix = identityHash(draft, salt);
  while (taken.has(suffix)) {
    salt += 1;
    suffix = identityHash(draft, salt);
  }
  taken.add(suffix);
  usedBase.set(base, taken);

  draft.suffixHash = suffix;
  draft.id = `${base}-${suffix}`;
}

const persons = drafts
  .map((draft) => ({
    id: draft.id,
    displayName: draft.displayName,
    romanized: draft.romanized,
    disambiguator: draft.disambiguator,
    aliases: draft.aliases,
    primaryDynasty: draft.primaryDynasty,
    dynasties: draft.dynasties,
    eraIds: draft.eraIds,
    scopeIds: draft.scopeIds,
    eventIds: draft.events.map((event) => event.id),
    firstYear: draft.firstYear,
    lastYear: draft.lastYear,
    status: "active",
  }))
  .sort((a, b) => compareText(a.id, b.id));

// ---------------------------------------------------------------------------
// 别名表
// ---------------------------------------------------------------------------
const personsByName = new Map();
for (const person of persons) {
  const bucket = personsByName.get(person.displayName) ?? [];
  bucket.push(person);
  personsByName.set(person.displayName, bucket);
}

const personIdByDisplayName = new Map();
for (const [displayName, bucket] of personsByName) {
  if (bucket.length === 1) personIdByDisplayName.set(displayName, bucket[0].id);
}

const aliasEntries = [];
for (const [alias, target] of Object.entries(PERSON_NAME_ALIASES)) {
  const override = PERSON_ALIAS_OVERRIDES[alias];
  let personId = override;

  if (!personId) {
    const targetPersons = personsByName.get(target) ?? [];
    if (targetPersons.length === 0) {
      fail(`别名「${alias}」指向的人物「${target}」不存在`);
      continue;
    }
    if (targetPersons.length > 1) {
      fail(`别名「${alias}」指向已拆分人物「${target}」，请在 PERSON_ALIAS_OVERRIDES 里指定 person_id`);
      continue;
    }
    personId = targetPersons[0].id;
  } else if (!persons.some((person) => person.id === personId)) {
    fail(`别名「${alias}」的人工覆盖指向不存在的 person_id：${personId}`);
    continue;
  }

  // 别名不能与另一个真实人物的 displayName 冲突（否则搜索会串人）。
  const collision = personsByName.get(alias) ?? [];
  if (collision.some((person) => person.id !== personId)) {
    fail(
      `别名「${alias}」与真实人物记录冲突：${collision.map((person) => person.id).join("、")}，请在裁决层显式处理`,
    );
    continue;
  }
  aliasEntries.push([alias, personId]);
}

for (const alias of Object.keys(PERSON_ALIAS_OVERRIDES)) {
  if (!(alias in PERSON_NAME_ALIASES)) {
    fail(`PERSON_ALIAS_OVERRIDES 含未登记的别名：${alias}`);
  }
}
aliasEntries.sort((a, b) => compareText(a[0], b[0]));

// ---------------------------------------------------------------------------
// 失败即中止：不写出半成品
// ---------------------------------------------------------------------------
if (errors.length > 0) {
  console.error("✖ 人物主数据生成失败：");
  for (const message of errors) console.error(`  - ${message}`);
  process.exit(1);
}

// ---------------------------------------------------------------------------
// 输出内容
// ---------------------------------------------------------------------------
const GENERATED_HEADER = `/**
 * 自动生成，禁止手改（scripts/build-persons.mjs）。
 *
 * 数据源：frontend/data/timeline-events.ts、weijin-events.ts、timeline-participants.ts、person-graph.ts
 * 人工裁决：frontend/data/person-overrides.ts
 * 重新生成：node scripts/build-persons.mjs     校验：node scripts/build-persons.mjs --check
 */
`;

const personsContent =
  GENERATED_HEADER +
  `import type { PersonRecord } from "./person-types";\n\n` +
  `export const PERSONS: readonly PersonRecord[] = [\n` +
  persons.map((person) => `  ${JSON.stringify(person)},`).join("\n") +
  `\n];\n`;

const aliasesContent =
  `/**
 * 自动生成，禁止手改（scripts/build-persons.mjs）。
 *
 * 来源：frontend/data/person-graph.ts 的 PERSON_NAME_ALIASES（66 条），
 * 按 person_id 归一；人工覆盖见 frontend/data/person-overrides.ts 的 PERSON_ALIAS_OVERRIDES。
 * 重新生成：node scripts/build-persons.mjs     校验：node scripts/build-persons.mjs --check
 */
` +
  `export const PERSON_ALIAS_TO_ID: Readonly<Record<string, string>> = {\n` +
  aliasEntries.map(([alias, personId]) => `  ${JSON.stringify(alias)}: ${JSON.stringify(personId)},`).join("\n") +
  `\n};\n`;

const lockContent =
  JSON.stringify(
    {
      schema_version: "person-ids.v1",
      person_count: persons.length,
      persons: persons.map((person) => {
        const draft = drafts.find((item) => item.id === person.id);
        return {
          id: person.id,
          displayName: person.displayName,
          firstYear: person.firstYear,
          identityHash: identityFingerprint(draft),
        };
      }),
    },
    null,
    2,
  ) + "\n";

/** 同名组（拆分后同一 displayName 出现多次）。 */
const sameNameGroups = [...personsByName.entries()]
  .filter(([, bucket]) => bucket.length > 1)
  .sort((a, b) => compareText(a[0], b[0]));

const reportLines = [
  "# 人物同名报告（V1.0.1 / TC-02）",
  "",
  "> 本文件由 `scripts/build-persons.mjs` 生成，随人物主数据一起提交；",
  "> 人工裁决入口是 `frontend/data/person-overrides.ts`，改完重新生成即可。",
  "> 本报告覆盖全部同名组与已复核的「提及但同一人」记录，供评审留档。",
  "",
  "## 1. 总览",
  "",
  `- 事件池：${eventPool.length} 条（时间轴 ${data.TIMELINE_EVENTS.length} + 图谱补足 ${data.WEIJIN_EVENTS.length}）`,
  `- 去重姓名：${eventsByName.size} 个`,
  `- 异名同一人合并：${mergedNameToTarget.size} 条`,
  `- 同名拆分：${persons.length - (eventsByName.size - mergedNameToTarget.size)} 条`,
  `- 人物记录：${persons.length} 条（= ${eventsByName.size} 个姓名 − ${mergedNameToTarget.size} 条异名合并 + ${persons.length - (eventsByName.size - mergedNameToTarget.size)} 条同名拆分）`,
  `- 全局别名：${aliasEntries.length} 条`,
  `- 同名组：${sameNameGroups.length} 组`,
  "",
  "## 2. 同名组与裁决",
  "",
  "| displayName | 候选数 | 年份跨度 | 朝代 | 消歧副标题 | 结论 | 责任人 |",
  "|---|---:|---|---|---|---|---|",
];

for (const [displayName, bucket] of sameNameGroups) {
  const rule = splitRulesByName.get(displayName);
  const ordered = [...bucket].sort((a, b) => a.firstYear - b.firstYear);
  const years = ordered.map((person) => `${person.firstYear}—${person.lastYear}`).join(" / ");
  const dynasties = [...new Set(bucket.flatMap((person) => person.dynasties))].join("、");
  const labels = ordered.map((person) => `${person.disambiguator.period}·${person.disambiguator.role ?? "身份未详"}`).join("<br>");
  reportLines.push(
    `| ${displayName} | ${bucket.length} | ${years} | ${dynasties} | ${labels} | ${rule ? rule.ruling : "**缺少裁决，需人工补充**"} | ${rule ? rule.reviewer : "—"} |`,
  );
}

if (sameNameGroups.length === 0) {
  reportLines.push("| — | 0 | — | — | — | 当前数据没有同名组 | — |");
}

reportLines.push("", "## 3. 异名同一人合并（别名本身也是事件参与者姓名）", "");
if (mergedNameToTarget.size === 0) {
  reportLines.push("- 无");
} else {
  reportLines.push(
    "| 别名姓名 | 本名 | 别名姓名事件 | 本名事件 | 合并后 person_id | 依据 | 责任人 |",
    "|---|---|---|---|---|---|---|",
  );
  for (const [alias, target] of [...mergedNameToTarget.entries()].sort((a, b) => compareText(a[0], b[0]))) {
    const aliasEvents = (eventsByName.get(alias) ?? []).map((event) => event.id).join("、");
    const targetEvents = (eventsByName.get(target) ?? []).map((event) => event.id).join("、");
    const personId = personIdByDisplayName.get(target) ?? "—";
    reportLines.push(
      `| ${alias} | ${target} | ${aliasEvents} | ${targetEvents} | ${personId} | 别名表（PERSON_NAME_ALIASES）已确认同一人，事件取并集 | ${PERSON_ALIAS_MERGE_REVIEWER} |`,
    );
  }
}

reportLines.push("", "## 4. 已复核但不拆分", "");
for (const note of PERSON_REVIEW_NOTES) {
  reportLines.push(`- **${note.displayName}**：${note.note}（复核人：${note.reviewer}）`);
}
if (PERSON_REVIEW_NOTES.length === 0) reportLines.push("- 无");

reportLines.push(
  "",
  "## 5. 检查项",
  "",
  "- 每个姓名至少映射 1 个 `person_id`，每个人物至少关联 1 条事件；",
  "- `person_id` 全局唯一，正则 `^p-[a-z0-9]+(?:-[a-z0-9]+)*-[0-9a-f]{4}$`；",
  "- 同名组必须逐组裁决，不允许静默合并；拆分后每条记录生卒年区间与朝代由显式事件划分得出；",
  "- 异名同一人（别名本身也是参与者姓名）按别名表合并，事件取并集并保留别名；",
  "- 别名全部解析到唯一 `person_id`，且不与真实人物记录冲突；",
  "- 锁文件 `frontend/data/locks/person-ids.lock.json` 固定 `id ↔ displayName/firstYear/identityHash`，重跑无 diff。",
  "",
);

const reportContent = reportLines.join("\n");

// ---------------------------------------------------------------------------
// 写盘或校验
// ---------------------------------------------------------------------------
const outputs = [
  { label: "persons.generated.ts", file: PERSONS_OUT, content: personsContent },
  { label: "person-aliases.ts", file: ALIASES_OUT, content: aliasesContent },
  { label: "person-ids.lock.json", file: LOCK_OUT, content: lockContent },
  { label: "person-same-name-report.md", file: REPORT_OUT, content: reportContent },
];

if (CHECK_MODE) {
  const diffs = [];
  for (const output of outputs) {
    if (!fs.existsSync(output.file)) {
      diffs.push(`${output.label}：文件缺失`);
      continue;
    }
    const current = fs.readFileSync(output.file, "utf8");
    if (!sameText(current, output.content)) diffs.push(`${output.label}：内容与生成结果不一致`);
  }
  if (diffs.length > 0) {
    console.error("✖ 人物主数据校验失败（生成物过期或手改）：");
    for (const message of diffs) console.error(`  - ${message}`);
    console.error("  修复：node scripts/build-persons.mjs");
    process.exit(1);
  }
  console.log(`✓ 人物主数据一致：${persons.length} 条记录 / ${aliasEntries.length} 条别名 / ${sameNameGroups.length} 组同名。`);
  process.exit(0);
}

for (const output of outputs) {
  fs.mkdirSync(path.dirname(output.file), { recursive: true });
  fs.writeFileSync(output.file, output.content, "utf8");
}

const splitCount = persons.length - (eventsByName.size - mergedNameToTarget.size);
console.log(
  `✓ 已生成 ${persons.length} 条人物记录（${eventsByName.size} 个姓名 − ${mergedNameToTarget.size} 条异名合并 + ${splitCount} 条同名拆分）`,
);
console.log(`  别名：${aliasEntries.length} 条；同名组：${sameNameGroups.length} 组；无分期人物（仅简阅）：${persons.filter((p) => p.eraIds.length === 0).length} 条`);
console.log(`  输出：${[PERSONS_OUT, ALIASES_OUT, LOCK_OUT, REPORT_OUT].map((file) => path.relative(ROOT, file)).join("、")}`);
