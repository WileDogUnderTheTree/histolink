"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import type { MouseEvent } from "react";

import { DYNASTY_START_YEARS, TIMELINE_EVENTS } from "@/data/timeline-events";
import type { Dynasty, TimelineEvent } from "@/data/timeline-events";
import { formatYear, toAstronomical } from "@/lib/year";

import styles from "./timeline.module.css";

/** 轨道两端留白百分比，圆点不贴边。 */
const PAD = 6;

/**
 * 相邻圆点水平间距小于该百分比时做垂直错层，避免圆点互相压住、点不到。
 * 轨道最窄 680px（见 .track 的 min-width），1.8% ≈ 12px，与圆点直径相当；
 * 因此无论窗口多窄，圆点都不会重叠。
 */
const STACK_GAP_PERCENT = 1.8;

/** 错层基准步长（px）。层数过多时向 STACK_STEP_MIN_PX 收窄，控制轨道总高度。 */
const STACK_STEP_PX = 24;
const STACK_STEP_MIN_PX = 14;

/** 轨道最小高度（px）＝原来的一轴高度；最大高度用于反推最小步长。 */
const TRACK_MIN_HEIGHT = 148;
const TRACK_MAX_HEIGHT = 440;

/**
 * 轨道上下为圆点与悬停年份标签预留的空间（px）：
 * 圆点半高 15 + 标签位于圆点上方约 20—35px + 余量，保证 overflow 裁切不到。
 */
const TRACK_VERTICAL_PADDING_PX = 58;

/** 事件过多或错层过深时缩小圆点（见 timeline.module.css 的 data-density）。 */
const DENSE_EVENT_COUNT = 40;
const DENSE_MAX_LEVEL = 4;

/** 朝代选择器：从数据中提取出现过的朝代，再按朝代起始年排序（不硬编码 Tab 列表）。 */
const DYNASTIES: readonly Dynasty[] = Array.from(
  new Set(TIMELINE_EVENTS.map((event) => event.dynasty)),
).sort((a, b) => DYNASTY_START_YEARS[a] - DYNASTY_START_YEARS[b]);

/** 选择器标签之外的补充口径：新莽（9—23）事件归入西汉 Tab，这里显式说明。 */
const DYNASTY_NOTES: Partial<Record<Dynasty, string>> = {
  西汉: "（含新莽）",
};

/** 错层幅度：level 0 → 0，1 → -step，2 → +step，3 → -2step，4 → +2step…… */
function stackMagnitude(level: number, step: number): number {
  return step * Math.ceil(level / 2);
}

/** 垂直错层偏移（px），层数不设上限，偏移符号上下交替。 */
function stackOffset(level: number, step: number): number {
  if (level === 0) return 0;
  const magnitude = stackMagnitude(level, step);
  return level % 2 === 1 ? -magnitude : magnitude;
}

/** 把错层偏移拼成合法的 CSS calc：`calc(50% - 20px)`，避免 `+ -20px` 这种非法写法。 */
function stackTop(offset: number): string {
  if (offset === 0) return "50%";
  const sign = offset < 0 ? "-" : "+";
  return `calc(50% ${sign} ${Math.abs(offset)}px)`;
}

interface PositionedEvent extends TimelineEvent {
  /** 相对轨道的横坐标百分比。 */
  left: number;
  /** 垂直错层偏移（px），0 表示贴在轴上。 */
  offset: number;
}

interface TimelineLayout {
  /** 排好层的事件（按年份升序）。 */
  events: PositionedEvent[];
  /** 最深层号；0 表示所有事件都贴轴。 */
  maxLevel: number;
  /** 本朝代采用的错层步长（px）。 */
  step: number;
  /** 轨道高度（px）：随错层深度动态变化，保证圆点不出轨道。 */
  trackHeight: number;
}

/**
 * 计算时间轴布局。
 *
 * 两步：
 * 1. 按天文纪年把年份线性映射到 PAD%—(100-PAD)%，再贪心分配层号
 *    （同一层相邻圆点必须拉开 STACK_GAP_PERCENT）。层号只取决于事件的相对位置，
 *    与轨道实际像素宽度无关，所以无需测量 DOM。
 * 2. 由最大层号反推错层步长，保证轨道高度不超过 TRACK_MAX_HEIGHT；
 *    再据此算出每个点的垂直偏移和轨道总高度。
 */
function buildLayout(events: readonly TimelineEvent[]): TimelineLayout {
  if (events.length === 0) {
    return { events: [], maxLevel: 0, step: STACK_STEP_PX, trackHeight: TRACK_MIN_HEIGHT };
  }

  const entries = events.map((event) => ({ event, adjusted: toAstronomical(event.year) }));
  const adjustedYears = entries.map((entry) => entry.adjusted);
  const min = Math.min(...adjustedYears);
  const max = Math.max(...adjustedYears);
  const span = max - min;

  // 每一层上一个点的横坐标：只有当点与同层前一点拉开最小间距时，才复用该层。
  const lastLeftByLevel: number[] = [];

  const leveled = entries
    .sort(
      (a, b) =>
        a.adjusted - b.adjusted || a.event.title.localeCompare(b.event.title, "zh-Hans-CN"),
    )
    .map(({ event, adjusted }) => {
      const left = span === 0 ? 50 : PAD + ((adjusted - min) / span) * (100 - 2 * PAD);

      let level = 0;
      while (level < lastLeftByLevel.length && left - lastLeftByLevel[level] < STACK_GAP_PERCENT) {
        level += 1;
      }
      lastLeftByLevel[level] = left;

      return { event, left, level };
    });

  const maxLevel = leveled.reduce((acc, item) => Math.max(acc, item.level), 0);
  const laneCount = Math.ceil(maxLevel / 2);

  // 单侧可用空间（px）：轨道半高减去上下预留空间。
  const availableHalf = TRACK_MAX_HEIGHT / 2 - TRACK_VERTICAL_PADDING_PX;
  const fittedStep = laneCount === 0 ? STACK_STEP_PX : Math.floor(availableHalf / laneCount);
  const step = Math.min(STACK_STEP_PX, Math.max(STACK_STEP_MIN_PX, fittedStep));

  const maxOffset = laneCount * step;
  const halfHeight = Math.max(TRACK_MIN_HEIGHT / 2, maxOffset + TRACK_VERTICAL_PADDING_PX);

  return {
    events: leveled.map(({ event, left, level }) => ({
      ...event,
      left,
      offset: stackOffset(level, step),
    })),
    maxLevel,
    step,
    trackHeight: Math.round(halfHeight * 2),
  };
}

