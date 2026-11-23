"use client";

import { useId } from "react";

import type { EnergyLevelsData } from "@/lib/visuals/schemas";
import { formatTick, scale } from "@/lib/visuals/science";
import { SvgStage } from "./stage";

const W = 600;

/** Electrons in a subshell's boxes by Hund's rule: one per box (spin up), then pairing (spin down). */
function fill(boxes: number, electrons: number): ("up" | "pair" | "empty")[] {
  const e = Math.max(0, Math.min(Math.round(electrons), boxes * 2));
  return Array.from({ length: boxes }, (_, i) => (i < e - boxes ? "pair" : i < e ? "up" : "empty"));
}

function Orbitals({ data }: { data: EnergyLevelsData }) {
  const BOX = 30;
  const rowH = 46;
  const height = data.orbitals.length * rowH + 36;
  // Lowest energy at the bottom, as orbital diagrams are drawn.
  const rows = [...data.orbitals].reverse();
  return (
    <SvgStage width={W} height={height} label={data.title ?? "Orbital diagram"}>
      <line x1={54} x2={54} y1={14} y2={height - 18} className="stroke-muted-foreground" strokeWidth={1.2} />
      <path d={`M54,8 l-5,9 h10 z`} className="fill-muted-foreground" />
      <text transform={`translate(20 ${height / 2}) rotate(-90)`} textAnchor="middle" fontSize={12} className="fill-muted-foreground">
        {data.energyLabel ?? "Energy"}
      </text>
      {rows.map((o, i) => {
        const y = 22 + i * rowH;
        const cells = fill(o.boxes, o.electrons);
        const x0 = 120;
        return (
          <g key={`${o.label}${i}`}>
            <text x={x0 - 14} y={y + BOX / 2} dy="0.35em" textAnchor="end" fontSize={14} className="fill-foreground font-semibold">
              {o.label}
            </text>
            {cells.map((c, k) => {
              const x = x0 + k * BOX;
              return (
                <g key={k}>
                  <rect x={x} y={y} width={BOX} height={BOX} className="fill-card stroke-foreground/70" strokeWidth={1.4} />
                  {c !== "empty" && <path d={`M${x + 10},${y + 24} V${y + 7} m-4,5 l4,-5 l4,5`} className="fill-none stroke-foreground" strokeWidth={1.8} />}
                  {c === "pair" && <path d={`M${x + 20},${y + 6} V${y + 23} m-4,-5 l4,5 l4,-5`} className="fill-none stroke-foreground" strokeWidth={1.8} />}
                </g>
              );
            })}
            <text x={x0 + o.boxes * BOX + 12} y={y + BOX / 2} dy="0.35em" fontSize={12} className="fill-muted-foreground">
              {Math.round(o.electrons)} e⁻
            </text>
          </g>
        );
      })}
    </SvgStage>
  );
}

function Levels({ data }: { data: EnergyLevelsData }) {
  const uid = useId().replace(/[^a-zA-Z0-9]/g, "");
  const height = 380;
  const energies = data.levels.map((l) => l.energy);
  const lo = Math.min(...energies);
  const hi = Math.max(...energies);
  const sy = scale([lo - (hi - lo) * 0.05, hi + (hi - lo) * 0.05 || 1], [height - 26, 22]);
  const byId = new Map(data.levels.map((l) => [l.id, l]));
  const left = 110;
  const right = W - 150;
  const n = Math.max(1, data.transitions.length);
  // Labels of close levels are pushed apart (top to bottom) so they never overlap.
  const labelY = new Map<string, number>();
  let last = -Infinity;
  for (const l of [...data.levels].sort((a, b) => b.energy - a.energy)) {
    const y = Math.max(sy(l.energy), last + 14);
    labelY.set(l.id, y);
    last = y;
  }
  // Transition labels sit just past their arrowhead (below the target level
  // for emission, above it for absorption); one that would overlap an earlier
  // label moves a row further out.
  const placed: { x: number; y: number; w: number }[] = [];
  const transitionLabelY = data.transitions.map((t, i) => {
    const a = byId.get(t.from);
    const b = byId.get(t.to);
    if (!a || !b || !t.label) return 0;
    const x = left + ((right - left) * (i + 1)) / (n + 1) + 6;
    const w = t.label.length * 6.4;
    const down = sy(b.energy) > sy(a.energy);
    const step = down ? 15 : -15;
    let y = sy(b.energy) + (down ? 16 : -16);
    while (placed.some((p) => x < p.x + p.w && p.x < x + w && Math.abs(p.y - y) < 15)) y += step;
    placed.push({ x, y, w });
    return y;
  });
  return (
    <SvgStage
      width={W}
      height={height}
      label={data.title ?? "Energy levels"}
      defs={
        <marker id={`${uid}-t`} viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
          <path d="M0,0 L10,5 L0,10 z" fill="var(--highlight)" />
        </marker>
      }
    >
      <line x1={60} x2={60} y1={16} y2={height - 18} className="stroke-muted-foreground" strokeWidth={1.2} />
      <path d="M60,8 l-5,9 h10 z" className="fill-muted-foreground" />
      <text transform={`translate(24 ${height / 2}) rotate(-90)`} textAnchor="middle" fontSize={12} className="fill-muted-foreground">
        {data.energyLabel ?? "Energy"}
      </text>
      {data.levels.map((l) => {
        const y = sy(l.energy);
        return (
          <g key={l.id}>
            <line x1={left} x2={right} y1={y} y2={y} className="stroke-foreground" strokeWidth={2.2} />
            <text x={right + 10} y={labelY.get(l.id) ?? y} dy="0.35em" fontSize={12.5} className="fill-foreground font-medium">
              {l.label}
            </text>
            <text x={left - 8} y={labelY.get(l.id) ?? y} dy="0.35em" textAnchor="end" fontSize={10.5} className="fill-muted-foreground tabular-nums">
              {formatTick(l.energy)}
            </text>
          </g>
        );
      })}
      {data.transitions.map((t, i) => {
        const a = byId.get(t.from);
        const b = byId.get(t.to);
        if (!a || !b) return null;
        const x = left + ((right - left) * (i + 1)) / (n + 1);
        return (
          <g key={i}>
            <line x1={x} x2={x} y1={sy(a.energy)} y2={sy(b.energy)} stroke="var(--highlight)" strokeWidth={2} markerEnd={`url(#${uid}-t)`} />
            {t.label && (
              <text x={x + 6} y={transitionLabelY[i]} dy="0.35em" fontSize={11.5} className="fill-foreground" paintOrder="stroke" stroke="var(--background)" strokeWidth={4}>
                {t.label}
              </text>
            )}
          </g>
        );
      })}
    </SvgStage>
  );
}

/**
 * Electron structure: orbital box diagrams (boxes filled by Hund's rule,
 * lowest energy at the bottom) and/or energy-level diagrams to scale with
 * transitions (absorption/emission lines, MO diagrams).
 */
export function EnergyLevelsVisual({ data }: { data: EnergyLevelsData }) {
  return (
    <div className="flex flex-col gap-4">
      {data.orbitals.length > 0 && <Orbitals data={data} />}
      {data.levels.length > 0 && <Levels data={data} />}
      {!data.orbitals.length && !data.levels.length && <p className="text-sm text-muted-foreground">No orbitals or levels were given.</p>}
    </div>
  );
}
