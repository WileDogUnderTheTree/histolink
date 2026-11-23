#!/usr/bin/env node
/**
 * 契约测试（V1.0.1 / TC-04）：Node 侧校验 JSON Schema、动作策略覆盖与样例 payload。
 *
 * 覆盖内容：
 * 1. 三份生成物可解析，OpenAPI 为 3.1、info.version=1.0，必备路径/模型齐全；
 * 2. 动作 schema 的枚举 / surface / 可用性与 `contracts/action-policy.json` 完全一致；
 * 3. tools schema 恰好 8 个工具，入参/出参均为合法 JSON Schema；
 * 4. `contracts/samples/*.json` 全部通过对应 schema 校验（请求 / 回答 / 错误 / 澄清 / 动作）。
 *
 * 用法：node scripts/validate-contract.mjs
 */
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { ROOT } from "./lib/load-ts-data.mjs";

const CONTRACTS_DIR = path.join(ROOT, "contracts");
const SAMPLES_DIR = path.join(CONTRACTS_DIR, "samples");
const requireFromFrontend = createRequire(path.join(ROOT, "frontend", "package.json"));
const AjvModule = requireFromFrontend("ajv/dist/2020");
const Ajv2020 = AjvModule.default ?? AjvModule;

const errors = [];
const fail = (message) => errors.push(message);
const readJson = (file) => JSON.parse(fs.readFileSync(file, "utf8"));

// 报告 §5.4 冻结清单。
const EXPECTED_AVAILABLE = [
  "timeline.focus_event",
  "timeline.focus_dynasty",
  "graph.focus_person",
  "graph.focus_relation",
  "ask.suggest",
];
const EXPECTED_PLANNED = [
  "timeline.highlight_events",
  "graph.highlight_persons",
  "open.event_card",
  "open.person_card",
];
const EXPECTED_SURFACES = ["timeline", "graph", "ask"];
const EXPECTED_PATHS = [
  "/api/health",
  "/api/meta",
  "/api/entities/person/{person_id}",
  "/api/entities/event/{event_id}",
  "/api/entities/persons",
  "/api/search/events",
  "/api/agent/ask",
];
const EXPECTED_MODELS = [
  "AskRequest",
  "AnswerEnvelope",
  "ErrorEnvelope",
  "UIAction",
  "Clarification",
  "MetaResponse",
];
const EXPECTED_TOOLS = [
  "resolve_entity",
  "search_events",
  "get_event",
  "get_person",
  "get_person_events",
  "get_relation",
  "get_era_graph",
  "timeline_span",
];

// ---------------------------------------------------------------------------
// 1. 文件存在与解析
// ---------------------------------------------------------------------------
const FILES = {
  openapi: path.join(CONTRACTS_DIR, "api-v1.openapi.json"),
  actions: path.join(CONTRACTS_DIR, "actions-v1.schema.json"),
  tools: path.join(CONTRACTS_DIR, "tools-v1.schema.json"),
  policy: path.join(CONTRACTS_DIR, "action-policy.json"),
};
const parsed = {};
for (const [key, file] of Object.entries(FILES)) {
  if (!fs.existsSync(file)) {
    fail(`缺少契约文件：${path.relative(ROOT, file)}`);
    continue;
  }
  try {
    parsed[key] = readJson(file);
  } catch (error) {
    fail(`${path.relative(ROOT, file)} 不是合法 JSON：${error.message}`);
  }
}

// ---------------------------------------------------------------------------
// 2. OpenAPI 结构
// ---------------------------------------------------------------------------
const openapi = parsed.openapi;
if (openapi) {
  if (!String(openapi.openapi ?? "").startsWith("3.1")) fail(`OpenAPI 版本必须是 3.1.x，实际 ${openapi.openapi}`);
  if (openapi.info?.version !== "1.0") fail(`OpenAPI info.version 必须是 "1.0"，实际 ${openapi.info?.version}`);
  for (const apiPath of EXPECTED_PATHS) {
    if (!openapi.paths?.[apiPath]) fail(`OpenAPI 缺少路径 ${apiPath}`);
  }
  for (const model of EXPECTED_MODELS) {
    if (!openapi.components?.schemas?.[model]) fail(`OpenAPI components.schemas 缺少 ${model}`);
  }
  const askOperation = openapi.paths?.["/api/agent/ask"]?.post;
  if (!askOperation) fail("OpenAPI 缺少 POST /api/agent/ask");
  else if (!askOperation.requestBody?.content?.["application/json"]?.schema) {
    fail("POST /api/agent/ask 缺少 JSON requestBody schema");
  }
}

