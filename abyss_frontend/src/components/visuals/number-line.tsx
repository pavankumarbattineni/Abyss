"use client";

import type { NumberLineData } from "@/lib/visuals/schemas";
import { formatTick, niceTicks, scale, seriesColor } from "@/lib/visuals/science";
import { SvgStage } from "./stage";

const W = 600;
const PAD = 36;

type Bound = number | null | string;
const isInfinite = (b: Bound) => b === null || typeof b === "string";
const toNumber = (b: Bound, fallback: number) => (typeof b === "number" ? b : fallback);

/**
 * A number line: open/closed points and intervals (inequalities and solution
 * sets), with arrows where an interval runs on to infinity. Intervals stack on
 * separate rows above the line so overlapping ones stay readable.
 */
export function NumberLineVisual({ data }: { data: NumberLineData }) {
  const lo = Math.min(data.min, data.max);
  const hi = Math.max(data.min, data.max);
  const sx = scale([lo, hi], [PAD, W - PAD]);
  const ticks = data.step && (hi - lo) / data.step <= 40
    ? Array.from({ length: Math.floor((hi - lo) / data.step) + 1 }, (_, i) => lo + i * data.step!)
    : niceTicks(lo, hi, 10);
  const rows = data.intervals.length;
  const lineY = 34 + rows * 22;
  const height = lineY + 44 + (data.points.some((p) => p.label) ? 18 : 0);
  return (
    <SvgStage width={W} height={height} label={data.title ?? "Number line"}>
      {data.intervals.map((iv, i) => {
        const from = toNumber(iv.from as Bound, lo);
        const to = toNumber(iv.to as Bound, hi);
        const a = sx(Math.max(lo, Math.min(from, to)));
        const b = sx(Math.min(hi, Math.max(from, to)));
        const y = 24 + i * 22;
        const color = seriesColor(iv.color, i);
        const leftOpen = isInfinite(iv.from as Bound) ? null : !!iv.fromOpen;
        const rightOpen = isInfinite(iv.to as Bound) ? null : !!iv.toOpen;
        return (
          <g key={`i${i}`}>
            <line x1={a} x2={b} y1={y} y2={y} stroke={color} strokeWidth={4} strokeLinecap="round" />
            <rect x={a} y={y} width={Math.max(0, b - a)} height={lineY - y} fill={color} opacity={0.08} />
            {leftOpen === null ? (
              <path d={`M${a - 2},${y} l9,-6 v12 z`} fill={color} />
            ) : (
              <circle cx={a} cy={y} r={5.5} fill={leftOpen ? "var(--background)" : color} stroke={color} strokeWidth={2.2} />
            )}
            {rightOpen === null ? (
              <path d={`M${b + 2},${y} l-9,-6 v12 z`} fill={color} />
            ) : (
              <circle cx={b} cy={y} r={5.5} fill={rightOpen ? "var(--background)" : color} stroke={color} strokeWidth={2.2} />
            )}
            {iv.label && (
              <text x={(a + b) / 2} y={y - 8} textAnchor="middle" fontSize={12} className="fill-foreground font-medium">
                {iv.label}
              </text>
            )}
          </g>
        );
      })}
      <line x1={PAD - 18} x2={W - PAD + 18} y1={lineY} y2={lineY} className="stroke-foreground/70" strokeWidth={1.5} />
      <path d={`M${W - PAD + 22},${lineY} l-8,-5 v10 z`} className="fill-foreground/70" />
      <path d={`M${PAD - 22},${lineY} l8,-5 v10 z`} className="fill-foreground/70" />
      {ticks.map((t) => (
        <g key={t}>
          <line x1={sx(t)} x2={sx(t)} y1={lineY - 5} y2={lineY + 5} className="stroke-foreground/70" strokeWidth={1.2} />
          <text x={sx(t)} y={lineY + 20} textAnchor="middle" fontSize={11.5} className="fill-muted-foreground">
            {formatTick(t)}
          </text>
        </g>
      ))}
      {data.points.map((p, i) => (
        <g key={`p${i}`}>
          <circle cx={sx(p.at)} cy={lineY} r={6} className={p.open ? "fill-background stroke-highlight" : "fill-highlight stroke-highlight"} strokeWidth={2.2} />
          {p.label && (
            <text x={sx(p.at)} y={lineY + 36} textAnchor="middle" fontSize={12} className="fill-foreground font-semibold">
              {p.label}
            </text>
          )}
        </g>
      ))}
    </SvgStage>
  );
}
