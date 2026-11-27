/**
 * 力导向布局 / 视图自适应纯函数单测（V1.0.8「比例与缩放」专项）。
 *
 * 覆盖：中心固定居中、少量邻居收敛半径小于大量邻居、画布越小环越紧凑、
 * fit 变换居中 + 等比装进画布 + 缩放上下限。
 */
import { describe, expect, it } from "vitest";

import {
  computeFitTransform,
  computeGraphLayout,
  GRAPH_NODE_RADIUS,
} from "@/lib/graph-layout";

/** 复用真实三栏画布尺寸：graph 列约 860×620。 */
const CANVAS = { width: 860, height: 620 };

describe("computeGraphLayout", () => {
  it("中心人物始终固定在画布正中心", () => {
    for (const neighborCount of [0, 5, 27, 40]) {
      const layout = computeGraphLayout({ ...CANVAS, neighborCount });
      expect(layout.centerX).toBe(CANVAS.width / 2);
      expect(layout.centerY).toBe(CANVAS.height / 2);
    }
  });

  it("邻居少时环半径明显小于邻居多时（夏 5 人 vs 秦汉 27 人）", () => {
    const few = computeGraphLayout({ ...CANVAS, neighborCount: 5 });
    const many = computeGraphLayout({ ...CANVAS, neighborCount: 27 });
    expect(few.ringRadius).toBeLessThan(many.ringRadius);
    expect(many.ringRadius - few.ringRadius).toBeGreaterThan(40);
  });

  it("5 个邻居的环半径限制在最短边的合理比例内，不会飞得太散", () => {
    const { ringRadius } = computeGraphLayout({ ...CANVAS, neighborCount: 5 });
    expect(ringRadius).toBeGreaterThanOrEqual(110);
    expect(ringRadius).toBeLessThanOrEqual(Math.min(CANVAS.width, CANVAS.height) * 0.4);
  });

  it("邻居越多斥力越强，且 distanceMax 随环半径增长并封顶长程推力", () => {
    const few = computeGraphLayout({ ...CANVAS, neighborCount: 5 });
    const many = computeGraphLayout({ ...CANVAS, neighborCount: 27 });
    expect(many.chargeStrength).toBeLessThan(few.chargeStrength);
    expect(many.chargeDistanceMax).toBeGreaterThan(few.chargeDistanceMax);
    expect(few.chargeDistanceMax).toBeGreaterThanOrEqual(320);
    // distanceMax 不允许短程斥力之外无限外扩。
    expect(few.chargeDistanceMax).toBeLessThanOrEqual(few.ringRadius * 3);
  });

  it("窄小画布（史引副驾驶 iframe）自动收敛环半径", () => {
    const narrow = computeGraphLayout({ width: 420, height: 320, neighborCount: 27 });
    const wide = computeGraphLayout({ ...CANVAS, neighborCount: 27 });
    expect(narrow.ringRadius).toBeLessThan(wide.ringRadius);
    expect(narrow.ringRadius).toBeGreaterThan(0);
  });

  it("邻居初始角度从正上方开始均匀分布，数量与邻居数一致", () => {
    const layout = computeGraphLayout({ ...CANVAS, neighborCount: 5 });
    expect(layout.initialAngles).toHaveLength(5);
    expect(layout.initialAngles[0]).toBeCloseTo(-Math.PI / 2, 6);
    for (let index = 1; index < layout.initialAngles.length; index += 1) {
      const step = layout.initialAngles[index] - layout.initialAngles[index - 1];
      expect(step).toBeCloseTo((2 * Math.PI) / 5, 6);
    }
    expect(layout.initialRadius).toBeGreaterThan(0);
    expect(layout.initialRadius).toBeLessThan(layout.ringRadius);
  });
});

/** 把 (x, y) 按 `translate(x0, y0) scale(k)` 变换后的坐标。 */
function transformPoint(x: number, y: number, fit: { k: number; x: number; y: number }) {
  return { x: x * fit.k + fit.x, y: y * fit.k + fit.y };
}

describe("computeFitTransform", () => {
  it("包围盒中心精确映射到画布中心（中心人物居中）", () => {
    const points = [
      { x: CANVAS.width / 2, y: CANVAS.height / 2 },
      { x: CANVAS.width / 2 + 180, y: CANVAS.height / 2 - 120 },
      { x: CANVAS.width / 2 - 140, y: CANVAS.height / 2 + 160 },
    ];
    // 与组件一致的包围盒：圆点 ±(r+18)，标签额外向下 NODE_LABEL_DROP。
    const minX = Math.min(...points.map((point) => point.x)) - GRAPH_NODE_RADIUS - 18;
    const maxX = Math.max(...points.map((point) => point.x)) + GRAPH_NODE_RADIUS + 18;
    const minY = Math.min(...points.map((point) => point.y)) - GRAPH_NODE_RADIUS - 18;
    const maxY = Math.max(...points.map((point) => point.y)) + GRAPH_NODE_RADIUS + 34;
    const fit = computeFitTransform({ ...CANVAS, points });
    const center = transformPoint((minX + maxX) / 2, (minY + maxY) / 2, fit);
    expect(center.x).toBeCloseTo(CANVAS.width / 2, 4);
    expect(center.y).toBeCloseTo(CANVAS.height / 2, 4);
  });

  it("节点少（聚集）时放大、节点多（分散）时缩小，且都等比装进画布", () => {
    const compact = [
      { x: CANVAS.width / 2, y: CANVAS.height / 2 },
      { x: CANVAS.width / 2 + 60, y: CANVAS.height / 2 - 40 },
      { x: CANVAS.width / 2 - 50, y: CANVAS.height / 2 + 30 },
    ];
    const spread = Array.from({ length: 28 }, (_, index) => {
      const angle = (index / 28) * Math.PI * 2;
      return {
        x: CANVAS.width / 2 + Math.cos(angle) * 320,
        y: CANVAS.height / 2 + Math.sin(angle) * 260,
      };
    });

    const compactFit = computeFitTransform({ ...CANVAS, points: compact });
    const spreadFit = computeFitTransform({ ...CANVAS, points: spread });

    expect(compactFit.k).toBeGreaterThan(spreadFit.k);
    expect(spreadFit.k).toBeGreaterThanOrEqual(0.5);
    expect(compactFit.k).toBeLessThanOrEqual(2.2);

    // 每张图的所有节点都必须落在自己的画布内（等比缩放 + 居中平移）。
    const pairs: Array<{ fit: { k: number; x: number; y: number }; points: typeof compact }> = [
      { fit: compactFit, points: compact },
      { fit: spreadFit, points: spread },
    ];
    for (const { fit, points } of pairs) {
      for (const point of points) {
        const mapped = transformPoint(point.x, point.y, fit);
        expect(mapped.x).toBeGreaterThanOrEqual(0);
        expect(mapped.x).toBeLessThanOrEqual(CANVAS.width);
        expect(mapped.y).toBeGreaterThanOrEqual(0);
        expect(mapped.y).toBeLessThanOrEqual(CANVAS.height);
      }
    }
  });

  it("空点集返回恒等变换，不抛异常", () => {
    expect(computeFitTransform({ ...CANVAS, points: [] })).toEqual({ k: 1, x: 0, y: 0 });
  });
});