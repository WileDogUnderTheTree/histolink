#!/usr/bin/env node
/**
 * 图谱数据入库辅助脚本（V1.0.5.4）。
 *
 * 由 `backend/scripts/ingest_graph_data.py` 调用，**只读**，不写任何文件：
 * - `index`    输出「基准数据层索引」JSON：去掉上一次入库生成物（ingested-graph-data.generated.ts）
 *              之后的基础事件 / 图谱分期 / 关系对 / 朝代顺序 / 别名，供 Python 侧做去重合并；
 * - `romanize` 从 stdin 读 JSON 字符串数组，用 pinyin-pro 输出 `{ 原文: 罗马化 }`，
 *              与 `scripts/build-persons.mjs` 使用同一套规则，保证 person_id 可读且稳定。
 *
 * 之所以单独提供 `index`：Python 脚本无法直接加载 TypeScript 数据模块，而 dedupe 需要
 * 完整的事件标题 / 参与者 / 关系对 / 分期信息。把「TS → JSON」收敛到这一个脚本，
 * 避免在两处各写一套解析逻辑。
 */
import { createRequire } from "node:module";
import path from "node:path";

import { ROOT, DATA_DIR, loadDataModule, loadTsData } from "./lib/load-ts-data.mjs";

const requireFromFrontend = createRequire(path.join(ROOT, "frontend", "package.json"));
const { pinyin } = requireFromFrontend("pinyin-pro");

/** 与 build-persons.mjs 完全一致的罗马化规则（小写、无音调、仅 a-z0-9）。 */
function romanize(text) {
  const pieces = pinyin(text, { toneType: "none", type: "array", v: true });
  const joined = pieces.join("").toLowerCase().replace(/[^a-z0-9]/g, "");
  return joined || "unknown";
}

const EMPTY_INGESTED = {
  INGESTED_EVENT_RECORDS: [],
  INGESTED_EVENT_PARTICIPANTS: {},
  INGESTED_IMPORTANCE_OVERRIDES: {},
  INGESTED_PERSON_ALIASES: {},
  INGESTED_PERSON_ID_PINS: {},
  INGESTED_RELATIONS: [],
  INGESTED_RELATION_PATCHES: [],
  INGESTED_GRAPH_ERAS: [],
  INGESTED_KEY_FIGURES: {},
};

/** 读取生成物；尚未生成时返回空对象（首次入库 / 全新仓库）。 */
function loadIngestedModule() {
  try {
    return { ...EMPTY_INGESTED, ...loadDataModule("ingested-graph-data.generated") };
  } catch {
    return EMPTY_INGESTED;
  }
}

const command = process.argv[2];

