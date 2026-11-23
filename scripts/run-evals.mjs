#!/usr/bin/env node
/**
 * 评测运行器（V1.0.1 / TC-09）。
 *
 * 用法：
 *   node scripts/run-evals.mjs --mode contract   # 本版唯一可用模式：校验 fixture 与 ID 解析
 *   node scripts/run-evals.mjs --mode live       # V1.0.3 起接真实问答；当前打印未实现并退出 0
 *
 * contract 模式只做离线校验，不调用 LLM、不访问网络：
 * 1. `evals/golden.v1.json` 通过 `evals/schema.json`（Ajv 2020-12）；
 * 2. 文件头绑定的 snapshot version/hash/counts 必须与当前快照完全一致；
 * 3. 每条用例的 person/event/era 引用都能在快照中解析（0 悬空）；
 * 4. 工具名、入参满足 `contracts/tools-v1.schema.json` 的 input schema；
 * 5. 动作类型在契约中为 available，target surface / 同页跨页判定与策略一致；
 * 6. 回答模式与缺失/拒答/澄清字段自洽，引用必须来自有据事件（彩蛋事件不得引用）；
 * 7. 负向自测：篡改任一引用 ID 后必须被同一套校验拦截（防止校验器形同虚设）。
 *
 * 退出码：0 = 通过；1 = 校验失败；2 = 参数错误。
 */
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

import { ROOT, BACKEND_DATA_DIR } from "./lib/load-ts-data.mjs";

const requireFromFrontend = createRequire(path.join(ROOT, "frontend", "package.json"));
const AjvModule = requireFromFrontend("ajv/dist/2020");
const Ajv2020 = AjvModule.default ?? AjvModule;

const EVALS_DIR = path.join(ROOT, "evals");
const CONTRACTS_DIR = path.join(ROOT, "contracts");
const GOLDEN_PATH = path.join(EVALS_DIR, "golden.v1.json");
const SCHEMA_PATH = path.join(EVALS_DIR, "schema.json");
const SNAPSHOT_PATH = path.join(BACKEND_DATA_DIR, "snapshot.v1.json");
const SNAPSHOT_META_PATH = path.join(BACKEND_DATA_DIR, "snapshot.meta.json");
const ACTION_POLICY_PATH = path.join(CONTRACTS_DIR, "action-policy.json");
const TOOLS_SCHEMA_PATH = path.join(CONTRACTS_DIR, "tools-v1.schema.json");

const args = process.argv.slice(2);
function readArg(name, fallback) {
  const index = args.indexOf(name);
  if (index === -1) return fallback;
  return args[index + 1] ?? fallback;
}

const mode = readArg("--mode", "contract");
if (!["contract", "live"].includes(mode)) {
  console.error(`✖ 未知 --mode：${mode}（只支持 contract / live）`);
  process.exit(2);
}

if (mode === "live") {
  console.log("○ live 模式未实现：V1.0.1 只提供 contract 骨架，真实评分在 V1.0.3 接入（退出码 0，避免 CI 红）。");
  process.exit(0);
}

// ---------------------------------------------------------------------------
// 读取文件
// ---------------------------------------------------------------------------
const readJson = (file) => JSON.parse(fs.readFileSync(file, "utf8"));

let golden;
let schema;
let snapshot;
let meta;
let actionPolicy;
let toolsSchema;
try {
  golden = readJson(GOLDEN_PATH);
  schema = readJson(SCHEMA_PATH);
  snapshot = readJson(SNAPSHOT_PATH);
  meta = readJson(SNAPSHOT_META_PATH);
  actionPolicy = readJson(ACTION_POLICY_PATH);
  toolsSchema = readJson(TOOLS_SCHEMA_PATH);
} catch (error) {
  console.error(`✖ 读取评测/快照/契约文件失败：${error.message}`);
  process.exit(1);
}

// ---------------------------------------------------------------------------
// schema 校验
// ---------------------------------------------------------------------------
const ajv = new Ajv2020({ strict: false, allErrors: true, validateFormats: false });
let validateGolden;
try {
  validateGolden = ajv.compile(schema);
} catch (error) {
  console.error(`✖ evals/schema.json 编译失败：${error.message}`);
  process.exit(1);
}
if (!validateGolden(golden)) {
  console.error("✖ evals/golden.v1.json 未通过 schema 校验：");
  for (const issue of validateGolden.errors ?? []) {
    console.error(`  - ${issue.instancePath || "/"} ${issue.message}`);
  }
  process.exit(1);
}

