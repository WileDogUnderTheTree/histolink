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
}: PersonGraph2DProps) {
  const graphHostRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const interactionRef = useRef<PointerInteraction | null>(null);
  const [size, setSize] = useState({ width: 860, height: 620 });
  const [selectedRelationship, setSelectedRelationship] = useState<SelectedRelationshipState | null>(null);

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
      const height = width < 620 ? 520 : 620;
      setSize((current) =>
        current.width === width && current.height === height ? current : { width, height },
      );
    });

    observer.observe(host);
    return () => observer.disconnect();
  }, []);

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

    const linkLayer = svg.append("g").attr("aria-hidden", "true");
    const nodeLayer = svg.append("g");
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

    const pointInSvg = (event: PointerEvent) => {
      const bounds = svgElement.getBoundingClientRect();
      return {
        x: ((event.clientX - bounds.left) / bounds.width) * width,
        y: ((event.clientY - bounds.top) / bounds.height) * height,
      };
    };

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
      render();
    } else {
      simulation.on("tick", render);
    }

    return () => {
      clearInteraction();
      simulation.stop();
      svg.on("contextmenu", null);
      svg.selectAll("*").remove();
      nodeSelectionRef.current = null;
      applyNodeStatesRef.current = null;
    };
    // 注意：受控选中 / 高亮**故意不进入依赖**——它们只通过上面的独立 effect 更新 class，
    // 若放进来会在每次点击时重推力导向，破坏既有交互手感（TC-08 约束）。
  }, [centerPersonId, onCenterPersonChange, onPersonSelect, oneHopView, size]);

  if (!oneHopView) {
    return <p className={styles.empty}>未找到中心人物数据。</p>;
  }

  const { center } = oneHopView;

  return (
    <section className={styles.layout} aria-label="人物关系网络">
      <div ref={graphHostRef} className={styles.graphHost}>
        <svg ref={svgRef} className={styles.graph} role="img" />
        <p className={styles.graphHint}>单击人物查看两人关系与共同事件；长按约 0.5 秒切换中心；拖拽可调整位置。</p>
      </div>

      <aside className={styles.panel} aria-live="polite">
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
