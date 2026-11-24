/**
 * 生成物文本比对工具（V1.0.5.3 体检专项 · F-01）。
 *
 * 背景：本机 Git 配置 `core.autocrlf=true`，检出时会把仓库内 LF 文本转成 CRLF；
 * 而生成类脚本（build-persons / extract-sources / gen-frontend-types）在内存里用 LF 拼接内容，
 * 直接逐字节比对会把「换行符不同、语义完全一致」的工作区文件误判成生成物过期，
 * 导致 `scripts/verify.ps1` 在 Windows 上偶发失败。
 *
 * 约定：所有生成物的 --check 比对都先归一化 CRLF → LF，再比较内容；
 * 生成模式仍统一写出 LF，保证仓库内 blob 稳定（不受检出平台影响）。
 */

/** 归一化换行符：CRLF / 单独 CR → LF。 */
export function normalizeEol(text) {
  return text.replace(/\r\n?/g, "\n");
}

/** 语义比对：忽略换行符差异。 */
export function sameText(left, right) {
  return normalizeEol(left) === normalizeEol(right);
}