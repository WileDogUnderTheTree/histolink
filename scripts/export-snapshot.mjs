#!/usr/bin/env node
/**
 * 数据快照导出（V1.0.1 / TC-05）。
 *
 * 把前端 TS 数据模块导出为后端可读的单一 JSON 快照，前后端从此读同一份数据。
 *
 * 输入（只读，均在前端数据层）：
 *   timeline-events.ts / weijin-events.ts / timeline-participants.ts / person-graph.ts /
 *   person-relations.ts / persons.ts / event-sources.ts
 * 输出（生成物，禁止手改）：
 *   backend/data/snapshot.v1.json
 *   backend/data/snapshot.meta.json
 *   frontend/data/locks/event-ids.lock.json
 *
 * 确定性约定：
 * - 快照 JSON 不含时间戳，所有数组 / 对象键排序固定；
 * - `snapshot.meta.json` 的 `generated_at` 是唯一每次生成都会变化的字段，`--check` 会忽略它；
 * - `content_hash` = snapshot.v1.json 字节内容的 sha256；`snapshot_version` 由 hash 派生（内容寻址）。
 *
 * 用法：
 *   node scripts/export-snapshot.mjs          # 生成
 *   node scripts/export-snapshot.mjs --check  # 只校验（生成物过期 / 手改即失败）
 */
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { BACKEND_DATA_DIR, DATA_DIR, ROOT, loadTsData, loadDataModule } from "./lib/load-ts-data.mjs";

const CHECK_MODE = process.argv.includes("--check");

const SNAPSHOT_OUT = path.join(BACKEND_DATA_DIR, "snapshot.v1.json");
const META_OUT = path.join(BACKEND_DATA_DIR, "snapshot.meta.json");
const EVENT_LOCK_OUT = path.join(DATA_DIR, "locks", "event-ids.lock.json");

const compareText = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
const compareEvents = (a, b) => a.year - b.year || compareText(a.id, b.id);

const errors = [];
const fail = (message) => errors.push(message);

// ---------------------------------------------------------------------------
// 读取输入
// ---------------------------------------------------------------------------
const data = loadTsData();
const {
  TIMELINE_EVENTS,
  WEIJIN_EVENTS,
  PERSON_GRAPH_ERAS,
  PERSON_GRAPH_SCOPES,
  PERSON_RELATIONS,
  DYNASTY_GROUPS,
  eventPool,
} = data;
const { PERSONS } = loadDataModule("persons");
const { PERSON_ALIAS_TO_ID } = loadDataModule("person-aliases");
const { EVENT_SOURCES, EVENT_SOURCE_STATUS } = loadDataModule("event-sources");

const TIMELINE_IDS = new Set(TIMELINE_EVENTS.map((event) => event.id));
const WEIJIN_IDS = new Set(WEIJIN_EVENTS.map((event) => event.id));

// ---------------------------------------------------------------------------
// 姓名 → person_id 解析（含别名 / 异名合并 / 同名拆分）
// ---------------------------------------------------------------------------
const personsByAnyName = new Map();
for (const person of PERSONS) {
  for (const name of [person.displayName, ...person.aliases]) {
    const bucket = personsByAnyName.get(name) ?? [];
    bucket.push(person);
    personsByAnyName.set(name, bucket);
  }
}
const personById = new Map(PERSONS.map((person) => [person.id, person]));

/** 事件内解析参与者姓名：必须在「该姓名候选」里恰好一个记录包含这条事件。 */
function resolveParticipant(name, eventId) {
  const candidates = personsByAnyName.get(name) ?? [];
  const matched = candidates.filter((person) => person.eventIds.includes(eventId));
  if (matched.length === 1) return matched[0].id;
  if (matched.length === 0) {
    fail(`事件 ${eventId} 的参与者「${name}」没有可解析的 person_id`);
    return null;
  }
  fail(`事件 ${eventId} 的参与者「${name}」解析到多个 person_id：${matched.map((person) => person.id).join("、")}`);
  return null;
}

/** 关系两端姓名解析：用共同事件锁定候选；无法唯一确定即失败。 */
function resolveRelationEnd(name, sharedEventIds) {
  const candidates = personsByAnyName.get(name) ?? [];
  if (candidates.length === 1) return candidates[0].id;
  const matched = candidates.filter((person) =>
    person.eventIds.some((eventId) => sharedEventIds.has(eventId)),
  );
  if (matched.length === 1) return matched[0].id;
  fail(
    `关系人物「${name}」无法唯一解析：候选 ${candidates.map((person) => person.id).join("、")} / 共同事件 ${[
      ...sharedEventIds,
    ].join("、")}`,
  );
  return null;
}