// ---------------------------------------------------------------------------
// 索引与工具入参校验器
// ---------------------------------------------------------------------------
const eventById = new Map(snapshot.events.map((event) => [event.event_id, event]));
const personById = new Map(snapshot.persons.map((person) => [person.person_id, person]));
const eraIds = new Set(snapshot.eras.map((era) => era.era_id));
const scopeIds = new Set(snapshot.scopes.map((scope) => scope.scope_id));
const groupIds = new Set(snapshot.groups.map((group) => group.group_id));
const dynastyNames = new Set(snapshot.events.map((event) => event.dynasty));
const allowedSurfaces = new Set(actionPolicy.surfaces ?? []);
const availableActions = new Set(
  Object.entries(actionPolicy.actions ?? {})
    .filter(([, entry]) => entry.availability === "available")
    .map(([type]) => type),
);
const policyByAction = actionPolicy.actions ?? {};

const toolInputValidators = new Map();
for (const tool of toolsSchema.tools ?? []) {
  const validate = ajv.compile(tool.input);
  toolInputValidators.set(tool.name, validate);
}

/** 两人关系索引：key = 两个 person_id 排序后拼接，value = 关系记录。 */
const relationByPair = new Map();
for (const relation of snapshot.relations) {
  const key = [relation.person_id_a, relation.person_id_b].sort().join("|");
  relationByPair.set(key, relation);
}

const surfaceFromRoute = (route) => {
  const cleaned = String(route ?? "").split("?")[0].split("#")[0].replace(/\/+$/, "") || "/";
  if (cleaned === "/timeline") return "timeline";
  if (cleaned === "/graph") return "graph";
  if (cleaned === "/ask") return "ask";
  return null;
};

const REQUIRED_CATEGORIES = [
  "bc_year",
  "ambiguous_name",
  "insufficient",
  "cross_dynasty",
  "relation",
  "comparison",
  "out_of_scope",
  "easter_egg",
  "graph_only_event",
  "multi_turn",
  "event_person_link",
  "ui_action",
];

