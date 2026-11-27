"use client";

/**
 * 历史对话侧边栏（V1.0.5.2；V1.0.5.2-layout 补丁）。
 *
 * 位置：`/ask` 页面最左侧的独立竖向侧边栏，**自身内部滚动**，不参与整页滚动。
 *
 * 结构：
 * - 顶部固定标题栏（含收起按钮）；
 * - 固定「+ 新建对话」入口（点击后清空聊天区并创建一个新会话，新会话出现在列表最上方）；
 * - 可滚动列表：置顶组（仅在有置顶项时出现）→ 今天 → 过去 30 天；
 * - 底部说明。
 *
 * 交互（V1.0.5.2-layout 补丁重点）：
 * - 点击历史标题**只切换高亮**（浅灰选中态），绝不改变条目物理位置；
 * - 悬浮 / 键盘聚焦某条历史记录时，右侧出现「⋯」图标，点击展开「置顶 / 重命名 / 删除」菜单；
 * - 置顶：用户主动点击后，该项进入最上方「置顶」组；
 * - 重命名：行内输入框，Enter / ✓ 保存，Esc / ✕ 取消；
 * - 删除：点击后该项消失，其余项相对顺序不变（下面的项自然上补）。
 *
 * 数据：由 `AgentContext` 注入（V1.0.6 起为 `/api/sessions` 真实服务端持久化数据；
 * 刷新页面 / 重新打开浏览器后历史对话仍在，点击即可恢复完整聊天记录）。
 */

import { useCallback, useEffect, useRef, useState } from "react";

import {
  MAX_CONVERSATION_TITLE_LENGTH,
  type ConversationGroup,
  type ConversationSummary,
} from "@/lib/conversation-store";

import styles from "./ConversationSidebar.module.css";

export interface ConversationSidebarProps {
  groups: readonly ConversationGroup[];
  /** 当前活动会话 id；null 表示尚未创建历史记录的新会话。 */
  activeConversationId: string | null;
  /** 当前会话是否为空（欢迎语之外没有轮次）→「新建对话」显示选中态。 */
  isCurrentConversationEmpty?: boolean;
  onNewConversation: () => void;
  onSelectConversation: (id: string) => void;
  /** 重命名历史对话（PATCH /api/sessions/{id}）。 */
  onRenameConversation: (id: string, title: string) => void;
  /** 删除历史对话（DELETE /api/sessions/{id}）。 */
  onDeleteConversation: (id: string) => void;
  /** 置顶 / 取消置顶历史对话（PATCH pinned）。 */
  onPinConversation: (id: string, pinned: boolean) => void;
  /** 收起侧边栏（把横向空间让给中间聊天区）。 */
  onCollapse: () => void;
  /** 会话列表加载中（首屏读取服务端历史时显示占位）。 */
  loading?: boolean;
  disabled?: boolean;
}

interface MenuState {
  id: string;
  top: number;
  left: number;
  pinned: boolean;
}

/** 悬浮菜单尺寸（用于贴边翻转，避免菜单被视口裁切）。 */
const MENU_WIDTH = 122;
const MENU_HEIGHT = 116;

