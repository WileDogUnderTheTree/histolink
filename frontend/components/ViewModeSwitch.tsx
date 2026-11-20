"use client";

import styles from "./ViewModeSwitch.module.css";

/** 视图模式：简阅 = 断代大势（聚合朝代 + 顶级事件）；细览 = 编年细览（细分朝代 + 全量事件）。 */
export type ViewMode = "brief" | "detail";

export interface ViewModeSwitchProps {
  value: ViewMode;
  onChange: (mode: ViewMode) => void;
  /** 无障碍分组名，如「时间轴视图模式」。 */
  ariaLabel?: string;
}

/** 两个档位固定：左简阅、右细览（默认细览，保持既有体验）。 */
const OPTIONS = [
  { value: "brief", label: "简阅", title: "断代大势：聚合成大朝代，只看顶级事件" },
  { value: "detail", label: "细览", title: "编年细览：细分朝代，展示全部事件" },
] as const satisfies readonly { value: ViewMode; label: string; title: string }[];

/**
 * 时间轴 / 人物图共用的「简阅 · 细览」切换开关。
 *
 * 纯受控组件：只负责渲染与回调，模式状态与切换副作用由页面自己管理
 * （两页需要保持的选中状态不同，硬编码进组件会互相牵制）。
 */
export function ViewModeSwitch({ value, onChange, ariaLabel = "视图模式" }: ViewModeSwitchProps) {
  return (
    <div className={styles.switch} role="group" aria-label={ariaLabel}>
      {OPTIONS.map((option) => {
        const active = value === option.value;
        return (
          <button
            key={option.value}
            type="button"
            className={`${styles.option}${active ? ` ${styles.optionActive}` : ""}`}
            aria-pressed={active}
            title={option.title}
            onClick={() => onChange(option.value)}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}
