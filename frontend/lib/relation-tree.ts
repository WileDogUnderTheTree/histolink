/**
 * 聊天气泡内联「文字关系树」折叠（V1.0.6.3 痛点 3）。
 *
 * 背景：本地模型有时会把一大棵家族关系树（`李渊 ├── 李建成 └── 李世民 …`，十行起步）
 * 直接写进回答正文，聊天气泡被撑得极长；而真正可交互的 2D 力导向图在右侧史引面板。
 *
 * 本模块提供**纯函数**（无 React、无 DOM）：
 * - `parseRelationTreeLines()`：一段文本行是否是「单根 + 多子节点」的关系树；
 * - `collectInlineTreeBlock()`：正文中从任意行开始的连续关系树块（含根节点行）；
 * - `relationTreeNotice()`：折叠后展示的唯一一句话。
 *
 * 判定刻意保守：必须出现至少 2 个树形连接符（├ └ │ ┬ 等）且除根节点外每一行都带连接符，
 * 避免把普通正文 / 列表误折叠。默认折叠文案由调用方渲染，可展开看原文字版。
 */

/** 常见树形连接符（制表符 Box Drawing + 部分全角变体）。 */
const TREE_CONNECTOR = /[├└┌┐┘┬┴┼╔╗╚╝╠╣╦╩╬]/;

/** 箭头式关系图（Mermaid / ASCII 边列表，如 `A[李渊] --> B[李世民]`）。 */
const EDGE_ARROW = /(?:--+>|==+>|—+>|->)/;
/** Mermaid 节点定义：`ID[显示名]` / `ID(显示名)` / `ID{显示名}` / `ID["显示名"]`。 */
const MERMAID_NODE = /([A-Za-z0-9_\u4e00-\u9fa5]+)\s*[\[（({]\s*["'“]?\s*([^\]）)}"'”]+?)\s*["'”]?\s*[\])）}]/g;

/** 根节点行最长字符数：超过该长度多半是正文段落而非树根。 */
const MAX_ROOT_LENGTH = 24;

/** 子节点最少个数：低于 2 个不算「一大棵关系树」，保持正文原样。 */
const MIN_CHILDREN = 2;

export interface InlineRelationTree {
  /** 关系树根节点名（折叠文案里的「某某家族」）；无法确定根节点时为空字符串。 */
  root: string;
  /** 子节点数量（折叠文案里的「N 位核心亲属」）。 */
  count: number;
  /** 去掉空行后的原始树行（用于「展开文字版」）。 */
  lines: string[];
}

function hasConnector(line: string): boolean {
  return TREE_CONNECTOR.test(line);
}

/** 去掉连接符 / 缩进，提取根节点文字。 */
function extractRootText(line: string): string {
  return line
    .replace(/[├└┌┐┘┬┴┼╔╗╚╝╠╣╦╩╬]/g, " ")
    .replace(/[─━\-—–_+|／/\\]/g, " ")
    .replace(/[（(].*?[)）]/g, "")
    .replace(/\s+/g, "")
    .trim();
}

/**
 * 解析「根节点 + 多个树形子节点」的关系树块。
 *
 * @param lines 候选行（可含空行，函数内部会过滤）。
 * @returns 合法关系树；不是关系树时返回 null。
 */
export function parseRelationTreeLines(
  lines: readonly string[],
): InlineRelationTree | null {
  const nonEmpty = lines.map((line) => line.trim()).filter(Boolean);
  if (nonEmpty.length < MIN_CHILDREN + 1) return null;
  if (hasConnector(nonEmpty[0])) return null;
  const root = extractRootText(nonEmpty[0]);
  if (!root || root.length > MAX_ROOT_LENGTH) return null;

  const children = nonEmpty.slice(1);
  if (children.some((line) => !hasConnector(line))) return null;
  if (children.length < MIN_CHILDREN) return null;

  return { root, count: children.length, lines: nonEmpty };
}

/**
 * 解析「箭头式关系图 / 关系树」（Mermaid / ASCII 边列表）：
 *
 * ```
 * A[李渊] --> B[李建成]
 * A --> C[李世民]
 * A --> D[李元吉]
 * ```
 *
 * 与制表符家族树一样折叠成一句话；根节点取「没有入边的节点」，数量取不同人物标签数 - 1。
 */
