/**
 * 图谱受控状态辅助函数（V1.0.1 / TC-08）。
 *
 * 把「选中关系」与「高亮集合」的解析从 `PersonGraph2D` 中拆成纯函数，
 * 既让受控 props 的边界可单测，也避免 D3 渲染管线被 React 状态重写。
 */
import type {
  PersonGraphData,
  PersonGraphEdge,
  PersonGraphNode,
} from "@/data/person-graph";

export interface SelectedRelationship {
  person: PersonGraphNode;
  edge: PersonGraphEdge;
}

/** 在给定边集合里找中心人物与另一人的关系边；不存在返回 undefined。 */
export function findRelationship(
  edges: readonly PersonGraphEdge[],
  centerPersonId: string,
  personId: string,
): PersonGraphEdge | undefined {
  return edges.find(
    (edge) =>
      (edge.source === centerPersonId && edge.target === personId) ||
      (edge.target === centerPersonId && edge.source === personId),
  );
}

/**
 * 解析受控选中项：只有「中心人物的一跳邻居」才返回关系，其余情况返回 null。
 *
 * 受控语义（TC-08）：传入不存在的 id、传中心人物自己、传非邻居 id 都不应崩溃，
 * 也不应打开关系面板；这三个安全边界由此函数统一兜住。
 */
export function resolveSelectedRelationship(
  data: PersonGraphData,
  centerPersonId: string,
  selectedPersonId: string | null | undefined,
): SelectedRelationship | null {
  if (!selectedPersonId || selectedPersonId === centerPersonId) return null;
  const person = data.nodes.find((node) => node.id === selectedPersonId);
  if (!person) return null;
  const edge = findRelationship(data.edges, centerPersonId, selectedPersonId);
  if (!edge) return null;
  return { person, edge };
}

/**
 * 规范化高亮集合：去重、忽略空值、过滤掉当期图中不存在的人物。
 *
 * 返回**新数组**，便于 `useMemo` / effect 依赖比较；未知 id 静默丢弃，
 * 保证后端下发的旧快照 id 不会让组件抛错。
 */
export function normalizeHighlightedPersonIds(
  ids: readonly string[] | null | undefined,
  nodes: readonly PersonGraphNode[],
): readonly string[] {
  if (!ids || ids.length === 0) return [];
  const available = new Set(nodes.map((node) => node.id));
  const seen = new Set<string>();
  const normalized: string[] = [];
  for (const id of ids) {
    if (typeof id !== "string" || !available.has(id) || seen.has(id)) continue;
    seen.add(id);
    normalized.push(id);
  }
  return normalized;
}