// ---------------------------------------------------------------------------
// events[]
// ---------------------------------------------------------------------------
/** 出现在任意人物图（细览 18 期 + 简阅 7 组）中的事件 id。 */
const graphEventIds = new Set();
for (const graphEntry of [...PERSON_GRAPH_ERAS, ...PERSON_GRAPH_SCOPES]) {
  for (const node of graphEntry.graph.nodes) {
    for (const reference of node.relatedEvents) graphEventIds.add(reference.id);
  }
  for (const edge of graphEntry.graph.edges) {
    for (const reference of edge.sharedEvents) graphEventIds.add(reference.id);
  }
}

const events = [...eventPool]
  .sort((a, b) => compareText(a.id, b.id))
  .map((event) => {
    const personIds = [];
    for (const name of event.participants ?? []) {
      const personId = resolveParticipant(name, event.id);
      if (personId && !personIds.includes(personId)) personIds.push(personId);
    }
    const sourceStatus = EVENT_SOURCE_STATUS[event.id] ?? "missing";
    return {
      event_id: event.id,
      title: event.title,
      dynasty: event.dynasty,
      year: event.year,
      ...(event.date ? { date: event.date } : {}),
      description: event.description,
      ...(event.importance ? { importance: event.importance } : {}),
      is_special: event.isSpecial === true,
      participants: [...(event.participants ?? [])],
      person_ids: personIds.sort(compareText),
      source_refs: EVENT_SOURCES[event.id] ?? [],
      source_status: sourceStatus,
      surface: {
        timeline: TIMELINE_IDS.has(event.id),
        graph: graphEventIds.has(event.id),
      },
    };
  });

// ---------------------------------------------------------------------------
// persons[]
// ---------------------------------------------------------------------------
const persons = [...PERSONS]
  .sort((a, b) => compareText(a.id, b.id))
  .map((person) => ({
    person_id: person.id,
    display_name: person.displayName,
    romanized: person.romanized,
    disambiguator: person.disambiguator,
    aliases: [...person.aliases],
    primary_dynasty: person.primaryDynasty,
    dynasties: [...person.dynasties],
    era_ids: [...person.eraIds],
    scope_ids: [...person.scopeIds],
    event_ids: [...person.eventIds],
    first_year: person.firstYear,
    last_year: person.lastYear,
    status: person.status,
    ...(person.mergedInto ? { merged_into: person.mergedInto } : {}),
  }));

// ---------------------------------------------------------------------------
// relations[]
// ---------------------------------------------------------------------------
const relations = [...PERSON_RELATIONS]
  .map((record) => {
    const sharedEventIds = new Set(Object.keys(record.eventSummaries ?? {}));
    const personIdA = resolveRelationEnd(record.a, sharedEventIds);
    const personIdB = resolveRelationEnd(record.b, sharedEventIds);
    const pairKey = [record.a, record.b].sort(compareText).join("__");
    return {
      pair_key: pairKey,
      person_id_a: personIdA,
      person_id_b: personIdB,
      label: record.label,
      ...(record.description ? { description: record.description } : {}),
      event_summaries: record.eventSummaries ?? {},
      basis_event_ids: [...sharedEventIds].sort(compareText),
      attribution: "史脉关系库（人工校订）",
    };
  })
  .sort((a, b) => compareText(a.pair_key, b.pair_key));

// ---------------------------------------------------------------------------
// eras[] / scopes[]：图节点与边按 person_id 去重合并
// ---------------------------------------------------------------------------
function mapGraph(graph, label) {
  const nodeMap = new Map();
  for (const node of graph.nodes) {
    const candidates = personsByAnyName.get(node.name) ?? [];
    const matched = candidates.filter((person) => person.eventIds.includes(node.relatedEvents[0]?.id ?? ""));
    let person = matched[0];
    if (!person && candidates.length === 1) person = candidates[0];
    if (!person) {
      // 图节点名没有直接命中事件时，退回到「姓名 + 该期 era/scope 成员」解析。
      const fallback = candidates.find(
        (candidate) =>
          (candidate.eraIds.includes(label.id) || candidate.scopeIds.includes(label.id)) &&
          node.relatedEvents.some((reference) => candidate.eventIds.includes(reference.id)),
      );
      person = fallback;
    }
    if (!person) {
      fail(`${label.kind}「${label.id}」的节点「${node.name}」无法解析到 person_id`);
      continue;
    }
    if (!nodeMap.has(person.id)) {
      nodeMap.set(person.id, {
        person_id: person.id,
        name: person.displayName,
        dynasty: node.dynasty,
      });
    }
  }

  const edgeMap = new Map();
  for (const edge of graph.edges) {
    const sourceId = resolveGraphEndpoint(edge.source, edge, label);
    const targetId = resolveGraphEndpoint(edge.target, edge, label);
    if (!sourceId || !targetId) continue;
    if (sourceId === targetId) {
      // 异名同一人合并后可能出现自环（同一事件里两个名字都指向同一人），直接丢弃。
      continue;
    }
    const [a, b] = [sourceId, targetId].sort(compareText);
    const key = `${a}__${b}`;
    const existing = edgeMap.get(key) ?? { person_id_a: a, person_id_b: b, weight: 0, shared_event_ids: [] };
    existing.weight += edge.weight;
    for (const reference of edge.sharedEvents) {
      if (!existing.shared_event_ids.includes(reference.id)) existing.shared_event_ids.push(reference.id);
    }
    edgeMap.set(key, existing);
  }
  for (const entry of edgeMap.values()) {
    entry.shared_event_ids.sort(compareText);
    // 合并后按「共同事件去重数」重算权重，避免异名合并导致重复计数。
    entry.weight = entry.shared_event_ids.length;
  }

  return {
    nodes: [...nodeMap.values()].sort((a, b) => compareText(a.person_id, b.person_id)),
    edges: [...edgeMap.values()].sort((a, b) => compareText(a.person_id_a + "__" + a.person_id_b, b.person_id_a + "__" + b.person_id_b)),
  };
}

