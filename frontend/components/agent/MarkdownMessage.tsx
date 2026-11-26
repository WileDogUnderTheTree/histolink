"use client";

import { useState } from "react";
import type { ElementType, ReactNode } from "react";
import Link from "next/link";

import {
  collectInlineTreeBlock,
  parseInlineRelationBlock,
  relationTreeNotice,
} from "@/lib/relation-tree";
import type { InlineRelationTree } from "@/lib/relation-tree";

import styles from "./MarkdownMessage.module.css";

const INLINE_MARKDOWN = /(\[[^\]]+\]\((?:https?:\/\/|\/)[^)]+\)|\*\*[^*]+\*\*|__[^_]+__|`[^`]+`|\*[^*]+\*|_[^_]+_)/g;
const TABLE_SEPARATOR = /^\s*\|?\s*:?-{3,}:?\s*(?:\|\s*:?-{3,}:?\s*)+\|?\s*$/;

function renderInline(text: string): ReactNode[] {
  return text.split(INLINE_MARKDOWN).map((part, index) => {
    if (!part) return null;
    const link = part.match(/^\[([^\]]+)\]\(((?:https?:\/\/|\/)[^)]+)\)$/);
    if (link) {
      const [, label, href] = link;
      return href.startsWith("http://") || href.startsWith("https://") ? (
        <a key={index} href={href} target="_blank" rel="noreferrer">{label}</a>
      ) : <Link key={index} href={href}>{label}</Link>;
    }
    if ((part.startsWith("**") && part.endsWith("**")) || (part.startsWith("__") && part.endsWith("__"))) {
      return <strong key={index}>{part.slice(2, -2)}</strong>;
    }
    if (part.startsWith("`") && part.endsWith("`")) return <code key={index}>{part.slice(1, -1)}</code>;
    if ((part.startsWith("*") && part.endsWith("*")) || (part.startsWith("_") && part.endsWith("_"))) {
      return <em key={index}>{part.slice(1, -1)}</em>;
    }
    return <span key={index}>{part}</span>;
  });
}

function isBlockStart(line: string): boolean {
  return /^(#{1,6})\s+/.test(line)
    || /^\s*[-*+]\s+/.test(line)
    || /^\s*\d+[.)]\s+/.test(line)
    || /^\s*>\s?/.test(line)
    || line.trim().startsWith("```")
    || line.includes("|");
}

function tableCells(line: string): string[] {
  const value = line.trim().replace(/^\|/, "").replace(/\|$/, "");
  return value.split(/(?<!\\)\|/).map((cell) => cell.replace(/\\\|/g, "|").trim());
}

function Table({ header, rows }: { header: string[]; rows: string[][] }) {
  return (
    <div className={styles.tableWrap} role="region" aria-label="回答表格" tabIndex={0}>
      <table>
        <thead><tr>{header.map((cell, index) => <th key={`head-${index}`}>{renderInline(cell)}</th>)}</tr></thead>
        <tbody>{rows.map((row, rowIndex) => <tr key={`row-${rowIndex}`}>
          {header.map((_, cellIndex) => <td key={`cell-${rowIndex}-${cellIndex}`}>{renderInline(row[cellIndex] ?? "")}</td>)}
        </tr>)}</tbody>
      </table>
    </div>
  );
}

/**
 * 内联文字关系树 → 默认折叠卡片（V1.0.6.3 痛点 3）。
 *
 * 模型偶尔会在大段正文里画一整棵家族树（十行以上），默认只展示一句提示文案，
 * 完整交互图交给右侧史引面板；想看原文时仍可展开文字版（不丢信息）。
 */
function RelationTreeNotice({ tree }: { tree: InlineRelationTree }) {
  const [expanded, setExpanded] = useState(false);
  return (
    <div className={styles.relationTree} data-relation-tree="collapsed">
      <p className={styles.relationTreeText}>{relationTreeNotice(tree)}</p>
      <button
        type="button"
        className={styles.relationTreeToggle}
        aria-expanded={expanded}
        onClick={() => setExpanded((value) => !value)}
      >
        {expanded ? "收起文字版" : `展开文字版（${tree.count} 行）`}
      </button>
      {expanded ? (
        <pre className={styles.relationTreePre}>
          <code>{tree.lines.join("\n")}</code>
        </pre>
      ) : null}
    </div>
  );
}

