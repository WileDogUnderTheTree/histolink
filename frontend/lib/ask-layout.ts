/**
 * `/ask` 页面布局偏好（V1.0.5.2 UI 呼吸感补丁）。
 *
 * 侧边栏折叠状态需要「刷新后保持」，但页面是客户端渲染 + localStorage，
 * 因此把解析规则抽成纯函数，方便单测覆盖，也避免 SSR / 首帧 hydration 差异：
 * - 服务端首帧按「展开」渲染；
 * - 挂载后读取 localStorage 与当前视口宽度，再决定是否收起（窄屏默认收起）。
 */

/** 侧边栏折叠偏好在 localStorage 中的 key（v1：只存 expanded / collapsed）。 */
export const ASK_SIDEBAR_STORAGE_KEY = "histolink.ask.sidebar.v1";

/** 窄屏断点：≤1080px 时侧边栏默认收起，展开后以浮层形式覆盖在页面上。 */
export const ASK_SIDEBAR_NARROW_QUERY = "(max-width: 1080px)";

export type AskSidebarPreference = "expanded" | "collapsed";

/** localStorage 原始值是否表示「已收起」；无法识别时按展开处理。 */
export function askSidebarPreferenceFromStored(stored: string | null): AskSidebarPreference {
  return stored === "collapsed" ? "collapsed" : "expanded";
}

/**
 * 计算挂载后的初始侧边栏偏好。
 *
 * - 窄屏（≤1080px）一律默认收起，把横向空间让给对话区，展开后走浮层；
 * - 宽屏优先尊重用户上次选择；没有记录时默认展开。
 */
export function resolveAskSidebarPreference(
  stored: string | null,
  narrowViewport: boolean,
): AskSidebarPreference {
  if (narrowViewport) return "collapsed";
  return askSidebarPreferenceFromStored(stored);
}

/** 偏好 → 落盘值（只写 expanded / collapsed，不写 JSON，便于人工排查）。 */
export function askSidebarPreferenceToStored(preference: AskSidebarPreference): string {
  return preference === "collapsed" ? "collapsed" : "expanded";
}