// ---------------------------------------------------------------------------
// 核心校验：输入 cases，返回错误数组（负向自测复用）
// ---------------------------------------------------------------------------
function validateCases(cases, { checkHeader = false } = {}) {
  const errors = [];
  const fail = (caseId, message) => errors.push(`${caseId}：${message}`);

  if (checkHeader) {
    const expectedHash = `sha256:${meta.content_hash}`;
    if (golden.version !== "golden.v1") fail("header", `version 必须是 golden.v1，实际 ${golden.version}`);
    if (golden.snapshot?.version !== snapshot.snapshot_version) {
      fail("header", `snapshot.version 过期：用例 ${golden.snapshot?.version} / 当前 ${snapshot.snapshot_version}`);
    }
    if (golden.snapshot?.hash !== expectedHash) {
      fail("header", `snapshot.hash 过期：用例 ${golden.snapshot?.hash} / 当前 ${expectedHash}`);
    }
    const counts = meta.counts ?? {};
    for (const key of Object.keys(counts)) {
      if (golden.snapshot?.counts?.[key] !== counts[key]) {
        fail("header", `counts.${key} 过期：用例 ${golden.snapshot?.counts?.[key]} / 当前 ${counts[key]}`);
      }
    }
  }

  // 用例数量、ID 唯一、类别计数
  if (cases.length !== 30) fail("header", `用例数量必须为 30，实际 ${cases.length}`);
  const ids = new Set();
  const categoryCounts = Object.fromEntries(REQUIRED_CATEGORIES.map((name) => [name, 0]));
  for (const testCase of cases) {
    if (ids.has(testCase.id)) fail(testCase.id, "用例 id 重复");
    ids.add(testCase.id);
    if (!(testCase.category in categoryCounts)) {
      fail(testCase.id, `未知类别 ${testCase.category}`);
    } else {
      categoryCounts[testCase.category] += 1;
    }
  }
  for (const category of REQUIRED_CATEGORIES) {
    const declared = golden.category_counts?.[category];
    if (categoryCounts[category] < 1) {
      fail("header", `类别 ${category} 至少需要 1 条用例`);
    }
    if (typeof declared === "number" && categoryCounts[category] !== declared) {
      fail("header", `类别 ${category} 计数与 category_counts 不符：${categoryCounts[category]} vs ${declared}`);
    }
  }

  for (const testCase of cases) {
    const id = testCase.id;
    const context = testCase.context ?? {};
    const expected = testCase.expected ?? {};

    // 1) context ID 可解析
    const contextSurface = surfaceFromRoute(context.route);
    if (context.person_id && !personById.has(context.person_id)) {
      fail(id, `context.person_id 悬空：${context.person_id}`);
    }
    if (context.event_id && !eventById.has(context.event_id)) {
      fail(id, `context.event_id 悬空：${context.event_id}`);
    }
    if (context.era_id && !eraIds.has(context.era_id) && !scopeIds.has(context.era_id) && !groupIds.has(context.era_id)) {
      fail(id, `context.era_id 无法解析为 era/scope/group：${context.era_id}`);
    }
    if (context.dynasty && !dynastyNames.has(context.dynasty)) {
      fail(id, `context.dynasty 不在快照朝代集合：${context.dynasty}`);
    }

    // 2) 工具调用：名字存在 + 入参满足契约
    for (const call of expected.tool_calls ?? []) {
      const validateInput = toolInputValidators.get(call.name);
      if (!validateInput) {
        fail(id, `未知工具 ${call.name}`);
        continue;
      }
      if (!validateInput(call.args ?? {})) {
        fail(id, `工具 ${call.name} 入参不合法：${ajv.errorsText(validateInput.errors)}`);
      }
    }

    // 3) 实体 / 事件 / 关系引用可解析
    for (const personId of expected.entity_ids ?? []) {
      if (!personById.has(personId)) fail(id, `entity_id 悬空：${personId}`);
    }
    for (const eventId of expected.event_ids ?? []) {
      if (!eventById.has(eventId)) fail(id, `event_id 悬空：${eventId}`);
    }
    if (expected.relation_pair) {
      const [left, right] = expected.relation_pair;
      if (!personById.has(left) || !personById.has(right)) {
        fail(id, `relation_pair 含悬空人物：${left} / ${right}`);
      } else {
        const relation = relationByPair.get([left, right].sort().join("|"));
        if (expected.relation_label === null) {
          if (relation) fail(id, `relation_label=null 但快照存在该关系（${relation.label}）`);
        } else if (!relation) {
          fail(id, `expected.relation_label=${expected.relation_label} 但快照无此二人关系`);
        } else if (relation.label !== expected.relation_label) {
          fail(id, `关系定性不符：期望 ${expected.relation_label} / 快照 ${relation.label}`);
        }
      }
    }

    // 4) 动作契约：必须 available，surface / 同页判定与策略一致
    const actionTypes = expected.action_types ?? [];
    const surfaces = expected.action_target_surfaces;
    const decisions = expected.action_decisions;
    if (surfaces && surfaces.length !== actionTypes.length) {
      fail(id, "action_target_surfaces 与 action_types 数量不一致");
    }
    if (decisions && decisions.length !== actionTypes.length) {
      fail(id, "action_decisions 与 action_types 数量不一致");
    }
    actionTypes.forEach((actionType, index) => {
      const policy = policyByAction[actionType];
      if (!policy) {
        fail(id, `未知动作类型 ${actionType}`);
        return;
      }
      if (!availableActions.has(actionType)) {
        fail(id, `golden 期望了非 available 动作：${actionType}`);
      }
      const expectedSurface = surfaces?.[index];
      if (expectedSurface !== undefined) {
        if (!allowedSurfaces.has(expectedSurface)) {
          fail(id, `surface 非法：${expectedSurface}`);
        } else if (policy.surface !== expectedSurface) {
          fail(id, `动作 ${actionType} 的 surface 应为 ${policy.surface}，实际期望 ${expectedSurface}`);
        }
      }
      const expectedDecision = decisions?.[index];
      if (expectedDecision !== undefined) {
        const actualDecision =
          policy.surface !== null && policy.surface === contextSurface ? "auto" : "confirm";
        if (expectedDecision !== actualDecision) {
          fail(id, `动作 ${actionType} 同页判定应为 ${actualDecision}，实际期望 ${expectedDecision}`);
        }
      }
    });

    // 5) 回答模式自洽
    const answerMode = expected.answer_mode;
    const candidates = expected.clarification_candidates ?? [];
    for (const personId of candidates) {
      if (!personById.has(personId)) fail(id, `clarification 候选悬空：${personId}`);
    }
    if (answerMode === null) {
      if (candidates.length < 2) fail(id, "clarification 用例至少需要 2 个候选");
      if ((expected.facts ?? []).length > 0) fail(id, "clarification 用例不应包含 facts");
    } else if (candidates.length > 0) {
      fail(id, "非 clarification 用例不应带 clarification_candidates");
    }
    if (answerMode === "grounded" && (expected.facts ?? []).length === 0) {
      fail(id, "grounded 回答必须至少 1 条 fact");
    }
    if (answerMode === "insufficient" && (expected.missing ?? []).length === 0) {
      fail(id, "insufficient 回答必须说明 missing");
    }
    if (answerMode === "refusal" && !expected.reason_code) {
      fail(id, "refusal 回答必须提供 reason_code");
    }
    if (answerMode !== "refusal" && expected.reason_code) {
      fail(id, "非 refusal 回答不应带 reason_code");
    }

    // 6) facts：事件存在；要求引用时必须有结构化出处；彩蛋不得作为史实
    let hasCitedFact = false;
    for (const fact of expected.facts ?? []) {
      for (const eventId of fact.event_ids ?? []) {
        const event = eventById.get(eventId);
        if (!event) {
          fail(id, `fact 引用悬空事件：${eventId}`);
          continue;
        }
        if (event.is_special || event.source_status === "easter_egg") {
          fail(id, `fact 不得引用彩蛋事件：${eventId}`);
          continue;
        }
        const cited = event.source_status === "cited" && (event.source_refs ?? []).length > 0;
        if (fact.citation_required && !cited) {
          fail(id, `fact 要求引用但事件无结构化出处：${eventId}`);
        }
        if (cited) hasCitedFact = true;
      }
    }
    if (expected.citation_required && !hasCitedFact) {
      fail(id, "citation_required=true 但没有任何带结构化出处的 fact");
    }
    if (answerMode === "grounded" && expected.citation_required === false && (expected.facts ?? []).length === 0) {
      fail(id, "grounded 回答缺少 fact");
    }

    // 7) 仅图谱事件 / 彩蛋排除断言
    for (const eventId of expected.graph_only_event_ids ?? []) {
      const event = eventById.get(eventId);
      if (!event) {
        fail(id, `graph_only_event_id 悬空：${eventId}`);
      } else if (event.surface?.timeline !== false || event.surface?.graph !== true) {
        fail(id, `${eventId} 不是「仅图谱」事件（surface=${JSON.stringify(event.surface)}）`);
      }
    }
    for (const eventId of expected.excluded_event_ids ?? []) {
      const event = eventById.get(eventId);
      if (!event) {
        fail(id, `excluded_event_id 悬空：${eventId}`);
      } else if (!event.is_special) {
        fail(id, `${eventId} 不是彩蛋事件，不应出现在 excluded_event_ids`);
      }
    }
  }

  return errors;
}