function resolveGraphEndpoint(name, edge, label) {
  const candidates = personsByAnyName.get(name) ?? [];
  const matched = candidates.filter((person) =>
    edge.sharedEvents.some((reference) => person.eventIds.includes(reference.id)),
  );
  if (matched.length === 1) return matched[0].id;
  if (candidates.length === 1) return candidates[0].id;
  fail(`${label.kind}「${label.id}」的边 ${edge.id} 端点「${name}」无法唯一解析`);
  return null;
}

const eras = PERSON_GRAPH_ERAS.map((era) => ({
  era_id: era.id,
  label: era.label,
  dynasties: [...era.dynasties],
  default_center_person_id: resolveDefaultCenter(era.defaultCenterPersonId, era.id, "era"),
  graph: mapGraph(era.graph, { kind: "细览分期", id: era.id }),
}));

function resolveDefaultCenter(name, eraOrScopeId, kind) {
  const candidates = personsByAnyName.get(name) ?? [];
  const byMembership = candidates.find(
    (person) => person.eraIds.includes(eraOrScopeId) || person.scopeIds.includes(eraOrScopeId),
  );
  const person = byMembership ?? (candidates.length === 1 ? candidates[0] : undefined);
  if (!person) {
    fail(`${kind}「${eraOrScopeId}」的默认中心「${name}」无法解析到 person_id`);
    return null;
  }
  return person.id;
}

const scopes = PERSON_GRAPH_SCOPES.map((scope) => ({
  scope_id: scope.id,
  label: scope.label,
  default_center_person_id: resolveDefaultCenter(scope.defaultCenterPersonId, scope.id, "scope"),
  graph: mapGraph(scope.graph, { kind: "简阅断代", id: scope.id }),
}));

// ---------------------------------------------------------------------------
// groups[] / aliases[] / indexes
// ---------------------------------------------------------------------------
const groups = DYNASTY_GROUPS.map((group) => ({
  group_id: group.id,
  label: group.label,
  dynasties: [...group.dynasties],
  start_year: group.startYear,
}));

const aliases = Object.entries(PERSON_ALIAS_TO_ID)
  .map(([alias, personId]) => ({ alias, person_id: personId }))
  .sort((a, b) => compareText(a.alias, b.alias));

const nameToPersons = {};
for (const person of persons) {
  const bucket = nameToPersons[person.display_name] ?? [];
  bucket.push(person.person_id);
  nameToPersons[person.display_name] = bucket;
}
for (const [name, ids] of Object.entries(nameToPersons)) {
  if (new Set(ids).size !== ids.length) fail(`nameToPersons：「${name}」有重复 person_id`);
  nameToPersons[name] = [...new Set(ids)].sort(compareText);
}

const personToEras = {};
for (const person of persons) personToEras[person.person_id] = [...person.era_ids];

const eventToDynasty = {};
for (const event of events) eventToDynasty[event.event_id] = event.dynasty;

const eraMembers = {};
for (const era of eras) eraMembers[era.era_id] = era.graph.nodes.map((node) => node.person_id);

const indexes = {
  name_to_persons: nameToPersons,
  person_to_eras: personToEras,
  event_to_dynasty: eventToDynasty,
  era_members: eraMembers,
};

// ---------------------------------------------------------------------------
// 组装 & 一致性自检
// ---------------------------------------------------------------------------
if (errors.length > 0) {
  console.error("✖ 快照导出失败：");
  for (const message of errors) console.error(`  - ${message}`);
  process.exit(1);
}

