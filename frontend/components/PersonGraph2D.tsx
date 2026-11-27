"use client";

import {
  forceCenter,
  forceCollide,
  forceLink,
  forceManyBody,
  forceRadial,
  forceSimulation,
  type SimulationNodeDatum,
} from "d3-force";
import { select } from "d3-selection";
import type { Selection } from "d3-selection";
import { useEffect, useMemo, useRef, useState } from "react";

import type { PersonGraphData, PersonGraphEdge, PersonGraphNode } from "@/data/person-graph";
import {
  computeFitTransform,
  computeGraphLayout,
  GRAPH_NODE_RADIUS,
} from "@/lib/graph-layout";
import {
  findRelationship,
  normalizeHighlightedPersonIds,
  resolveSelectedRelationship,
} from "@/lib/graph-selection";
import { formatYear } from "@/lib/year";

import styles from "./PersonGraph2D.module.css";

const LONG_PRESS_MS = 500;
const DRAG_THRESHOLD_PX = 7;
const NODE_RADIUS = GRAPH_NODE_RADIUS;

interface ForceNode extends PersonGraphNode, SimulationNodeDatum {
  isCenter: boolean;
}

interface ForceEdge {
  id: string;
  source: string | ForceNode;
  target: string | ForceNode;
  weight: number;
  sharedEvents: PersonGraphEdge["sharedEvents"];
}

interface PointerInteraction {
  pointerId: number;
  node: ForceNode;
  target: SVGGElement;
  startX: number;
  startY: number;
  mode: "pressing" | "dragging" | "longPressed";
  timer: ReturnType<typeof setTimeout> | null;
}

interface SelectedRelationshipState {
  person: PersonGraphNode;
  edge: PersonGraphEdge;
}

export interface PersonGraph2DProps {
  data: PersonGraphData;
  centerPersonId: string;
  onCenterPersonChange: (personId: string) => void;
  /**
   * 受控高亮集合（TC-08）：只做视觉强调，不改变布局、不打开关系面板。
   * 传入的 id 会先按当期图节点过滤，未知 id 静默丢弃；缺省 / 空数组 = 无高亮。
   */
  highlightedPersonIds?: readonly string[];
  /**
   * 受控选中人物（TC-08）：传入即进入受控模式，关系面板由该值派生。
   * - `undefined`：非受控，保持 V0.9.0「点击邻居自己开面板」的行为；
   * - `null`：受控且无选中；
   * - 合法的一跳邻居 id：打开该邻居的关系面板；
   * - 不存在 / 中心自己 / 非邻居：不崩溃、面板不打开。
   */
  selectedPersonId?: string | null;
  /**
   * 点击（含键盘 Enter / 空格）选中邻居时触发，参数为**当期图节点 id**。
   * V1.0.1 图节点仍以姓名为 id，`person_id` 迁移属 V1.1；语义与受控 prop 一致。
   */
  onPersonSelect?: (personId: string) => void;
  /**
   * V1.0.6.2 专项修复（痛点 3）：史引副驾驶 iframe 内使用。
   *
   * - `true`：图表填满父容器高度（父级给出确定高度），关系详情面板在窄容器下改为
   *   底部固定高度区块，保证「整张图不用滚动就能看全」；
   * - `false`（默认）：保持整页布局的原有高度策略。
   */
  fillContainer?: boolean;
}

function getOneHopView(data: PersonGraphData, centerPersonId: string) {
  const center = data.nodes.find((node) => node.id === centerPersonId);
  if (!center) return null;

  const edges = data.edges.filter(
    (edge) => edge.source === centerPersonId || edge.target === centerPersonId,
  );
  const nodeIds = new Set<string>([centerPersonId]);
  for (const edge of edges) {
    nodeIds.add(edge.source);
    nodeIds.add(edge.target);
  }

  return {
    center,
    nodes: data.nodes.filter((node) => nodeIds.has(node.id)),
    edges,
  };
}

