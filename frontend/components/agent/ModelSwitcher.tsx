"use client";

/**
 * 模型切换窗口（V1.0.5.2）。
 *
 * 摆放：对话输入框左上角、输入框外部左侧区域（由 `ask.module.css` 的 composerTools 行负责）。
 * 形态：圆角矩形下拉按钮 = 品牌图标 + 当前模型展示名 + 向下箭头；
 *       展开后展示模型注册表（主模型 / 备用降级模型）。
 * 交互：选择后立即生效、不清空已有对话历史；任意模型异常时后端仍会自动切换到另一款。
 *
 * 纯受控组件：模型列表与选中值由 `AgentContext` 统一提供，本组件不自己发请求。
 *
 * V1.0.6.2 修复：按产品要求精简为「模型名 + 角色徽标」两行信息——
 * 不再渲染模型描述（如「主模型：默认用于回答所有历史问题。」）与降级提示
 * （「所选模型异常时限流 / 超时会自动切换到另一款」）；模型展示名由后端
 * `LLM_MODEL_DISPLAY_NAME` / 自动缩写提供（如 XiaoHong-v1），请求仍用真实模型 id。
 */

import { useEffect, useId, useRef, useState } from "react";

import type { ModelOption } from "@/lib/agent-client";

import styles from "./ModelSwitcher.module.css";

export interface ModelSwitcherProps {
  models: readonly ModelOption[];
  /** 当前选中的模型 id；`null` 表示使用后端默认主模型。 */
  value: string | null;
  onChange: (modelId: string) => void;
  disabled?: boolean;
  /** 模型注册表是否仍在加载（加载时按钮显示「读取模型…」）。 */
  loading?: boolean;
  /** 模型注册表是否来自静态兜底（后端未启动时）；仅用于 title 提示。 */
  fallback?: boolean;
  className?: string;
}

const ROLE_LABEL: Record<string, string> = {
  primary: "主模型",
  fallback: "备用模型",
};

function QwenIcon() {
  return (
    <svg
      className={styles.brandIcon}
      viewBox="0 0 24 24"
      width="18"
      height="18"
      aria-hidden="true"
      focusable="false"
    >
      <defs>
        <linearGradient id="model-switcher-brand" x1="2" y1="2" x2="22" y2="22">
          <stop offset="0%" stopColor="#8b0000" />
          <stop offset="100%" stopColor="#c08a4a" />
        </linearGradient>
      </defs>
      <circle cx="12" cy="12" r="10" fill="url(#model-switcher-brand)" opacity="0.12" />
      <path
        d="M12 4.5a7.5 7.5 0 1 0 0 15 7.5 7.5 0 0 0 0-15Zm0 2a5.5 5.5 0 1 1 0 11 5.5 5.5 0 0 1 0-11Z"
        fill="url(#model-switcher-brand)"
      />
      <path
        d="M13.6 13.4 17 17.2"
        stroke="url(#model-switcher-brand)"
        strokeWidth="2.4"
        strokeLinecap="round"
      />
      <circle cx="12" cy="12" r="2.2" fill="url(#model-switcher-brand)" />
    </svg>
  );
}

function Chevron({ open }: { open: boolean }) {
  return (
    <svg
      className={styles.chevron}
      data-open={open ? "true" : undefined}
      viewBox="0 0 12 12"
      width="12"
      height="12"
      aria-hidden="true"
      focusable="false"
    >
      <path
        d="M2.5 4.5 6 8l3.5-3.5"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function ModelSwitcher({
  models,
  value,
  onChange,
  disabled = false,
  loading = false,
  fallback = false,
  className,
}: ModelSwitcherProps) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const listboxId = useId();

  const selected =
    models.find((model) => model.id === value) ??
    models.find((model) => model.role === "primary") ??
    models[0] ??
    null;
  const selectedName = selected?.name ?? (loading ? "读取模型…" : "默认模型");

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: MouseEvent | TouchEvent) => {
      const target = event.target;
      if (target instanceof Node && rootRef.current?.contains(target)) return;
      setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpen(false);
        buttonRef.current?.focus();
      }
    };
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("touchstart", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("touchstart", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  const selectModel = (modelId: string) => {
    onChange(modelId);
    setOpen(false);
    buttonRef.current?.focus();
  };

  return (
    <div
      ref={rootRef}
      className={`${styles.switcher} ${className ?? ""}`}
      data-open={open ? "true" : undefined}
    >
      <button
        ref={buttonRef}
        type="button"
        className={styles.trigger}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={listboxId}
        aria-label={`选择模型，当前为 ${selectedName}`}
        title={
          fallback
            ? "模型注册表暂不可用，已使用内置模型表（不影响提问）"
            : `当前模型：${selectedName}`
        }
        disabled={disabled || loading || models.length === 0}
        onClick={() => setOpen((previous) => !previous)}
      >
        <QwenIcon />
        <span className={styles.name}>{selectedName}</span>
        <Chevron open={open} />
      </button>

      {open ? (
        <ul className={styles.menu} id={listboxId} role="listbox" aria-label="可用模型">
          <li className={styles.menuHeading} aria-hidden="true">
            切换模型 · 当前会话立即生效
          </li>
          {models.map((model) => {
            const isSelected = model.id === selected?.id;
            return (
              <li key={model.id} role="none">
                <button
                  type="button"
                  role="option"
                  aria-selected={isSelected}
                  className={styles.option}
                  data-selected={isSelected ? "true" : undefined}
                  onClick={() => selectModel(model.id)}
                >
                  <span className={styles.optionHead}>
                    <span className={styles.optionName}>{model.name}</span>
                    <span className={styles.optionRole} data-role={model.role}>
                      {ROLE_LABEL[model.role] ?? model.role}
                    </span>
                  </span>
                  <span className={styles.optionCheck} aria-hidden="true">
                    {isSelected ? "✓" : ""}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      ) : null}
    </div>
  );
}