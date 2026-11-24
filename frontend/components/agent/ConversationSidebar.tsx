"use client";

/**
 * 历史对话侧边栏（V1.0.5.2）。
 *
 * 位置：`/ask` 页面最左侧的独立竖向侧边栏。
 * 结构：按时间分组——「今天」组内首项固定为「新建对话」（选中态浅灰背景），
 *       其后是今天的历史对话；「过去 30 天」组按时间倒序展示历史对话标题。
 * 交互：点击「新建对话」清空当前对话开启新会话；点击历史标题加载对应会话；
 *       标题右侧「«」收起侧边栏（V1.0.5.2 UI 呼吸感补丁，把宽度让给中间聊天区）；
 *       窄屏（≤1080px）展开时由页面 CSS 切换为左侧浮层 + 遮罩。
 *
 * 数据：由 `AgentContext` 注入（v1.0.5.2 走 `lib/conversation-store.ts` 的内存实现 + 演示数据，
 * v1.0.6 接入真实持久化后本组件无需改动）。
 */

import type { ConversationGroup, ConversationSummary } from "@/lib/conversation-store";

import styles from "./ConversationSidebar.module.css";

export interface ConversationSidebarProps {
  groups: readonly ConversationGroup[];
  /** 当前活动会话 id；null 表示尚未创建历史记录的新会话。 */
  activeConversationId: string | null;
  /** 当前会话是否为空（欢迎语之外没有轮次）→「新建对话」显示选中态。 */
  isCurrentConversationEmpty?: boolean;
  onNewConversation: () => void;
  onSelectConversation: (id: string) => void;
  /** 收起侧边栏（V1.0.5.2 UI 呼吸感补丁：把横向空间让给中间聊天区）。 */
  onCollapse: () => void;
  /** 会话列表加载中（首屏读取演示数据时显示占位）。 */
  loading?: boolean;
  disabled?: boolean;
}

function ConversationItem({
  conversation,
  active,
  disabled,
  onSelect,
}: {
  conversation: ConversationSummary;
  active: boolean;
  disabled: boolean;
  onSelect: (id: string) => void;
}) {
  return (
    <li className={styles.item}>
      <button
        type="button"
        className={styles.conversationButton}
        data-active={active ? "true" : undefined}
        aria-current={active ? "page" : undefined}
        title={conversation.title}
        disabled={disabled}
        onClick={() => onSelect(conversation.id)}
      >
        <span className={styles.conversationTitle}>{conversation.title}</span>
      </button>
    </li>
  );
}

export function ConversationSidebar({
  groups,
  activeConversationId,
  isCurrentConversationEmpty = false,
  onNewConversation,
  onSelectConversation,
  onCollapse,
  loading = false,
  disabled = false,
}: ConversationSidebarProps) {
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

      <div className={styles.scrollArea}>
        {groups.map((group) => (
          <section className={styles.group} key={group.key} aria-labelledby={`conversation-group-${group.key}`}>
            <h2 className={styles.groupTitle} id={`conversation-group-${group.key}`}>
              {group.label}
            </h2>
            <ul className={styles.groupList}>
              {group.key === "today" ? (
                <li className={styles.item}>
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
                </li>
              ) : null}
              {loading ? (
                <li className={styles.placeholder} aria-hidden="true">
                  正在载入历史对话…
                </li>
              ) : null}
              {group.items.map((conversation) => (
                <ConversationItem
                  key={conversation.id}
                  conversation={conversation}
                  active={conversation.id === activeConversationId && !isCurrentConversationEmpty}
                  disabled={disabled}
                  onSelect={onSelectConversation}
                />
              ))}
            </ul>
          </section>
        ))}
      </div>

      <footer className={styles.footer}>
        {/* TODO v1.0.6 多轮历史对话记忆模块 - 功能待实现：重命名 / 删除 / 置顶入口 */}
        <p className={styles.footerNote}>v1.0.5.2 · 演示数据（不接真实持久化）</p>
      </footer>
    </aside>
  );
}