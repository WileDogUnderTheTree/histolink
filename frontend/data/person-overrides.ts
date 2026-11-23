/**
 * 人物主数据 · 人工裁决层（V1.0.1 / TC-02）。
 *
 * **这是人物主数据里唯一允许手改的文件。**
 * `persons.generated.ts`、`person-aliases.ts`、`locks/person-ids.lock.json`
 * 都由 `scripts/build-persons.mjs` 生成，手改会在下一次生成时被覆盖，并由 `--check` 拦下。
 *
 * 使用规则：
 * 1. 同名异人：在 `PERSON_SPLIT_RULES` 里给出显式事件划分与消歧信息，禁止静默合并；
 * 2. 同一人的异名：优先在 `PERSON_ALIAS_OVERRIDES` 里把别名指向确定的 `person_id`；
 * 3. 事件数据变化后，若某个拆分规则漏掉了新事件，`build-persons.mjs` 会直接失败并列出漏网事件，
 *    要求人工补裁决，不会自动猜测；
 * 4. 每条拆分规则必须有 `ruling`（结论）与 `reviewer`（责任人），并写入
 *    `docs/person-same-name-report.md`。
 */
import type { Dynasty } from "./timeline-events";

/** 同名拆分中单条候选的裁决信息。 */
export interface PersonSplitCandidate {
  /** 可选的可读标签，进入 ID：`p-<romanized>-<idTag>-<hash>`。 */
  idTag: string;
  /**
   * 该候选拥有的事件 id（显式列出，避免按朝代/年份猜测）。
   * 同一姓名的全部事件必须被恰好覆盖一次，否则生成脚本失败。
   */
  eventIds: readonly string[];
  /** 消歧副标题的时期。 */
  period: string;
  /** 消歧副标题的身份。 */
  role: string;
  /** 指定主朝代（默认取最后一条关联事件的 dynasty）。 */
  primaryDynasty?: Dynasty;
  /** 指定别名（可选）；未指定时按 `PERSON_NAME_ALIASES` 反查，歧义则要求在此显式给出。 */
  aliases?: readonly string[];
}

/** 同名拆分裁决：把一个 displayName 拆成多条 person 记录。 */
export interface PersonSplitRule {
  displayName: string;
  candidates: readonly PersonSplitCandidate[];
  /** 裁决结论（写入同名报告）。 */
  ruling: string;
  /** 责任人 / 复核人。 */
  reviewer: string;
}

/**
 * 已确认的同名异人。
 *
 * - `梁太后`：东汉 146 年「梁冀毒杀质帝」中的顺烈皇后梁妠（梁冀妹），
 *   与西夏 1081–1082 年灵州、永乐城之战中的毅宗后梁氏，相隔近千年，必为两人。
 *   注意：五路伐夏（`beisong-25`）、永乐城之战（`beisong-26`）虽记为北宋事件，
 *   但叙事主体是西夏梁太后，因此归入西夏候选。
 * - `刘崇`：西汉 6 年起兵讨王莽的安众侯刘崇，与五代 954 年高平之战的北汉世祖刘崇
 *   （刘旻）为两人。
 */
export const PERSON_SPLIT_RULES: readonly PersonSplitRule[] = [
  {
    displayName: "梁太后",
    candidates: [
      {
        idTag: "handong",
        eventIds: ["handong-zhidi"],
        period: "东汉",
        role: "梁冀妹·顺烈皇后",
        primaryDynasty: "东汉",
      },
      {
        idTag: "xixia",
        eventIds: ["beisong-25", "beisong-26", "xixia-09"],
        period: "西夏",
        role: "毅宗后",
        primaryDynasty: "西夏",
      },
    ],
    ruling:
      "东汉梁太后（梁冀妹，146 年毒杀质帝）与西夏梁太后（毅宗后，1081–1082 灵州、永乐城之战）为两人，拆为两条记录。",
    reviewer: "待评审（V1.0.1 评审会）",
  },
  {
    displayName: "刘崇",
    candidates: [
      {
        idTag: "xihan",
        eventIds: ["xihan-wangmang-regent"],
        period: "西汉",
        role: "安众侯",
        primaryDynasty: "西汉",
      },
      {
        idTag: "wudai",
        eventIds: ["wudai-17"],
        period: "五代十国",
        role: "北汉世祖",
        primaryDynasty: "五代十国",
      },
    ],
    ruling:
      "西汉安众侯刘崇（公元 6 年起兵讨王莽）与五代北汉世祖刘崇（刘旻，954 年高平之战）为两人，拆为两条记录。",
    reviewer: "待评审（V1.0.1 评审会）",
  },
];

/**
 * 别名 → `person_id` 的人工覆盖。
 *
 * 仅当别名指向的 displayName 已被拆分（一个别名对多个候选）时才需要填写；
 * 其余别名由脚本按 `PERSON_NAME_ALIASES` 自动解析。
 */
export const PERSON_ALIAS_OVERRIDES: Readonly<Record<string, string>> = {};

/**
 * 已人工复核、确认**不拆分**的记录说明（进入同名报告，便于日后复查）。
 */
export const PERSON_REVIEW_NOTES: readonly {
  displayName: string;
  note: string;
  reviewer: string;
}[] = [
  {
    displayName: "朱熹",
    note:
      "1195 年南宋「庆元党禁」条与 1527 年明「王阳明」条同时出现「朱熹」，属于后人提及，同一人物，不拆分；数据层不改动。",
    reviewer: "待评审（V1.0.1 评审会）",
  },
];

/**
 * 「异名同一人」合并的复核人。
 *
 * 当 `PERSON_NAME_ALIASES` 的别名本身也作为事件参与者姓名出现时
 * （当前三例：明武宗 / 明神宗 / 宋恭帝），生成脚本会把两条姓名记录合并为一条，
 * 事件取并集，并把别名保留在 `aliases[]` 中，避免同一历史人物拿到两个 person_id。
 * 合并明细写入 `docs/person-same-name-report.md`。
 */
export const PERSON_ALIAS_MERGE_REVIEWER = "待评审（V1.0.1 评审会）";

