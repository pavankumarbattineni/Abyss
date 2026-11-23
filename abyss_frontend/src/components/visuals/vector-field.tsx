"use client";

import { useId, useMemo } from "react";

import type { VectorFieldData } from "@/lib/visuals/schemas";
import { fn, scale, value, type Scope } from "@/lib/visuals/science";
import { CartesianAxes, MARGIN, ParamControls, PLOT_W, useParams } from "./science-frame";
import { SvgStage } from "./stage";

/**
 * A 2-D vector field F(x, y) = (fx, fy) as arrows on a grid: direction to
 * scale, length and opacity growing with magnitude (relative to the strongest
 * arrow shown), so where the field is strong reads at a glance. Markers show
 * sources (e.g. charges); formulas may use slider parameters.
 */
export function VectorFieldVisual({ data }: { data: VectorFieldData }) {
  const params = useParams(data.params);
  const uid = useId().replace(/[^a-zA-Z0-9]/g, "");
  const scope: Scope = params.values;

  const model = useMemo(() => {
    const xs = data.x ?? [-5, 5];
    const ys = data.y ?? xs;
    const plotW = PLOT_W - MARGIN.left - MARGIN.right;
    const plotH = Math.min(520, Math.max(240, (plotW * (ys[1] - ys[0])) / (xs[1] - xs[0])));
    const height = plotH + MARGIN.top + MARGIN.bottom;
    const sx = scale(xs, [MARGIN.left, PLOT_W - MARGIN.right]);
    const sy = scale(ys, [height - MARGIN.bottom, MARGIN.top]);
    const n = data.density ?? 15;
    const cols = n;
    const rows = Math.max(4, Math.round((n * plotH) / plotW));
    const cell = Math.min(plotW / cols, plotH / rows);
    const fx = (x: number, y: number) => fn(data.fx, "x", { ...scope, y })(x);
    const fy = (x: number, y: number) => fn(data.fy, "x", { ...scope, y })(x);
    const arrows: { x: number; y: number; dx: number; dy: number; m: number }[] = [];
    for (let i = 0; i < cols; i++) {
      for (let j = 0; j < rows; j++) {
        const x = xs[0] + ((i + 0.5) * (xs[1] - xs[0])) / cols;
        const y = ys[0] + ((j + 0.5) * (ys[1] - ys[0])) / rows;
        const u = fx(x, y);
        const v = fy(x, y);
        const m = Math.hypot(u, v);
        if (Number.isFinite(m) && m > 0) arrows.push({ x, y, dx: u / m, dy: v / m, m });
      }
    }
    // Scale by a high percentile so one singular point doesn't flatten the rest.
    const sorted = arrows.map((a) => a.m).sort((a, b) => a - b);
    const ref = sorted[Math.floor(sorted.length * 0.9)] ?? 1;
    return { xs, ys, height, sx, sy, cell, arrows, ref };
  }, [data, scope]);

  const { sx, sy, height } = model;
  const marker = `${uid}-head`;
  return (
    <div>
      <ParamControls params={data.params} state={params} />
      <SvgStage
        width={PLOT_W}
        height={height}
        label={data.title ?? "Vector field"}
        defs={
          <marker id={marker} viewBox="0 0 10 10" refX="9" refY="5" markerWidth="5" markerHeight="5" orient="auto">
            <path d="M0,0 L10,5 L0,10 z" fill="var(--viz-1)" />
          </marker>
        }
      >
        <CartesianAxes xDomain={model.xs} yDomain={model.ys} sx={sx} sy={sy} width={PLOT_W} height={height} grid={false} xLabel={data.xLabel} yLabel={data.yLabel} />
        {model.arrows.map((a, i) => {
          const strength = Math.min(1, a.m / (model.ref || 1));
          const len = model.cell * (0.35 + 0.5 * strength);
          const cx = sx(a.x);
          const cy = sy(a.y);
          // Screen y points down: flip dy.
          const hx = (a.dx * len) / 2;
          const hy = (-a.dy * len) / 2;
          return (
            <line
              key={i}
              x1={cx - hx}
              y1={cy - hy}
              x2={cx + hx}
              y2={cy + hy}
              stroke="var(--viz-1)"
              strokeOpacity={0.35 + 0.65 * strength}
              strokeWidth={1.6}
              markerEnd={`url(#${marker})`}
            />
          );
        })}
        {data.markers.map((m, i) => {
          const x = sx(value(m.at.x, params.values));
          const y = sy(value(m.at.y, params.values));
          if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
          return (
            <g key={`m${i}`}>
              <circle cx={x} cy={y} r={11} className={m.sign === "-" ? "fill-[var(--viz-2)]" : "fill-highlight"} />
              {m.sign && (
                <text x={x} y={y} dy="0.35em" textAnchor="middle" fontSize={15} fontWeight={700} fill="white">
                  {m.sign === "-" ? "−" : "+"}
                </text>
              )}
              {m.label && (
                <text x={x + 15} y={y - 12} fontSize={12} className="fill-foreground font-medium" paintOrder="stroke" stroke="var(--background)" strokeWidth={4}>
                  {m.label}
                </text>
              )}
            </g>
          );
        })}
      </SvgStage>
    </div>
  );
}