export default function TimelinePage() {
  const [dynasty, setDynasty] = useState<Dynasty>(DYNASTIES[0]);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const layout = useMemo(
    () => buildLayout(TIMELINE_EVENTS.filter((event) => event.dynasty === dynasty)),
    [dynasty],
  );
  const positioned = layout.events;

  // 事件多或错层深时缩小圆点，缓解密集年份的视觉拥挤（点击热区不变）。
  const density =
    positioned.length > DENSE_EVENT_COUNT || layout.maxLevel >= DENSE_MAX_LEVEL
      ? "dense"
      : "normal";

  const first = positioned[0];
  const last = positioned[positioned.length - 1];
  const mixedEra = first.year < 0 && last.year > 0;
  const selected = positioned.find((event) => event.id === selectedId) ?? null;
  const yearRange = `${formatYear(first.year, { full: mixedEra })} — ${formatYear(last.year, {
    full: mixedEra,
  })}`;
  const dynastyNote = DYNASTY_NOTES[dynasty] ?? "";

  const selectDynasty = (next: Dynasty) => {
    setDynasty(next);
    setSelectedId(null);
  };

  const handleTrackClick = (event: MouseEvent<HTMLDivElement>) => {
    if (!(event.target as HTMLElement).closest("button")) {
      setSelectedId(null);
    }
  };

  return (
    <main className={styles.page}>
      <div className={styles.shell}>
        <div className={styles.topbar}>
          <Link className={styles.back} href="/">
            ← 返回首页
          </Link>
          <p className={styles.eyebrow}>中国历史探索 · 时间轴</p>
        </div>

        <h1 className={styles.title}>{dynasty} · 大事记</h1>
        <p className={styles.lead}>
          本朝精选 {positioned.length} 条{dynastyNote} · {yearRange}
          。切换朝代只看该朝事件，点击圆点查看事件详情；圆点按年份自动上下错层，不再堆叠。
        </p>

        <div className={styles.tabs} role="tablist" aria-label="朝代选择">
          {DYNASTIES.map((option) => (
            <button
              key={option}
              type="button"
              role="tab"
              aria-selected={dynasty === option}
              className={`${styles.tab}${dynasty === option ? ` ${styles.tabActive}` : ""}`}
              onClick={() => selectDynasty(option)}
            >
              {option}
            </button>
          ))}
        </div>

        <div className={styles.trackViewport}>
          <div
            className={styles.track}
            data-density={density}
            style={{ height: `${layout.trackHeight}px` }}
            onClick={handleTrackClick}
          >
            <div
              className={styles.axis}
              style={{ left: `${PAD}%`, right: `${PAD}%` }}
              aria-hidden="true"
            />

            {positioned.map((event) => (
              <button
                key={event.id}
                type="button"
                className={`${styles.point}${selectedId === event.id ? ` ${styles.pointSelected}` : ""}`}
                style={{ left: `${event.left}%`, top: stackTop(event.offset) }}
                aria-pressed={selectedId === event.id}
                aria-label={`${formatYear(event.year, { full: mixedEra })}，${event.title}`}
                onClick={() => setSelectedId(selectedId === event.id ? null : event.id)}
              >
                <span className={styles.pointLabel}>
                  {formatYear(event.year, { full: mixedEra })}
                </span>
                <span className={styles.dot} />
              </button>
            ))}

            <span className={styles.axisEnd} style={{ left: `${PAD}%` }}>
              {formatYear(first.year, { full: mixedEra })}
            </span>
            <span className={styles.axisEnd} style={{ left: `${100 - PAD}%` }}>
              {formatYear(last.year, { full: mixedEra })}
            </span>
          </div>
        </div>

        {selected ? (
          <section className={styles.card} aria-live="polite">
            <p className={styles.cardMeta}>
              {selected.dynasty} · {formatYear(selected.year, { full: mixedEra })}
            </p>
            <h2 className={styles.cardTitle}>{selected.title}</h2>
            <p className={styles.cardBody}>{selected.description}</p>
          </section>
        ) : (
          <p className={styles.hint}>点击时间轴上的圆点查看事件详情</p>
        )}

        <footer className={styles.footer}>
          数据来源：
          <a href="https://github.com/baojie/shiji-kb" target="_blank" rel="noreferrer">
            史记知识库 shiji-kb
          </a>
          （CC BY-NC-SA 4.0，仅限非商业使用）；《汉书》《后汉书》原文（公有领域）；
          朝代纪年与年号参考{" "}
          <a href="https://github.com/anthonyhann/chinese-history" target="_blank" rel="noreferrer">
            chinese-history
          </a>
          （事实数据 CC0）。当前共收录 {TIMELINE_EVENTS.length} 条事件。
        </footer>
      </div>
    </main>
  );
}
