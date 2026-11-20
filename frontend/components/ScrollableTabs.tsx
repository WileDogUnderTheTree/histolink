"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { MouseEvent as ReactMouseEvent, PointerEvent as ReactPointerEvent } from "react";

import styles from "./ScrollableTabs.module.css";

/** Tab 项：`id` 为稳定标识，`label` 为展示名。 */
export interface ScrollableTabOption {
  id: string;
  label: string;
}

export interface ScrollableTabsProps {
  /** tablist 的无障碍名称，如「朝代选择」。 */
  ariaLabel: string;
  options: readonly ScrollableTabOption[];
  /** 当前选中的 Tab id。 */
  activeId: string;
  onSelect: (id: string) => void;
  /** 左右箭头按钮的无障碍名，用于区分页面语境。 */
  scrollLeftLabel?: string;
  scrollRightLabel?: string;
}

/** 距边缘小于该值即视为「已到端点」，避免亚像素误差导致箭头不消失。 */
const EDGE_EPSILON_PX = 2;
/** 指针位移超过该值即判定为拖拽（而不是点击 Tab）。 */
const DRAG_THRESHOLD_PX = 5;
/** 惯性摩擦：每 16.67ms 速度衰减比例；越小停得越快。 */
const MOMENTUM_FRICTION = 0.94;
/** 低于该速度（px/ms）停止惯性。 */
const MOMENTUM_MIN_VELOCITY = 0.02;
/** 惯性初速度上限（px/ms），避免「甩」得过猛。 */
const MOMENTUM_MAX_VELOCITY = 3.2;

interface DragState {
  pointerId: number;
  startX: number;
  startScrollLeft: number;
  lastX: number;
  lastTime: number;
  /** 滚动方向速度（px/ms），正值代表内容向左滚（scrollLeft 增大）。 */
  velocity: number;
  moved: boolean;
}

/**
 * 可横向滑动的 Tab 栏（时间轴 / 人物图共用）。
 *
 * 行为：
 * - 内容超出容器时横向滚动，系统滚动条隐藏；两侧箭头按钮位于滚动容器**外侧**，
 *   以 flex 占位而非绝对定位覆盖，保证绝不遮挡首尾 Tab；
 * - 指针拖拽：鼠标 / 触控按住即可左右拖动，松手后按速度惯性滑行（`prefers-reduced-motion` 时无惯性）；
 * - 拖动超过 5px 判定为拖拽，松手后会吞掉该次 click，避免误切 Tab；
 * - 切换模式或分期后，选中 Tab 自动滚到视野中心；
 * - 尺寸变化（窗口缩放、Tab 数量变化）由 ResizeObserver 重新计算。
 *
 * 纯受控组件：选中状态与切换副作用由页面管理，本组件只负责渲染、滚动与拖拽。
 */
