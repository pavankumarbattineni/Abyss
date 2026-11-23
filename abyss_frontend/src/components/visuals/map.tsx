"use client";

import { useCallback, useEffect, useId, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent } from "react";
import { MapPinned, Minus, Plus, RotateCcw, X } from "lucide-react";
import type { Feature, FeatureCollection, Geometry } from "geojson";

import { cn } from "@/lib/utils";
import type { MapData } from "@/lib/visuals/schemas";
import { formatTick } from "@/lib/visuals/science";

type Countries = FeatureCollection<Geometry, { name: string }>;
type Geo = typeof import("d3-geo");

// d3-geo (ISC) and the 1:110m world outline (world-atlas, ISC, ~100 KB):
// fetched the first time a map is shown.
let mapPromise: Promise<{ geo: Geo; countries: Countries }> | null = null;
function loadMap() {
  mapPromise ??= Promise.all([import("d3-geo"), import("topojson-client"), import("world-atlas/countries-110m.json")]).then(
    ([geo, topo, atlas]) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const world = (atlas as any).default ?? atlas;
      const countries = topo.feature(world, world.objects.countries) as unknown as Countries;
      return { geo, countries };
    },
  );
  return mapPromise;
}

const normal = (s: string) =>
  s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

// Common names -> the outline's names.
const ALIASES: Record<string, string> = {
  usa: "United States of America",
  us: "United States of America",
  "united states": "United States of America",
  america: "United States of America",
  uk: "United Kingdom",
  britain: "United Kingdom",
  "great britain": "United Kingdom",
  england: "United Kingdom",
  "democratic republic of the congo": "Dem. Rep. Congo",
  "dr congo": "Dem. Rep. Congo",
  drc: "Dem. Rep. Congo",
  "republic of the congo": "Congo",
  "czech republic": "Czechia",
  "ivory coast": "Côte d'Ivoire",
  "cote d ivoire": "Côte d'Ivoire",
  "south sudan": "S. Sudan",
  "bosnia and herzegovina": "Bosnia and Herz.",
  "central african republic": "Central African Rep.",
  "dominican republic": "Dominican Rep.",
  "north macedonia": "Macedonia",
  eswatini: "eSwatini",
  swaziland: "eSwatini",
  "russian federation": "Russia",
  "republic of korea": "South Korea",
  korea: "South Korea",
  "equatorial guinea": "Eq. Guinea",
  "solomon islands": "Solomon Is.",
  "falkland islands": "Falkland Is.",
  "western sahara": "W. Sahara",
  "east timor": "Timor-Leste",
  burma: "Myanmar",
  uae: "United Arab Emirates",
  holland: "Netherlands",
  "the netherlands": "Netherlands",
  turkiye: "Turkey",
  "viet nam": "Vietnam",
};

function findCountry(countries: Countries, name: string): Feature<Geometry, { name: string }> | undefined {
  const key = normal(name);
  const target = normal(ALIASES[key] ?? name);
  return countries.features.find((f) => normal(f.properties.name) === target);
}

const W = 640;
const MIN_ZOOM = 1;
const MAX_ZOOM = 12;

type View = { k: number; x: number; y: number };
type Box = { x0: number; x1: number; y0: number; y1: number };
const overlaps = (a: Box, b: Box) => a.x0 < b.x1 && b.x0 < a.x1 && a.y0 < b.y1 && b.y0 < a.y1;

/** Each label's spot around its dot (right, left, below, above): the first
 * that overlaps no earlier label and stays inside the map. */
function placeLabels(points: { cx: number; cy: number; text: string }[], height: number) {
  const taken: Box[] = [];
  return points.map(({ cx, cy, text }) => {
    const w = text.length * 6.6;
    const spots = [
      { x: cx + 7, y: cy - 6, anchor: "start" as const },
      { x: cx - 7, y: cy - 6, anchor: "end" as const },
      { x: cx + 7, y: cy + 15, anchor: "start" as const },
      { x: cx - 7, y: cy + 15, anchor: "end" as const },
      { x: cx, y: cy - 10, anchor: "middle" as const },
      { x: cx, y: cy + 19, anchor: "middle" as const },
    ];
    const boxOf = (s: (typeof spots)[number]): Box => {
      const x0 = s.anchor === "start" ? s.x : s.anchor === "end" ? s.x - w : s.x - w / 2;
      return { x0, x1: x0 + w, y0: s.y - 11, y1: s.y + 2 };
    };
    const inside = (b: Box) => b.x0 >= 2 && b.x1 <= W - 2 && b.y0 >= 2 && b.y1 <= height - 2;
    // No clear spot: no label at this zoom (the dot's tooltip names it; zooming in makes room).
    const spot = spots.find((s) => inside(boxOf(s)) && !taken.some((t) => overlaps(t, boxOf(s))));
    if (!spot) return null;
    taken.push(boxOf(spot));
    return spot;
  });
}

