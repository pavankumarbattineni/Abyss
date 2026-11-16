"use client";

import { useState } from "react";

import { textWidth, wrapText } from "@/lib/visuals/geometry";
import type { ExplodedViewData } from "@/lib/visuals/schemas";
import { cn } from "@/lib/utils";
import { SvgStage } from "./stage";

type Shape = ExplodedViewData["parts"][number]["shape"];

/** Isometric proportions per shape: footprint width/depth and thickness. */
const DIMS: Record<Shape, { w: number; d: number; t: number }> = {
  cover: { w: 250, d: 144, t: 14 },
  panel: { w: 236, d: 136, t: 8 },
  screen: { w: 244, d: 140, t: 10 },
  board: { w: 222, d: 128, t: 10 },
  box: { w: 190, d: 110, t: 44 },
  cylinder: { w: 130, d: 66, t: 52 },
  disc: { w: 180, d: 90, t: 10 },
  ring: { w: 180, d: 90, t: 12 },
};

/** Muted hues, cycled through the parts (base colour; faces are shaded from it). */
const HUES = ["#8aa5bd", "#9caf88", "#c7a27c", "#a3a9b8", "#b9a3c7", "#86b3b0"];

function shade(hex: string, amount: number): string {
  const n = parseInt(hex.slice(1), 16);
  const f = (c: number) => Math.max(0, Math.min(255, Math.round(c + amount * 255)));
  const r = f((n >> 16) & 255);
  const g = f((n >> 8) & 255);
  const b = f(n & 255);
  return `rgb(${r},${g},${b})`;
}

const AXIS_X = 170;
const LABEL_X = 330;
const STROKE = "rgba(30,41,59,0.55)";

/** One part as an isometric solid centred on (cx, cy) = the middle of its top face. */
function Part({ shape, cx, cy, hue, active }: { shape: Shape; cx: number; cy: number; hue: string; active: boolean }) {
  const { w, d, t } = DIMS[shape];
  const top = shade(hue, active ? 0.16 : 0.1);
  const left = shade(hue, -0.06);
  const right = shade(hue, -0.18);
  const strokeProps = { stroke: active ? "var(--highlight)" : STROKE, strokeWidth: active ? 1.6 : 0.9, strokeLinejoin: "round" as const };

  if (shape === "cylinder" || shape === "disc" || shape === "ring") {
    const rx = w / 2;
    const ry = d / 2;
    return (
      <g>
        <path
          d={`M${cx - rx},${cy} L${cx - rx},${cy + t} A${rx},${ry} 0 0 0 ${cx + rx},${cy + t} L${cx + rx},${cy} Z`}
          fill={right}
          {...strokeProps}
        />
        <ellipse cx={cx} cy={cy} rx={rx} ry={ry} fill={top} {...strokeProps} />
        {shape === "ring" && <ellipse cx={cx} cy={cy} rx={rx * 0.5} ry={ry * 0.5} fill="var(--card)" {...strokeProps} />}
      </g>
    );
  }
  const T = { x: cx, y: cy - d / 2 };
  const R = { x: cx + w / 2, y: cy };
  const B = { x: cx, y: cy + d / 2 };
  const L = { x: cx - w / 2, y: cy };
  const p = (pts: { x: number; y: number }[]) => pts.map((q) => `${q.x},${q.y}`).join(" ");
  return (
    <g>
      <polygon points={p([L, B, { x: B.x, y: B.y + t }, { x: L.x, y: L.y + t }])} fill={left} {...strokeProps} />
      <polygon points={p([B, R, { x: R.x, y: R.y + t }, { x: B.x, y: B.y + t }])} fill={right} {...strokeProps} />
      <polygon points={p([T, R, B, L])} fill={top} {...strokeProps} />
      {shape === "screen" && (
        <polygon
          points={p([
            { x: cx, y: cy - d / 2 + 12 },
            { x: cx + w / 2 - 20, y: cy },
            { x: cx, y: cy + d / 2 - 12 },
            { x: cx - w / 2 + 20, y: cy },
          ])}
          fill="#1e293b"
          opacity={0.85}
        />
      )}
      {shape === "board" &&
        [-0.22, 0.05, 0.28].map((k, i) => (
          <polygon
            key={i}
            points={p([
              { x: cx + k * w, y: cy - 14 + k * 10 },
              { x: cx + k * w + 18, y: cy - 4 + k * 10 },
              { x: cx + k * w, y: cy + 6 + k * 10 },
              { x: cx + k * w - 18, y: cy - 4 + k * 10 },
            ])}
            fill="#334155"
            opacity={0.75}
          />
        ))}
    </g>
  );
}

