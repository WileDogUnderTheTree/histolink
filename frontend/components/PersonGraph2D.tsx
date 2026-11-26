"use client";

import {
  forceCenter,
  forceCollide,
  forceLink,
  forceManyBody,
  forceSimulation,
  type SimulationNodeDatum,
} from "d3-force";
import { select } from "d3-selection";
import type { Selection } from "d3-selection";
import { useEffect, useMemo, useRef, useState } from "react";

import type { PersonGraphData, PersonGraphEdge, PersonGraphNode } from "@/data/person-graph";
import {
  findRelationship,
  normalizeHighlightedPersonIds,
  resolveSelectedRelationship,
} from "@/lib/graph-selection";
import { formatYear } from "@/lib/year";

import styles from "./PersonGraph2D.module.css";

const LONG_PRESS_MS = 500;
const DRAG_THRESHOLD_PX = 7;
const NODE_RADIUS = 22;

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

  useEffect(() => {
    const host = graphHostRef.current;
    if (!host) return;

    const observer = new ResizeObserver(([entry]) => {
      const width = Math.max(320, Math.round(entry.contentRect.width));
      const observedHeight = Math.round(entry.contentRect.height);
      // V1.0.6.2（痛点 3）/ V1.0.6.3：史引副驾驶中图表填满容器高度（不再回退固定 520/620），
      // 普通页面仍沿用固定高度策略（窄图 520 / 宽图 620）。
      const height = fillContainer
        ? Math.max(240, observedHeight)
        : width < 620
          ? 520
          : 620;
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

    centerNode.fx = width / 2;
    centerNode.fy = height / 2;

    const simulation = forceSimulation(nodes)
      .force(
        "link",
        forceLink<ForceNode, ForceEdge>(edges)
          .id((node) => node.id)
          .distance((edge) => Math.max(110, 190 - edge.weight * 18))
          .strength(0.85),
      )
      .force("charge", forceManyBody().strength(-520))
      .force("collide", forceCollide<ForceNode>().radius(NODE_RADIUS + 16).strength(0.9))
      .force("center", forceCenter(width / 2, height / 2));

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
     * V1.0.6.3（布局专项）：把整张关系图（含节点半径与标签）自动适配进当前画布。
     *
     * 力导向图稳定后节点分布半径是未知的，之前固定 viewBox 导致图偏小、四周留大片白边。
     * 这里按节点实际包围盒计算缩放 / 平移，让图尽可能撑满画布；「复位视图」也复用该逻辑。
     */
    const fitViewToNodes = () => {
      if (nodes.length === 0) return;
      const xs = nodes.map((node) => node.x ?? width / 2);
      const ys = nodes.map((node) => node.y ?? height / 2);
      const minX = Math.min(...xs) - NODE_RADIUS - 18;
      const maxX = Math.max(...xs) + NODE_RADIUS + 18;
      // 节点标签在圆点下方（dy = r + 15），底部多留一点空间避免文字被裁。
      const minY = Math.min(...ys) - NODE_RADIUS - 18;
      const maxY = Math.max(...ys) + NODE_RADIUS + 34;
      const contentWidth = Math.max(1, maxX - minX);
      const contentHeight = Math.max(1, maxY - minY);
      const padding = Math.max(12, Math.min(width, height) * 0.04);
      const fittedScale = Math.min(
        (width - padding * 2) / contentWidth,
        (height - padding * 2) / contentHeight,
      );
      const scale = Math.min(2.2, Math.max(0.5, fittedScale));
      viewState.k = scale;
      viewState.x = width / 2 - scale * ((minX + maxX) / 2);
      viewState.y = height / 2 - scale * ((minY + maxY) / 2);
      applyViewTransform();
    };

    /** 以 SVG 坐标系中的 (cx, cy) 为锚点缩放（滚轮 / 按钮共用）。 */
    const zoomAt = (factor: number, cx: number, cy: number) => {
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

    /** 屏幕坐标 → SVG viewBox 坐标（不受视图缩放影响，供滚轮锚点使用）。 */
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

    // V1.0.6.2（痛点 3）：滚轮缩放 + 空白处拖拽平移（图表内部交互，不滚动外层页面）。
    svg.on("wheel.zoom", (event: WheelEvent) => {
      event.preventDefault();
      const anchor = pointInViewBox(event);
      zoomAt(event.deltaY < 0 ? 1.15 : 1 / 1.15, anchor.x, anchor.y);
    });

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
      // V1.0.6.3：前 45 帧持续自适应视图——图从中心自然舒展到撑满画布，
      // 之后的 45 帧内用户仍可滚轮缩放 / 拖拽平移，不会被自动视图覆盖。
      let ticks = 0;
      simulation.on("tick", () => {
        render();
        ticks += 1;
        if (ticks <= 45) fitViewToNodes();
      });
    }

    return () => {
      clearInteraction();
      simulation.stop();
      svg.on("contextmenu", null);
      svg.on(".zoom", null);
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
          单击人物查看两人关系与共同事件；长按约 0.5 秒切换中心；拖拽节点调整位置；
          滚轮缩放、拖拽空白处平移。
        </p>
      </div>

      <aside className={styles.panel} aria-live="polite" data-graph-info-card="true">
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
