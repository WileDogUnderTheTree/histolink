"use client";

/**
 * 聊天气泡底部的「双图联动」按钮（V1.0.6.3 痛点 1）。
 *
 * 后端在 `ui_actions` 里同时下发 `timeline.focus_event` 与 `graph.focus_person` 时，
 * 气泡底部并排渲染：
 * - `[ 查看人物图谱 ]`
 * - `[ 查看时间轴 ]`
 * 点击哪个，右侧史引副驾驶就切换到哪个视图（/ask 页内切换；悬浮抽屉则跳转完整对话）。
 * 注：按用户反馈，按钮文字前**不再放 emoji 图标**（部分环境 emoji 字体缺字会显示成彩色方块）。
 */
import type { AgentGuideTarget } from "@/lib/agent-guide";

import styles from "./GuideActionButtons.module.css";

export interface GuideActionButtonsProps {
  /** 本轮回答可用的联动目标（时间轴 / 人物图，均可缺省）。 */
  targets: readonly AgentGuideTarget[];
  /** 点击按钮：父级打开 / 切换右侧面板视图。 */
  onOpen: (target: AgentGuideTarget) => void;
  /** 紧凑模式（悬浮抽屉）。 */
  compact?: boolean;
}

/** 固定顺序：人物图谱在左、时间轴在右（与需求文案一致）。 */
const SURFACE_ORDER: ReadonlyArray<AgentGuideTarget["surface"]> = ["graph", "timeline"];

const SURFACE_LABEL: Record<AgentGuideTarget["surface"], string> = {
  graph: "查看人物图谱",
  timeline: "查看时间轴",
};

export function GuideActionButtons({ targets, onOpen, compact = false }: GuideActionButtonsProps) {
  if (targets.length === 0) return null;
  const ordered = SURFACE_ORDER.flatMap((surface) =>
    targets.filter((target) => target.surface === surface).slice(0, 1),
  );
  return (
    <div
      className={`${styles.guideActions}${compact ? ` ${styles.compact}` : ""}`}
      role="group"
      aria-label="史引联动视图"
      data-guide-actions="true"
    >
      {ordered.map((target) => {
        return (
          <button
            key={target.surface}
            type="button"
            className={styles.guideAction}
            data-surface={target.surface}
            onClick={() => onOpen(target)}
            title={target.title}
          >
            <span>{SURFACE_LABEL[target.surface]}</span>
          </button>
        );
      })}
    </div>
  );
}