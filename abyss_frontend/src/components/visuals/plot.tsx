"use client";

import { useId, useMemo } from "react";

import type { PlotData } from "@/lib/visuals/schemas";
import {
  extent,
  fn,
  linearFit,
  pathOf,
  sampleCurve,
  sampleParametric,
  scale,
  seriesColor,
  value,
  type Scope,
  type XY,
} from "@/lib/visuals/science";
import { CartesianAxes, MARGIN, ParamControls, PLOT_W, SeriesKey, useParams } from "./science-frame";
import { SvgStage } from "./stage";

const SAMPLES = 480;

/** The y-range that shows a set of values well: ignores asymptote spikes (5th-95th percentile, widened). */
function robustRange(values: number[]): [number, number] | null {
  const v = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (v.length < 2) return null;
  const q = (p: number) => v[Math.min(v.length - 1, Math.max(0, Math.round(p * (v.length - 1))))];
  let lo = q(0.03);
  let hi = q(0.97);
  if (hi - lo < 1e-9) {
    lo -= 1;
    hi += 1;
  }
  const pad = (hi - lo) * 0.12;
  return [lo - pad, hi + pad];
}

/**
 * A graph drawn to scale: functions y = f(x), parametric and polar curves,
 * shaded areas, data series (with an optional trend line), points, segments
 * and arrows, reference lines and notes. Parameters become sliders; one marked
 * `animate` gets a play button. Formulas use lib/formula.ts.
 */
