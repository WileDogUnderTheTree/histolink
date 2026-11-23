#!/usr/bin/env node
/**
 * 《史脉》TS 数据加载器（唯一实现）。
 *
 * 为什么需要它：
 * - 前端数据模块是 TypeScript，Node 不能直接 import；
 * - 直接用 tsx / ts-node 会引入额外依赖；
 * - 因此用 TypeScript 编译器把模块转译成 CommonJS 后执行，并提供一个只解析
 *   相对路径、只追加 `.ts` 的 require 垫片。**不会执行任意 npm 包或网络代码**，
 *   只会读取 `frontend/data` 下的数据模块。
 *
 * 使用方：
 * - scripts/validate-data.mjs
 * - scripts/build-persons.mjs
 * - scripts/extract-sources.mjs
 * - scripts/export-snapshot.mjs
 *
 * 修改约定：
 * - 这是全仓库唯一一份 TS 加载逻辑，其他脚本不得再复制；
 * - 新增数据模块时在 `loadTsData()` 里登记，或在调用方用 `loadTsModule()` 按路径加载。
 */
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** 仓库根目录。 */
export const ROOT = path.resolve(__dirname, "..", "..");
/** 前端数据目录。 */
export const DATA_DIR = path.join(ROOT, "frontend", "data");
/** 后端数据目录（快照等生成物）。 */
export const BACKEND_DATA_DIR = path.join(ROOT, "backend", "data");

const requireFromFrontend = createRequire(path.join(ROOT, "frontend", "package.json"));
const ts = requireFromFrontend("typescript");

const moduleCache = new Map();

/**
 * 用 TypeScript 编译器把 .ts 模块转成 CommonJS 后加载，支持无扩展名的相对导入。
 *
 * @param {string} filePath 绝对路径或相对仓库根目录的路径
 * @returns {Record<string, unknown>} 模块导出
 */
export function loadTsModule(filePath) {
  const absolute = path.resolve(filePath);
  if (moduleCache.has(absolute)) return moduleCache.get(absolute).exports;

  const source = fs.readFileSync(absolute, "utf8");
  const output = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      esModuleInterop: true,
    },
    fileName: absolute,
  }).outputText;

  const module = { exports: {} };
  moduleCache.set(absolute, module);
  const dir = path.dirname(absolute);
  const requireShim = (specifier) => {
    if (!specifier.startsWith(".")) {
      // 数据模块只允许相对导入；npm 依赖走 Node 正常解析。
      return requireFromFrontend(specifier);
    }
    let target = path.resolve(dir, specifier);
    if (!target.endsWith(".ts")) target += ".ts";
    return loadTsModule(target);
  };
  // eslint-disable-next-line no-new-func
  new Function("exports", "require", "module", "__dirname", "__filename", output)(
    module.exports,
    requireShim,
    module,
    dir,
    absolute,
  );
  return module.exports;
}

/** 加载 `frontend/data/<name>.ts`。 */
export function loadDataModule(name) {
  return loadTsModule(path.join(DATA_DIR, `${name}.ts`));
}

/** 加载 `frontend/data/<name>.ts`；文件不存在时返回 `null`（用于逐步落地的生成物）。 */
export function loadOptionalDataModule(name) {
  const file = path.join(DATA_DIR, `${name}.ts`);
  if (!fs.existsSync(file)) return null;
  return loadTsModule(file);
}

/**
 * 一次性加载校验 / 生成所需的全部基础数据模块。
 *
 * @returns {{
 *   TIMELINE_EVENTS: readonly object[],
 *   DYNASTY_START_YEARS: Record<string, number>,
 *   DYNASTY_GROUPS: readonly object[],
 *   importanceOf: (event: object) => number,
 *   EVENT_PARTICIPANTS: Record<string, readonly string[]>,
 *   PERSON_RELATIONS: readonly object[],
 *   pairKey: (a: string, b: string) => string,
 *   WEIJIN_EVENTS: readonly object[],
 *   PERSON_GRAPH_ERAS: readonly object[],
 *   PERSON_GRAPH_SCOPES: readonly object[],
 *   ERA_TO_SCOPE: Record<string, string>,
 *   SCOPE_TO_ERA: Record<string, string>,
 *   KEY_FIGURES: Record<string, string[]>,
 *   PERSON_NAME_ALIASES: Record<string, string>,
 *   eventPool: readonly object[],
 *   eventIndex: Map<string, object>,
 * }}
 */
export function loadTsData() {
  const timeline = loadDataModule("timeline-events");
  const participantsModule = loadDataModule("timeline-participants");
  const relationsModule = loadDataModule("person-relations");
  const weijin = loadDataModule("weijin-events");
  const graphModule = loadDataModule("person-graph");

  const TIMELINE_EVENTS = timeline.TIMELINE_EVENTS;
  const WEIJIN_EVENTS = weijin.WEIJIN_EVENTS;
  const eventPool = [...TIMELINE_EVENTS, ...WEIJIN_EVENTS];
  const eventIndex = new Map(eventPool.map((event) => [event.id, event]));

  return {
    TIMELINE_EVENTS,
    DYNASTY_START_YEARS: timeline.DYNASTY_START_YEARS,
    DYNASTY_GROUPS: timeline.DYNASTY_GROUPS,
    importanceOf: timeline.importanceOf,
    EVENT_PARTICIPANTS: participantsModule.EVENT_PARTICIPANTS,
    PERSON_RELATIONS: relationsModule.PERSON_RELATIONS,
    pairKey: relationsModule.pairKey,
    WEIJIN_EVENTS,
    PERSON_GRAPH_ERAS: graphModule.PERSON_GRAPH_ERAS,
    PERSON_GRAPH_SCOPES: graphModule.PERSON_GRAPH_SCOPES,
    ERA_TO_SCOPE: graphModule.ERA_TO_SCOPE,
    SCOPE_TO_ERA: graphModule.SCOPE_TO_ERA,
    KEY_FIGURES: graphModule.KEY_FIGURES,
    PERSON_NAME_ALIASES: graphModule.PERSON_NAME_ALIASES,
    eventPool,
    eventIndex,
  };
}
