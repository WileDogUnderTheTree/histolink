/**
 * PersonGraph2D 力导向布局与视图自适应的纯计算层（V1.0.8「比例与缩放」专项）。
 *
 * 背景：V1.0.6.3 只做了「模拟结束后按包围盒 fit」，但力导向的**分布半径**由弹簧 / 斥力
 * 决定、与画布大小无关——中心只有 5 个邻居时节点仍然被推到很远，画布四周留白过大；
 * 邻居多时又可能把画布撑出边界。
 *
 * 本模块把两个关键决策抽成纯函数，便于单测覆盖、也避免组件里堆参数：
 * 1. `computeGraphLayout`：按「画布尺寸 + 邻居数量」推导初始环半径、弹簧长度、斥力与
 *    斥力作用上限（distanceMax），让少量邻居收敛在适度半径内、大量邻居自动放大半径；
 * 2. `computeFitTransform`：把模拟后的节点包围盒（含节点半径与下方标签）等比缩放并
 *    平移到画布中心，保证「中心点居中 + 整体自适应画布」。
 *
 * 二者都不依赖 D3 / DOM，输入确定则输出确定。
 */

/** 节点圆半径（与 `PersonGraph2D` 渲染保持一致）。 */
export const GRAPH_NODE_RADIUS = 22;

/** 节点标签在圆点下方的额外留白（dy = r + 15，12px 字高 + 呼吸位）。 */
const NODE_LABEL_DROP = 34;

const MIN_RING_RADIUS = 110;
const MIN_CANVAS_EXTENT = 240;

export interface GraphLayoutInput {
  /** 画布宽（SVG viewBox 坐标系）。 */
  width: number;
  /** 画布高（SVG viewBox 坐标系）。 */
  height: number;
  /** 一跳邻居数量（不含中心人物）。 */
  neighborCount: number;
}

export interface GraphLayoutParams {
  /** 中心人物固定坐标 = 画布正中心。 */
  centerX: number;
  centerY: number;
  /** 邻居初始位置所在的半径（比目标环略小，让图从中心自然舒展）。 */
  initialRadius: number;
  /** 力导向收敛的目标环半径。 */
  ringRadius: number;
  /** 中心 → 邻居的弹簧长度。 */
  linkDistance: number;
  /** 斥力强度（负值），邻居越多越强。 */
  chargeStrength: number;
  /** 斥力作用半径上限：避免少量邻居之间的长程推力把节点甩出画布。 */
  chargeDistanceMax: number;
  /** 节点碰撞半径（含标签呼吸位）。 */
  collideRadius: number;
  /** 邻居在环上的初始角度（从正上方开始均分）。 */
  initialAngles: number[];
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/**
 * 根据画布与邻居数量推导力导向参数。
 *
 * - 少量邻居：环半径取最短边的 ~30%（并有上下限），节点不会「飞得太散」；
 * - 大量邻居：按环周长给每位邻居预留弧长，节点越多环越大，最终由 `computeFitTransform`
 *   自动缩小，保证整张图仍落在画布内。
 */
export function computeGraphLayout({ width, height, neighborCount }: GraphLayoutInput): GraphLayoutParams {
  const safeWidth = Math.max(1, width);
  const safeHeight = Math.max(1, height);
  const centerX = safeWidth / 2;
  const centerY = safeHeight / 2;

  const count = Math.max(0, Math.floor(neighborCount));
  const minExtent = Math.max(MIN_CANVAS_EXTENT, Math.min(safeWidth, safeHeight));

  // 少量邻居的基准半径：随画布最短边线性缩放，限制在 116–230。
  const baseRadius = clamp(minExtent * 0.3, 116, 230);
  // 多邻居：按周长预留弧长（节点直径 44 + 间距；画布越小弧长越紧凑）。
  const arcPerNode = clamp(minExtent * 0.1, 52, 68);
  const countRadius = (count * arcPerNode) / (2 * Math.PI);
  const ringRadius = clamp(Math.max(baseRadius, countRadius), MIN_RING_RADIUS, minExtent);

  return {
    centerX,
    centerY,
    initialRadius: ringRadius * 0.55,
    ringRadius,
    linkDistance: ringRadius * 0.92,
    // 少量邻居：-265 左右，避免强斥力把 5 个节点推到远处；
    // 邻居多：-500 左右，配合碰撞力均匀铺满环。
    chargeStrength: -Math.min(520, 210 + count * 11),
    chargeDistanceMax: Math.max(320, ringRadius * 2.4),
    collideRadius: GRAPH_NODE_RADIUS + 15,
    initialAngles: Array.from({ length: count }, (_, index) => -Math.PI / 2 + (index * 2 * Math.PI) / Math.max(1, count)),
  };
}

export interface FitBoundsPoint {
  x: number;
  y: number;
}

export interface FitTransformInput {
  width: number;
  height: number;
  /** 需要装进画布的点集（中心 + 邻居的模拟坐标）。 */
  points: readonly FitBoundsPoint[];
  /** 节点圆半径，用于给包围盒留出圆与标签的空间。 */
  nodeRadius?: number;
  /** 画布内边距；缺省按最短边 4% 计算。 */
  padding?: number;
  maxScale?: number;
  minScale?: number;
}

export interface FitTransform {
  /** 缩放比例。 */
  k: number;
  /** SVG 平移量（viewBox 坐标系）。 */
  x: number;
  y: number;
}

/**
 * 计算「把整张图装进画布」的视图变换（与 d3-zoom 的 `zoom.transform` 同语义：
 * `translate(x, y) scale(k)`）。
 *
 * 包围盒会额外加上节点半径 + 标签高度，避免缩放后圆点 / 文字被裁；结果再平移，
 * 使包围盒中心精确落在画布中心——因此中心人物始终居中，节点多少只影响缩放比例。
 */
export function computeFitTransform({
  width,
  height,
  points,
  nodeRadius = GRAPH_NODE_RADIUS,
  padding,
  maxScale = 2.2,
  minScale = 0.5,
}: FitTransformInput): FitTransform {
  if (points.length === 0) return { k: 1, x: 0, y: 0 };

  const safeWidth = Math.max(1, width);
  const safeHeight = Math.max(1, height);
  const xs = points.map((point) => point.x);
  const ys = points.map((point) => point.y);
  const minX = Math.min(...xs) - nodeRadius - 18;
  const maxX = Math.max(...xs) + nodeRadius + 18;
  // 标签在圆点下方，底部多留一点空间避免文字被裁。
  const minY = Math.min(...ys) - nodeRadius - 18;
  const maxY = Math.max(...ys) + nodeRadius + NODE_LABEL_DROP;
  const contentWidth = Math.max(1, maxX - minX);
  const contentHeight = Math.max(1, maxY - minY);
  const edgePadding = padding ?? Math.max(12, Math.min(safeWidth, safeHeight) * 0.04);

  const fittedScale = Math.min(
    (safeWidth - edgePadding * 2) / contentWidth,
    (safeHeight - edgePadding * 2) / contentHeight,
  );
  const scale = clamp(fittedScale, minScale, maxScale);

  return {
    k: scale,
    x: safeWidth / 2 - scale * ((minX + maxX) / 2),
    y: safeHeight / 2 - scale * ((minY + maxY) / 2),
  };
}