/** Safe, dependency-free Markdown subset used by both the drawer and /ask workspace. */
export function MarkdownMessage({ content }: { content: string }) {
  const lines = content.replace(/\r\n?/g, "\n").split("\n");
  const blocks: ReactNode[] = [];
  let index = 0;

  while (index < lines.length) {
    const line = lines[index];
    if (!line.trim()) { index += 1; continue; }

    if (line.trim().startsWith("```")) {
      const code: string[] = [];
      index += 1;
      while (index < lines.length && !lines[index].trim().startsWith("```")) { code.push(lines[index]); index += 1; }
      if (index < lines.length) index += 1;
      // V1.0.6.3：代码块里的关系树（制表符家族树 / Mermaid 箭头边列表）同样默认折叠，
      // 避免一段树把气泡撑到十几屏。
      const tree = parseInlineRelationBlock(code);
      if (tree) {
        blocks.push(<RelationTreeNotice key={`tree-code-${index}`} tree={tree} />);
      } else {
        blocks.push(<pre key={`code-${index}`}><code>{code.join("\n")}</code></pre>);
      }
      continue;
    }

    // V1.0.6.3：正文里未用代码块包裹的关系树（「李渊 / ├── 李建成 …」）默认折叠。
    const inlineTree = collectInlineTreeBlock(lines, index);
    if (inlineTree) {
      blocks.push(<RelationTreeNotice key={`tree-${index}`} tree={inlineTree.tree} />);
      index = inlineTree.end;
      continue;
    }

    const heading = line.match(/^(#{1,6})\s+(.+)$/);
    if (heading) {
      const Heading = `h${Math.min(heading[1].length, 6)}` as ElementType;
      blocks.push(<Heading key={`heading-${index}`}>{renderInline(heading[2])}</Heading>);
      index += 1;
      continue;
    }

    if (index + 1 < lines.length && line.includes("|") && TABLE_SEPARATOR.test(lines[index + 1])) {
      const header = tableCells(line);
      index += 2;
      const rows: string[][] = [];
      while (index < lines.length && lines[index].trim() && lines[index].includes("|")) {
        rows.push(tableCells(lines[index]));
        index += 1;
      }
      blocks.push(<Table key={`table-${index}`} header={header} rows={rows} />);
      continue;
    }

    if (/^\s*[-*+]\s+/.test(line)) {
      const items: ReactNode[] = [];
      while (index < lines.length && /^\s*[-*+]\s+/.test(lines[index])) {
        items.push(<li key={`${index}-${items.length}`}>{renderInline(lines[index].replace(/^\s*[-*+]\s+/, ""))}</li>);
        index += 1;
      }
      blocks.push(<ul key={`list-${index}`}>{items}</ul>);
      continue;
    }

    if (/^\s*\d+[.)]\s+/.test(line)) {
      const items: ReactNode[] = [];
      while (index < lines.length && /^\s*\d+[.)]\s+/.test(lines[index])) {
        items.push(<li key={`${index}-${items.length}`}>{renderInline(lines[index].replace(/^\s*\d+[.)]\s+/, ""))}</li>);
        index += 1;
      }
      blocks.push(<ol key={`ordered-${index}`}>{items}</ol>);
      continue;
    }

    if (/^\s*>\s?/.test(line)) {
      const quote: string[] = [];
      while (index < lines.length && /^\s*>\s?/.test(lines[index])) { quote.push(lines[index].replace(/^\s*>\s?/, "")); index += 1; }
      blocks.push(<blockquote key={`quote-${index}`}>{quote.map((item, quoteIndex) => <p key={quoteIndex}>{renderInline(item)}</p>)}</blockquote>);
      continue;
    }

    const paragraph: string[] = [line];
    index += 1;
    while (index < lines.length && lines[index].trim() && !isBlockStart(lines[index])) { paragraph.push(lines[index]); index += 1; }
    blocks.push(<p key={`paragraph-${index}`}>{paragraph.map((item, paragraphIndex) => <span key={paragraphIndex}>{paragraphIndex > 0 ? <br /> : null}{renderInline(item)}</span>)}</p>);
  }

  return <div className={styles.markdown}>{blocks}</div>;
}
