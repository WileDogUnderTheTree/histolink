"use client";

/**
 * 左下角悬浮「史」字印章 + 印章弹窗（V1.0.8 最终整合补丁）。
 *
 * 1. 圆形「史」字印章按钮：深红底 + 米黄繁体「史」字，悬浮有放大动效；
 *    点击弹出居中模态框（半透明遮罩），内含【关于】/【联系】两个 Tab。
 * 2. 点赞按钮（V1.0.8 调整）：不再固定在左下角，而是放在【关于】Tab 的**右下角**，
 *    红心图标 + 纯数字点赞数；点击 `POST /api/likes` 数字 +1、图标跳动，
 *    写入 `localStorage.has_liked_shimai` 后置灰并禁用（防刷）。
 * 3. 史引（时间轴 / 人物图）页面与 iframe 内嵌场景**不展示**本组件（不加入关于模块）。
 *
 * 数据：`GET /api/likes`（页面加载 / 重新可见 / 打开弹窗时刷新计数）。
 * 点赞是锦上添花功能：接口不可达时只在数字位显示「—」，绝不阻塞页面其它交互。
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";

import { CONTACTS, copyText, type ContactEntry } from "@/lib/contact-info";
import {
  fetchLikes,
  postLike,
  readHasLiked,
  writeHasLiked,
} from "@/lib/likes-client";

import styles from "./SealDock.module.css";

const TOAST_DURATION_MS = 1600;
const BOUNCE_DURATION_MS = 720;
/** 史引（时间轴 / 人物图）页面不挂载「关于」模块。 */
const HIDDEN_PATHNAMES = new Set(["/timeline", "/graph"]);

type SealTab = "about" | "contact";

const TABS: ReadonlyArray<{ key: SealTab; label: string }> = [
  { key: "about", label: "关于" },
  { key: "contact", label: "联系" },
];

/** 关于 Tab 的能力清单（与项目 V1.0 实际能力保持一致）。 */
const FEATURES: ReadonlyArray<{ title: string; detail: string }> = [
  {
    title: "双 RAG 架构",
    detail: "时间轴·大事记 + 人物关系图谱双源检索，再以史料向量检索补齐细节。",
  },
  {
    title: "全景时间轴",
    detail: "夏—清约四千年大事记，逐年可查、支持深链接定位。",
  },
  {
    title: "人物关系图谱",
    detail: "人物主数据、共同事件与关系定性，先秦至清 18 期 2D 力导向图。",
  },
  {
    title: "史令 × 史引",
    detail: "史令负责查阅史料、标注出处；史引负责把答案放回时间轴与关系图脉络。",
  },
];

