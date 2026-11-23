/**
 * 人物主数据 · 对外读取入口（V1.0.1 / TC-02）。
 *
 * 数据来源分三层：
 * 1. `persons.generated.ts` —— 由 `scripts/build-persons.mjs` 生成，已应用人工裁决；
 * 2. `person-overrides.ts`  —— 唯一允许手改的裁决层（拆分规则、ID 固定、别名覆盖）；
 * 3. 本文件 —— 只读查询入口，页面与 Agent 都通过它拿 `person_id`。
 *
 * 重要：V1.0.1 不切换页面渲染口径（图节点仍以姓名为 id），
 * 本文件供 V1.0.2 起的工具层与 V1.1 的关系库迁移使用。
 */
import { PERSONS as GENERATED_PERSONS } from "./persons.generated";
import { PERSON_ALIAS_TO_ID } from "./person-aliases";
import type { PersonRecord } from "./person-types";

export type { PersonDisambiguator, PersonRecord, PersonStatus } from "./person-types";

/** 全部人物记录（按 `id` 排序；当前 1,058 条 = 1,059 个姓名 − 3 条异名合并 + 2 条同名拆分）。 */
export const PERSONS: readonly PersonRecord[] = GENERATED_PERSONS;

/** `person_id → 记录`。 */
export const PERSON_BY_ID: ReadonlyMap<string, PersonRecord> = new Map(
  PERSONS.map((person) => [person.id, person]),
);

/** `displayName → 候选记录`（同名时多于一条；禁止默认取第一条）。 */
export const PERSON_CANDIDATES_BY_NAME: ReadonlyMap<string, readonly PersonRecord[]> = (() => {
  const index = new Map<string, PersonRecord[]>();
  for (const person of PERSONS) {
    const bucket = index.get(person.displayName) ?? [];
    bucket.push(person);
    index.set(person.displayName, bucket);
  }
  return index;
})();

/** 别名 → `person_id`。 */
export const PERSON_BY_ALIAS: ReadonlyMap<string, string> = new Map(
  Object.entries(PERSON_ALIAS_TO_ID),
);

/** 按稳定主键查人物；不存在返回 `undefined`。 */
export function getPersonById(personId: string): PersonRecord | undefined {
  return PERSON_BY_ID.get(personId);
}

/** 按展示名取全部候选（同名时可多于一条，调用方必须让用户选择）。 */
export function findPersonsByName(displayName: string): readonly PersonRecord[] {
  return PERSON_CANDIDATES_BY_NAME.get(displayName) ?? [];
}

/** 把 `person_id` / 展示名 / 别名统一解析成候选列表（无结果返回空数组）。 */
export function resolvePersonCandidates(value: string): readonly PersonRecord[] {
  const byId = PERSON_BY_ID.get(value);
  if (byId) return [byId];

  const byName = PERSON_CANDIDATES_BY_NAME.get(value);
  if (byName && byName.length > 0) return byName;

  const aliasTargetId = PERSON_BY_ALIAS.get(value);
  if (aliasTargetId) {
    const byAlias = PERSON_BY_ID.get(aliasTargetId);
    if (byAlias) return [byAlias];
  }

  return [];
}

/** 取人物关联事件 id（只读）。 */
export function getPersonEventIds(personId: string): readonly string[] {
  return PERSON_BY_ID.get(personId)?.eventIds ?? [];
}