// ---------------------------------------------------------------------------
// 正式校验 + 负向自测
// ---------------------------------------------------------------------------
const errors = validateCases(golden.cases, { checkHeader: true });

if (errors.length > 0) {
  console.error(`✖ evals contract 校验失败，共 ${errors.length} 项：`);
  for (const message of errors) console.error(`  - ${message}`);
  process.exit(1);
}

const negativeSource = structuredClone(golden.cases[0]);
negativeSource.expected.entity_ids = ["p-dangling-0000"];
const negativeErrors = validateCases([negativeSource]);
if (negativeErrors.length === 0) {
  console.error("✖ 负向自测失败：篡改 entity_id 后校验器未拦截，说明引用校验失效。");
  process.exit(1);
}

const negativeEventSource = structuredClone(golden.cases[0]);
negativeEventSource.expected.event_ids = ["event-dangling"];
const negativeEventErrors = validateCases([negativeEventSource]);
if (negativeEventErrors.length === 0) {
  console.error("✖ 负向自测失败：篡改 event_id 后校验器未拦截。");
  process.exit(1);
}

const counts = meta.counts ?? {};
console.log("✓ evals contract 模式通过：");
console.log(`  - ${golden.cases.length}/${golden.cases.length} 用例通过 schema 与语义校验`);
console.log(`  - ${REQUIRED_CATEGORIES.length} 类覆盖达标：${REQUIRED_CATEGORIES.map((name) => `${name}=${golden.category_counts[name]}`).join(" / ")}`);
console.log(`  - 0 悬空 person / event / era ID；工具入参与 action-policy 一致`);
console.log(`  - 负向自测：篡改 entity_id / event_id 均被拦截`);
console.log(`  - 快照 ${snapshot.snapshot_version}（sha256:${meta.content_hash.slice(0, 12)}…，${counts.events} 事件 / ${counts.persons} 人物）`);