function ConversationItem({
  conversation,
  active,
  disabled,
  menuOpen,
  renaming,
  onSelect,
  onOpenMenu,
  onStartRename,
  onCommitRename,
  onCancelRename,
}: {
  conversation: ConversationSummary;
  active: boolean;
  disabled: boolean;
  menuOpen: boolean;
  renaming: boolean;
  onSelect: (id: string) => void;
  onOpenMenu: (trigger: HTMLElement, conversation: ConversationSummary) => void;
  onStartRename: (id: string) => void;
  onCommitRename: (id: string, title: string) => void;
  onCancelRename: () => void;
}) {
  const [draft, setDraft] = useState(conversation.title);
  const inputRef = useRef<HTMLInputElement>(null);

  // 进入重命名态：同步当前标题、聚焦并全选，便于直接输入新名称。
  useEffect(() => {
    if (!renaming) return;
    setDraft(conversation.title);
    const frame = window.requestAnimationFrame(() => {
      inputRef.current?.focus();
      inputRef.current?.select();
    });
    return () => window.cancelAnimationFrame(frame);
  }, [renaming, conversation.title]);

  const commitRename = () => {
    const trimmed = draft.trim();
    if (!trimmed || trimmed === conversation.title) {
      onCancelRename();
      return;
    }
    onCommitRename(conversation.id, trimmed);
  };

  return (
    <li
      className={styles.item}
      data-conversation-id={conversation.id}
      data-active={active ? "true" : undefined}
      data-pinned={conversation.pinned ? "true" : undefined}
    >
      {renaming ? (
        <form
          className={styles.renameForm}
          onSubmit={(event) => {
            event.preventDefault();
            commitRename();
          }}
        >
          <input
            ref={inputRef}
            className={styles.renameInput}
            value={draft}
            maxLength={MAX_CONVERSATION_TITLE_LENGTH}
            aria-label="重命名历史对话"
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Escape") {
                event.preventDefault();
                onCancelRename();
              }
            }}
          />
          <button type="submit" className={styles.renameConfirm} aria-label="保存名称">
            ✓
          </button>
          <button
            type="button"
            className={styles.renameCancel}
            aria-label="取消重命名"
            onClick={onCancelRename}
          >
            ✕
          </button>
        </form>
      ) : (
        <>
          <button
            type="button"
            className={styles.conversationButton}
            data-active={active ? "true" : undefined}
            aria-current={active ? "page" : undefined}
            title={conversation.title}
            disabled={disabled}
            onClick={() => onSelect(conversation.id)}
          >
            {conversation.pinned ? (
              <span className={styles.pinMark} aria-hidden="true">
                顶
              </span>
            ) : null}
            <span className={styles.conversationTitle}>{conversation.title}</span>
          </button>
          <button
            type="button"
            className={styles.menuTrigger}
            data-conversation-menu-trigger="true"
            aria-haspopup="menu"
            aria-expanded={menuOpen ? "true" : "false"}
            aria-label={`「${conversation.title}」更多操作`}
            title="更多操作"
            disabled={disabled}
            onClick={(event) => {
              event.stopPropagation();
              onOpenMenu(event.currentTarget, conversation);
            }}
            onDoubleClick={() => onStartRename(conversation.id)}
          >
            <span aria-hidden="true">⋯</span>
          </button>
        </>
      )}
    </li>
  );
}

