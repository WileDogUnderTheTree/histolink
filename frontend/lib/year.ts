/** 天文纪年：用于运算的连续整数轴（含 0 年，不展示）。 */
export function toAstronomical(year: number): number {
  assertValidYear(year);
  return year < 0 ? year + 1 : year;
}

/** 天文纪年还原为史书纪年（展示用）。 */
export function fromAstronomical(adjustedYear: number): number {
  if (!Number.isInteger(adjustedYear)) {
    throw new RangeError(`天文纪年必须是整数：${adjustedYear}`);
  }
  return adjustedYear <= 0 ? adjustedYear - 1 : adjustedYear;
}

/** 公元 0 年不存在，非法年份直接抛错。 */
export function assertValidYear(year: number): void {
  if (!Number.isInteger(year)) {
    throw new RangeError(`年份必须是整数：${year}`);
  }
  if (year === 0) {
    throw new RangeError("公元 0 年不存在（公元前1年的下一年是公元1年）");
  }
}

export interface FormatYearOptions {
  /** true 时公元年份显式带“公元”，用于同一条轴上前后纪元并存的场景。 */
  full?: boolean;
}

/** 统一年份格式化：公元前统一带“公元前”，公元年份默认省略“公元”。 */
export function formatYear(year: number, options: FormatYearOptions = {}): string {
  assertValidYear(year);
  if (year < 0) {
    return `公元前${Math.abs(year)}年`;
  }
  return options.full ? `公元${year}年` : `${year}年`;
}
