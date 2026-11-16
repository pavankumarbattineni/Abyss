"use client";

import { useMemo, useState } from "react";
import { ChevronRight } from "lucide-react";

import { textWidth, wrapText } from "@/lib/visuals/geometry";
import type { TreeData, TreeNode } from "@/lib/visuals/schemas";
import { cn } from "@/lib/utils";
import { SvgStage, useWidth } from "./stage";

/** Narrower than this, the tree reads better as an indented outline. */
const OUTLINE_BELOW = 560;
const FONT = 12.5;
const LINE = 16;
const ROW_GAP = 12;
const COL_GAP = 56;

interface Placed {
  key: string;
  node: TreeNode;
  depth: number;
  lines: string[];
  width: number;
  height: number;
  x: number;
  y: number;
  parent?: string;
  hidden: number;
}

/** Tidy left-to-right layout: leaves stack top to bottom, parents centre on their children. */
function layoutTree(root: TreeNode, collapsed: Set<string>) {
  const placed: Placed[] = [];
  const colWidth: number[] = [];
  const visit = (node: TreeNode, key: string, depth: number, parent?: string) => {
    const lines = wrapText(node.label, depth === 0 ? 22 : 24, 2);
    const width = Math.max(96, ...lines.map((l) => textWidth(l, FONT) + 28));
    const height = lines.length * LINE + 16;
    colWidth[depth] = Math.max(colWidth[depth] ?? 0, width);
    const item: Placed = {
      key,
      node,
      depth,
      lines,
      width,
      height,
      x: 0,
      y: 0,
      parent,
      hidden: collapsed.has(key) ? node.children.length : 0,
    };
    placed.push(item);
    if (!collapsed.has(key)) node.children.forEach((child, i) => visit(child, `${key}.${i}`, depth + 1, key));
  };
  visit(root, "0", 0);

  const byKey = new Map(placed.map((p) => [p.key, p]));
  const childrenOf = (key: string) => placed.filter((p) => p.parent === key);
  let cursor = 0;
  const place = (item: Placed): number => {
    const kids = childrenOf(item.key);
    if (!kids.length) {
      item.y = cursor + item.height / 2;
      cursor += item.height + ROW_GAP;
      return item.y;
    }
    const ys = kids.map(place);
    item.y = (ys[0] + ys[ys.length - 1]) / 2;
    return item.y;
  };
  place(placed[0]);
  const colX: number[] = [];
  colWidth.forEach((w, d) => (colX[d] = d === 0 ? 0 : colX[d - 1] + colWidth[d - 1] + COL_GAP));
  for (const item of placed) item.x = colX[item.depth];
  const width = colX[colX.length - 1] + colWidth[colWidth.length - 1];
  return { placed, byKey, width, height: Math.max(cursor - ROW_GAP, placed[0].height) };
}

function count(node: TreeNode): number {
  return 1 + node.children.reduce((n, c) => n + count(c), 0);
}

/** A hierarchy: a collapsible left-to-right tree, or an indented outline on narrow screens. */
export function TreeVisual({ data }: { data: TreeData }) {
  const [ref, width] = useWidth<HTMLDivElement>();
  // Very large trees start with their third level folded.
  const [collapsed, setCollapsed] = useState<Set<string>>(() => {
    if (count(data.root) <= 28) return new Set();
    const keys = new Set<string>();
    data.root.children.forEach((child, i) => child.children.forEach((_, j) => keys.add(`0.${i}.${j}`)));
    return keys;
  });
  const toggle = (key: string) =>
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  return (
    <div ref={ref}>
      {width > 0 && width < OUTLINE_BELOW ? (
        <Outline node={data.root} nodeKey="0" depth={0} collapsed={collapsed} onToggle={toggle} />
      ) : (
        <TreeDrawing data={data} collapsed={collapsed} onToggle={toggle} />
      )}
    </div>
  );
}