if (command === "romanize") {
  const chunks = [];
  process.stdin.setEncoding("utf8");
  process.stdin.on("data", (chunk) => chunks.push(chunk));
  process.stdin.on("end", () => {
    const names = JSON.parse(chunks.join("") || "[]");
    if (!Array.isArray(names)) throw new Error("romanize 需要 JSON 字符串数组");
    const result = {};
    for (const name of names) {
      if (typeof name === "string") result[name] = romanize(name);
    }
    process.stdout.write(JSON.stringify(result));
  });
} else if (command === "index") {
  const data = loadTsData();
  const ingested = loadIngestedModule();
  const {
    TIMELINE_EVENTS,
    WEIJIN_EVENTS,
    DYNASTY_START_YEARS,
    DYNASTY_GROUPS,
    PERSON_GRAPH_ERAS,
    PERSON_GRAPH_SCOPES,
    PERSON_RELATIONS,
    PERSON_NAME_ALIASES,
    eventPool,
  } = data;

  const ingestedEventIds = new Set((ingested.INGESTED_EVENT_RECORDS ?? []).map((event) => event.id));
  const ingestedEraIds = new Set((ingested.INGESTED_GRAPH_ERAS ?? []).map((era) => era.id));
  const participantAdditions = ingested.INGESTED_EVENT_PARTICIPANTS ?? {};
  /** 重要度覆盖记录为 `[base, applied]`，baseline 用于无损还原基础数据。 */
  const importanceOverrides = ingested.INGESTED_IMPORTANCE_OVERRIDES ?? {};
  const ingestedRelationKeys = new Set(
    (ingested.INGESTED_RELATIONS ?? []).map((relation) =>
      [relation.a, relation.b].sort().join("__"),
    ),
  );
  const relationPatchKeys = new Set(
    (ingested.INGESTED_RELATION_PATCHES ?? []).map((patch) => patch.pairKey),
  );
  const relationPatchSummaries = new Map(
    (ingested.INGESTED_RELATION_PATCHES ?? []).map((patch) => [
      patch.pairKey,
      patch.eventSummaries ?? {},
    ]),
  );
  const ingestedAliases = new Set(Object.keys(ingested.INGESTED_PERSON_ALIASES ?? {}));

  /** 还原「基准事件池」：去掉生成事件，扣掉参与者增补与重要度覆盖。 */
  const baseEvent = (event) => {
    if (ingestedEventIds.has(event.id)) return null;
    const additions = participantAdditions[event.id] ?? [];
    const baseParticipants = (event.participants ?? []).filter((name) => !additions.includes(name));
    const override = importanceOverrides[event.id];
    const baseImportance = override ? override[0] : event.importance;
    const { importance: _merged, ...rest } = event;
    return {
      ...rest,
      ...(baseImportance ? { importance: baseImportance } : {}),
      participants: baseParticipants,
    };
  };

  const events = eventPool
    .map(baseEvent)
    .filter((event) => event !== null)
    .sort((left, right) => (left.id < right.id ? -1 : left.id > right.id ? 1 : 0));

  const relationships = PERSON_RELATIONS.filter(
    (relation) => !ingestedRelationKeys.has([relation.a, relation.b].sort().join("__")),
  ).map((relation) => {
    const pairKey = [relation.a, relation.b].sort().join("__");
    const patched = relationPatchSummaries.get(pairKey) ?? {};
    // 还原手写基线的事件简述：扣掉入库生成物追加的补丁键。
    const baseSummaryKeys = Object.keys(relation.eventSummaries ?? {}).filter(
      (eventId) => !(eventId in patched),
    );
    return {
      a: relation.a,
      b: relation.b,
      label: relation.label,
      event_summaries: baseSummaryKeys.sort(),
    };
  });

  const aliases = Object.fromEntries(
    Object.entries(PERSON_NAME_ALIASES).filter(([alias]) => !ingestedAliases.has(alias)),
  );

  const result = {
    schema_version: "graph-ingest-index.v1",
    generated_at: new Date().toISOString(),
    events,
    relations: relationships,
    eras: PERSON_GRAPH_ERAS.filter((era) => !ingestedEraIds.has(era.id)).map((era) => ({
      id: era.id,
      label: era.label,
      dynasties: [...era.dynasties],
      default_center_person_id: era.defaultCenterPersonId,
    })),
    scopes: PERSON_GRAPH_SCOPES.map((scope) => ({
      id: scope.id,
      label: scope.label,
      default_center_person_id: scope.defaultCenterPersonId,
    })),
    groups: DYNASTY_GROUPS.map((group) => ({
      id: group.id,
      label: group.label,
      dynasties: [...group.dynasties],
      start_year: group.startYear,
    })),
    dynasty_order: Object.entries(DYNASTY_START_YEARS)
      .sort((left, right) => left[1] - right[1])
      .map(([dynasty]) => dynasty),
    dynasty_start_years: DYNASTY_START_YEARS,
    aliases,
    ingested: {
      event_ids: [...ingestedEventIds],
      era_ids: [...ingestedEraIds],
      relation_pairs: [...ingestedRelationKeys],
      relation_patch_pairs: [...relationPatchKeys],
    },
    counts: {
      events: events.length,
      relations: relationships.length,
      weijin_events: WEIJIN_EVENTS.length,
    },
    paths: {
      data_dir: DATA_DIR,
      root: ROOT,
    },
  };
  process.stdout.write(JSON.stringify(result));
} else {
  console.error("用法：node scripts/ingest-data-helper.mjs <index|romanize>");
  process.exit(2);
}