const snapshot = {
  schema_version: "snapshot.v1",
  counts: {
    events: events.length,
    persons: persons.length,
    relations: relations.length,
    eras: eras.length,
    scopes: scopes.length,
    groups: groups.length,
    aliases: aliases.length,
  },
  events,
  persons,
  relations,
  eras,
  scopes,
  groups,
  aliases,
  indexes,
};

const baseContent = JSON.stringify(snapshot, null, 2) + "\n";
const baseHash = crypto.createHash("sha256").update(baseContent, "utf8").digest("hex");
const snapshotVersion = `v1-${baseHash.slice(0, 12)}`;
const snapshotWithVersion = { ...snapshot, snapshot_version: snapshotVersion };
const snapshotContentFinal = JSON.stringify(snapshotWithVersion, null, 2) + "\n";
// content_hash = 对「写入磁盘的 snapshot.v1.json 字节」的 sha256，供后端启动校验；版本由内容派生。
const finalHash = crypto.createHash("sha256").update(snapshotContentFinal, "utf8").digest("hex");
const finalVersion = snapshotVersion;

const meta = {
  schema_version: "snapshot.v1",
  snapshot_version: finalVersion,
  generated_at: new Date().toISOString(),
  content_hash: finalHash,
  counts: snapshot.counts,
  license: "CC BY-NC-SA 4.0",
  attribution: "数据依据 shiji-kb（CC BY-NC-SA 4.0）与史脉人工校订；非商用。",
  files: {
    snapshot: "snapshot.v1.json",
    size_bytes: Buffer.byteLength(snapshotContentFinal, "utf8"),
  },
};

const eventLock = {
  schema_version: "event-ids.v1",
  event_count: events.length,
  events: events.map((event) => ({
    id: event.event_id,
    title: event.title,
    dynasty: event.dynasty,
    year: event.year,
    surface: event.surface,
  })),
};

const outputs = [
  {
    label: "snapshot.v1.json",
    file: SNAPSHOT_OUT,
    content: snapshotContentFinal,
    allowTimestampVariance: false,
  },
  {
    label: "snapshot.meta.json",
    file: META_OUT,
    content: JSON.stringify(meta, null, 2) + "\n",
    allowTimestampVariance: true,
  },
  {
    label: "event-ids.lock.json",
    file: EVENT_LOCK_OUT,
    content: JSON.stringify(eventLock, null, 2) + "\n",
    allowTimestampVariance: false,
  },
];

if (CHECK_MODE) {
  const diffs = [];
  for (const output of outputs) {
    if (!fs.existsSync(output.file)) {
      diffs.push(`${output.label}：文件缺失`);
      continue;
    }
    const current = fs.readFileSync(output.file, "utf8");
    if (current === output.content) continue;
    if (output.allowTimestampVariance) {
      try {
        const currentJson = JSON.parse(current);
        const expectedJson = JSON.parse(output.content);
        const { generated_at: _currentGeneratedAt, ...currentRest } = currentJson;
        const { generated_at: _expectedGeneratedAt, ...expectedRest } = expectedJson;
        if (JSON.stringify(currentRest) === JSON.stringify(expectedRest)) continue;
      } catch {
        // 落到下面的差异报告
      }
    }
    diffs.push(`${output.label}：内容与生成结果不一致`);
  }
  if (diffs.length > 0) {
    console.error("✖ 快照校验失败（生成物过期或手改）：");
    for (const message of diffs) console.error(`  - ${message}`);
    console.error("  修复：node scripts/export-snapshot.mjs");
    process.exit(1);
  }
  console.log(
    `✓ 快照一致：${snapshot.counts.events} 事件 / ${snapshot.counts.persons} 人物 / ${snapshot.counts.relations} 关系 / ${snapshot.counts.eras} 期 / ${snapshot.counts.scopes} 组（${finalVersion}）`,
  );
  process.exit(0);
}

for (const output of outputs) {
  fs.mkdirSync(path.dirname(output.file), { recursive: true });
  fs.writeFileSync(output.file, output.content, "utf8");
}

console.log(
  `✓ 已生成快照 ${finalVersion}：${snapshot.counts.events} 事件 / ${snapshot.counts.persons} 人物 / ${snapshot.counts.relations} 关系 / ${snapshot.counts.eras} 期 / ${snapshot.counts.scopes} 断代 / ${snapshot.counts.aliases} 别名（${meta.files.size_bytes} bytes）`,
);
console.log(
  `  输出：${[SNAPSHOT_OUT, META_OUT, EVENT_LOCK_OUT].map((file) => path.relative(ROOT, file)).join("、")}`,
);