export function parseRelationGraphLines(
  lines: readonly string[],
): InlineRelationTree | null {
  const nonEmpty = lines
    .map((line) => line.trim())
    .filter((line) => Boolean(line) && !/^(graph|flowchart)\b/i.test(line) && !line.startsWith("%%"));
  const edgeLines = nonEmpty.filter((line) => EDGE_ARROW.test(line));
  if (edgeLines.length < MIN_CHILDREN) return null;

  // 第一遍：收集 `ID[显示名]` 形式的节点定义。
  const keyToLabel = new Map<string, string>();
  const allKeys: string[] = [];
  const rememberKey = (key: string, label: string) => {
    if (!key) return;
    if (!allKeys.includes(key)) allKeys.push(key);
    const clean = label.replace(/["'“”]/g, "").trim();
    if (clean && !keyToLabel.has(key)) keyToLabel.set(key, clean);
  };
  for (const line of nonEmpty) {
    MERMAID_NODE.lastIndex = 0;
    for (const match of line.matchAll(MERMAID_NODE)) {
      rememberKey(match[1], match[2]);
    }
  }

  const incoming = new Set<string>();
  const resolveToken = (raw: string): string | null => {
    const token = raw.trim().replace(/^["'“]|["'”]$/g, "");
    if (!token) return null;
    MERMAID_NODE.lastIndex = 0;
    const nodeMatch = MERMAID_NODE.exec(token);
    if (nodeMatch) {
      rememberKey(nodeMatch[1], nodeMatch[2]);
      return nodeMatch[1];
    }
    // 裸 ID（ASCII）没有显示名：保留为根节点候选，折叠文案里不写出家族名。
    if (/^[A-Za-z0-9_]+$/.test(token)) {
      rememberKey(token, "");
      return token;
    }
    // 裸中文姓名：节点 key = 显示名。
    rememberKey(token, token);
    return token;
  };

  // 第二遍：解析边，统计入边（根节点 = 没有入边的节点）。
  for (const line of edgeLines) {
    const segments = line.split(EDGE_ARROW);
    const cleaned = segments
      .map((segment) => segment.replace(/\|[^|]*\|/g, "").trim()) // 去掉 `-->|label|` 边标签
      .filter(Boolean);
    if (cleaned.length < 2) continue;
    for (let index = 1; index < cleaned.length; index += 1) {
      const target = resolveToken(cleaned[index]);
      if (target) incoming.add(target);
    }
    resolveToken(cleaned[0]);
  }

  const distinct = allKeys
    .map((key) => keyToLabel.get(key))
    .filter((label): label is string => Boolean(label));
  const uniqueLabels = [...new Set(distinct)];
  if (uniqueLabels.length < MIN_CHILDREN) return null;

  const rootKey = allKeys.find((key) => !incoming.has(key));
  const rootLabel = rootKey ? (keyToLabel.get(rootKey) ?? "") : "";
  // 根节点带显示名时：core relatives = 其余人物；根节点是裸 ID（例如模型只写了
  // `C --> AE[李元礼]`）时：所有出现的显示名都算作亲属。
  const count = rootLabel
    ? Math.max(uniqueLabels.length - 1, MIN_CHILDREN)
    : Math.max(uniqueLabels.length, MIN_CHILDREN);
  return { root: rootLabel, count, lines: nonEmpty };
}

/**
 * 统一入口：先按制表符家族树解析，再按箭头式关系图解析（代码块 / 正文通用）。
 */
export function parseInlineRelationBlock(
  lines: readonly string[],
): InlineRelationTree | null {
  return parseRelationTreeLines(lines) ?? parseRelationGraphLines(lines);
}

/**
 * 从正文第 `start` 行开始收集连续关系树块（含根节点行）。
 *
 * 典型输入：
 * ```
 * 李渊
 * ├── 李建成（长子）
 * ├── 李世民（次子）
 * └── 李凤（五子，封蜀王）
 * ```
 */
export function collectInlineTreeBlock(
  lines: readonly string[],
  start: number,
): { tree: InlineRelationTree; end: number } | null {
  const rootLine = lines[start];
  if (!rootLine || !rootLine.trim() || hasConnector(rootLine)) return null;
  let end = start + 1;
  while (end < lines.length && hasConnector(lines[end])) {
    end += 1;
  }
  const tree = parseRelationTreeLines(lines.slice(start, end));
  if (!tree) return null;
  return { tree, end };
}

/** 默认折叠后展示的唯一一句话（V1.0.6.3 需求文案）。 */
export function relationTreeNotice(tree: InlineRelationTree): string {
  if (!tree.root) {
    return `已为您提取到 ${tree.count} 位核心亲属，请点击右侧展开图谱查看`;
  }
  return `已为您提取到${tree.root}家族的 ${tree.count} 位核心亲属，请点击右侧展开图谱查看`;
}