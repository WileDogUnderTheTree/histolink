import Image from "next/image";

/**
 * 史脉品牌标（V1.0.8 · 全新 Logo）。
 *
 * 新标识为「红色圆形对话气泡 + 蜿蜒的 S 线」，由设计稿
 * `史脉问答标志/史脉问答标志-图形标.png` 去白底后生成
 * `public/brand/shimai-mark.png`（透明底、已裁切）。
 *
 * 组件只负责图形标本身；「史脉问答」文字的语义由旁侧文案 / 链接提供，故 `alt=""`。
 * 保持原 SVG 版本的 API（`size` + `className`），调用点无需改动。
 */

const MARK_SRC = "/brand/shimai-mark.png";
const MARK_WIDTH = 135;
const MARK_HEIGHT = 108;

export function BrandMark({
  size = 40,
  className,
}: {
  size?: number;
  className?: string;
}) {
  return (
    <Image
      className={className}
      src={MARK_SRC}
      alt=""
      width={MARK_WIDTH}
      height={MARK_HEIGHT}
      sizes={`${size}px`}
      priority
      style={{ height: size, width: "auto" }}
    />
  );
}