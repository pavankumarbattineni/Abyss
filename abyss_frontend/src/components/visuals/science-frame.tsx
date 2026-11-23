"use client";

import { useEffect, useRef, useState } from "react";
import { Pause, Play } from "lucide-react";

import { formatTick, initialParams, logTicks, niceTicks, type Scope } from "@/lib/visuals/science";
import type { Param } from "@/lib/visuals/schemas";

/** Drawing size shared by the science visuals (scaled to the column by SvgStage). */
export const PLOT_W = 600;
export const MARGIN = { top: 16, right: 20, bottom: 44, left: 54 };

/**
 * Slider parameters, plus playback for the ones marked `animate`: playing
 * moves the value from min to max over the given seconds (default 6) and
 * loops. Nothing moves until the user presses play.
 */
export function useParams(params: Param[]) {
  const [values, setValues] = useState<Scope>(() => initialParams(params));
  const [playing, setPlaying] = useState<string | null>(null);
  const frame = useRef<number | undefined>(undefined);

  useEffect(() => {
    if (!playing) return;
    const p = params.find((q) => q.name === playing);
    if (!p) return;
    const seconds = typeof p.animate === "number" && p.animate > 0 ? p.animate : 6;
    let last = performance.now();
    const tick = (now: number) => {
      const dt = (now - last) / 1000;
      last = now;
      setValues((v) => {
        let next = (v[p.name] ?? p.min) + ((p.max - p.min) * dt) / seconds;
        if (next > p.max) next = p.min;
        return { ...v, [p.name]: next };
      });
      frame.current = requestAnimationFrame(tick);
    };
    frame.current = requestAnimationFrame(tick);
    return () => {
      if (frame.current !== undefined) cancelAnimationFrame(frame.current);
    };
  }, [playing, params]);

  const set = (name: string, v: number) => setValues((prev) => ({ ...prev, [name]: v }));
  return { values, set, playing, setPlaying };
}

export function ParamControls({
  params,
  state,
}: {
  params: Param[];
  state: ReturnType<typeof useParams>;
}) {
  if (!params.length) return null;
  return (
    <div className="mb-3 grid gap-x-5 gap-y-2 font-sans text-[13px] sm:grid-cols-2" data-export-skip="">
      {params.map((p) => {
        const v = state.values[p.name] ?? p.min;
        const step = p.step ?? (p.max - p.min) / 200;
        const isPlaying = state.playing === p.name;
        return (
          <label key={p.name} className="flex min-w-0 items-center gap-2">
            {p.animate !== undefined && p.animate !== false && (
              <button
                type="button"
                onClick={(e) => {
                  e.preventDefault();
                  state.setPlaying(isPlaying ? null : p.name);
                }}
                aria-label={isPlaying ? `Pause ${p.label ?? p.name}` : `Play ${p.label ?? p.name}`}
                className="grid size-7 shrink-0 place-items-center rounded-full border border-border text-foreground hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
              >
                {isPlaying ? <Pause className="size-3.5" /> : <Play className="size-3.5" />}
              </button>
            )}
            <span className="shrink-0 text-muted-foreground">{p.label ?? p.name}</span>
            <input
              type="range"
              min={p.min}
              max={p.max}
              step={step}
              value={v}
              onChange={(e) => {
                state.setPlaying(null);
                state.set(p.name, Number(e.target.value));
              }}
              className="min-w-0 flex-1 accent-[var(--viz-1)]"
            />
            <span className="w-14 shrink-0 text-right font-medium tabular-nums">{formatTick(Number(v.toPrecision(3)))}</span>
          </label>
        );
      })}
    </div>
  );
}

/**
 * Grid, axes and tick labels for a Cartesian drawing. Axes sit at zero when
 * zero is in range, otherwise at the drawing's edge.
 */
export function CartesianAxes({
  xDomain,
  yDomain,
  sx,
  sy,
  width,
  height,
  xLog,
  yLog,
  grid = true,
  xLabel,
  yLabel,
  inset = MARGIN,
}: {
  /** The drawing area inside the SVG (defaults to the plot margins). */
  inset?: { top: number; right: number; bottom: number; left: number };
  xDomain: [number, number];
  yDomain: [number, number];
  sx: (v: number) => number;
  sy: (v: number) => number;
  width: number;
  height: number;
  xLog?: boolean;
  yLog?: boolean;
  grid?: boolean;
  xLabel?: string;
  yLabel?: string;
}) {
  const xt = xLog ? logTicks(...xDomain) : niceTicks(...xDomain, Math.max(4, Math.round((width - inset.left - inset.right) / 80)));
  const yt = yLog ? logTicks(...yDomain) : niceTicks(...yDomain, Math.max(4, Math.round((height - inset.top - inset.bottom) / 55)));
  const left = inset.left;
  const right = width - inset.right;
  const top = inset.top;
  const bottom = height - inset.bottom;
  const axisY = !yLog && yDomain[0] <= 0 && yDomain[1] >= 0 ? sy(0) : bottom;
  const axisX = !xLog && xDomain[0] <= 0 && xDomain[1] >= 0 ? sx(0) : left;
  return (
    <g className="font-sans" fontSize={11}>
      {grid &&
        xt.map((t) => <line key={`gx${t}`} x1={sx(t)} x2={sx(t)} y1={top} y2={bottom} className="stroke-border" strokeWidth={0.7} />)}
      {grid &&
        yt.map((t) => <line key={`gy${t}`} x1={left} x2={right} y1={sy(t)} y2={sy(t)} className="stroke-border" strokeWidth={0.7} />)}
      <line x1={left} x2={right} y1={axisY} y2={axisY} className="stroke-muted-foreground" strokeWidth={1.2} />
      <line x1={axisX} x2={axisX} y1={top} y2={bottom} className="stroke-muted-foreground" strokeWidth={1.2} />
      {xt.map((t) => (
        <text key={`tx${t}`} x={sx(t)} y={Math.min(bottom, axisY) + 15} textAnchor="middle" className="fill-muted-foreground">
          {t === 0 && axisX === sx(0) ? "" : formatTick(t)}
        </text>
      ))}
      {yt.map((t) => (
        <text key={`ty${t}`} x={Math.max(left, axisX) - 6} y={sy(t)} dy="0.35em" textAnchor="end" className="fill-muted-foreground">
          {formatTick(t)}
        </text>
      ))}
      {xLabel && (
        <text x={(left + right) / 2} y={height - 8} textAnchor="middle" fontSize={12} className="fill-foreground font-medium">
          {xLabel}
        </text>
      )}
      {yLabel && (
        <text transform={`translate(14 ${(top + bottom) / 2}) rotate(-90)`} textAnchor="middle" fontSize={12} className="fill-foreground font-medium">
          {yLabel}
        </text>
      )}
    </g>
  );
}

/** A small key for named series. */
export function SeriesKey({ items }: { items: { label: string; color: string; dashed?: boolean }[] }) {
  if (!items.length) return null;
  return (
    <div className="mt-2 flex flex-wrap justify-center gap-x-4 gap-y-1 font-sans text-xs text-muted-foreground">
      {items.map((item) => (
        <span key={item.label} className="inline-flex items-center gap-1.5">
          <svg width="18" height="6" aria-hidden="true">
            <line x1="0" x2="18" y1="3" y2="3" stroke={item.color} strokeWidth="2.5" strokeDasharray={item.dashed ? "4 3" : undefined} />
          </svg>
          {item.label}
        </span>
      ))}
    </div>
  );
}