function HeartIcon() {
  return (
    <svg viewBox="0 0 20 20" width="16" height="16" aria-hidden="true" focusable="false">
      <path
        d="M10 16.6S3.1 12.4 3.1 7.9c0-2.1 1.6-3.7 3.6-3.7 1.3 0 2.5.7 3.3 1.9.8-1.2 2-1.9 3.3-1.9 2 0 3.6 1.6 3.6 3.7 0 4.5-6.9 8.7-6.9 8.7Z"
        fill="currentColor"
        stroke="currentColor"
        strokeWidth="1.1"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function CopyIcon() {
  return (
    <svg viewBox="0 0 16 16" width="13" height="13" aria-hidden="true" focusable="false">
      <rect x="5.2" y="5.2" width="8.2" height="8.2" rx="1.6" fill="none" stroke="currentColor" strokeWidth="1.2" />
      <path d="M10.6 3.4V2.9c0-.7-.6-1.3-1.3-1.3H3.1c-.7 0-1.3.6-1.3 1.3v6.2c0 .7.6 1.3 1.3 1.3h.5" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg viewBox="0 0 16 16" width="13" height="13" aria-hidden="true" focusable="false">
      <path d="M3.2 8.4l3.1 3.1 6.5-6.9" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function SealDock() {
  const pathname = usePathname();
  const [likes, setLikes] = useState<number | null>(null);
  const [liked, setLiked] = useState(false);
  const [likeBusy, setLikeBusy] = useState(false);
  const [bouncing, setBouncing] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const [tab, setTab] = useState<SealTab>("about");
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [toastVisible, setToastVisible] = useState(false);
  /** 被 iframe 嵌入（如 /ask 右侧史引副驾驶里的时间轴 / 人物图）时不重复渲染悬浮组。 */
  const [isEmbedded, setIsEmbedded] = useState(false);

  const toastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const bounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  /** 读取最新点赞数（接口失败保持上一次展示值，不弹错误）。 */
  const refreshLikes = useCallback(async () => {
    const count = await fetchLikes();
    if (count !== null) setLikes(count);
  }, []);

  useEffect(() => {
    setIsEmbedded(window.self !== window.top);
  }, []);

  useEffect(() => {
    setLiked(readHasLiked());
    void refreshLikes();
    // 切回标签页 / 从后台返回时刷新计数（别的访客可能刚点过赞）。
    const onVisibilityChange = () => {
      if (document.visibilityState === "visible") void refreshLikes();
    };
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => document.removeEventListener("visibilitychange", onVisibilityChange);
  }, [refreshLikes]);

  useEffect(
    () => () => {
      if (toastTimerRef.current !== null) clearTimeout(toastTimerRef.current);
      if (bounceTimerRef.current !== null) clearTimeout(bounceTimerRef.current);
    },
    [],
  );

  const openModal = useCallback(() => {
    setTab("about");
    setModalOpen(true);
    // 打开弹窗时同步刷新一次点赞数（需求：页面加载 / 打开弹窗时请求 GET /api/likes）。
    void refreshLikes();
  }, [refreshLikes]);

  const closeModal = useCallback(() => setModalOpen(false), []);

  useEffect(() => {
    if (!modalOpen) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") closeModal();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [modalOpen, closeModal]);

  /** 点赞：没点过才允许；成功后更新数字、写入防刷标记、播放跳动微动效。 */
  const handleLike = useCallback(async () => {
    if (liked || likeBusy) return;
    setLikeBusy(true);
    try {
      const next = await postLike();
      if (next === null) return; // 接口失败：保持可点状态，用户可稍后重试。
      setLikes(next);
      writeHasLiked();
      setLiked(true);
      setBouncing(true);
      if (bounceTimerRef.current !== null) clearTimeout(bounceTimerRef.current);
      bounceTimerRef.current = setTimeout(() => setBouncing(false), BOUNCE_DURATION_MS);
    } finally {
      setLikeBusy(false);
    }
  }, [liked, likeBusy]);

  const handleCopy = useCallback(async (entry: ContactEntry) => {
    const copied = await copyText(entry.value);
    if (!copied) return;
    setCopiedId(entry.id);
    setToastVisible(true);
    if (toastTimerRef.current !== null) clearTimeout(toastTimerRef.current);
    toastTimerRef.current = setTimeout(() => {
      setToastVisible(false);
      setCopiedId(null);
    }, TOAST_DURATION_MS);
  }, []);

  const likeLabel = liked ? "已点赞史脉" : "为史脉点赞";

  // 史引（时间轴 / 人物图）页面与 iframe 内嵌场景不加入「关于」模块。
  if (isEmbedded || HIDDEN_PATHNAMES.has(pathname)) return null;

  return (
    <>
      <div className={styles.dock} data-seal-dock>
        {/* 圆形印章按钮（深红底 + 米黄繁体「史」字，悬浮放大）。点赞按钮已移入弹窗【关于】右下角。 */}
        <button
          type="button"
          className={styles.seal}
          aria-label="打开史脉关于与联系"
          aria-haspopup="dialog"
          aria-expanded={modalOpen}
          data-seal-trigger
          onClick={openModal}
        >
          <span className={styles.sealChar} aria-hidden="true">史</span>
        </button>
      </div>

      {modalOpen ? (
        <div
          className={styles.overlay}
          role="presentation"
          data-seal-overlay
          onClick={closeModal}
        >
          <section
            className={styles.modal}
            role="dialog"
            aria-modal="true"
            aria-labelledby="seal-modal-title"
            data-seal-modal
            onClick={(event) => event.stopPropagation()}
          >
            <header className={styles.modalHead}>
              <span className={styles.modalSeal} aria-hidden="true">史</span>
              <div className={styles.modalTitleBox}>
                <p className={styles.kicker}>SHIMAI · HISTOLINK</p>
                <h2 id="seal-modal-title" className={styles.modalTitle}>史脉</h2>
              </div>
              <button
                type="button"
                className={styles.close}
                aria-label="关闭弹窗"
                onClick={closeModal}
              >
                <span aria-hidden="true">×</span>
              </button>
            </header>

            <div className={styles.tabs} role="tablist" aria-label="关于与联系">
              {TABS.map((item) => (
                <button
                  key={item.key}
                  type="button"
                  role="tab"
                  className={styles.tab}
                  aria-selected={tab === item.key}
                  data-seal-tab={item.key}
                  data-active={tab === item.key ? "true" : undefined}
                  onClick={() => setTab(item.key)}
                >
                  {item.label}
                </button>
              ))}
            </div>

            {tab === "about" ? (
              <div className={styles.panel} role="tabpanel" aria-label="关于" data-seal-panel="about">
                <p className={styles.lead}>
                  史脉是一个基于<strong>双 RAG 架构</strong>的历史探索 Agent，
                  涵盖全景时间轴与人物关系图谱；每一次回答都标注可核验的史料出处。
                </p>
                <ul className={styles.features}>
                  {FEATURES.map((feature) => (
                    <li key={feature.title}>
                      <strong>{feature.title}</strong>
                      <span>{feature.detail}</span>
                    </li>
                  ))}
                </ul>
                {/* 点赞按钮（V1.0.8 调整）：从左侧悬浮组移到【关于】Tab 右下角。 */}
                <div className={styles.aboutFoot}>
                  <p className={styles.quote}>史脉已合，五千年入卷；愿你每一次追问，皆有出处。</p>
                  <button
                    type="button"
                    className={styles.like}
                    aria-label={likeLabel}
                    aria-pressed={liked}
                    title={liked ? "已点赞（每台设备限一次）" : "为史脉点赞"}
                    data-like-button
                    data-liked={liked ? "true" : undefined}
                    data-busy={likeBusy ? "true" : undefined}
                    disabled={liked || likeBusy}
                    onClick={() => void handleLike()}
                  >
                    <span
                      className={`${styles.heart} ${bouncing ? styles.heartBouncing : ""}`}
                      aria-hidden="true"
                    >
                      <HeartIcon />
                    </span>
                    <span className={styles.likeCount} data-likes-count>
                      {likes === null ? "—" : likes}
                    </span>
                  </button>
                </div>
              </div>
            ) : (
              <div className={styles.panel} role="tabpanel" aria-label="联系" data-seal-panel="contact">
                <p className={styles.panelHint}>点击任意一行即可复制。</p>
                <ul className={styles.contactList} aria-label="联系方式（点击任意一行复制）">
                  {CONTACTS.map((entry) => {
                    const copied = copiedId === entry.id;
                    return (
                      <li key={entry.id}>
                        <button
                          type="button"
                          className={styles.contactRow}
                          data-copied={copied ? "true" : undefined}
                          aria-label={`复制${entry.label}：${entry.value}`}
                          onClick={() => void handleCopy(entry)}
                        >
                          <span className={styles.contactLabel}>{entry.label}</span>
                          <span className={styles.contactValue}>{entry.value}</span>
                          <span className={styles.contactAction} aria-hidden="true">
                            {copied ? <CheckIcon /> : <CopyIcon />}
                            <span>{copied ? "已复制" : "复制"}</span>
                          </span>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </div>
            )}

            <footer className={styles.modalFoot}>
              <span aria-hidden="true" className={styles.footRule} />
              史脉 HistoLink · 以史为脉，让每一次好奇都有出处
            </footer>

            <div
              className={styles.toast}
              role="status"
              aria-live="polite"
              data-visible={toastVisible ? "true" : undefined}
            >
              {toastVisible ? (
                <>
                  <CheckIcon />
                  <span>已复制</span>
                </>
              ) : null}
            </div>
          </section>
        </div>
      ) : null}
    </>
  );
}