export function PersonGraph2D({
  data,
  centerPersonId,
  onCenterPersonChange,
  highlightedPersonIds,
  selectedPersonId,
  onPersonSelect,
  fillContainer = false,
}: PersonGraph2DProps) {
  const graphHostRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  /** 右侧「人物关系 / 共同事件」详情面板：V1.0.8 起为内部独立滚动容器。 */
  const panelRef = useRef<HTMLElement>(null);
  const interactionRef = useRef<PointerInteraction | null>(null);
  const [size, setSize] = useState({ width: 860, height: 620 });
  const [selectedRelationship, setSelectedRelationship] = useState<SelectedRelationshipState | null>(null);
  /**
   * V1.0.6.2（痛点 3）：图表视图变换（缩放 / 平移）。
   *
   * D3 层持有实际 transform（`viewport <g>`），React 只渲染右下角缩放按钮；
   * `zoomControlsRef` 暴露 zoomIn / zoomOut / reset 给按钮调用（effect 内重建时更新）。
   */
  const viewTransformRef = useRef({ k: 1, x: 0, y: 0 });
  const zoomControlsRef = useRef<{
    zoomIn: () => void;
    zoomOut: () => void;
    reset: () => void;
  } | null>(null);

  /** 受控与否只看 prop 是否为 undefined：`null` 是「受控且无选中」，不是「没传」。 */
  const isSelectionControlled = selectedPersonId !== undefined;

  const oneHopView = useMemo(() => getOneHopView(data, centerPersonId), [data, centerPersonId]);

  /** 受控选中：只在当期图内、且为一跳邻居时生成关系；非法值安全降级为「未选中」。 */
  const controlledRelationship = useMemo(
    () => resolveSelectedRelationship(data, centerPersonId, selectedPersonId),
    [data, centerPersonId, selectedPersonId],
  );

  const activeRelationship = isSelectionControlled ? controlledRelationship : selectedRelationship;

  /** 高亮集合：过滤未知 id、去重后供 D3 层使用。 */
  const highlightedIds = useMemo(
    () => normalizeHighlightedPersonIds(highlightedPersonIds, data.nodes),
    [data.nodes, highlightedPersonIds],
  );

  const nodeSelectionRef = useRef<Selection<SVGGElement, ForceNode, SVGGElement, unknown> | null>(
    null,
  );
  const applyNodeStatesRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    setSelectedRelationship(null);
  }, [centerPersonId]);

  /** 受控选中 / 高亮变化时只更新既有 SVG 节点的 class 与 aria，不重跑力导向。 */
  useEffect(() => {
    applyNodeStatesRef.current?.();
  }, [activeRelationship, highlightedIds]);

  /**
   * V1.0.8 体验修复（Bug 2）：详情面板改为内部独立滚动后，切换查看的人物 / 关闭面板时
   * 回到顶部，避免上一个长事件列表的滚动位置残留到新关系上（只动面板，不动整页滚动）。
   */
  useEffect(() => {
    if (panelRef.current) panelRef.current.scrollTop = 0;
  }, [activeRelationship]);

  useEffect(() => {
    const host = graphHostRef.current;
    if (!host) return;

    const observer = new ResizeObserver(([entry]) => {
      const width = Math.max(320, Math.round(entry.contentRect.width));
      const observedHeight = Math.round(entry.contentRect.height);
      // V1.0.8（比例与缩放专项）：画布容器已改为固定宽高比（CSS `aspect-ratio: 16 / 9`
      // + `min-height: 500px`），这里直接跟随实测高度；史引副驾驶 iframe 中依旧填满容器。
      const height = Math.max(320, observedHeight || Math.round((width * 9) / 16));
      setSize((current) =>
        current.width === width && current.height === height ? current : { width, height },
      );
    });

    observer.observe(host);
    return () => observer.disconnect();
  }, [fillContainer]);

  useEffect(() => {
    const svgElement = svgRef.current;
    if (!svgElement || !oneHopView) return;

    const { center, nodes: sourceNodes, edges: sourceEdges } = oneHopView;
    const { width, height } = size;
    const nodes: ForceNode[] = sourceNodes.map((node) => ({
      ...node,
      isCenter: node.id === center.id,
    }));
    const nodeById = new Map(nodes.map((node) => [node.id, node]));
    const edges: ForceEdge[] = sourceEdges.map((edge) => ({ ...edge }));
    const centerNode = nodeById.get(center.id);

    if (!centerNode) return;

    /**
     * V1.0.8（比例与缩放专项）：按「画布尺寸 + 一跳邻居数量」推导自适应布局参数。
     * 邻居少（如夏朝 5 人）时环半径收敛、斥力减弱，不再「飞得太散」；
     * 邻居多（如秦汉 27 人）时环半径增大、斥力增强，再由 fit 视图整体缩小。
     */
    const layout = computeGraphLayout({
      width,
      height,
      neighborCount: nodes.length - 1,
    });

    // 中心人物固定居中（fit 视图会再次保证整个包围盒中心 = 画布中心）。
    centerNode.fx = layout.centerX;
    centerNode.fy = layout.centerY;

    // 邻居从正上方开始均匀铺在初始环上：模拟一开始就分布均匀，避免随机初值导致的单侧堆积。
    let neighborIndex = 0;
    for (const node of nodes) {
      if (node.isCenter) {
        node.x = layout.centerX;
        node.y = layout.centerY;
        continue;
      }
      const angle = layout.initialAngles[neighborIndex] ?? 0;
      neighborIndex += 1;
      node.x = layout.centerX + Math.cos(angle) * layout.initialRadius;
      node.y = layout.centerY + Math.sin(angle) * layout.initialRadius;
      node.vx = 0;
      node.vy = 0;
    }

    const simulation = forceSimulation(nodes)
      .force(
        "link",
        forceLink<ForceNode, ForceEdge>(edges)
          .id((node) => node.id)
          .distance(layout.linkDistance)
          .strength(0.72),
      )
      .force(
        "charge",
        forceManyBody().strength(layout.chargeStrength).distanceMax(layout.chargeDistanceMax),
      )
      .force("collide", forceCollide<ForceNode>().radius(layout.collideRadius).strength(0.9))
      // 径向力把邻居约束在目标环上：少量邻居不散、多量邻居均匀铺满。
      .force(
        "radial",
        forceRadial<ForceNode>(
          (node) => (node.isCenter ? 0 : layout.ringRadius),
          layout.centerX,
          layout.centerY,
        ).strength((node) => (node.isCenter ? 0 : 0.4)),
      )
      .force("center", forceCenter(layout.centerX, layout.centerY));

    const svg = select(svgElement)
      .attr("viewBox", `0 0 ${width} ${height}`)
      .attr("preserveAspectRatio", "xMidYMid meet")
      .attr("aria-label", `以${center.name}为中心的人物关系图，共 ${nodes.length - 1} 位直接关系人`)
      .on("contextmenu", (event: MouseEvent) => event.preventDefault());

    // SVG 子树只由 D3 管理；React 仅管理 svg 容器与关系详情面板。
    svg.selectAll("*").remove();

    // V1.0.6.2（痛点 3）：缩放 / 平移作用在唯一的 viewport 分组上，节点 / 连线都在其内。
    const viewport = svg.append("g").attr("class", styles.viewport);
    const viewState = viewTransformRef.current;
    viewState.k = 1;
    viewState.x = 0;
    viewState.y = 0;
    const applyViewTransform = () => {
      viewport.attr(
        "transform",
        `translate(${viewState.x},${viewState.y}) scale(${viewState.k})`,
      );
    };
    applyViewTransform();

    /**
     * V1.0.8（比例与缩放专项）：把整张关系图（含节点半径与标签）等比装进当前画布。
     *
     * 视图变换由纯函数 `computeFitTransform` 计算：包围盒中心精确落在画布中心，
     * 邻居少（包围盒小）时自动放大、邻居多（包围盒大）时自动缩小。
     * 「复位视图」也复用该逻辑。
     */
    const fitViewToNodes = () => {
      if (nodes.length === 0) return;
      const fitted = computeFitTransform({
        width,
        height,
        points: nodes.map((node) => ({
          x: node.x ?? layout.centerX,
          y: node.y ?? layout.centerY,
        })),
        nodeRadius: NODE_RADIUS,
      });
      viewState.k = fitted.k;
      viewState.x = fitted.x;
      viewState.y = fitted.y;
      applyViewTransform();
    };

    /**
     * 用户是否已手动缩放（＋ / － 按钮）/ 平移 / 拖拽节点。
     *
     * 模拟收敛前视图会持续自适应（从中心自然舒展到完整装进画布）；一旦用户主动操作，
     * 立即把视图控制权交还用户，后续 tick 不再覆盖用户的缩放 / 平移。
     */
    let userAdjustedView = false;

    /** 以 SVG 坐标系中的 (cx, cy) 为锚点缩放（仅左下角 ＋ / － 按钮调用）。 */
    const zoomAt = (factor: number, cx: number, cy: number) => {
      userAdjustedView = true;
      const nextScale = Math.min(3, Math.max(0.45, viewState.k * factor));
      const ratio = nextScale / viewState.k;
      viewState.x = cx - ratio * (cx - viewState.x);
      viewState.y = cy - ratio * (cy - viewState.y);
      viewState.k = nextScale;
      applyViewTransform();
    };
    const resetView = () => {
      fitViewToNodes();
    };
    zoomControlsRef.current = {
      zoomIn: () => zoomAt(1.2, width / 2, height / 2),
      zoomOut: () => zoomAt(1 / 1.2, width / 2, height / 2),
      reset: resetView,
    };

    // 首帧先按初始分布 fit 一次，避免「先居中原始坐标、再跳变缩放」的闪烁。
    fitViewToNodes();

    const linkLayer = viewport.append("g").attr("aria-hidden", "true");
    const nodeLayer = viewport.append("g");
    const linkSelection = linkLayer
      .selectAll<SVGLineElement, ForceEdge>("line")
      .data(edges, (edge) => edge.id)
      .join("line")
      .attr("class", styles.link)
      .attr("stroke-width", (edge) => 1 + Math.min(edge.weight, 4) * 0.7);

    const baseNodeLabel = (node: ForceNode) =>
      node.isCenter
        ? `当前中心人物：${node.name}`
        : `${node.name}；与${center.name}共同参与 ${findRelationship(sourceEdges, center.id, node.id)?.weight ?? 0} 件事件。按 Enter 查看详情，长按切换中心人物。`;

    const nodeSelection = nodeLayer
      .selectAll<SVGGElement, ForceNode>("g")
      .data(nodes, (node) => node.id)
      .join("g")
      .attr("class", (node) => `${styles.node}${node.isCenter ? ` ${styles.nodeCenter}` : ""}`)
      .attr("tabindex", (node) => (node.isCenter ? -1 : 0))
      .attr("role", (node) => (node.isCenter ? "img" : "button"))
      .attr("aria-label", baseNodeLabel);

    nodeSelection
      .append("circle")
      .attr("r", (node) => (node.isCenter ? NODE_RADIUS + 6 : NODE_RADIUS));

    nodeSelection
      .append("text")
      .attr("class", styles.nodeLabel)
      .attr("dy", (node) => (node.isCenter ? 4 : NODE_RADIUS + 15))
      .text((node) => node.name);

    // 受控选中 / 高亮只改 class 与 aria：力导向模拟不因 React 状态变化而重跑。
    const highlightedSet = new Set(highlightedIds);
    const applyNodeStates = () => {
      const selectedId = activeRelationship?.person.id ?? null;
      nodeSelection
        .classed(styles.nodeHighlighted, (node) => !node.isCenter && highlightedSet.has(node.id))
        .classed(styles.nodeSelected, (node) => node.id === selectedId)
        .attr("aria-label", (node) => {
          const label = baseNodeLabel(node);
          if (node.id === selectedId) return `${label}（已选中）`;
          if (!node.isCenter && highlightedSet.has(node.id)) return `${label}（重点人物）`;
          return label;
        })
        .attr("aria-pressed", (node) =>
          node.isCenter ? null : node.id === selectedId ? "true" : "false",
        );
    };
    nodeSelectionRef.current = nodeSelection;
    applyNodeStatesRef.current = applyNodeStates;
    applyNodeStates();

    const clearInteraction = () => {
      const interaction = interactionRef.current;
      if (interaction?.timer) clearTimeout(interaction.timer);
      interactionRef.current = null;
    };

    /** 屏幕坐标 → SVG viewBox 坐标（节点拖拽坐标换算的中间步骤）。 */
    const pointInViewBox = (event: { clientX: number; clientY: number }) => {
      const bounds = svgElement.getBoundingClientRect();
      return {
        x: ((event.clientX - bounds.left) / Math.max(1, bounds.width)) * width,
        y: ((event.clientY - bounds.top) / Math.max(1, bounds.height)) * height,
      };
    };

    /** 屏幕坐标 → 视图变换后的 SVG 坐标（节点拖拽需要抵消缩放 / 平移）。 */
    const pointInSvg = (event: PointerEvent) => {
      const point = pointInViewBox(event);
      return {
        x: (point.x - viewState.x) / viewState.k,
        y: (point.y - viewState.y) / viewState.k,
      };
    };

    // V1.0.8 体验修复（Bug 1）：**不再绑定 wheel.zoom**。
    // 旧实现 `svg.on("wheel.zoom", ...)` 会 preventDefault 并在滚轮时缩放画布，
    // 用户想滚动页面时经常误触；现在滚轮事件完全不拦截，交给浏览器正常滚动页面，
    // 缩放只保留左下角 ＋ / － / ⟲ 按钮，此外保留空白处拖拽平移。
    let panState: {
      pointerId: number;
      startClientX: number;
      startClientY: number;
      originX: number;
      originY: number;
    } | null = null;

    svg
      .on("pointerdown.pan", (event: PointerEvent) => {
        if (event.button !== 0) return;
        const target = event.target as Element | null;
        if (target?.closest?.(`.${styles.node}`)) return;
        // 用户开始平移即交还视图控制权，模拟收敛期间不再自动 fit 覆盖。
        userAdjustedView = true;
        panState = {
          pointerId: event.pointerId,
          startClientX: event.clientX,
          startClientY: event.clientY,
          originX: viewState.x,
          originY: viewState.y,
        };
        svgElement.setPointerCapture(event.pointerId);
      })
      .on("pointermove.pan", (event: PointerEvent) => {
        if (!panState || panState.pointerId !== event.pointerId) return;
        const bounds = svgElement.getBoundingClientRect();
        if (!bounds.width || !bounds.height) return;
        viewState.x =
          panState.originX + ((event.clientX - panState.startClientX) / bounds.width) * width;
        viewState.y =
          panState.originY + ((event.clientY - panState.startClientY) / bounds.height) * height;
        applyViewTransform();
      })
      .on("pointerup.pan", (event: PointerEvent) => {
        if (!panState || panState.pointerId !== event.pointerId) return;
        if (svgElement.hasPointerCapture(event.pointerId)) {
          svgElement.releasePointerCapture(event.pointerId);
        }
        panState = null;
      })
      .on("pointercancel.pan", () => {
        panState = null;
      });

    const selectRelationship = (node: ForceNode) => {
      const edge = findRelationship(sourceEdges, center.id, node.id);
      if (!edge) return;
      // 非受控模式保持 V0.9.0 行为（点击即开面板）；受控模式由父级回传 selectedPersonId。
      if (!isSelectionControlled) setSelectedRelationship({ person: node, edge });
      onPersonSelect?.(node.id);
    };

    nodeSelection
      .on("pointerdown", function (event: PointerEvent, node) {
        if (node.isCenter || (event.pointerType === "mouse" && event.button !== 0)) return;

        event.preventDefault();
        event.stopPropagation();
        clearInteraction();
        const target = this as SVGGElement;
        target.setPointerCapture(event.pointerId);
        const start = pointInSvg(event);
        const interaction: PointerInteraction = {
          pointerId: event.pointerId,
          node,
          target,
          startX: start.x,
          startY: start.y,
          mode: "pressing",
          timer: null,
        };

        interaction.timer = setTimeout(() => {
          const current = interactionRef.current;
          if (!current || current.pointerId !== event.pointerId || current.mode !== "pressing") return;

          current.mode = "longPressed";
          current.timer = null;
          onCenterPersonChange(node.id);
        }, LONG_PRESS_MS);

        interactionRef.current = interaction;
      })
      .on("pointermove", (event: PointerEvent) => {
        const interaction = interactionRef.current;
        if (!interaction || interaction.pointerId !== event.pointerId || interaction.mode === "longPressed") {
          return;
        }

        const point = pointInSvg(event);
        const distance = Math.hypot(point.x - interaction.startX, point.y - interaction.startY);
        if (interaction.mode === "pressing" && distance > DRAG_THRESHOLD_PX) {
          interaction.mode = "dragging";
          if (interaction.timer) clearTimeout(interaction.timer);
          interaction.timer = null;
        }

        if (interaction.mode === "dragging") {
          interaction.node.fx = point.x;
          interaction.node.fy = point.y;
          userAdjustedView = true;
          simulation.alphaTarget(0.22).restart();
        }
      })
      .on("pointerup", (event: PointerEvent) => {
        const interaction = interactionRef.current;
        if (!interaction || interaction.pointerId !== event.pointerId) return;

        if (interaction.target.hasPointerCapture(event.pointerId)) {
          interaction.target.releasePointerCapture(event.pointerId);
        }

        if (interaction.mode === "pressing") {
          selectRelationship(interaction.node);
        } else if (interaction.mode === "dragging") {
          interaction.node.fx = null;
          interaction.node.fy = null;
          simulation.alphaTarget(0);
        }
        clearInteraction();
      })
      .on("pointercancel", () => {
        const interaction = interactionRef.current;
        if (interaction?.mode === "dragging") {
          interaction.node.fx = null;
          interaction.node.fy = null;
          simulation.alphaTarget(0);
        }
        clearInteraction();
      })
      .on("keydown", (event: KeyboardEvent, node) => {
        if (node.isCenter || (event.key !== "Enter" && event.key !== " ")) return;
        event.preventDefault();
        selectRelationship(node);
      })
      // pointerup 已决定短按/长按；吞掉后续浏览器 click，保持两者绝对互斥。
      .on("click", (event: MouseEvent) => event.preventDefault());

    const asNode = (endpoint: string | ForceNode): ForceNode =>
      typeof endpoint === "string" ? nodeById.get(endpoint)! : endpoint;

    const render = () => {
      linkSelection
        .attr("x1", (edge) => asNode(edge.source).x ?? width / 2)
        .attr("y1", (edge) => asNode(edge.source).y ?? height / 2)
        .attr("x2", (edge) => asNode(edge.target).x ?? width / 2)
        .attr("y2", (edge) => asNode(edge.target).y ?? height / 2);
      nodeSelection.attr("transform", (node) => `translate(${node.x ?? width / 2},${node.y ?? height / 2})`);
    };

    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduceMotion) {
      simulation.stop();
      for (let index = 0; index < 180; index += 1) simulation.tick();
      fitViewToNodes();
      render();
    } else {
      // V1.0.8（比例与缩放专项）：模拟收敛前持续自适应视图——图从中心自然舒展并始终保持完整居中；
      // 用户一旦拖拽平移 / 拖动节点（或点击缩放按钮），就停止自动 fit，把视图完全交还用户。
      simulation.on("tick", () => {
        render();
        if (!userAdjustedView) fitViewToNodes();
      });
      // 模拟自然停止后再补一次最终 fit，保证终态一定居中且完整装进画布。
      simulation.on("end", () => {
        render();
        if (!userAdjustedView) fitViewToNodes();
      });
    }

    return () => {
      clearInteraction();
      simulation.stop();
      simulation.on("tick", null);
      simulation.on("end", null);
      svg.on("contextmenu", null);
      svg.on(".pan", null);
      svg.selectAll("*").remove();
      nodeSelectionRef.current = null;
      applyNodeStatesRef.current = null;
      zoomControlsRef.current = null;
    };
    // 注意：受控选中 / 高亮**故意不进入依赖**——它们只通过上面的独立 effect 更新 class，
    // 若放进来会在每次点击时重推力导向，破坏既有交互手感（TC-08 约束）。
  }, [centerPersonId, onCenterPersonChange, onPersonSelect, oneHopView, size]);

  if (!oneHopView) {
    return <p className={styles.empty}>未找到中心人物数据。</p>;
  }

  const { center } = oneHopView;

  return (
    <section
      className={`${styles.layout}${fillContainer ? ` ${styles.layoutFill}` : ""}`}
      aria-label="人物关系网络"
    >
      <div ref={graphHostRef} className={styles.graphHost} data-graph-host="true">
        <svg ref={svgRef} className={styles.graph} role="img" />
        <div className={styles.zoomControls} role="group" aria-label="关系图缩放与平移">
          <button
            type="button"
            aria-label="放大关系图"
            title="放大"
            onClick={() => zoomControlsRef.current?.zoomIn()}
          >
            ＋
          </button>
          <button
            type="button"
            aria-label="缩小关系图"
            title="缩小"
            onClick={() => zoomControlsRef.current?.zoomOut()}
          >
            －
          </button>
          <button
            type="button"
            aria-label="复位关系图视图"
            title="复位视图"
            onClick={() => zoomControlsRef.current?.reset()}
          >
            ⟲
          </button>
        </div>
        <p className={styles.graphHint}>
          单击人物看关系与共同事件；长按 0.5 秒换中心；拖拽节点或空白处调整；
          左下角 ＋ / － 缩放。
        </p>
      </div>

      <aside
        ref={panelRef}
        className={styles.panel}
        aria-live="polite"
        aria-label="人物关系与共同事件详情"
        tabIndex={0}
        data-graph-info-card="true"
      >
        {activeRelationship ? (
          <>
            <p className={styles.panelEyebrow}>人物关系</p>
            <h2 className={styles.panelTitle}>
              {center.name} × {activeRelationship.person.name}
            </h2>
            <p className={styles.panelLead}>
              两人共同参与 {activeRelationship.edge.weight} 件历史事件。
            </p>

            {activeRelationship.edge.relation ? (
              <div className={styles.relationBox}>
                <span className={styles.relationBadge}>
                  {activeRelationship.edge.relation.label}
                </span>
                {activeRelationship.edge.relation.description ? (
                  <p className={styles.relationNote}>
                    {activeRelationship.edge.relation.description}
                  </p>
                ) : null}
              </div>
            ) : null}

            <ol className={styles.eventList}>
              {activeRelationship.edge.sharedEvents.map((event) => (
                <li key={event.id}>
                  <span>
                    {formatYear(event.year)} · {event.dynasty}
                  </span>
                  <strong>{event.title}</strong>
                  <p className={styles.eventSummary}>
                    {activeRelationship.edge.relation?.eventSummaries[event.id] ??
                      event.summary}
                  </p>
                </li>
              ))}
            </ol>
          </>
        ) : (
          <>
            <p className={styles.panelEyebrow}>当前中心</p>
            <h2 className={styles.panelTitle}>{center.name}</h2>
            <p className={styles.panelLead}>
              当前显示 {center.relatedPeople.length} 位直接关系人。选择任一节点，查看共同参与的历史事件。
            </p>
          </>
        )}
      </aside>
    </section>
  );
}
