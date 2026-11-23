"use client";

import { useId, useMemo, useState } from "react";

import { cn } from "@/lib/utils";
import type { GeometryData } from "@/lib/visuals/schemas";
import { extent, pathOf, scale, seriesColor, value, type NumOrExpr, type Scope, type XY } from "@/lib/visuals/science";
import { CartesianAxes, ParamControls, PLOT_W, useParams } from "./science-frame";
import { SvgStage } from "./stage";

type Ref = string | { x: NumOrExpr; y: NumOrExpr };
const PAD = 28;

/**
 * Geometry drawn to scale (equal units on both axes, so circles stay round
 * and angles are true): points, segments, arrows (forces, velocities), circles,
 * polygons, marked angles, boxes for bodies, and notes. With a 2x2 `transform`
 * a toggle shows the drawing before and after the matrix is applied (the
 * original stays faint underneath). Coordinates may be formulas over sliders.
 */
export function GeometryVisual({ data }: { data: GeometryData }) {
  const params = useParams(data.params);
  const [applied, setApplied] = useState(false);
  const uid = useId().replace(/[^a-zA-Z0-9]/g, "");
  const scope: Scope = params.values;

  const model = useMemo(() => {
    const named = new Map<string, XY>();
    for (const p of data.points) named.set(p.id, { x: value(p.at.x, scope), y: value(p.at.y, scope) });
    const at = (r: Ref | undefined): XY | null => {
      if (r === undefined) return null;
      if (typeof r === "string") return named.get(r.trim()) ?? null;
      const p = { x: value(r.x, scope), y: value(r.y, scope) };
      return Number.isFinite(p.x) && Number.isFinite(p.y) ? p : null;
    };
    const vectors = data.vectors.map((v) => {
      const from = at(v.from);
      if (!from) return null;
      const to = v.to !== undefined ? at(v.to) : v.d ? { x: from.x + value(v.d.x, scope), y: from.y + value(v.d.y, scope) } : null;
      return to && Number.isFinite(to.x) && Number.isFinite(to.y) ? { from, to, v } : null;
    });
    const boxes = data.boxes.map((b) => {
      const c = { x: value(b.at.x, scope), y: value(b.at.y, scope) };
      const a = ((b.angle ?? 0) * Math.PI) / 180;
      const corners = [
        [-b.w / 2, -b.h / 2],
        [b.w / 2, -b.h / 2],
        [b.w / 2, b.h / 2],
        [-b.w / 2, b.h / 2],
      ].map(([dx, dy]) => ({ x: c.x + dx * Math.cos(a) - dy * Math.sin(a), y: c.y + dx * Math.sin(a) + dy * Math.cos(a) }));
      return { corners, center: c, b };
    });
    // Everything drawn, for the fitted view (both before and after a transform).
    const m = data.transform?.matrix;
    const T = (p: XY): XY => (m ? { x: m[0][0] * p.x + m[0][1] * p.y, y: m[1][0] * p.x + m[1][1] * p.y } : p);
    const all: XY[] = [...named.values()];
    vectors.forEach((v) => v && all.push(v.from, v.to));
    data.segments.forEach((s) => [at(s.from), at(s.to)].forEach((p) => p && all.push(p)));
    data.polygons.forEach((pg) => pg.points.forEach((r) => {
      const p = at(r);
      if (p) all.push(p);
    }));
    data.circles.forEach((c) => {
      const p = at(c.center);
      const r = value(c.r, scope);
      if (p && Number.isFinite(r)) all.push({ x: p.x - r, y: p.y - r }, { x: p.x + r, y: p.y + r });
    });
    boxes.forEach((b) => all.push(...b.corners));
    data.notes.forEach((n) => all.push({ x: value(n.at.x, scope), y: value(n.at.y, scope) }));
    const fit = m ? [...all, ...all.map(T)] : all;
    let xs = data.x ?? extent(fit.map((p) => p.x), [-5, 5], 0.12);
    let ys = data.y ?? extent(fit.map((p) => p.y), [-5, 5], 0.12);
    if (data.axes) {
      xs = [Math.min(xs[0], 0), Math.max(xs[1], 0)];
      ys = [Math.min(ys[0], 0), Math.max(ys[1], 0)];
    }
    // Equal units: the drawing's height follows the y span.
    const unit = (PLOT_W - 2 * PAD) / (xs[1] - xs[0]);
    let height = (ys[1] - ys[0]) * unit + 2 * PAD;
    if (height > 620) {
      // Very tall: widen x instead so the drawing stays a readable shape.
      const needed = ((620 - 2 * PAD) / (PLOT_W - 2 * PAD)) * (xs[1] - xs[0]);
      const grow = (ys[1] - ys[0]) / needed;
      const mid = (xs[0] + xs[1]) / 2;
      const half = ((xs[1] - xs[0]) * grow) / 2;
      xs = [mid - half, mid + half];
      height = 620;
    }
    height = Math.max(200, height);
    const sx = scale(xs, [PAD, PLOT_W - PAD]);
    const sy = scale(ys, [height - PAD, PAD]);
    return { named, at, vectors, boxes, T, xs, ys, height, sx, sy, unit: (PLOT_W - 2 * PAD) / (xs[1] - xs[0]) };
  }, [data, scope]);

  const { sx, sy, height, at } = model;
  const show = (p: XY, after: boolean) => {
    const q = after ? model.T(p) : p;
    return { x: sx(q.x), y: sy(q.y) };
  };
  const arrowId = (i: number) => `${uid}-a${i}`;

  const layer = (after: boolean, ghost: boolean) => (
    <g opacity={ghost ? 0.25 : 1}>
      {data.polygons.map((pg, i) => {
        const pts = pg.points.map(at).filter((p): p is XY => !!p).map((p) => show(p, after));
        if (pts.length < 3) return null;
        const color = pg.color ? seriesColor(pg.color, 0) : undefined;
        return (
          <g key={`pg${i}`}>
            <path
              d={`${pathOf(pts)}Z`}
              className={color ? undefined : pg.shade ? "fill-muted stroke-foreground/70" : "fill-none stroke-foreground/70"}
              fill={color && pg.shade ? color : color ? "none" : undefined}
              fillOpacity={color && pg.shade ? 0.2 : undefined}
              stroke={color}
              strokeWidth={1.6}
              strokeLinejoin="round"
            />
            {pg.label && !ghost && (
              <text x={pts.reduce((s, p) => s + p.x, 0) / pts.length} y={pts.reduce((s, p) => s + p.y, 0) / pts.length} dy="0.35em" textAnchor="middle" fontSize={12} className="fill-foreground font-medium">
                {pg.label}
              </text>
            )}
          </g>
        );
      })}
      {model.boxes.map(({ corners, center, b }, i) => {
        const pts = corners.map((p) => show(p, after));
        const c = show(center, after);
        return (
          <g key={`b${i}`}>
            <path d={`${pathOf(pts)}Z`} className="fill-muted stroke-foreground/70" strokeWidth={1.6} />
            {b.label && !ghost && (
              <text x={c.x} y={c.y} dy="0.35em" textAnchor="middle" fontSize={12} className="fill-foreground font-semibold">
                {b.label}
              </text>
            )}
          </g>
        );
      })}
      {data.circles.map((c, i) => {
        const p = at(c.center);
        const r = value(c.r, scope);
        if (!p || !Number.isFinite(r)) return null;
        const ring = Array.from({ length: 73 }, (_, k) => {
          const a = (k / 72) * 2 * Math.PI;
          return show({ x: p.x + r * Math.cos(a), y: p.y + r * Math.sin(a) }, after);
        });
        return (
          <g key={`c${i}`}>
            <path d={pathOf(ring)} className="fill-none stroke-foreground/70" strokeWidth={1.6} strokeDasharray={c.dashed ? "6 4" : undefined} />
            {c.label && !ghost && (
              <text x={ring[9].x + 6} y={ring[9].y - 6} fontSize={12} className="fill-foreground">
                {c.label}
              </text>
            )}
          </g>
        );
      })}
      {data.segments.map((s, i) => {
        const a = at(s.from);
        const b = at(s.to);
        if (!a || !b) return null;
        const pa = show(a, after);
        const pb = show(b, after);
        return (
          <g key={`s${i}`}>
            <line x1={pa.x} y1={pa.y} x2={pb.x} y2={pb.y} className="stroke-foreground/80" strokeWidth={1.7} strokeDasharray={s.dashed ? "6 4" : undefined} />
            {s.label && !ghost && (
              <text x={(pa.x + pb.x) / 2} y={(pa.y + pb.y) / 2 - 7} textAnchor="middle" fontSize={12} className="fill-foreground" paintOrder="stroke" stroke="var(--background)" strokeWidth={4}>
                {s.label}
              </text>
            )}
          </g>
        );
      })}
      {data.angles.map((an, i) => {
        const v = at(an.vertex);
        const a = at(an.from);
        const b = at(an.to);
        if (!v || !a || !b) return null;
        const pv = show(v, after);
        const pa = show(a, after);
        const pb = show(b, after);
        const a1 = Math.atan2(pa.y - pv.y, pa.x - pv.x);
        let a2 = Math.atan2(pb.y - pv.y, pb.x - pv.x);
        let sweep = a2 - a1;
        while (sweep <= -Math.PI) sweep += 2 * Math.PI;
        while (sweep > Math.PI) sweep -= 2 * Math.PI;
        a2 = a1 + sweep;
        const r = 22;
        const mid = a1 + sweep / 2;
        const label = an.label && !ghost && (
          <text x={pv.x + (r + 13) * Math.cos(mid)} y={pv.y + (r + 13) * Math.sin(mid)} dy="0.35em" textAnchor="middle" fontSize={12} className="fill-foreground">
            {an.label}
          </text>
        );
        if (an.right) {
          const s = 11;
          const u = { x: Math.cos(a1), y: Math.sin(a1) };
          const w = { x: Math.cos(a2), y: Math.sin(a2) };
          const d = `M${pv.x + u.x * s},${pv.y + u.y * s}L${pv.x + (u.x + w.x) * s},${pv.y + (u.y + w.y) * s}L${pv.x + w.x * s},${pv.y + w.y * s}`;
          return (
            <g key={`an${i}`}>
              <path d={d} className="fill-none stroke-foreground/70" strokeWidth={1.3} />
              {label}
            </g>
          );
        }
        const start = { x: pv.x + r * Math.cos(a1), y: pv.y + r * Math.sin(a1) };
        const end = { x: pv.x + r * Math.cos(a2), y: pv.y + r * Math.sin(a2) };
        return (
          <g key={`an${i}`}>
            <path d={`M${start.x},${start.y}A${r},${r} 0 0 ${sweep > 0 ? 1 : 0} ${end.x},${end.y}`} className="fill-none stroke-foreground/70" strokeWidth={1.3} />
            {label}
          </g>
        );
      })}
      {model.vectors.map((vec, i) => {
        if (!vec) return null;
        const a = show(vec.from, after);
        const b = show(vec.to, after);
        const color = seriesColor(vec.v.color, i);
        const len = Math.hypot(b.x - a.x, b.y - a.y) || 1;
        const nx = -(b.y - a.y) / len;
        const ny = (b.x - a.x) / len;
        return (
          <g key={`v${i}`}>
            <line x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke={color} strokeWidth={2.4} markerEnd={`url(#${arrowId(i)})`} />
            {vec.v.label && !ghost && (
              <text x={(a.x + b.x) / 2 + nx * 13} y={(a.y + b.y) / 2 + ny * 13} dy="0.35em" textAnchor="middle" fontSize={12.5} fill={color} className="font-semibold" paintOrder="stroke" stroke="var(--background)" strokeWidth={4}>
                {vec.v.label}
              </text>
            )}
          </g>
        );
      })}
      {data.points.map((p, i) => {
        if (p.hidden) return null;
        const q = model.named.get(p.id);
        if (!q || !Number.isFinite(q.x) || !Number.isFinite(q.y)) return null;
        const c = show(q, after);
        return (
          <g key={`p${i}`}>
            <circle cx={c.x} cy={c.y} r={3.8} className="fill-foreground" />
            {!ghost && (p.label ?? p.id) && (
              <text x={c.x + 7} y={c.y - 7} fontSize={12.5} className="fill-foreground font-semibold">
                {p.label ?? p.id}
              </text>
            )}
          </g>
        );
      })}
      {!ghost &&
        data.notes.map((n, i) => {
          const c = show({ x: value(n.at.x, scope), y: value(n.at.y, scope) }, after);
          return Number.isFinite(c.x) && Number.isFinite(c.y) ? (
            <text key={`n${i}`} x={c.x} y={c.y} fontSize={12} className="fill-muted-foreground">
              {n.text}
            </text>
          ) : null;
        })}
    </g>
  );

  return (
    <div>
      <ParamControls params={data.params} state={params} />
      {data.transform && (
        <div className="mb-2 flex flex-wrap items-center gap-2 font-sans text-[13px]" data-export-skip="">
          <div role="group" aria-label="Transformation" className="inline-flex rounded-lg border border-border p-0.5">
            {(["Before", "After"] as const).map((label) => {
              const on = (label === "After") === applied;
              return (
                <button
                  key={label}
                  type="button"
                  aria-pressed={on}
                  onClick={() => setApplied(label === "After")}
                  className={cn("rounded-md px-2.5 py-1 font-medium transition-colors", on ? "bg-muted text-foreground" : "text-muted-foreground hover:text-foreground")}
                >
                  {label}
                </button>
              );
            })}
          </div>
          <span className="text-muted-foreground">{data.transform.label ?? "Apply the matrix"}</span>
        </div>
      )}
      <SvgStage
        width={PLOT_W}
        height={height}
        label={data.title ?? "Geometry"}
        defs={model.vectors.map((vec, i) =>
          vec ? (
            <marker key={i} id={arrowId(i)} viewBox="0 0 10 10" refX="8.5" refY="5" markerWidth="6.5" markerHeight="6.5" orient="auto-start-reverse">
              <path d="M0,0 L10,5 L0,10 z" fill={seriesColor(vec.v.color, i)} />
            </marker>
          ) : null,
        )}
      >
        {(data.grid || data.axes) && (
          <CartesianAxes
            xDomain={model.xs}
            yDomain={model.ys}
            sx={sx}
            sy={sy}
            width={PLOT_W}
            height={height}
            grid={!!data.grid}
            inset={{ top: PAD, right: PAD, bottom: PAD, left: PAD }}
          />
        )}
        {data.transform && applied && layer(false, true)}
        {layer(applied, false)}
      </SvgStage>
    </div>
  );
}
