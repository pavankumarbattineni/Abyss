"use client";

import { useId, useMemo } from "react";

import { layoutGraph, smoothPath, textWidth, wrapText } from "@/lib/visuals/geometry";
import type { DiagramData } from "@/lib/visuals/schemas";
import { iconFor } from "./icons";
import { ArrowMarker, SvgStage } from "./stage";

const FONT = 13;
const LINE = 17;
const DETAIL = 11;
const DETAIL_LINE = 14;
const ICON = 18;

/** Concepts or parts and how they relate: cards, labelled links and grouped clusters. */
export function DiagramVisual({ data }: { data: DiagramData }) {
  const markerId = useId().replace(/:/g, "");
  const layout = useMemo(() => {
    const sized = data.nodes.map((node) => {
      const lines = wrapText(node.label, 22, 2);
      const details = node.detail ? wrapText(node.detail, 28, 3) : [];
      const textW = Math.max(...lines.map((l) => textWidth(l, FONT)), ...details.map((l) => textWidth(l, DETAIL)));
      const hasIcon = Boolean(node.icon);
      return {
        ...node,
        lines,
        details,
        hasIcon,
        width: Math.max(140, textW + 32),
        height: (hasIcon ? ICON + 8 : 0) + lines.length * LINE + (details.length ? 4 + details.length * DETAIL_LINE : 0) + 24,
      };
    });
    const graph = layoutGraph({
      nodes: sized.map((n) => ({ id: n.id, width: n.width, height: n.height, group: n.group })),
      edges: data.edges,
      groups: data.groups,
      direction: "TB",
      rankSep: data.groups.length ? 70 : 54,
      nodeSep: 40,
    });
    return { sized, graph };
  }, [data]);

  const dashed = new Set(data.edges.filter((e) => e.dashed).map((e) => `${e.from}->${e.to}`));

  return (
    <SvgStage
      width={layout.graph.width}
      height={layout.graph.height}
      label={data.title ?? "Diagram"}
      defs={<ArrowMarker id={markerId} />}
    >
      {layout.graph.groups.map((group) => (
        <g key={group.id}>
          <rect
            x={group.x}
            y={group.y - 14}
            width={group.width}
            height={group.height + 14}
            rx={14}
            className="fill-none stroke-muted-foreground/50"
            strokeDasharray="5 4"
          />
          <text x={group.x + 12} y={group.y + 2} fontSize={11} className="fill-muted-foreground font-semibold tracking-wide">
            {group.label}
          </text>
        </g>
      ))}
      {layout.graph.edges.map((edge, i) => (
        <g key={i}>
          <path
            d={smoothPath(edge.points)}
            className="fill-none stroke-muted-foreground/70"
            strokeWidth={1.5}
            strokeDasharray={dashed.has(`${edge.from}->${edge.to}`) ? "5 4" : undefined}
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
              <text textAnchor="middle" dy="0.35em" fontSize={11} className="fill-muted-foreground">
                {edge.label}
              </text>
            </g>
          )}
        </g>
      ))}
      {layout.sized.map((node) => {
        const pos = layout.graph.nodes.get(node.id);
        if (!pos) return null;
        const Icon = iconFor(node.icon);
        const top = -node.height / 2 + 12;
        const textStart = top + (node.hasIcon ? ICON + 8 : 0);
        return (
          <g key={node.id} transform={`translate(${pos.x},${pos.y})`}>
            <rect
              x={-node.width / 2}
              y={-node.height / 2}
              width={node.width}
              height={node.height}
              rx={12}
              className="fill-card stroke-border"
              strokeWidth={1.25}
            />
            <rect x={-node.width / 2 + 5} y={-node.height / 2 + 10} width={3} height={node.height - 20} rx={1.5} className="fill-primary" />
            {node.hasIcon && <Icon x={-ICON / 2} y={top} width={ICON} height={ICON} className="text-sage-text" />}
            {node.lines.map((line, i) => (
              <text
                key={i}
                y={textStart + i * LINE + LINE / 2}
                dy="0.35em"
                textAnchor="middle"
                fontSize={FONT}
                className="fill-foreground font-semibold"
              >
                {line}
              </text>
            ))}
            {node.details.map((line, i) => (
              <text
                key={`d${i}`}
                y={textStart + node.lines.length * LINE + 4 + i * DETAIL_LINE + DETAIL_LINE / 2}
                dy="0.35em"
                textAnchor="middle"
                fontSize={DETAIL}
                className="fill-muted-foreground"
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