export function ConversationSidebar({
  groups,
  activeConversationId,
  isCurrentConversationEmpty = false,
  onNewConversation,
  onSelectConversation,
  onRenameConversation,
  onDeleteConversation,
  onPinConversation,
  onCollapse,
  loading = false,
  disabled = false,
}: ConversationSidebarProps) {
  const [menu, setMenu] = useState<MenuState | null>(null);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  const closeMenu = useCallback(() => setMenu(null), []);

  const openMenu = useCallback(
    (trigger: HTMLElement, conversation: ConversationSummary) => {
      const rect = trigger.getBoundingClientRect();
      const preferredTop = rect.bottom + 6;
      const top = Math.max(
        8,
        Math.min(window.innerHeight - MENU_HEIGHT - 8, preferredTop),
      );
      const left = Math.max(
        8,
        Math.min(window.innerWidth - MENU_WIDTH - 8, rect.right - MENU_WIDTH),
      );
      setMenu({ id: conversation.id, top, left, pinned: conversation.pinned });
    },
    [],
  );

  // 菜单打开时：点击外部 / Esc / 视口尺寸变化都关闭，避免浮层残留在屏幕角落。
  useEffect(() => {
    if (!menu) return;
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (!(target instanceof Element)) return;
      if (menuRef.current?.contains(target)) return;
      if (target.closest("[data-conversation-menu-trigger]")) return;
      setMenu(null);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setMenu(null);
    };
    const onResize = () => setMenu(null);
    document.addEventListener("pointerdown", onPointerDown, true);
    document.addEventListener("keydown", onKeyDown);
    window.addEventListener("resize", onResize);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown, true);
      document.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("resize", onResize);
    };
  }, [menu]);

  const startRename = useCallback((id: string) => {
    setMenu(null);
    setRenamingId(id);
  }, []);

  const commitRename = useCallback(
    (id: string, title: string) => {
      setRenamingId(null);
      onRenameConversation(id, title);
    },
    [onRenameConversation],
  );

  const cancelRename = useCallback(() => setRenamingId(null), []);

  const handleDelete = useCallback(() => {
    if (!menu) return;
    const deletedId = menu.id;
    setMenu(null);
    if (renamingId === deletedId) setRenamingId(null);
    onDeleteConversation(deletedId);
  }, [menu, renamingId, onDeleteConversation]);

  const handleTogglePin = useCallback(() => {
    if (!menu) return;
    const { id, pinned } = menu;
    setMenu(null);
    onPinConversation(id, !pinned);
  }, [menu, onPinConversation]);

  const handleStartRenameFromMenu = useCallback(() => {
    if (!menu) return;
    startRename(menu.id);
  }, [menu, startRename]);

  const visibleGroups = groups.filter((group) => group.items.length > 0);
  const hasConversations = visibleGroups.length > 0;

  return (
    <aside className={styles.sidebar} aria-label="历史对话">
      <header className={styles.header}>
        <div className={styles.headerText}>
          <span className={styles.kicker}>HISTOLINK</span>
          <strong>历史对话</strong>
        </div>
        <button
          type="button"
          className={styles.collapseButton}
          title="收起历史对话（把宽度让给聊天区）"
          aria-label="收起历史对话侧边栏"
          onClick={onCollapse}
        >
          <span aria-hidden="true">«</span>
        </button>
      </header>

      {/* 新建对话：固定入口。只有点击这里才会创建一个新会话并出现在列表最上方。 */}
      <div className={styles.newConversationDock}>
        <button
          type="button"
          className={styles.newConversationButton}
          data-active={isCurrentConversationEmpty ? "true" : undefined}
          aria-current={isCurrentConversationEmpty ? "page" : undefined}
          disabled={disabled}
          onClick={onNewConversation}
        >
          <span className={styles.newIcon} aria-hidden="true">
            +
          </span>
          <span className={styles.conversationTitle}>新建对话</span>
        </button>
      </div>

      <div
        className={styles.scrollArea}
        onScroll={() => {
          if (menu) setMenu(null);
        }}
      >
        {loading ? (
          <p className={styles.placeholder} aria-hidden="true">
            正在载入历史对话…
          </p>
        ) : null}
        {!loading && !hasConversations ? (
          <p className={styles.empty}>
            还没有历史对话
            <br />
            点击「新建对话」开始
          </p>
        ) : null}
        {visibleGroups.map((group) => (
          <section
            className={styles.group}
            key={group.key}
            aria-labelledby={`conversation-group-${group.key}`}
          >
            <h2 className={styles.groupTitle} id={`conversation-group-${group.key}`}>
              {group.label}
            </h2>
            <ul className={styles.groupList}>
              {group.items.map((conversation) => (
                <ConversationItem
                  key={conversation.id}
                  conversation={conversation}
                  active={
                    conversation.id === activeConversationId && !isCurrentConversationEmpty
                  }
                  disabled={disabled}
                  menuOpen={menu?.id === conversation.id}
                  renaming={renamingId === conversation.id}
                  onSelect={onSelectConversation}
                  onOpenMenu={openMenu}
                  onStartRename={startRename}
                  onCommitRename={commitRename}
                  onCancelRename={cancelRename}
                />
              ))}
            </ul>
          </section>
        ))}
      </div>

      <footer className={styles.footer}>
        <p className={styles.footerNote}>
          V1.0.8 · 历史对话已持久化（刷新后仍可恢复）
        </p>
      </footer>

      {menu ? (
        <div
          ref={menuRef}
          className={styles.menu}
          role="menu"
          aria-label="历史对话操作"
          style={{ top: menu.top, left: menu.left }}
        >
          <button
            type="button"
            role="menuitem"
            className={styles.menuItem}
            onClick={handleTogglePin}
          >
            {menu.pinned ? "取消置顶" : "置顶"}
          </button>
          <button
            type="button"
            role="menuitem"
            className={styles.menuItem}
            onClick={handleStartRenameFromMenu}
          >
            重命名
          </button>
          <button
            type="button"
            role="menuitem"
            className={styles.menuItemDanger}
            onClick={handleDelete}
          >
            删除
          </button>
        </div>
      ) : null}
    </aside>
  );
}