import { networkInterfaces } from "node:os";
import type { NextConfig } from "next";

/**
 * 后端服务地址（Next 服务端代理目标，仅本机进程访问，不暴露给浏览器）。
 * 默认指向本机 FastAPI；部署到其他机器时可用环境变量覆盖：
 *   API_PROXY_TARGET=http://127.0.0.1:8000
 */
const apiProxyTarget = (process.env.API_PROXY_TARGET ?? "http://127.0.0.1:8000").replace(
  /\/$/,
  "",
);

/**
 * 自动收集本机全部非回环 IPv4 地址。
 *
 * 背景：Next.js 16 在 dev 模式下会拦截来自非 localhost 主机的 dev-only 资源请求
 * （`/_next/*`、HMR）。朋友通过本机局域网 IP（如 192.168.x.x / 10.x.x.x）访问
 * `pnpm dev` 时，若不放行，页面 HTML 能打开但 JS 无法水合、交互全部失效。
 * 这里自动把本机网卡地址加入 allowedDevOrigins，做到局域网分享零配置。
 */
function detectLocalIPv4Hosts(): string[] {
  const hosts = new Set<string>();
  for (const interfaceInfos of Object.values(networkInterfaces())) {
    for (const info of interfaceInfos ?? []) {
      if (info.family === "IPv4" && !info.internal) {
        hosts.add(info.address);
      }
    }
  }
  return [...hosts];
}

/**
 * 额外的 dev 放行来源（用于 UUMit 等隧道域名，hostname 不带协议 / 端口），
 * 逗号分隔，例如：
 *   ALLOWED_DEV_ORIGINS=app-3000--xxx.uua2a.com,xiaolong.uumit.com
 * 生产模式（next start）不受 dev 拦截限制，分享时更推荐生产模式。
 */
const extraAllowedDevOrigins = (process.env.ALLOWED_DEV_ORIGINS ?? "")
  .split(",")
  .map((item) => item.trim())
  .filter(Boolean);

/**
 * V0.9.0 内测默认放行的 UUMit 隧道域名（仅 dev 模式）。
 * 隧道地址形如 https://app-3000--xxx.uua2a.com 或 https://xxx.uumit.com。
 * 只影响 dev-only 资源的跨站校验；生产模式（next start）不涉及，
 * 若日后隧道域名变化，用 ALLOWED_DEV_ORIGINS 追加即可。
 */
const UUMIT_TUNNEL_DEV_ORIGINS = ["**.uua2a.com", "**.uumit.com"];

const allowedDevOrigins = [
  ...new Set([
    ...detectLocalIPv4Hosts(),
    ...UUMIT_TUNNEL_DEV_ORIGINS,
    ...extraAllowedDevOrigins,
  ]),
];

const nextConfig: NextConfig = {
  reactStrictMode: true,
  ...(allowedDevOrigins.length > 0 ? { allowedDevOrigins } : {}),
  async rewrites() {
    return [
      // V0.9.0：把 /api/* 同源代理到 FastAPI。
      // 浏览器只访问前端端口，因此局域网 IP、UUMit 隧道下健康检查依然可用，
      // 也不会触发跨域 / Mixed Content 问题；分享时只需暴露 3000 一个端口。
      {
        source: "/api/:path*",
        destination: `${apiProxyTarget}/api/:path*`,
      },
    ];
  },
};

export default nextConfig;