/** Vertical positions: each part below the previous, with room for its label. */
function stack<P extends { dims: { d: number; t: number }; labelLines: string[]; detailLines: string[] }>(parts: P[]) {
  const gap = 16;
  const placed: (P & { cy: number })[] = [];
  let y = 30;
  for (const part of parts) {
    const cy = y + part.dims.d / 2;
    const labelH = part.labelLines.length * 16 + part.detailLines.length * 14;
    y = cy + part.dims.d / 2 + part.dims.t + gap + Math.max(0, labelH - (part.dims.d + part.dims.t)) * 0.6;
    placed.push({ ...part, cy });
  }
  return { placed, height: y + 14 };
}

/**
 * An object pulled apart along its assembly axis: each part an isometric
 * solid, outermost on top, with leader lines to its name and role. Hovering
 * or tapping a part (or its label) highlights it.
 */
export function ExplodedViewVisual({ data }: { data: ExplodedViewData }) {
  const [active, setActive] = useState<number | null>(null);
  const parts = data.parts.map((part, i) => {
    const labelLines = wrapText(part.name, 24, 2);
    const detailLines = part.detail ? wrapText(part.detail, 34, 3) : [];
    return { ...part, i, labelLines, detailLines, dims: DIMS[part.shape] };
  });
  const { placed, height } = stack(parts);
  const labelWidth = Math.max(...parts.map((p) => Math.max(...p.labelLines.map((l) => textWidth(l, 13.5)), ...p.detailLines.map((l) => textWidth(l, 11.5)))));
  const width = LABEL_X + labelWidth + 24;

  return (
    <SvgStage width={width} height={height} label={`Exploded view of ${data.object}`}>
      {/* Assembly axis */}
      <line x1={AXIS_X} y1={14} x2={AXIS_X} y2={height - 10} className="stroke-muted-foreground/45" strokeWidth={1.2} strokeDasharray="6 5" />
      {[...placed].reverse().map((part) => (
        <g
          key={part.i}
          onMouseEnter={() => setActive(part.i)}
          onMouseLeave={() => setActive(null)}
          onClick={() => setActive(active === part.i ? null : part.i)}
          className="cursor-pointer"
        >
          {part.detail && <title>{part.detail}</title>}
          <Part shape={part.shape} cx={AXIS_X} cy={part.cy} hue={HUES[part.i % HUES.length]} active={active === part.i} />
        </g>
      ))}
      {placed.map((part) => {
        const anchorX = AXIS_X + part.dims.w / 2 + 6;
        const isActive = active === part.i;
        return (
          <g
            key={`l${part.i}`}
            onMouseEnter={() => setActive(part.i)}
            onMouseLeave={() => setActive(null)}
            className="cursor-pointer"
          >
            <path
              d={`M${anchorX},${part.cy} L${LABEL_X - 26},${part.cy} L${LABEL_X - 8},${part.cy}`}
              className={cn("fill-none", isActive ? "stroke-highlight" : "stroke-muted-foreground/60")}
              strokeWidth={1.1}
            />
            <circle cx={anchorX} cy={part.cy} r={2.5} className={isActive ? "fill-highlight" : "fill-muted-foreground"} />
            <g transform={`translate(${LABEL_X},${part.cy - 8})`}>
              <text x={0} y={0} dy="0.35em" fontSize={10.5} className="fill-sage-text font-bold">
                {String(part.i + 1).padStart(2, "0")}
              </text>
              {part.labelLines.map((line, j) => (
                <text key={j} x={20} y={j * 16} dy="0.35em" fontSize={13.5} className={cn("font-semibold", isActive ? "fill-highlight" : "fill-foreground")}>
                  {line}
                </text>
              ))}
              {part.detailLines.map((line, j) => (
                <text key={`d${j}`} x={20} y={part.labelLines.length * 16 + j * 14} dy="0.35em" fontSize={11.5} className="fill-muted-foreground">
                  {line}
                </text>
              ))}
            </g>
          </g>
        );
      })}
    </SvgStage>
  );
}
