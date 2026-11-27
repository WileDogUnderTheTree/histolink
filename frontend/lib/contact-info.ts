/**
 * 史脉联系方式与「一键复制」工具（V1.0.8）。
 *
 * 首页「关于与联系」卡片与左下角「史」字印章弹窗的【联系】Tab 共用同一份数据 /
 * 复制实现，避免两处展示的联系方式出现漂移。
 */

export interface ContactEntry {
  id: string;
  label: string;
  value: string;
}

/** 官方联系方式（抖音 / GitHub / 邮箱）。 */
export const CONTACTS: readonly ContactEntry[] = [
  { id: "douyin", label: "抖音", value: "树下飞野狗" },
  { id: "github", label: "GitHub", value: "WileDogUnderTheTree" },
  { id: "email", label: "邮箱", value: "2399324139@qq.com" },
];

/** 复制文本：优先 Clipboard API，失败时回退到隐藏 textarea + execCommand。 */
export async function copyText(text: string): Promise<boolean> {
  try {
    if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // 权限被拒 / 非安全上下文：继续走下面的兜底方案。
  }
  try {
    const textarea = document.createElement("textarea");
    textarea.value = text;
    textarea.setAttribute("readonly", "");
    textarea.style.position = "fixed";
    textarea.style.top = "0";
    textarea.style.opacity = "0";
    document.body.appendChild(textarea);
    textarea.select();
    const copied = document.execCommand("copy");
    document.body.removeChild(textarea);
    return copied;
  } catch {
    return false;
  }
}