export function PlotVisual({ data }: { data: PlotData }) {
  const params = useParams(data.params);
  const uid = useId().replace(/[^a-zA-Z0-9]/g, "");
  const scope: Scope = params.values;

  const model = useMemo(() => {
    const xLog = !!data.xLog;
    const yLog = !!data.yLog;
    // x-range: given, else from data/points/curves, else [-10, 10].
    const curveXs: number[] = [];
    const curveYs: number[] = [];
    const param = data.parametric.map((c) =>
      sampleParametric(fn(c.x, "t", scope), fn(c.y, "t", scope), c.t[0], c.t[1], SAMPLES),
    );
    const polar = data.polar.map((c) => {
      const r = fn(c.r, "t", scope);
      return sampleParametric((t) => r(t) * Math.cos(t), (t) => r(t) * Math.sin(t), c.t[0], c.t[1], SAMPLES);
    });
    for (const runs of [...param, ...polar]) for (const run of runs) for (const p of run) {
      curveXs.push(p.x);
      curveYs.push(p.y);
    }
    const dataPts = data.data.flatMap((d) => d.points);
    const fixed = [
      ...dataPts,
      ...data.points.map((p) => ({ x: value(p.at.x, scope), y: value(p.at.y, scope) })),
      ...data.segments.flatMap((s) => [
        { x: value(s.from.x, scope), y: value(s.from.y, scope) },
        { x: value(s.to.x, scope), y: value(s.to.y, scope) },
      ]),
    ];
    const xDomain: [number, number] =
      data.x ??
      (curveXs.length || fixed.length
        ? extent([...curveXs, ...fixed.map((p) => p.x)], [-10, 10])
        : data.functions.length || data.areas.length
          ? [-10, 10]
          : [0, 10]);

    // Curves over x.
    const fns = data.functions.map((f) => fn(f.y, "x", scope));
    const probe: number[] = [];
    data.functions.forEach((f, i) => {
      const [a, b] = f.x ?? xDomain;
      for (let k = 0; k <= 200; k++) {
        const x = xLog ? 10 ** (Math.log10(a) + ((Math.log10(b) - Math.log10(a)) * k) / 200) : a + ((b - a) * k) / 200;
        probe.push(fns[i](x));
      }
    });
    for (const a of data.areas) {
      const f = fn(a.y, "x", scope);
      const [x0, x1] = a.x ?? xDomain;
      for (let k = 0; k <= 60; k++) probe.push(f(x0 + ((x1 - x0) * k) / 60));
    }
    const yDomain: [number, number] =
      data.y ??
      (() => {
        const ys = [...probe, ...curveYs, ...fixed.map((p) => p.y)];
        if (yLog) {
          // Whole decades around the positive values.
          const logs = robustRange(ys.filter((v) => v > 0).map(Math.log10));
          return (logs ? [10 ** Math.floor(logs[0]), 10 ** Math.ceil(logs[1])] : [1, 10]) as [number, number];
        }
        const robust = robustRange(ys);
        if (!robust) return [-10, 10] as [number, number];
        // Keep the x-axis in view when the graph is close to it.
        const [lo, hi] = robust;
        const span = hi - lo;
        return [lo > 0 && lo < span * 0.5 ? 0 : lo, hi < 0 && -hi < span * 0.5 ? 0 : hi] as [number, number];
      })();
    const safeY: [number, number] = yLog ? [Math.max(yDomain[0], 1e-12), yDomain[1]] : yDomain;
    const safeX: [number, number] = xLog ? [Math.max(xDomain[0], 1e-12), xDomain[1]] : xDomain;

    const plotH = data.equal
      ? Math.min(560, Math.max(260, ((PLOT_W - MARGIN.left - MARGIN.right) * (safeY[1] - safeY[0])) / (safeX[1] - safeX[0])))
      : 360;
    const height = plotH + MARGIN.top + MARGIN.bottom;
    const sx = scale(safeX, [MARGIN.left, PLOT_W - MARGIN.right], xLog);
    const sy = scale(safeY, [height - MARGIN.bottom, MARGIN.top], yLog);
    const toPx = (p: XY) => ({ x: sx(p.x), y: sy(p.y) });

    const curves = data.functions.map((f, i) => {
      const [a, b] = f.x ?? safeX;
      return sampleCurve(fns[i], a, b, SAMPLES, safeY, xLog).map((run) => run.map(toPx));
    });
    return { xLog, yLog, xDomain: safeX, yDomain: safeY, height, sx, sy, toPx, curves, param, polar };
  }, [data, scope]);

  const { sx, sy, toPx, height } = model;
  const clip = `${uid}-clip`;
  const arrow = `${uid}-arrow`;
  const keyItems: { label: string; color: string; dashed?: boolean }[] = [];
  let colorTurn = 0;
  // Automatic colours take turns, skipping the ones the spec picked explicitly.
  const picked = new Set(
    [...data.functions, ...data.parametric, ...data.polar, ...data.data].map((c) => c.color).filter((c): c is number => c !== undefined),
  );
  const nextColor = (c: number | undefined) => {
    if (c !== undefined) return seriesColor(c, 0);
    while (picked.has((colorTurn % 8) + 1) && picked.size < 8) colorTurn++;
    return seriesColor(undefined, colorTurn++);
  };

  const curveColors = data.functions.map((f) => nextColor(f.color));
  const paramColors = data.parametric.map((c) => nextColor(c.color));
  const polarColors = data.polar.map((c) => nextColor(c.color));
  const dataColors = data.data.map((d) => nextColor(d.color));
  data.functions.forEach((f, i) => f.label && keyItems.push({ label: f.label, color: curveColors[i], dashed: f.dashed }));
  data.parametric.forEach((c, i) => c.label && keyItems.push({ label: c.label, color: paramColors[i], dashed: c.dashed }));
  data.polar.forEach((c, i) => c.label && keyItems.push({ label: c.label, color: polarColors[i], dashed: c.dashed }));
  data.data.forEach((d, i) => d.label && keyItems.push({ label: d.label, color: dataColors[i] }));

  const label = data.title ?? "Graph";
  return (
    <div>
      <ParamControls params={data.params} state={params} />
      <SvgStage
        width={PLOT_W}
        height={height}
        label={label}
        defs={
          <>
            <clipPath id={clip}>
              <rect x={MARGIN.left} y={MARGIN.top} width={PLOT_W - MARGIN.left - MARGIN.right} height={height - MARGIN.top - MARGIN.bottom} />
            </clipPath>
            <marker id={arrow} viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
              <path d="M0,0 L10,5 L0,10 z" className="fill-foreground" />
            </marker>
          </>
        }
      >
        <CartesianAxes
          xDomain={model.xDomain}
          yDomain={model.yDomain}
          sx={sx}
          sy={sy}
          width={PLOT_W}
          height={height}
          xLog={model.xLog}
          yLog={model.yLog}
          grid={data.grid !== false}
          xLabel={data.xLabel}
          yLabel={data.yLabel}
        />
        <g clipPath={`url(#${clip})`}>
          {data.areas.map((a, i) => {
            const f = fn(a.y, "x", scope);
            const g = a.y2 ? fn(a.y2, "x", scope) : () => 0;
            const [x0, x1] = a.x ?? model.xDomain;
            const top: XY[] = [];
            const bottom: XY[] = [];
            for (let k = 0; k <= 160; k++) {
              const x = x0 + ((x1 - x0) * k) / 160;
              const y1 = f(x);
              const y2 = g(x);
              if (Number.isFinite(y1) && Number.isFinite(y2)) {
                top.push(toPx({ x, y: y1 }));
                bottom.push(toPx({ x, y: y2 }));
              }
            }
            if (top.length < 2) return null;
            const color = seriesColor(a.color, i + 2);
            return (
              <g key={`a${i}`}>
                <path d={`${pathOf(top)}${pathOf(bottom.reverse()).replace("M", "L")}Z`} fill={color} fillOpacity={0.18} />
                {a.label && (
                  <text x={(top[0].x + top[top.length - 1].x) / 2} y={(top[Math.floor(top.length / 2)].y + bottom[Math.floor(bottom.length / 2)].y) / 2} textAnchor="middle" fontSize={12} className="fill-foreground font-medium">
                    {a.label}
                  </text>
                )}
              </g>
            );
          })}
          {model.curves.map((runs, i) =>
            runs.map((run, j) => (
              <path key={`f${i}-${j}`} d={pathOf(run)} fill="none" stroke={curveColors[i]} strokeWidth={2.4} strokeDasharray={data.functions[i].dashed ? "7 5" : undefined} strokeLinejoin="round" />
            )),
          )}
          {model.param.map((runs, i) =>
            runs.map((run, j) => (
              <path key={`p${i}-${j}`} d={pathOf(run.map(toPx))} fill="none" stroke={paramColors[i]} strokeWidth={2.4} strokeDasharray={data.parametric[i].dashed ? "7 5" : undefined} />
            )),
          )}
          {model.polar.map((runs, i) =>
            runs.map((run, j) => (
              <path key={`r${i}-${j}`} d={pathOf(run.map(toPx))} fill="none" stroke={polarColors[i]} strokeWidth={2.4} strokeDasharray={data.polar[i].dashed ? "7 5" : undefined} />
            )),
          )}
          {data.data.map((d, i) => {
            const pts = d.points.map(toPx);
            return (
              <g key={`d${i}`}>
                {d.line && <path d={pathOf(pts)} fill="none" stroke={dataColors[i]} strokeWidth={2} />}
                {pts.map((p, k) => (
                  <circle key={k} cx={p.x} cy={p.y} r={3.6} fill={dataColors[i]} />
                ))}
              </g>
            );
          })}
          {data.vlines.map((v, i) => {
            const x = sx(value(v.x, scope));
            return Number.isFinite(x) ? (
              <g key={`v${i}`}>
                <line x1={x} x2={x} y1={MARGIN.top} y2={height - MARGIN.bottom} className="stroke-muted-foreground" strokeWidth={1.3} strokeDasharray={v.dashed === false ? undefined : "5 4"} />
                {v.label && <text x={x + 4} y={MARGIN.top + 12} fontSize={11} className="fill-muted-foreground">{v.label}</text>}
              </g>
            ) : null;
          })}
          {data.hlines.map((h, i) => {
            const y = sy(value(h.y, scope));
            return Number.isFinite(y) ? (
              <g key={`h${i}`}>
                <line x1={MARGIN.left} x2={PLOT_W - MARGIN.right} y1={y} y2={y} className="stroke-muted-foreground" strokeWidth={1.3} strokeDasharray={h.dashed === false ? undefined : "5 4"} />
                {h.label && <text x={PLOT_W - MARGIN.right - 4} y={y - 5} textAnchor="end" fontSize={11} className="fill-muted-foreground">{h.label}</text>}
              </g>
            ) : null;
          })}
          {data.segments.map((s, i) => {
            const a = toPx({ x: value(s.from.x, scope), y: value(s.from.y, scope) });
            const b = toPx({ x: value(s.to.x, scope), y: value(s.to.y, scope) });
            if (![a.x, a.y, b.x, b.y].every(Number.isFinite)) return null;
            const color = s.color ? seriesColor(s.color, 0) : "var(--foreground)";
            return (
              <g key={`s${i}`}>
                <line x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke={color} strokeWidth={1.8} strokeDasharray={s.dashed ? "6 4" : undefined} markerEnd={s.arrow ? `url(#${arrow})` : undefined} />
                {s.label && (
                  <text x={(a.x + b.x) / 2 + 6} y={(a.y + b.y) / 2 - 6} fontSize={12} className="fill-foreground font-medium">
                    {s.label}
                  </text>
                )}
              </g>
            );
          })}
        </g>
        {/* Trend lines for scattered data (no line asked): a least-squares fit. */}
        <g clipPath={`url(#${clip})`}>
          {data.data.map((d, i) => {
            if (d.line || d.points.length < 3) return null;
            const fitLine = linearFit(d.points);
            if (!fitLine) return null;
            const [x0, x1] = model.xDomain;
            const a = toPx({ x: x0, y: fitLine.slope * x0 + fitLine.intercept });
            const b = toPx({ x: x1, y: fitLine.slope * x1 + fitLine.intercept });
            return <line key={`fit${i}`} x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke={dataColors[i]} strokeWidth={1.4} strokeDasharray="6 4" opacity={0.8} />;
          })}
        </g>
        {data.points.map((p, i) => {
          const c = toPx({ x: value(p.at.x, scope), y: value(p.at.y, scope) });
          if (!Number.isFinite(c.x) || !Number.isFinite(c.y)) return null;
          const color = p.color ? seriesColor(p.color, 0) : "var(--foreground)";
          return (
            <g key={`pt${i}`}>
              <circle cx={c.x} cy={c.y} r={4.5} fill={p.open ? "var(--background)" : color} stroke={color} strokeWidth={2} />
              {p.label && (
                <text x={c.x + 8} y={c.y - 8} fontSize={12} className="fill-foreground font-medium">
                  {p.label}
                </text>
              )}
            </g>
          );
        })}
        {data.notes.map((n, i) => {
          const c = toPx({ x: value(n.at.x, scope), y: value(n.at.y, scope) });
          return Number.isFinite(c.x) && Number.isFinite(c.y) ? (
            <text key={`n${i}`} x={c.x} y={c.y} fontSize={12} className="fill-foreground" paintOrder="stroke" stroke="var(--background)" strokeWidth={4}>
              {n.text}
            </text>
          ) : null;
        })}
      </SvgStage>
      <SeriesKey items={keyItems} />
    </div>
  );
}
