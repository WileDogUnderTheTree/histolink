#!/usr/bin/env node
/**
 * 由 OpenAPI 生成前端类型（V1.0.1 / TC-04）。
 *
 * 输入：contracts/api-v1.openapi.json（由 backend/scripts/export_contracts.py 导出）
 * 输出：frontend/lib/api-types.ts（生成物，禁止手改）
 *
 * 用法：
 *   node scripts/gen-frontend-types.mjs          # 生成
 *   node scripts/gen-frontend-types.mjs --check  # 只校验是否与磁盘一致（CI 用）
 *
 * 依赖 npm 包经 `frontend/node_modules` 解析（与 scripts/validate-data.mjs 一致）。
 */
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { ROOT } from "./lib/load-ts-data.mjs";
import { sameText } from "./lib/text-compare.mjs";

const CHECK_MODE = process.argv.includes("--check");
const OPENAPI_PATH = path.join(ROOT, "contracts", "api-v1.openapi.json");
const OUTPUT_PATH = path.join(ROOT, "frontend", "lib", "api-types.ts");

const requireFromFrontend = createRequire(path.join(ROOT, "frontend", "package.json"));
const openapiTS = requireFromFrontend("openapi-typescript");

const HEADER = `/**
 * 自动生成，禁止手改（scripts/gen-frontend-types.mjs）。
 *
 * 来源：contracts/api-v1.openapi.json（由 backend/contracts 的 Pydantic 模型导出）
 * 重新生成：node scripts/gen-frontend-types.mjs
 * 校验：node scripts/gen-frontend-types.mjs --check
 */
`;

async function build() {
  if (!fs.existsSync(OPENAPI_PATH)) {
    throw new Error(`缺少 ${path.relative(ROOT, OPENAPI_PATH)}，请先运行 backend/scripts/export_contracts.py`);
  }
  const source = fs.readFileSync(OPENAPI_PATH, "utf8");
  const ast = await openapiTS.default(source);
  const types = openapiTS.astToString(ast);
  return HEADER + types;
}

const content = await build();

if (CHECK_MODE) {
  if (!fs.existsSync(OUTPUT_PATH)) {
    console.error(`✖ 前端契约类型缺失：${path.relative(ROOT, OUTPUT_PATH)}`);
    console.error("  修复：node scripts/gen-frontend-types.mjs");
    process.exit(1);
  }
  const current = fs.readFileSync(OUTPUT_PATH, "utf8");
  if (!sameText(current, content)) {
    console.error("✖ 前端契约类型与 OpenAPI 不一致（生成物过期或手改）。");
    console.error("  修复：node scripts/gen-frontend-types.mjs");
    process.exit(1);
  }
  console.log(`✓ 前端契约类型一致：${path.relative(ROOT, OUTPUT_PATH)}（${content.length} chars）`);
  process.exit(0);
}

fs.mkdirSync(path.dirname(OUTPUT_PATH), { recursive: true });
fs.writeFileSync(OUTPUT_PATH, content, "utf8");
console.log(`✓ 已生成 ${path.relative(ROOT, OUTPUT_PATH)}（${content.length} chars）`);