function TreeDrawing({
  data,
  collapsed,
  onToggle,
}: {
  data: TreeData;
  collapsed: Set<string>;
  onToggle: (key: string) => void;
}) {
  const layout = useMemo(() => layoutTree(data.root, collapsed), [data, collapsed]);
  const pad = 14;
  return (
    <SvgStage width={layout.width + pad * 2 + 24} height={layout.height + pad * 2} label={data.title ?? "Tree"}>
      <g transform={`translate(${pad},${pad})`}>
        {layout.placed.map((item) => {
          const parent = item.parent ? layout.byKey.get(item.parent) : undefined;
          if (!parent) return null;
          const x1 = parent.x + parent.width;
          const x2 = item.x;
          const mid = (x1 + x2) / 2;
          return (
            <path
              key={`l${item.key}`}
              d={`M${x1},${parent.y} C${mid},${parent.y} ${mid},${item.y} ${x2},${item.y}`}
              className="fill-none stroke-primary/45"
              strokeWidth={1.5}
            />
          );
        })}
        {layout.placed.map((item) => {
          const hasKids = item.node.children.length > 0;
          const isRoot = item.depth === 0;
          return (
            <g
              key={item.key}
              transform={`translate(${item.x},${item.y - item.height / 2})`}
              className={cn(hasKids && "cursor-pointer")}
              onClick={hasKids ? () => onToggle(item.key) : undefined}
              role={hasKids ? "button" : undefined}
              aria-expanded={hasKids ? !collapsed.has(item.key) : undefined}
              aria-label={hasKids ? `${item.node.label}: ${collapsed.has(item.key) ? "expand" : "collapse"}` : undefined}
            >
              {item.node.detail && <title>{item.node.detail}</title>}
              <rect
                width={item.width}
                height={item.height}
                rx={10}
                strokeWidth={1.25}
                className={cn(
                  isRoot
                    ? "fill-primary stroke-primary"
                    : item.depth === 1
                      ? "fill-primary/12 stroke-primary/60"
                      : "fill-card stroke-border",
                )}
              />
              {item.lines.map((line, i) => (
                <text
                  key={i}
                  x={14}
                  y={8 + i * LINE + LINE / 2}
                  dy="0.35em"
                  fontSize={FONT}
                  className={cn(
                    isRoot ? "fill-primary-foreground font-semibold" : item.depth === 1 ? "fill-foreground font-semibold" : "fill-foreground",
                  )}
                >
                  {line}
                </text>
              ))}
              {hasKids && (
                <g transform={`translate(${item.width},${item.height / 2})`}>
                  <circle r={8} className="fill-background stroke-primary/60" strokeWidth={1.25} />
                  <text textAnchor="middle" dy="0.35em" fontSize={item.hidden ? 9 : 11} className="fill-sage-text font-semibold">
                    {item.hidden ? item.hidden : "−"}
                  </text>
                </g>
              )}
            </g>
          );
        })}
      </g>
    </SvgStage>
  );
}

function Outline({
  node,
  nodeKey,
  depth,
  collapsed,
  onToggle,
}: {
  node: TreeNode;
  nodeKey: string;
  depth: number;
  collapsed: Set<string>;
  onToggle: (key: string) => void;
}) {
  const open = !collapsed.has(nodeKey);
  const hasKids = node.children.length > 0;
  return (
    <div className={cn(depth > 0 && "border-l border-primary/30 pl-3")}>
      <button
        type="button"
        disabled={!hasKids}
        onClick={() => onToggle(nodeKey)}
        aria-expanded={hasKids ? open : undefined}
        className={cn(
          "my-1 flex w-full items-start gap-1.5 rounded-md px-2 py-1.5 text-left",
          depth === 0 ? "bg-primary text-primary-foreground" : depth === 1 ? "bg-primary/10 font-semibold" : "hover:bg-muted",
        )}
      >
        {hasKids && <ChevronRight className={cn("mt-0.5 size-3.5 shrink-0 transition-transform", open && "rotate-90")} />}
        <span className="min-w-0">
          <span className="block leading-snug">{node.label}</span>
          {node.detail && (
            <span className={cn("block text-xs font-normal", depth === 0 ? "text-primary-foreground/80" : "text-muted-foreground")}>
              {node.detail}
            </span>
          )}
        </span>
      </button>
      {hasKids && open && (
        <div className="ml-2">
          {node.children.map((child, i) => (
            <Outline
              key={`${nodeKey}.${i}`}
              node={child}
              nodeKey={`${nodeKey}.${i}`}
              depth={depth + 1}
              collapsed={collapsed}
              onToggle={onToggle}
            />
          ))}
        </div>
      )}
    </div>
  );
}
