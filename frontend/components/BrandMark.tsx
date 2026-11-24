import type { SVGProps } from "react";

/**
 * 史脉品牌标（V1.0.4 UI 精修 · 第二版）。
 *
 * 按用户手绘线稿用 SVG 纯描边重绘，无填充：
 * - 底部两根平行波浪线 = 历史长河 / 竹简，左侧略低、向右延伸；
 * - 线条向上蜿蜒盘旋，收成流畅的英文字母「S」（Shi / 史）；
 * - S 最顶端向右上折起，形成一个带几何切角的箭头 / 指针（溯源、指引）；
 * - 统一 1.35 描边、深红 #8B0000，透明底。
 *
 * 纯展示图形，语义由旁边的「史脉问答」文字 / 链接提供，故 aria-hidden。
 */
export function BrandMark({
  size = 40,
  className,
  ...rest
}: { size?: number; className?: string } & Omit<SVGProps<SVGSVGElement>, "width" | "height">) {
  return (
    <svg
      className={className}
      width={size}
      height={size}
      viewBox="0 0 48 48"
      fill="none"
      stroke="#8B0000"
      strokeWidth="1.35"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      {...rest}
    >
      {/* 左侧长河 → 向上盘旋成 S → 底部回流 */}
      <path d="M3 28C7 27 10.5 26.4 13.5 26.6C16 26.8 17.6 28 19 29.7C20.4 31.4 21.6 32.4 23 33C24.4 33.6 26.2 33.6 27.2 33C28.2 32.4 28.4 31.6 28 30.8C27.6 30 27.2 29.4 27.2 29C25.8 28.4 23.4 27.6 21.5 26.6C18.8 24.8 16.6 22.6 15.4 21.2L22.4 9.8C24.6 10.2 27.6 13.2 29.4 15.9L23.9 16.6C23 17.2 22.6 18.4 23.2 19.8C24 21.4 26.5 22.2 28.5 22.5C30 23.4 32 25.2 33.3 28.4C33.7 30.8 33.6 33.2 32.3 35.7C30.2 38.6 26.8 39.4 24.1 38.8C20.9 38.2 17.4 36 16.1 33.5C13 32 8.4 32.2 3 33" />
      {/* 右侧延伸的两道河流 */}
      <path d="M33.3 28.4C36.4 28.4 40 28.4 45.2 26.9" />
      <path d="M33.2 33.6C36.4 33.6 40 33.5 45.2 32.1" />
    </svg>
  );
}
