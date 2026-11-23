"use client";

import type { VennData } from "@/lib/visuals/schemas";
import { wrapText } from "@/lib/visuals/geometry";
import { SvgStage } from "./stage";

const W = 560;
const R = 120;

/** Circle centres for 2 or 3 sets, and where each region's label goes. */
function layout(n: number) {
  if (n === 2) {
    const c = [
      { x: W / 2 - 75, y: 175 },
      { x: W / 2 + 75, y: 175 },
    ];
    return { c, height: 350 };
  }
  const c = [
    { x: W / 2 - 72, y: 160 },
    { x: W / 2 + 72, y: 160 },
    { x: W / 2, y: 282 },
  ];
  return { c, height: 430 };
}

/** The point to label the region inside exactly the sets in `inside` (by index). */
function regionAnchor(inside: number[], n: number, centres: { x: number; y: number }[]) {
  if (!inside.length) return { x: 34, y: 30 };
  const avg = (idx: number[]) => ({
    x: idx.reduce((s, i) => s + centres[i].x, 0) / idx.length,
    y: idx.reduce((s, i) => s + centres[i].y, 0) / idx.length,
  });
  const all = Array.from({ length: n }, (_, i) => i);
  const centre = avg(all);
  if (inside.length === n) return centre;
  const mid = avg(inside);
  // Push away from the sets it is outside of.
  const away = inside.length === 1 ? 0.62 : 0.55;
  return { x: mid.x + (mid.x - centre.x) * away * (inside.length === 1 ? 1.15 : 1), y: mid.y + (mid.y - centre.y) * away * (inside.length === 1 ? 1.15 : 1) };
}

/**
 * A Venn diagram of 2 or 3 sets: overlapping circles with their names, and a
 * label or count in each region (e.g. "A ∩ B", "12"). A region is given by the
 * sets it lies inside; `[]` is outside them all (in the universe).
 */
export function VennVisual({ data }: { data: VennData }) {
  const sets = data.sets.slice(0, 3);
  const n = sets.length;
  const { c, height } = layout(n);
  const index = new Map(sets.map((s, i) => [s.id, i]));
  return (
    <SvgStage width={W} height={height} label={data.title ?? "Venn diagram"}>
      <rect x={6} y={6} width={W - 12} height={height - 12} rx={14} className="fill-none stroke-border" strokeWidth={1.4} />
      {data.universe && (
        <text x={W - 18} y={26} textAnchor="end" fontSize={12} className="fill-muted-foreground font-medium">
          {data.universe}
        </text>
      )}
      {sets.map((s, i) => (
        <circle key={s.id} cx={c[i].x} cy={c[i].y} r={R} fill={`var(--viz-${i + 1})`} fillOpacity={0.16} stroke={`var(--viz-${i + 1})`} strokeWidth={2} />
      ))}
      {sets.map((s, i) => {
        const dx = c[i].x - W / 2;
        const dy = c[i].y - (n === 2 ? 175 : 200);
        const len = Math.hypot(dx, dy) || 1;
        const lx = c[i].x + (dx / len) * (R * 0.98);
        const ly = n === 2 ? c[i].y - R - 10 : c[i].y + (dy / len) * (R + 16);
        return (
          <text key={`l${s.id}`} x={n === 2 ? c[i].x + (dx / len) * 40 : lx} y={ly} textAnchor="middle" fontSize={14} fontWeight={700} fill={`var(--viz-${i + 1})`}>
            {s.label}
          </text>
        );
      })}
      {data.regions.map((r, k) => {
        const inside = r.in.map((id) => index.get(id)).filter((i): i is number => i !== undefined);
        const at = regionAnchor(inside, n, c);
        const lines = [r.value !== undefined ? String(r.value) : null, ...(r.label ? wrapText(r.label, 14, 3) : [])].filter(
          (l): l is string => !!l,
        );
        return (
          <text key={`r${k}`} x={at.x} y={at.y - ((lines.length - 1) * 15) / 2} textAnchor={inside.length ? "middle" : "start"} fontSize={12.5} className="fill-foreground">
            {lines.map((line, j) => (
              <tspan key={j} x={at.x} dy={j ? 15 : 0} fontWeight={j === 0 && r.value !== undefined ? 700 : 500}>
                {line}
              </tspan>
            ))}
          </text>
        );
      })}
    </SvgStage>
  );
}