export function ScrollableTabs({
  ariaLabel,
  options,
  activeId,
  onSelect,
  scrollLeftLabel = "向左查看更多",
  scrollRightLabel = "向右查看更多",
}: ScrollableTabsProps) {
  const viewportRef = useRef<HTMLDivElement>(null);
  const tabRefs = useRef(new Map<string, HTMLButtonElement>());
  const dragRef = useRef<DragState | null>(null);
  const suppressClickRef = useRef(false);
  const momentumFrameRef = useRef<number | null>(null);
  const [overflow, setOverflow] = useState({ left: false, right: false });
  const [dragging, setDragging] = useState(false);

  const stopMomentum = useCallback(() => {
    if (momentumFrameRef.current !== null) {
      cancelAnimationFrame(momentumFrameRef.current);
      momentumFrameRef.current = null;
    }
  }, []);

  const updateOverflow = useCallback(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    const maxScrollLeft = viewport.scrollWidth - viewport.clientWidth;
    const next = {
      left: viewport.scrollLeft > EDGE_EPSILON_PX,
      right: viewport.scrollLeft < maxScrollLeft - EDGE_EPSILON_PX,
    };
    setOverflow((current) =>
      current.left === next.left && current.right === next.right ? current : next,
    );
  }, []);

  // 容器与内容尺寸变化时重算两侧箭头显隐（箭头以 flex 占位，显隐会改变可视宽度）。
  useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    updateOverflow();
    const observer = new ResizeObserver(updateOverflow);
    observer.observe(viewport);
    if (viewport.firstElementChild) observer.observe(viewport.firstElementChild);
    window.addEventListener("resize", updateOverflow);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", updateOverflow);
    };
  }, [updateOverflow]);

  // 选中项滚到视野中心：切换朝代 / 模式后都能立刻看到当前 Tab。
  useEffect(() => {
    const viewport = viewportRef.current;
    const tab = tabRefs.current.get(activeId);
    if (!viewport || !tab) return;
    stopMomentum();
    const maxScrollLeft = viewport.scrollWidth - viewport.clientWidth;
    const centered = tab.offsetLeft - (viewport.clientWidth - tab.offsetWidth) / 2;
    const target = Math.max(0, Math.min(centered, maxScrollLeft));
    if (Math.abs(viewport.scrollLeft - target) <= EDGE_EPSILON_PX) return;
    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    viewport.scrollTo({ left: target, behavior: reduceMotion ? "auto" : "smooth" });
  }, [activeId, options, stopMomentum]);

  /** 松手后的惯性滑行：按速度衰减推进 scrollLeft，撞到端点即停。 */
  const startMomentum = useCallback(
    (initialVelocity: number) => {
      const viewport = viewportRef.current;
      if (!viewport) return;
      if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
      let velocity = Math.max(
        -MOMENTUM_MAX_VELOCITY,
        Math.min(MOMENTUM_MAX_VELOCITY, initialVelocity),
      );
      if (Math.abs(velocity) < MOMENTUM_MIN_VELOCITY) return;
      let lastTime = performance.now();
      const step = (now: number) => {
        const elapsed = Math.min(now - lastTime, 48);
        lastTime = now;
        const maxScrollLeft = viewport.scrollWidth - viewport.clientWidth;
        const next = Math.max(0, Math.min(viewport.scrollLeft + velocity * elapsed, maxScrollLeft));
        viewport.scrollLeft = next;
        velocity *= Math.pow(MOMENTUM_FRICTION, elapsed / 16.67);
        const hitEdge = next <= 0 || next >= maxScrollLeft;
        if (hitEdge || Math.abs(velocity) < MOMENTUM_MIN_VELOCITY) {
          momentumFrameRef.current = null;
          return;
        }
        momentumFrameRef.current = requestAnimationFrame(step);
      };
      momentumFrameRef.current = requestAnimationFrame(step);
    },
    [],
  );

  const handlePointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.pointerType === "mouse" && event.button !== 0) return;
    stopMomentum();
    dragRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startScrollLeft: viewportRef.current?.scrollLeft ?? 0,
      lastX: event.clientX,
      lastTime: event.timeStamp || performance.now(),
      velocity: 0,
      moved: false,
    };
  };

  const handlePointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    const viewport = viewportRef.current;
    if (!drag || !viewport || event.pointerId !== drag.pointerId) return;

    const deltaX = event.clientX - drag.startX;
    if (!drag.moved && Math.abs(deltaX) < DRAG_THRESHOLD_PX) return;

    if (!drag.moved) {
      drag.moved = true;
      // 阈值后再捕获指针：普通点击不被截走，拖拽中移出容器仍能继续。
      try {
        viewport.setPointerCapture(event.pointerId);
      } catch {
        // 指针已释放等情况忽略即可。
      }
      setDragging(true);
    }

    event.preventDefault();
    viewport.scrollLeft = drag.startScrollLeft - deltaX;

    const now = event.timeStamp || performance.now();
    const elapsed = now - drag.lastTime;
    if (elapsed > 0) {
      // 内容位移速度 = -(指针位移速度)；向左甩 → scrollLeft 增大。
      const instant = (drag.lastX - event.clientX) / elapsed;
      drag.velocity = drag.velocity * 0.75 + instant * 0.25;
    }
    drag.lastX = event.clientX;
    drag.lastTime = now;
  };

  const finishPointer = (event: ReactPointerEvent<HTMLDivElement>, withMomentum: boolean) => {
    const drag = dragRef.current;
    const viewport = viewportRef.current;
    if (!drag || event.pointerId !== drag.pointerId) return;
    dragRef.current = null;
    if (viewport?.hasPointerCapture(event.pointerId)) {
      viewport.releasePointerCapture(event.pointerId);
    }
    setDragging(false);
    if (!drag.moved) return;
    // 拖拽后的 click 一律吞掉，避免「拖动 Tab 栏却切换了朝代」。
    suppressClickRef.current = true;
    window.setTimeout(() => {
      suppressClickRef.current = false;
    }, 0);
    if (withMomentum) startMomentum(drag.velocity);
  };

  const handleClickCapture = (event: ReactMouseEvent<HTMLDivElement>) => {
    if (!suppressClickRef.current) return;
    suppressClickRef.current = false;
    event.preventDefault();
    event.stopPropagation();
  };

  const nudge = (direction: -1 | 1) => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    stopMomentum();
    const distance = Math.max(160, Math.round(viewport.clientWidth * 0.6));
    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    viewport.scrollBy({ left: direction * distance, behavior: reduceMotion ? "auto" : "smooth" });
  };

  const registerTab = (id: string) => (node: HTMLButtonElement | null) => {
    if (node) tabRefs.current.set(id, node);
    else tabRefs.current.delete(id);
  };

  return (
    <div className={styles.wrap}>
      {overflow.left ? (
        <button
          type="button"
          className={`${styles.nudge} ${styles.nudgeLeft}`}
          data-visible="true"
          aria-label={scrollLeftLabel}
          onClick={() => nudge(-1)}
        >
          ‹
        </button>
      ) : null}

      <div
        ref={viewportRef}
        className={styles.viewport}
        role="tablist"
        aria-label={ariaLabel}
        data-dragging={dragging}
        onScroll={updateOverflow}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={(event) => finishPointer(event, true)}
        onPointerCancel={(event) => finishPointer(event, false)}
        onClickCapture={handleClickCapture}
        onWheel={stopMomentum}
      >
        {options.map((option) => {
          const active = option.id === activeId;
          return (
            <button
              key={option.id}
              ref={registerTab(option.id)}
              type="button"
              role="tab"
              aria-selected={active}
              className={`${styles.tab}${active ? ` ${styles.tabActive}` : ""}`}
              onClick={() => onSelect(option.id)}
            >
              {option.label}
            </button>
          );
        })}
      </div>

      {overflow.right ? (
        <button
          type="button"
          className={`${styles.nudge} ${styles.nudgeRight}`}
          data-visible="true"
          aria-label={scrollRightLabel}
          onClick={() => nudge(1)}
        >
          ›
        </button>
      ) : null}
    </div>
  );
}
