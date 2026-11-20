"use client";

import { useEffect } from "react";

import styles from "./EasterEgg.module.css";

const DISPLAY_DURATION = 5000;

interface EasterEggProps {
  isOpen: boolean;
  onClose: () => void;
}

export default function EasterEgg({ isOpen, onClose }: EasterEggProps) {
  useEffect(() => {
    if (!isOpen) return undefined;
    const timer = window.setTimeout(onClose, DISPLAY_DURATION);
    return () => window.clearTimeout(timer);
  }, [isOpen, onClose]);

  return (
    <aside
      className={`${styles.banner} ${isOpen ? styles.bannerVisible : styles.bannerHidden}`}
      aria-label="致敬纪念横幅"
      aria-hidden={!isOpen}
    >
      <div className={styles.words}>
        <span>四海翻腾云水怒</span>
        <span>五洲震荡风雷激</span>
      </div>
      <button
        type="button"
        className={styles.close}
        aria-label="关闭纪念横幅"
        tabIndex={isOpen ? 0 : -1}
        onClick={onClose}
      >
        ×
      </button>
    </aside>
  );
}
