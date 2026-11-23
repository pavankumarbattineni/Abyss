"use client";

import { useId, useMemo } from "react";

import { layoutGraph, smoothPath, textWidth, wrapText, type Point } from "@/lib/visuals/geometry";
import type { FlowchartData } from "@/lib/visuals/schemas";
import { cn } from "@/lib/utils";
import { ArrowMarker, SvgStage } from "./stage";

const FONT = 14;
const LINE = 18;
const DETAIL = 11.5;
const DETAIL_LINE = 15;

type Kind = FlowchartData["nodes"][number]["kind"];

function measure(label: string, detail: string | undefined, kind: Kind) {
  const lines = wrapText(label, kind === "decision" ? 16 : 30, 3);
  const details = detail ? wrapText(detail, 46, 2) : [];
  const textW = Math.max(...lines.map((l) => textWidth(l, FONT)), ...details.map((l) => textWidth(l, DETAIL)));
  const textH = lines.length * LINE + (details.length ? 4 + details.length * DETAIL_LINE : 0);
  if (kind === "decision") return { lines, details, width: Math.max(140, textW * 1.5 + 40), height: Math.max(88, textH * 1.6 + 32) };
  // Roomy cards: generous padding around a centred title and its subtitle.
  return { lines, details, width: Math.max(170, textW + 48), height: textH + 30 };
}

// Soft tinted cards, one hue per kind of step (mixed into the card colour, so
// they read in light and dark themes), with a faint edge of the same hue
// instead of a hard border. Text stays the normal foreground on every tint.
const TINT: Record<Kind, string> = {
  start: "var(--viz-1)",
  end: "var(--viz-1)",
  process: "var(--viz-3)",
  decision: "var(--viz-4)",
  io: "var(--viz-7)",
  subprocess: "var(--viz-5)",
};
const tintFill = (kind: Kind) => `color-mix(in oklab, ${TINT[kind]} 13%, var(--card))`;
const tintEdge = (kind: Kind) => `color-mix(in oklab, ${TINT[kind]} 32%, var(--card))`;

/**
 * dagre routes edges to a node's bounding box; for a diamond, move the end
 * point in along the same direction to where it meets the diamond's edge.
 */
function toDiamondEdge(center: Point, toward: Point, w: number, h: number): Point {
  const dx = toward.x - center.x;
  const dy = toward.y - center.y;
  const k = 1 / (Math.abs(dx) / (w / 2) + Math.abs(dy) / (h / 2) || 1);
  return { x: center.x + dx * k, y: center.y + dy * k };
}

/** A process: typed shapes (start/end, step, decision, input/output, sub-process) laid out by dagre. */
export function FlowchartVisual({ data }: { data: FlowchartData }) {
  const markerId = useId().replace(/:/g, "");
  const layout = useMemo(() => {
    const measured = data.nodes.map((node) => ({ ...node, ...measure(node.label, node.detail, node.kind) }));
    // Cards share one width (the widest, within reason) so the chart reads as
    // an even column; decision diamonds keep their own size.
    const cardWidth = Math.min(360, Math.max(0, ...measured.filter((n) => n.kind !== "decision").map((n) => n.width)));
    const sized = measured.map((n) => (n.kind === "decision" ? n : { ...n, width: Math.max(n.width, cardWidth) }));
    const graph = layoutGraph({
      nodes: sized.map((n) => ({ id: n.id, width: n.width, height: n.height })),
      edges: data.edges,
      direction: data.direction ?? "TB",
      rankSep: 46,
    });
    const byId = new Map(sized.map((n) => [n.id, n]));
    for (const edge of graph.edges) {
      const from = byId.get(edge.from);
      const to = byId.get(edge.to);
      const fromPos = graph.nodes.get(edge.from);
      const toPos = graph.nodes.get(edge.to);
      const pts = edge.points;
      if (from?.kind === "decision" && fromPos && pts.length > 1) pts[0] = toDiamondEdge(fromPos, pts[1], from.width, from.height);
      if (to?.kind === "decision" && toPos && pts.length > 1) {
        pts[pts.length - 1] = toDiamondEdge(toPos, pts[pts.length - 2], to.width, to.height);
      }
    }
    return { sized, graph };
  }, [data]);

  return (
    <SvgStage
      width={layout.graph.width}
      height={layout.graph.height}
      label={data.title ?? "Flowchart"}
      defs={<ArrowMarker id={markerId} />}
    >
      {layout.graph.edges.map((edge, i) => (
        <g key={i}>
          <path
            d={smoothPath(edge.points)}
            className="fill-none stroke-muted-foreground/60"
            strokeWidth={1.25}
            markerEnd={`url(#${markerId})`}
          />
          {edge.label && edge.labelAt && (
            <g transform={`translate(${edge.labelAt.x},${edge.labelAt.y})`}>
              <rect
                x={-(textWidth(edge.label, 11) + 14) / 2}
                y={-10}
                width={textWidth(edge.label, 11) + 14}
                height={20}
                rx={10}
                className="fill-background stroke-border"
              />
              <text textAnchor="middle" dy="0.35em" fontSize={11} className="fill-muted-foreground font-medium">
                {edge.label}
              </text>
            </g>
          )}
        </g>
      ))}
      {layout.sized.map((node) => {
        const pos = layout.graph.nodes.get(node.id);
        if (!pos) return null;
        const { width: w, height: h } = node;
        const onPrimary = false; // no filled shapes: text is always the normal colour
        const shape =
          node.kind === "decision" ? (
            <polygon points={`0,${-h / 2} ${w / 2},0 0,${h / 2} ${-w / 2},0`} />
          ) : node.kind === "io" ? (
            <polygon points={`${-w / 2 + 12},${-h / 2} ${w / 2},${-h / 2} ${w / 2 - 12},${h / 2} ${-w / 2},${h / 2}`} />
          ) : (
            <rect x={-w / 2} y={-h / 2} width={w} height={h} rx={onPrimary ? h / 2 : 12} />
          );
        const textTop = -((node.lines.length * LINE + (node.details.length ? 4 + node.details.length * DETAIL_LINE : 0)) / 2);
        return (
          <g key={node.id} transform={`translate(${pos.x},${pos.y})`}>
            {node.detail && <title>{node.detail}</title>}
            <g fill={tintFill(node.kind)} stroke={tintEdge(node.kind)} strokeWidth={1}>
              {shape}
            </g>
            {node.kind === "subprocess" && (
              <g stroke={tintEdge(node.kind)} strokeWidth={1}>
                <line x1={-w / 2 + 9} y1={-h / 2} x2={-w / 2 + 9} y2={h / 2} />
                <line x1={w / 2 - 9} y1={-h / 2} x2={w / 2 - 9} y2={h / 2} />
              </g>
            )}
            {node.lines.map((line, i) => (
              <text
                key={i}
                y={textTop + i * LINE + LINE / 2}
                dy="0.35em"
                textAnchor="middle"
                fontSize={FONT}
                className={cn("font-semibold", onPrimary ? "fill-primary-foreground" : "fill-foreground")}
              >
                {line}
              </text>
            ))}
            {node.details.map((line, i) => (
              <text
                key={`d${i}`}
                y={textTop + node.lines.length * LINE + 4 + i * DETAIL_LINE + DETAIL_LINE / 2}
                dy="0.35em"
                textAnchor="middle"
                fontSize={DETAIL}
                className={onPrimary ? "fill-primary-foreground/80" : "fill-muted-foreground"}
              >
                {line}
              </text>
            ))}
          </g>
        );
      })}
    </SvgStage>
  );
}