const groupColor = (i: number) => `var(--viz-${(i % 8) + 1})`;

/**
 * An interactive world map (Equal Earth projection): places as dots (click
 * one for its details), journeys as paths through them in order, countries
 * shaded (a colour scale when they carry values) and routes as great-circle
 * arcs. Groups colour stages or regions, with a legend that shows or hides
 * them. Zoom and pan with the buttons, Ctrl/⌘ + scroll, drag, two fingers on
 * touch screens, or the keyboard (+ − arrows 0). Names it can't place are listed.
 */
export function MapVisual({ data }: { data: MapData }) {
  const uid = useId().replace(/[^a-zA-Z0-9]/g, "");
  const [loaded, setLoaded] = useState<{ geo: Geo; countries: Countries } | null>(null);
  const [failed, setFailed] = useState(false);
  const [view, setView] = useState<View>({ k: 1, x: 0, y: 0 });
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const [selected, setSelected] = useState<number | null>(null);
  const [hint, setHint] = useState<string | null>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const gesture = useRef<{ dist: number; mid: { x: number; y: number }; view: View } | null>(null);

  useEffect(() => {
    let cancelled = false;
    loadMap()
      .then((m) => !cancelled && setLoaded(m))
      .catch(() => !cancelled && setFailed(true));
    return () => {
      cancelled = true;
    };
  }, []);

  const model = useMemo(() => {
    if (!loaded) return null;
    const { geo, countries } = loaded;
    const shaded = data.regions.map((r) => ({ r, f: findCountry(countries, r.name) }));
    const byName = new Map<string, MapData["places"][number]>();
    for (const p of data.places) {
      byName.set(normal(p.name), p);
      if (p.label) byName.set(normal(p.label), p);
    }
    const unplaced: string[] = [];
    const paths = data.paths.map((p) => {
      const coords: [number, number][] = [];
      for (const stop of p.via) {
        if (Array.isArray(stop)) coords.push([stop[1], stop[0]]);
        else {
          const place = byName.get(normal(stop));
          if (place) coords.push([place.lon, place.lat]);
          else unplaced.push(stop);
        }
      }
      return { ...p, coords };
    });
    const missing = [...shaded.filter((s) => !s.f).map((s) => s.r.name), ...new Set(unplaced)];
    const focus: Feature[] = [
      ...shaded.flatMap((s) => (s.f ? [s.f] : [])),
      ...data.places.map((p) => ({ type: "Feature" as const, properties: {}, geometry: { type: "Point" as const, coordinates: [p.lon, p.lat] } })),
      ...paths
        .filter((p) => p.coords.length > 1)
        .map((p) => ({ type: "Feature" as const, properties: {}, geometry: { type: "LineString" as const, coordinates: p.coords } })),
      ...data.routes.map((r) => ({
        type: "Feature" as const,
        properties: {},
        geometry: { type: "LineString" as const, coordinates: [[r.from[1], r.from[0]], [r.to[1], r.to[0]]] },
      })),
    ];
    const projection = geo.geoEqualEarth();
    const target: FeatureCollection = focus.length ? { type: "FeatureCollection", features: focus } : (countries as FeatureCollection);
    projection.fitWidth(W - 40, target);
    const [[x0, y0], [x1, y1]] = geo.geoPath(projection).bounds(target);
    // Don't zoom in past ~ a region: a single city still shows its surroundings.
    const minSpan = 260;
    let height: number;
    if (x1 - x0 < minSpan && y1 - y0 < minSpan) {
      projection.fitExtent([[0, 0], [W - 40, 400]], target);
      projection.scale(Math.min(projection.scale(), 900));
      const c = geo.geoPath(projection).centroid(target);
      projection.translate([projection.translate()[0] + (W / 2 - c[0]), projection.translate()[1] + (210 - c[1])]);
      height = 420;
    } else {
      // Centred, with room around it for labels (most sit to the right of their dot).
      const innerW = W - 170;
      const innerH = Math.min(460, Math.max(1, (innerW * (y1 - y0)) / (x1 - x0 || 1)));
      height = Math.max(240, Math.round(innerH + 110));
      const top = (height - innerH) / 2;
      projection.fitExtent([[50, top], [50 + innerW, top + innerH]], target);
    }
    const path = geo.geoPath(projection);
    const values = shaded.filter((s) => s.f).map((s) => s.r.value).filter((v): v is number => v !== undefined && Number.isFinite(v));
    const lo = values.length ? Math.min(...values) : 0;
    const hi = values.length ? Math.max(...values) : 1;
    return {
      land: countries.features.map((f) => path(f) ?? ""),
      shaded: shaded.map(({ r, f }) => (f ? { r, d: path(f) ?? "", c: path.centroid(f) } : null)),
      paths: paths.map((p) => ({ ...p, d: p.coords.length > 1 ? (path({ type: "LineString", coordinates: p.coords }) ?? "") : "" })),
      routes: data.routes.map((r) => ({
        r,
        d: path({ type: "LineString", coordinates: [[r.from[1], r.from[0]], [r.to[1], r.to[0]]] }) ?? "",
        mid: projection([(r.from[1] + r.to[1]) / 2, (r.from[0] + r.to[0]) / 2]),
      })),
      places: data.places.map((p) => projection([p.lon, p.lat])),
      missing,
      height,
      lo,
      hi,
      valued: values.length > 0,
    };
  }, [loaded, data]);

  const height = model?.height ?? 300;
  const groupIndex = useMemo(() => new Map(data.groups.map((g, i) => [g.id, i])), [data.groups]);
  const colorOf = (group: string | undefined) =>
    group !== undefined && groupIndex.has(group) ? groupColor(groupIndex.get(group)!) : "var(--highlight)";
  const visible = (group: string | undefined) => group === undefined || !hidden.has(group);

  const clampView = useCallback(
    (v: View): View => {
      const k = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, v.k));
      // Keep the map covering the frame.
      const x = Math.min(0, Math.max(W - W * k, v.x));
      const y = Math.min(0, Math.max(height - height * k, v.y));
      return { k, x, y };
    },
    [height],
  );
  const zoomAt = useCallback(
    (factor: number, cx = W / 2, cy = height / 2) =>
      setView((v) => {
        const k = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, v.k * factor));
        const f = k / v.k;
        return clampView({ k, x: cx - (cx - v.x) * f, y: cy - (cy - v.y) * f });
      }),
    [clampView, height],
  );
  /** Client (screen) point -> map (viewBox) units. */
  const toMap = (clientX: number, clientY: number) => {
    const rect = svgRef.current?.getBoundingClientRect();
    if (!rect || !rect.width) return { x: 0, y: 0 };
    return { x: ((clientX - rect.left) / rect.width) * W, y: ((clientY - rect.top) / rect.height) * height };
  };
  const flashHint = (text: string) => {
    setHint(text);
    window.setTimeout(() => setHint(null), 1600);
  };

  // Ctrl/⌘ + scroll zooms (a plain scroll keeps scrolling the page). React's
  // wheel listener is passive, so this one is added directly to block the
  // browser's own page zoom.
  const onWheel = useRef<(e: globalThis.WheelEvent) => void>(() => {});
  useEffect(() => {
    onWheel.current = (e) => {
      if (!(e.ctrlKey || e.metaKey)) {
        flashHint("Use Ctrl + scroll to zoom the map");
        return;
      }
      e.preventDefault();
      const p = toMap(e.clientX, e.clientY);
      zoomAt(e.deltaY < 0 ? 1.25 : 0.8, p.x, p.y);
    };
  });
  const ready = !!model;
  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;
    const listener = (e: globalThis.WheelEvent) => onWheel.current(e);
    svg.addEventListener("wheel", listener, { passive: false });
    return () => svg.removeEventListener("wheel", listener);
  }, [ready]);
  const onPointerDown = (e: PointerEvent<SVGSVGElement>) => {
    if ((e.target as Element).closest("[data-marker]")) return;
    pointers.current.set(e.pointerId, toMap(e.clientX, e.clientY));
    if (e.pointerType === "touch" && pointers.current.size < 2) {
      flashHint("Use two fingers to move the map");
      return;
    }
    e.currentTarget.setPointerCapture(e.pointerId);
    const pts = [...pointers.current.values()];
    const mid = pts.length > 1 ? { x: (pts[0].x + pts[1].x) / 2, y: (pts[0].y + pts[1].y) / 2 } : pts[0];
    const dist = pts.length > 1 ? Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y) : 0;
    gesture.current = { dist, mid, view };
  };
  const onPointerMove = (e: PointerEvent<SVGSVGElement>) => {
    if (!pointers.current.has(e.pointerId) || !gesture.current) return;
    pointers.current.set(e.pointerId, toMap(e.clientX, e.clientY));
    const pts = [...pointers.current.values()];
    if (e.pointerType === "touch" && pts.length < 2) return;
    const g = gesture.current;
    const mid = pts.length > 1 ? { x: (pts[0].x + pts[1].x) / 2, y: (pts[0].y + pts[1].y) / 2 } : pts[0];
    const factor = pts.length > 1 && g.dist ? Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y) / g.dist : 1;
    const k = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, g.view.k * factor));
    const f = k / g.view.k;
    setView(clampView({ k, x: mid.x - (g.mid.x - g.view.x) * f, y: mid.y - (g.mid.y - g.view.y) * f }));
  };
  const onPointerUp = (e: PointerEvent<SVGSVGElement>) => {
    pointers.current.delete(e.pointerId);
    gesture.current = null;
    if (pointers.current.size) {
      // One finger still down: restart the gesture from here.
      const pts = [...pointers.current.values()];
      gesture.current = { dist: 0, mid: pts[0], view };
    }
  };
  const onKeyDown = (e: KeyboardEvent<SVGSVGElement>) => {
    const step = 40;
    const moves: Record<string, [number, number]> = { ArrowLeft: [step, 0], ArrowRight: [-step, 0], ArrowUp: [0, step], ArrowDown: [0, -step] };
    if (e.key === "+" || e.key === "=") zoomAt(1.4);
    else if (e.key === "-" || e.key === "_") zoomAt(1 / 1.4);
    else if (e.key === "0") setView({ k: 1, x: 0, y: 0 });
    else if (moves[e.key]) setView((v) => clampView({ ...v, x: v.x + moves[e.key][0], y: v.y + moves[e.key][1] }));
    else if (e.key === "Escape") setSelected(null);
    else return;
    e.preventDefault();
  };

  if (failed) return <p className="text-sm text-muted-foreground">The map couldn&apos;t load.</p>;
  if (!model) {
    return (
      <div className="flex h-56 animate-pulse items-center justify-center gap-2 text-xs text-muted-foreground">
        <MapPinned className="size-4" /> Drawing map…
      </div>
    );
  }

  const at = (p: [number, number] | null) => (p ? { x: p[0] * view.k + view.x, y: p[1] * view.k + view.y } : null);
  const shadeOf = (v: number | undefined) =>
    model.valued && v !== undefined
      ? `color-mix(in oklab, var(--viz-1) ${Math.round(20 + 70 * ((v - model.lo) / (model.hi - model.lo || 1)))}%, var(--card))`
      : "color-mix(in oklab, var(--viz-1) 50%, var(--card))";
  const shownPlaces = data.places
    .map((p, i) => ({ p, i, pos: at(model.places[i]) }))
    .filter((x) => x.pos && visible(x.p.group) && x.pos.x > -10 && x.pos.x < W + 10 && x.pos.y > -10 && x.pos.y < height + 10);
  const labels = placeLabels(
    shownPlaces.map((x) => ({ cx: x.pos!.x, cy: x.pos!.y, text: x.p.label ?? x.p.name })),
    height,
  );
  const chosen = selected !== null ? data.places[selected] : null;
  const chosenGroup = chosen?.group !== undefined ? data.groups.find((g) => g.id === chosen.group) : undefined;
  const label = data.title ?? "Map";

  return (
    <div className="font-sans">
      <div className="relative">
        <svg
          ref={svgRef}
          role="application"
          aria-label={`${label}. Zoom with + and -, move with the arrow keys, reset with 0.`}
          tabIndex={0}
          viewBox={`0 0 ${W} ${height}`}
          className="block h-auto w-full cursor-grab touch-pan-y select-none rounded-[10px] outline-none focus-visible:ring-2 focus-visible:ring-ring active:cursor-grabbing"
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
          onKeyDown={onKeyDown}
        >
          <defs>
            <clipPath id={`${uid}-clip`}>
              <rect width={W} height={height} rx={10} />
            </clipPath>
          </defs>
          <g clipPath={`url(#${uid}-clip)`}>
            <rect width={W} height={height} className="fill-[color-mix(in_oklab,var(--viz-1)_6%,var(--background))]" />
            <g transform={`translate(${view.x} ${view.y}) scale(${view.k})`}>
              {model.land.map((d, i) => (
                <path key={i} d={d} className="fill-muted stroke-border" strokeWidth={0.6} vectorEffect="non-scaling-stroke" />
              ))}
              {model.shaded.map((s, i) =>
                s ? (
                  <path key={`s${i}`} d={s.d} fill={shadeOf(s.r.value)} className="stroke-foreground/50" strokeWidth={0.8} vectorEffect="non-scaling-stroke">
                    <title>{[s.r.name, s.r.value !== undefined ? formatTick(s.r.value) : null, s.r.label].filter(Boolean).join(" — ")}</title>
                  </path>
                ) : null,
              )}
              {model.routes.map((r, i) => (
                <path key={`r${i}`} d={r.d} fill="none" stroke="var(--highlight)" strokeWidth={2} strokeDasharray="6 4" vectorEffect="non-scaling-stroke" />
              ))}
              {model.paths.map((p, i) =>
                p.d && visible(p.group) ? (
                  <path
                    key={`pa${i}`}
                    d={p.d}
                    fill="none"
                    stroke={colorOf(p.group)}
                    strokeWidth={2.4}
                    strokeLinejoin="round"
                    strokeDasharray={p.dashed ? "6 4" : undefined}
                    vectorEffect="non-scaling-stroke"
                  />
                ) : null,
              )}
            </g>
            {model.shaded.map((s, i) => {
              const c = s?.r.label ? at(s.c as [number, number]) : null;
              return c && Number.isFinite(c.x) ? (
                <text key={`sl${i}`} x={c.x} y={c.y} textAnchor="middle" fontSize={11} className="pointer-events-none fill-foreground font-semibold" paintOrder="stroke" stroke="var(--background)" strokeWidth={3}>
                  {s!.r.label}
                </text>
              ) : null;
            })}
            {model.routes.map((r, i) => {
              const m = r.r.label ? at(r.mid) : null;
              return m ? (
                <text key={`rl${i}`} x={m.x} y={m.y - 6} textAnchor="middle" fontSize={11} className="pointer-events-none fill-foreground font-medium" paintOrder="stroke" stroke="var(--background)" strokeWidth={3}>
                  {r.r.label}
                </text>
              ) : null;
            })}
            {shownPlaces.map(({ p, i, pos }, n) => {
              const spot = labels[n];
              const active = selected === i;
              return (
                <g
                  key={`p${i}`}
                  data-marker=""
                  role="button"
                  tabIndex={0}
                  aria-label={`${p.label ?? p.name}${p.detail ? `: ${p.detail}` : ""}`}
                  aria-pressed={active}
                  className="cursor-pointer outline-none [&:focus-visible>circle]:stroke-ring"
                  onClick={() => setSelected(active ? null : i)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      e.stopPropagation();
                      setSelected(active ? null : i);
                    }
                  }}
                >
                  <title>{p.label ?? p.name}</title>
                  <circle cx={pos!.x} cy={pos!.y} r={12} fill="transparent" />
                  <circle cx={pos!.x} cy={pos!.y} r={active ? 6.5 : 5} fill={colorOf(p.group)} className="stroke-background" strokeWidth={active ? 2.5 : 1.6} />
                  {spot && (
                    <text x={spot.x} y={spot.y} textAnchor={spot.anchor} fontSize={11.5} className="fill-foreground font-semibold" paintOrder="stroke" stroke="var(--background)" strokeWidth={3}>
                      {p.label ?? p.name}
                    </text>
                  )}
                </g>
              );
            })}
          </g>
        </svg>
        <div className="absolute top-2 right-2 flex flex-col gap-1" data-export-skip="">
          {[
            { icon: Plus, label: "Zoom in", run: () => zoomAt(1.4) },
            { icon: Minus, label: "Zoom out", run: () => zoomAt(1 / 1.4) },
            { icon: RotateCcw, label: "Reset view", run: () => setView({ k: 1, x: 0, y: 0 }) },
          ].map(({ icon: Icon, label: name, run }) => (
            <button
              key={name}
              type="button"
              aria-label={name}
              title={name}
              onClick={run}
              className="grid size-7 place-items-center rounded-md border border-border bg-card/90 text-foreground shadow-sm backdrop-blur hover:bg-muted"
            >
              <Icon className="size-3.5" />
            </button>
          ))}
        </div>
        {hint && (
          <div className="pointer-events-none absolute inset-x-0 bottom-3 flex justify-center" aria-live="polite" data-export-skip="">
            <span className="rounded-md bg-foreground/80 px-2.5 py-1 text-xs text-background">{hint}</span>
          </div>
        )}
      </div>

      {chosen && (
        <div className="mt-2 flex items-start gap-3 rounded-lg border border-border bg-card px-3 py-2 text-sm" role="status">
          <span className="mt-1.5 size-2.5 shrink-0 rounded-full" style={{ background: colorOf(chosen.group) }} />
          <div className="min-w-0 flex-1">
            <p className="font-semibold text-foreground">
              {chosen.label ?? chosen.name}
              {chosenGroup && <span className="ml-2 text-xs font-normal text-muted-foreground">{chosenGroup.label}</span>}
            </p>
            {chosen.detail && <p className="mt-0.5 text-[13.5px] leading-snug text-foreground/90">{chosen.detail}</p>}
            <p className="mt-0.5 text-xs text-muted-foreground tabular-nums">
              {Math.abs(chosen.lat).toFixed(2)}°{chosen.lat >= 0 ? "N" : "S"}, {Math.abs(chosen.lon).toFixed(2)}°{chosen.lon >= 0 ? "E" : "W"}
            </p>
          </div>
          <button type="button" aria-label="Close" onClick={() => setSelected(null)} className="rounded p-0.5 text-muted-foreground hover:text-foreground" data-export-skip="">
            <X className="size-4" />
          </button>
        </div>
      )}

      {(data.groups.length > 0 || model.valued || model.missing.length > 0 || data.paths.some((p) => p.label)) && (
        <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
          {data.groups.length > 0 && (
            <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="Show or hide groups">
              {data.groups.map((g, i) => {
                const on = !hidden.has(g.id);
                return (
                  <button
                    key={g.id}
                    type="button"
                    aria-pressed={on}
                    onClick={() =>
                      setHidden((h) => {
                        const next = new Set(h);
                        if (next.has(g.id)) next.delete(g.id);
                        else next.add(g.id);
                        return next;
                      })
                    }
                    className={cn(
                      "flex items-center gap-1.5 rounded-full border px-2 py-0.5 transition-colors",
                      on ? "border-border bg-card text-foreground" : "border-dashed border-border text-muted-foreground line-through",
                    )}
                  >
                    <span className="size-2 rounded-full" style={{ background: groupColor(i), opacity: on ? 1 : 0.35 }} />
                    {g.label}
                  </button>
                );
              })}
            </div>
          )}
          {/* Route names live here, not on the map, so they never cover places. */}
          {data.paths.some((p) => p.label && visible(p.group)) && (
            <span className="flex flex-wrap items-center gap-3">
              {data.paths.map((p, i) =>
                p.label && visible(p.group) ? (
                  <span key={i} className="flex items-center gap-1.5">
                    <svg width="18" height="6" aria-hidden>
                      <line x1="0" x2="18" y1="3" y2="3" stroke={colorOf(p.group)} strokeWidth="2.4" strokeDasharray={p.dashed ? "4 3" : undefined} />
                    </svg>
                    {p.label}
                  </span>
                ) : null,
              )}
            </span>
          )}
          {model.valued && (
            <span className="flex items-center gap-2">
              {data.valueLabel ?? "Value"}: {formatTick(model.lo)}
              <span className="h-2.5 w-28 rounded-full" style={{ background: "linear-gradient(to right, color-mix(in oklab, var(--viz-1) 20%, var(--card)), color-mix(in oklab, var(--viz-1) 90%, var(--card)))" }} />
              {formatTick(model.hi)}
            </span>
          )}
          {model.missing.length > 0 && <span>Not found on the map: {model.missing.join(", ")}</span>}
        </div>
      )}
    </div>
  );
}