// ---------------------------------------------------------------------------
// 3. 动作 schema + 策略覆盖
// ---------------------------------------------------------------------------
const actions = parsed.actions;
const policy = parsed.policy;
if (actions && policy) {
  const enumTypes = [...(actions["x-action-types"] ?? [])].sort();
  const policyTypes = Object.keys(policy.actions ?? {}).sort();
  if (JSON.stringify(enumTypes) !== JSON.stringify(policyTypes)) {
    fail(`动作枚举与 action-policy 键不一致：enum=${enumTypes.join(",")} policy=${policyTypes.join(",")}`);
  }
  const expectedAll = [...EXPECTED_AVAILABLE, ...EXPECTED_PLANNED].sort();
  if (JSON.stringify(enumTypes) !== JSON.stringify(expectedAll)) {
    fail(`动作枚举与报告 §5.4 冻结清单不一致：${enumTypes.join(",")}`);
  }
  const surfaces = [...(actions["x-surfaces"] ?? [])].sort();
  if (JSON.stringify(surfaces) !== JSON.stringify([...EXPECTED_SURFACES].sort())) {
    fail(`动作 schema 的 x-surfaces 必须为 ${EXPECTED_SURFACES.join("/")}`);
  }
  if (JSON.stringify([...(policy.surfaces ?? [])].sort()) !== JSON.stringify([...EXPECTED_SURFACES].sort())) {
    fail(`action-policy.surfaces 必须为 ${EXPECTED_SURFACES.join("/")}`);
  }
  for (const [actionType, entry] of Object.entries(policy.actions ?? {})) {
    const label = `策略 ${actionType}`;
    if (!["available", "planned"].includes(entry.availability)) fail(`${label}：availability 非法（${entry.availability}）`);
    if (actions["x-availability"]?.[actionType] !== entry.availability) {
      fail(`${label}：与 x-availability 不一致（${actions["x-availability"]?.[actionType]} vs ${entry.availability}）`);
    }
    if (entry.availability === "available") {
      if (!EXPECTED_AVAILABLE.includes(actionType)) fail(`${label}：available 不在冻结可用集合中`);
      if (!surfaces.includes(entry.surface)) fail(`${label}：surface 非法（${entry.surface}）`);
      if (entry.auto !== "same_page_only") fail(`${label}：V1.0 可用动作只允许 same_page_only，实际 ${entry.auto}`);
    } else {
      if (!EXPECTED_PLANNED.includes(actionType)) fail(`${label}：planned 不在冻结暂缓集合中`);
      if (entry.surface !== null && !surfaces.includes(entry.surface)) fail(`${label}：surface 非法（${entry.surface}）`);
    }
    if (actions["x-action-surface"]?.[actionType] !== entry.surface) {
      fail(`${label}：surface 与 x-action-surface 不一致`);
    }
    if (!String(entry.since ?? "").startsWith("1.0.")) fail(`${label}：since 版本非法`);
  }
  if (!actions.$defs?.UIActionType) fail("动作 schema 缺少 UIActionType 定义");
  if (!actions.$defs?.UIActionTarget) fail("动作 schema 缺少 UIActionTarget 定义");
}

// ---------------------------------------------------------------------------
// 4. 工具 schema
// ---------------------------------------------------------------------------
let ajv = null;
try {
  ajv = new Ajv2020({ strict: false, allErrors: true, validateFormats: false });
} catch (error) {
  fail(`无法初始化 Ajv：${error.message}`);
}

