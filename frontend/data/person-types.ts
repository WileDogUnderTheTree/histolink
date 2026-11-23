/**
 * 人物主数据类型（V1.0.1 / TC-02）。
 *
 * 约定：
 * - `id` 是系统内唯一主键，任何引用（关系、事件、RAG 实体链接、深链接、URL）一律用它；
 * - `displayName` 只用于展示，**允许重复**（同名异人拆成多条记录）；
 * - `disambiguator` 用于同名时的界面副标题（时间 + 身份），不冲突时前端可不展示。
 *
 * 本文件只放类型，不放数据；数据在：
 * - `persons.generated.ts`（脚本生成，禁止手改）
 * - `person-overrides.ts`（唯一允许手改的裁决层）
 * - `persons.ts`（对外读取入口）
 */
import type { Dynasty } from "./timeline-events";
import type { PersonGraphEraId, PersonGraphScopeId } from "./person-graph";

/** 同名消歧副标题：时期 + 身份。 */
export interface PersonDisambiguator {
  /** 时期，例如「东汉」「西夏」；无更细信息时取 `primaryDynasty`。 */
  period: string;
  /** 身份，例如「梁冀妹」「毅宗后」；未知时为 `null`。 */
  role: string | null;
}

/** 记录状态；`merged` 预留给 V1.1 的合并迁移，本版本全部为 `active`。 */
export type PersonStatus = "active" | "merged";

/** 人物主数据记录。 */
export interface PersonRecord {
  /** 稳定主键：`p-<罗马化姓名>[-<拆分标签>]-<4 位 hash>`。 */
  id: string;
  displayName: string;
  /** 拼音罗马化（小写、无音调、仅 a-z0-9），用于可读 ID 与排序。 */
  romanized: string;
  disambiguator: PersonDisambiguator;
  /** 指向该人物的别名（庙号、本名、简称等）；由 `PERSON_NAME_ALIASES` 归一。 */
  aliases: readonly string[];
  /** 取「最后一条关联事件」的朝代，与人物图节点 `PersonGraphNode.dynasty` 口径一致。 */
  primaryDynasty: Dynasty;
  /** 全部出现过的朝代（按首次出现年份排序）。 */
  dynasties: readonly Dynasty[];
  /** 所属细览分期（18 期）；夏商西周人物无细览分期，只出现在简阅断代。 */
  eraIds: readonly PersonGraphEraId[];
  /** 所属简阅断代（7 组）。 */
  scopeIds: readonly PersonGraphScopeId[];
  /** 关联事件 id（按年份、id 排序）。 */
  eventIds: readonly string[];
  /** 首条关联事件年份（史书纪年，公元前为负）。 */
  firstYear: number;
  /** 末条关联事件年份。 */
  lastYear: number;
  status: PersonStatus;
  /** `status === "merged"` 时指向合并后的 `id`；V1.1 实现。 */
  mergedInto?: string;
}
