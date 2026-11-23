/**
 * Math for the science visuals (plot, geometry, vector-field): scales, nice
 * tick values, safe evaluation of the model's formulas over slider parameters,
 * and curve sampling that breaks at discontinuities (tan x, 1/x) instead of
 * drawing false vertical lines. No DOM; formulas go through lib/formula.ts
 * (a parser, never eval).
 */
import { evaluateFormula } from "@/lib/formula";
import type { Param } from "./schemas";

export type Scope = Record<string, number>;
export type NumOrExpr = number | string;
export interface XY {
  x: number;
  y: number;
}

/** A number, or a formula over `scope`; NaN when it can't be evaluated. */
export function value(v: NumOrExpr | undefined, scope: Scope): number {
  if (v === undefined) return Number.NaN;
  if (typeof v === "number") return v;
  const asNumber = Number(v);
  if (v.trim() !== "" && Number.isFinite(asNumber)) return asNumber;
  try {
    return evaluateFormula(v, scope);
  } catch {
    return Number.NaN;
  }
}

/** A compiled-once evaluator for `f(variable)` over `scope` (NaN on errors). */
export function fn(expr: string, variable: string, scope: Scope): (v: number) => number {
  const local: Scope = { ...scope };
  return (v: number) => {
    local[variable] = v;
    try {
      return evaluateFormula(expr, local);
    } catch {
      return Number.NaN;
    }
  };
}

/** The starting value of each slider parameter. */
export function initialParams(params: Param[]): Scope {
  return Object.fromEntries(params.map((p) => [p.name, clamp(p.value ?? p.min, p.min, p.max)]));
}

export function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}

/** Round tick values ("nice numbers") covering [lo, hi], about `count` of them. */
export function niceTicks(lo: number, hi: number, count = 6): number[] {
  if (!(hi > lo)) return [lo];
  const span = hi - lo;
  const raw = span / Math.max(1, count);
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw) ?? 10 * mag;
  const start = Math.ceil(lo / step) * step;
  const ticks: number[] = [];
  for (let t = start; t <= hi + step * 1e-9; t += step) ticks.push(Math.abs(t) < step * 1e-9 ? 0 : t);
  return ticks;
}

/** Powers of ten across a log axis. */
export function logTicks(lo: number, hi: number): number[] {
  const ticks: number[] = [];
  for (let e = Math.floor(Math.log10(lo)); e <= Math.ceil(Math.log10(hi)); e++) {
    const t = 10 ** e;
    if (t >= lo * 0.999 && t <= hi * 1.001) ticks.push(t);
  }
  return ticks;
}

/** Short tick label: 0.5, 2, 1000, 1e6, 0.001, π multiples left to the caller. */
export function formatTick(v: number): string {
  if (v === 0) return "0";
  const abs = Math.abs(v);
  if (abs >= 1e5 || abs < 1e-3) return v.toExponential(0).replace("e+", "e");
  return String(Number(v.toPrecision(4)));
}

/** A 1-D scale from data to pixels (linear or log10). */
export function scale(domain: [number, number], rangePx: [number, number], log = false) {
  const [d0, d1] = log ? [Math.log10(domain[0]), Math.log10(domain[1])] : domain;
  const [r0, r1] = rangePx;
  const k = (r1 - r0) / (d1 - d0 || 1);
  return (v: number) => r0 + ((log ? Math.log10(v) : v) - d0) * k;
}

/**
 * Samples `f` over [a, b] into polyline segments, split where the function is
 * undefined or jumps (a vertical asymptote), so no false lines are drawn.
 * `yBound` keeps runaway values from blowing up the path.
 */
export function sampleCurve(
  f: (x: number) => number,
  a: number,
  b: number,
  samples: number,
  yBound: [number, number],
  log = false,
): XY[][] {
  const runs: XY[][] = [];
  let run: XY[] = [];
  const span = yBound[1] - yBound[0];
  const lo = yBound[0] - span * 4;
  const hi = yBound[1] + span * 4;
  let prev: XY | null = null;
  for (let i = 0; i <= samples; i++) {
    const x = log ? 10 ** (Math.log10(a) + ((Math.log10(b) - Math.log10(a)) * i) / samples) : a + ((b - a) * i) / samples;
    const y = f(x);
    const ok = Number.isFinite(y) && y > lo && y < hi;
    const jump = prev && ok && Math.abs(y - prev.y) > span * 1.5;
    if (!ok || jump) {
      if (run.length > 1) runs.push(run);
      run = ok ? [{ x, y }] : [];
      prev = ok ? { x, y } : null;
      continue;
    }
    run.push({ x, y });
    prev = { x, y };
  }
  if (run.length > 1) runs.push(run);
  return runs;
}

/** Samples a parametric curve (x(t), y(t)) into segments. */
export function sampleParametric(
  fx: (t: number) => number,
  fy: (t: number) => number,
  t0: number,
  t1: number,
  samples: number,
): XY[][] {
  const runs: XY[][] = [];
  let run: XY[] = [];
  for (let i = 0; i <= samples; i++) {
    const t = t0 + ((t1 - t0) * i) / samples;
    const x = fx(t);
    const y = fy(t);
    if (Number.isFinite(x) && Number.isFinite(y)) run.push({ x, y });
    else if (run.length) {
      if (run.length > 1) runs.push(run);
      run = [];
    }
  }
  if (run.length > 1) runs.push(run);
  return runs;
}

/** A fitting range for values, padded, falling back when there are none. */
export function extent(values: number[], fallback: [number, number], pad = 0.08): [number, number] {
  const finite = values.filter(Number.isFinite);
  if (!finite.length) return fallback;
  let lo = Math.min(...finite);
  let hi = Math.max(...finite);
  if (lo === hi) {
    lo -= 1;
    hi += 1;
  }
  const p = (hi - lo) * pad;
  return [lo - p, hi + p];
}

/** Least-squares line through points: y = slope*x + intercept. */
export function linearFit(points: XY[]): { slope: number; intercept: number } | null {
  const n = points.length;
  if (n < 2) return null;
  const sx = points.reduce((s, p) => s + p.x, 0);
  const sy = points.reduce((s, p) => s + p.y, 0);
  const sxx = points.reduce((s, p) => s + p.x * p.x, 0);
  const sxy = points.reduce((s, p) => s + p.x * p.y, 0);
  const d = n * sxx - sx * sx;
  if (d === 0) return null;
  const slope = (n * sxy - sx * sy) / d;
  return { slope, intercept: (sy - slope * sx) / n };
}

/** The app's chart colours (--viz-1..8), by 1-based index or in turn. */
export function seriesColor(index: number | undefined, fallback: number): string {
  const i = ((index ?? fallback + 1) - 1 + 8) % 8;
  return `var(--viz-${i + 1})`;
}

/** SVG path data for a polyline. */
export function pathOf(points: { x: number; y: number }[]): string {
  return points.map((p, i) => `${i ? "L" : "M"}${p.x.toFixed(2)},${p.y.toFixed(2)}`).join("");
}