const tools = parsed.tools;
if (tools) {
  const names = (tools.tools ?? []).map((tool) => tool.name);
  if (JSON.stringify([...names].sort()) !== JSON.stringify([...EXPECTED_TOOLS].sort())) {
    fail(`工具清单不一致：${names.join(",")}`);
  }
  if (new Set(names).size !== names.length) fail("工具名重复");
  for (const tool of tools.tools ?? []) {
    for (const key of ["input", "output"]) {
      if (!tool[key]) {
        fail(`工具 ${tool.name} 缺少 ${key} schema`);
        continue;
      }
      try {
        ajv?.compile(tool[key]);
      } catch (error) {
        fail(`工具 ${tool.name} 的 ${key} 不是合法 JSON Schema：${error.message}`);
      }
    }
  }
  if (tools.$schema !== "https://json-schema.org/draft/2020-12/schema") fail("tools schema 必须声明 draft 2020-12");
}

// ---------------------------------------------------------------------------
// 5. 样例 payload
// ---------------------------------------------------------------------------
function validateAgainstOpenApi(modelName, sample, sampleName) {
  if (!openapi || !ajv) return;
  const spec = { ...openapi, $id: "https://histolink.local/contracts/api-v1.openapi.json" };
  if (!ajv.getSchema(spec.$id)) ajv.addSchema(spec);
  const schema = { $ref: `${spec.$id}#/components/schemas/${modelName}` };
  let validate;
  try {
    validate = ajv.compile(schema);
  } catch (error) {
    fail(`无法编译 ${modelName} schema：${error.message}`);
    return;
  }
  if (!validate(sample)) {
    fail(`${sampleName} 未通过 ${modelName} 校验：${ajv.errorsText(validate.errors)}`);
  }
}

function validateAgainstActions(sample, sampleName) {
  if (!actions || !ajv) return;
  const schema = { ...actions };
  delete schema.$id;
  let validate;
  try {
    validate = ajv.compile(schema);
  } catch (error) {
    fail(`无法编译动作 schema：${error.message}`);
    return;
  }
  if (!validate(sample)) fail(`${sampleName} 未通过动作 schema 校验：${ajv.errorsText(validate.errors)}`);
}

const samples = [
  { file: "ask-request.json", validator: (sample) => validateAgainstOpenApi("AskRequest", sample, "ask-request.json") },
  { file: "answer-grounded.json", validator: (sample) => validateAgainstOpenApi("AnswerEnvelope", sample, "answer-grounded.json") },
  { file: "error.json", validator: (sample) => validateAgainstOpenApi("ErrorEnvelope", sample, "error.json") },
  { file: "clarification.json", validator: (sample) => validateAgainstOpenApi("AnswerEnvelope", sample, "clarification.json") },
  { file: "ui-action.json", validator: (sample) => validateAgainstActions(sample, "ui-action.json") },
];
const sampleResults = [];
for (const { file, validator } of samples) {
  const samplePath = path.join(SAMPLES_DIR, file);
  if (!fs.existsSync(samplePath)) {
    fail(`缺少样例 ${path.relative(ROOT, samplePath)}`);
    continue;
  }
  const before = errors.length;
  try {
    validator(readJson(samplePath));
  } catch (error) {
    fail(`样例 ${file} 解析失败：${error.message}`);
  }
  sampleResults.push({ file, ok: errors.length === before });
}

// ---------------------------------------------------------------------------
// 6. 汇总
// ---------------------------------------------------------------------------
if (errors.length > 0) {
  console.error(`✖ 契约测试失败，共 ${errors.length} 项：`);
  for (const message of errors) console.error(`  - ${message}`);
  process.exit(1);
}

console.log("✓ 契约测试通过：");
console.log(`  - OpenAPI 3.1 / info.version=1.0 / ${EXPECTED_PATHS.length} 条路径 / ${EXPECTED_MODELS.length} 个关键模型`);
console.log(`  - 动作 ${EXPECTED_AVAILABLE.length} available + ${EXPECTED_PLANNED.length} planned，策略覆盖完整`);
console.log(`  - 工具 ${EXPECTED_TOOLS.length} 个，入参/出参 schema 合法`);
console.log(`  - 样例 ${sampleResults.length} 份全部通过：${sampleResults.map((item) => item.file).join("、")}`);
