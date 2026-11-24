"use client";

import { useId, useMemo, useState } from "react";

import { cn } from "@/lib/utils";
import type { GeometryData } from "@/lib/visuals/schemas";
import { placeLabels, textBox, type Box, type LabelRequest, type PlacedLabel, type Pt } from "@/lib/visuals/label-placement";
import {
  extent,
  fn,
  pathOf,
  sampleCurve,
  sampleParametric,
  scale,
  seriesColor,
  value,
  type NumOrExpr,
  type Scope,
  type XY,
} from "@/lib/visuals/science";
import { CartesianAxes, ParamControls, PLOT_W, useParams } from "./science-frame";
import { SvgStage } from "./stage";

type Ref = string | { x: NumOrExpr; y: NumOrExpr };
const PAD = 28;
const CURVE_SAMPLES = 160;
const LABEL_FONT = 12.5;

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
    // Curves (a cable, a trajectory, an arc): parametric ones fix their own extent;
    // y = f(x) ones are sampled over their range, or the drawing's.
    const parametric = data.parametric.map((c) => sampleParametric(fn(c.x, "t", scope), fn(c.y, "t", scope), c.t[0], c.t[1], CURVE_SAMPLES));
    parametric.forEach((runs) => runs.forEach((run) => all.push(...run)));
    data.functions.forEach((f) => f.x && all.push({ x: f.x[0], y: NaN }, { x: f.x[1], y: NaN }));
    const fit = (m ? [...all, ...all.map(T)] : all).filter((p) => Number.isFinite(p.x));
    let xs = data.x ?? extent(fit.map((p) => p.x), [-5, 5], 0.12);
    let ys = data.y ?? extent(fit.filter((p) => Number.isFinite(p.y)).map((p) => p.y), [-5, 5], 0.12);
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
    const span = ys[1] - ys[0];
    const curves = [
      ...data.functions.map((f) => ({
        runs: sampleCurve(fn(f.y, "x", scope), f.x?.[0] ?? xs[0], f.x?.[1] ?? xs[1], CURVE_SAMPLES, [ys[0] - span, ys[1] + span]),
        label: f.label, color: f.color, dashed: f.dashed,
      })),
      ...data.parametric.map((c, i) => ({ runs: parametric[i], label: c.label, color: c.color, dashed: c.dashed })),
    ];
    return { named, at, vectors, boxes, curves, T, xs, ys, height, sx, sy, unit: (PLOT_W - 2 * PAD) / (xs[1] - xs[0]) };
  }, [data, scope]);

  const { sx, sy, height, at } = model;
  const show = (p: XY, after: boolean) => {
    const q = after ? model.T(p) : p;
    return { x: sx(q.x), y: sy(q.y) };
  };
  const arrowId = (i: number) => `${uid}-a${i}`;

  /** Everything one layer draws, in pixels, with every movable label placed
   * clear of lines, arrows, curves, points and the other labels (label-placement.ts). */
  const layout = (after: boolean) => {
    const px = (p: XY) => show(p, after);
    const segments = data.segments.map((s) => {
      const a = at(s.from);
      const b = at(s.to);
      return a && b ? ([px(a), px(b)] as [Pt, Pt]) : null;
    });
    const vectors = model.vectors.map((vec) => (vec ? ([px(vec.from), px(vec.to)] as [Pt, Pt]) : null));
    const polygons = data.polygons.map((pg) => pg.points.map(at).filter((p): p is XY => !!p).map(px));
    const boxes = model.boxes.map(({ corners, center }) => ({ pts: corners.map(px), c: px(center) }));
    const rings = data.circles.map((c) => {
      const p = at(c.center);
      const r = value(c.r, scope);
      if (!p || !Number.isFinite(r)) return null;
      return Array.from({ length: 73 }, (_, k) => {
        const a = (k / 72) * 2 * Math.PI;
        return px({ x: p.x + r * Math.cos(a), y: p.y + r * Math.sin(a) });
      });
    });
    const curves = model.curves.map((c) => c.runs.map((run) => run.map(px)));
    const points = data.points.map((p) => {
      const q = model.named.get(p.id);
      return !p.hidden && q && Number.isFinite(q.x) && Number.isFinite(q.y) ? px(q) : null;
    });
    const notes = data.notes.map((n) => px({ x: value(n.at.x, scope), y: value(n.at.y, scope) }));
    const angles = data.angles.map((an) => {
      const v = at(an.vertex);
      const a = at(an.from);
      const b = at(an.to);
      if (!v || !a || !b) return null;
      const pv = px(v);
      const pa = px(a);
      const pb = px(b);
      const a1 = Math.atan2(pa.y - pv.y, pa.x - pv.x);
      let sweep = Math.atan2(pb.y - pv.y, pb.x - pv.x) - a1;
      while (sweep <= -Math.PI) sweep += 2 * Math.PI;
      while (sweep > Math.PI) sweep -= 2 * Math.PI;
      return { pv, a1, sweep };
    });

    // Obstacles: every stroke, every visible point, and text that stays where it is.
    const strokes: [Pt, Pt][] = [];
    const chain = (pts: Pt[], closed = false) => {
      for (let i = 1; i < pts.length; i++) strokes.push([pts[i - 1], pts[i]]);
      if (closed && pts.length > 2) strokes.push([pts[pts.length - 1], pts[0]]);
    };
    segments.forEach((s) => s && strokes.push(s));
    vectors.forEach((v) => v && strokes.push(v));
    polygons.forEach((pts) => chain(pts, true));
    boxes.forEach((b) => chain(b.pts, true));
    rings.forEach((r) => r && chain(r));
    curves.forEach((runs) => runs.forEach((run) => chain(run)));
    const fixed: Box[] = [];
    data.polygons.forEach((pg, i) => {
      const pts = polygons[i];
      if (pg.label && pts.length > 2) fixed.push(textBox(pg.label, 12, { x: pts.reduce((s, p) => s + p.x, 0) / pts.length, y: pts.reduce((s, p) => s + p.y, 0) / pts.length }));
    });
    model.boxes.forEach(({ b }, i) => b.label && fixed.push(textBox(b.label, 12, boxes[i].c)));
    data.angles.forEach((an, i) => {
      const g = angles[i];
      if (an.label && g) fixed.push(textBox(an.label, 12, { x: g.pv.x + 35 * Math.cos(g.a1 + g.sweep / 2), y: g.pv.y + 35 * Math.sin(g.a1 + g.sweep / 2) }));
    });
    data.notes.forEach((n, i) => {
      const w = n.text.length * 12 * 0.58;
      fixed.push({ x0: notes[i].x, y0: notes[i].y - 12, x1: notes[i].x + w, y1: notes[i].y + 3 });
    });

    // Movable labels, nearest-to-their-thing first: points, arrows, lines, circles, curves.
    const requests: LabelRequest[] = [];
    const slots: { kind: string; i: number }[] = [];
    const ask = (kind: string, i: number, req: LabelRequest) => {
      requests.push(req);
      slots.push({ kind, i });
    };
    data.points.forEach((p, i) => points[i] && ask("point", i, { text: p.label ?? p.id, anchor: points[i]!, fontSize: LABEL_FONT }));
    model.vectors.forEach((vec, i) => {
      const v = vectors[i];
      if (vec?.v.label && v) ask("vector", i, { text: vec.v.label, anchor: mid(v), fontSize: LABEL_FONT, own: v });
    });
    data.segments.forEach((s, i) => {
      const v = segments[i];
      if (s.label && v) ask("segment", i, { text: s.label, anchor: mid(v), fontSize: 12, own: v });
    });
    data.circles.forEach((c, i) => c.label && rings[i] && ask("circle", i, { text: c.label, anchor: rings[i]![9], fontSize: 12 }));
    model.curves.forEach((c, i) => {
      const run = curves[i].reduce<Pt[]>((longest, r) => (r.length > longest.length ? r : longest), []);
      if (c.label && run.length > 1) {
        const k = Math.floor(run.length * 0.7);
        ask("curve", i, { text: c.label, anchor: run[k], fontSize: 12, own: [run[Math.max(0, k - 1)], run[k]] });
      }
    });
    const placed = placeLabels(requests, { segments: strokes, points: points.filter((p): p is Pt => !!p), boxes: fixed }, {
      x0: 2, y0: 2, x1: PLOT_W - 2, y1: height - 2,
    });
    const labels = new Map<string, PlacedLabel>();
    slots.forEach((s, k) => labels.set(`${s.kind}:${s.i}`, placed[k]));
    return { segments, vectors, polygons, boxes, rings, curves, points, notes, angles, labels };
  };

  const mid = (s: [Pt, Pt]): Pt => ({ x: (s[0].x + s[1].x) / 2, y: (s[0].y + s[1].y) / 2 });

  /** A placed label: its text, and a thin leader line when it sits away from what it names. */
  const Label = ({ at: l, text, fill, className, size }: { at: PlacedLabel | undefined; text: string; fill?: string; className: string; size: number }) =>
    l ? (
      <>
        {l.leader && (
          <line x1={l.leader[0].x} y1={l.leader[0].y} x2={l.leader[1].x} y2={l.leader[1].y} stroke={fill} className={fill ? undefined : "stroke-muted-foreground"} strokeWidth={0.8} strokeOpacity={0.7} />
        )}
        <text x={l.x} y={l.y} dy="0.35em" textAnchor="middle" fontSize={size} fill={fill} className={className} paintOrder="stroke" stroke="var(--background)" strokeWidth={4}>
          {text}
        </text>
      </>
    ) : null;

  const layer = (after: boolean, ghost: boolean) => {
    const L = layout(after);
    return (
      <g opacity={ghost ? 0.25 : 1}>
        {data.polygons.map((pg, i) => {
          const pts = L.polygons[i];
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
        {model.boxes.map(({ b }, i) => (
          <g key={`b${i}`}>
            <path d={`${pathOf(L.boxes[i].pts)}Z`} className="fill-muted stroke-foreground/70" strokeWidth={1.6} />
            {b.label && !ghost && (
              <text x={L.boxes[i].c.x} y={L.boxes[i].c.y} dy="0.35em" textAnchor="middle" fontSize={12} className="fill-foreground font-semibold">
                {b.label}
              </text>
            )}
          </g>
        ))}
        {data.circles.map((c, i) => {
          const ring = L.rings[i];
          if (!ring) return null;
          return (
            <g key={`c${i}`}>
              <path d={pathOf(ring)} className="fill-none stroke-foreground/70" strokeWidth={1.6} strokeDasharray={c.dashed ? "6 4" : undefined} />
              {c.label && !ghost && <Label at={L.labels.get(`circle:${i}`)} text={c.label} className="fill-foreground" size={12} />}
            </g>
          );
        })}
        {model.curves.map((c, i) => {
          const color = seriesColor(c.color, i + 4);
          return (
            <g key={`cv${i}`}>
              {L.curves[i].map((run, k) => (
                <path key={k} d={pathOf(run)} fill="none" stroke={color} strokeWidth={2} strokeLinejoin="round" strokeDasharray={c.dashed ? "6 4" : undefined} />
              ))}
              {c.label && !ghost && <Label at={L.labels.get(`curve:${i}`)} text={c.label} fill={color} className="font-medium" size={12} />}
            </g>
          );
        })}
        {data.segments.map((s, i) => {
          const v = L.segments[i];
          if (!v) return null;
          return (
            <g key={`s${i}`}>
              <line x1={v[0].x} y1={v[0].y} x2={v[1].x} y2={v[1].y} className="stroke-foreground/80" strokeWidth={1.7} strokeDasharray={s.dashed ? "6 4" : undefined} />
              {s.label && !ghost && <Label at={L.labels.get(`segment:${i}`)} text={s.label} className="fill-foreground" size={12} />}
            </g>
          );
        })}
        {data.angles.map((an, i) => {
          const g = L.angles[i];
          if (!g) return null;
          const { pv, a1, sweep } = g;
          const a2 = a1 + sweep;
          const r = 22;
          const midAngle = a1 + sweep / 2;
          const label = an.label && !ghost && (
            <text x={pv.x + (r + 13) * Math.cos(midAngle)} y={pv.y + (r + 13) * Math.sin(midAngle)} dy="0.35em" textAnchor="middle" fontSize={12} className="fill-foreground">
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
          const v = L.vectors[i];
          if (!vec || !v) return null;
          const color = seriesColor(vec.v.color, i);
          return (
            <g key={`v${i}`}>
              <line x1={v[0].x} y1={v[0].y} x2={v[1].x} y2={v[1].y} stroke={color} strokeWidth={2.4} markerEnd={`url(#${arrowId(i)})`} />
              {vec.v.label && !ghost && <Label at={L.labels.get(`vector:${i}`)} text={vec.v.label} fill={color} className="font-semibold" size={LABEL_FONT} />}
            </g>
          );
        })}
        {data.points.map((p, i) => {
          const c = L.points[i];
          if (!c) return null;
          return (
            <g key={`p${i}`}>
              <circle cx={c.x} cy={c.y} r={3.8} className="fill-foreground" />
              {!ghost && <Label at={L.labels.get(`point:${i}`)} text={p.label ?? p.id} className="fill-foreground font-semibold" size={LABEL_FONT} />}
            </g>
          );
        })}
        {!ghost &&
          data.notes.map((n, i) => {
            const c = L.notes[i];
            return Number.isFinite(c.x) && Number.isFinite(c.y) ? (
              <text key={`n${i}`} x={c.x} y={c.y} fontSize={12} className="fill-muted-foreground">
                {n.text}
              </text>
            ) : null;
          })}
      </g>
    );
  };

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
