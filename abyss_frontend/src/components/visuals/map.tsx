"use client";

import { useEffect, useMemo, useState } from "react";
import { MapPinned } from "lucide-react";
import type { Feature, FeatureCollection, Geometry } from "geojson";

import type { MapData } from "@/lib/visuals/schemas";
import { formatTick } from "@/lib/visuals/science";
import { SvgStage } from "./stage";

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

/**
 * A world map (Equal Earth projection): places as labelled dots, countries
 * shaded (a colour scale when they carry values), and routes as great-circle
 * arcs. Zooms to what the map is about; names it can't find are listed.
 */
export function MapVisual({ data }: { data: MapData }) {
  const [loaded, setLoaded] = useState<{ geo: Geo; countries: Countries } | null>(null);
  const [failed, setFailed] = useState(false);
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
    const missing = shaded.filter((s) => !s.f).map((s) => s.r.name);
    const focus: Feature[] = [
      ...shaded.flatMap((s) => (s.f ? [s.f] : [])),
      ...data.places.map((p) => ({ type: "Feature" as const, properties: {}, geometry: { type: "Point" as const, coordinates: [p.lon, p.lat] } })),
      ...data.routes.map((r) => ({
        type: "Feature" as const,
        properties: {},
        geometry: { type: "LineString" as const, coordinates: [[r.from[1], r.from[0]], [r.to[1], r.to[0]]] },
      })),
    ];
    const projection = geo.geoEqualEarth();
    const target: FeatureCollection = focus.length ? { type: "FeatureCollection", features: focus } : (countries as FeatureCollection);
    projection.fitWidth(W - 40, target);
    let [[x0, y0], [x1, y1]] = geo.geoPath(projection).bounds(target);
    // Don't zoom in past ~ a region: a single city still shows its surroundings.
    const minSpan = 260;
    if (x1 - x0 < minSpan && y1 - y0 < minSpan) {
      projection.fitExtent([[0, 0], [W - 40, 400]], target);
      const k = projection.scale();
      projection.scale(Math.min(k, 900));
      const c = geo.geoPath(projection).centroid(target);
      projection.translate([projection.translate()[0] + (W / 2 - c[0]), projection.translate()[1] + (210 - c[1])]);
      [[x0, y0], [x1, y1]] = [[0, 0], [W, 420]];
    } else {
      projection.fitExtent([[20, 20], [W - 20, Math.min(560, 20 + ((W - 40) * (y1 - y0)) / (x1 - x0 || 1))]], target);
      [[x0, y0], [x1, y1]] = geo.geoPath(projection).bounds(target);
    }
    const height = Math.max(260, Math.min(600, Math.round(Math.max(y1, 280) + 24)));
    const path = geo.geoPath(projection);
    const values = shaded.filter((s) => s.f).map((s) => s.r.value).filter((v): v is number => v !== undefined && Number.isFinite(v));
    const lo = values.length ? Math.min(...values) : 0;
    const hi = values.length ? Math.max(...values) : 1;
    return { countries, shaded, missing, path, projection, height, lo, hi, valued: values.length > 0 };
  }, [loaded, data]);

  if (failed) return <p className="text-sm text-muted-foreground">The map couldn&apos;t load.</p>;
  if (!model) {
    return (
      <div className="flex h-56 animate-pulse items-center justify-center gap-2 text-xs text-muted-foreground">
        <MapPinned className="size-4" /> Drawing map…
      </div>
    );
  }
  const { path, projection, height } = model;
  const shadeOf = (v: number | undefined) =>
    model.valued && v !== undefined
      ? `color-mix(in oklab, var(--viz-1) ${Math.round(20 + 70 * ((v - model.lo) / (model.hi - model.lo || 1)))}%, var(--card))`
      : "color-mix(in oklab, var(--viz-1) 50%, var(--card))";

  return (
    <div className="font-sans">
      <SvgStage width={W} height={height} label={data.title ?? "Map"}>
        <rect width={W} height={height} className="fill-[color-mix(in_oklab,var(--viz-1)_6%,var(--background))]" rx={10} />
        {model.countries.features.map((f, i) => (
          <path key={i} d={path(f) ?? undefined} className="fill-muted stroke-border" strokeWidth={0.6} />
        ))}
        {model.shaded.map(({ r, f }, i) =>
          f ? (
            <path key={`s${i}`} d={path(f) ?? undefined} fill={shadeOf(r.value)} className="stroke-foreground/50" strokeWidth={0.8}>
              <title>{[r.name, r.value !== undefined ? formatTick(r.value) : null, r.label].filter(Boolean).join(" — ")}</title>
            </path>
          ) : null,
        )}
        {model.shaded.map(({ r, f }, i) => {
          if (!f || !r.label) return null;
          const [x, y] = path.centroid(f);
          return Number.isFinite(x) ? (
            <text key={`sl${i}`} x={x} y={y} textAnchor="middle" fontSize={11} className="fill-foreground font-semibold" paintOrder="stroke" stroke="var(--background)" strokeWidth={3}>
              {r.label}
            </text>
          ) : null;
        })}
        {data.routes.map((r, i) => {
          const d = path({ type: "LineString", coordinates: [[r.from[1], r.from[0]], [r.to[1], r.to[0]]] });
          const mid = projection([(r.from[1] + r.to[1]) / 2, (r.from[0] + r.to[0]) / 2]);
          return (
            <g key={`r${i}`}>
              <path d={d ?? undefined} fill="none" stroke="var(--highlight)" strokeWidth={2} strokeDasharray="6 4" />
              {r.label && mid && (
                <text x={mid[0]} y={mid[1] - 6} textAnchor="middle" fontSize={11} className="fill-foreground font-medium" paintOrder="stroke" stroke="var(--background)" strokeWidth={3}>
                  {r.label}
                </text>
              )}
            </g>
          );
        })}
        {data.places.map((p, i) => {
          const at = projection([p.lon, p.lat]);
          if (!at) return null;
          return (
            <g key={`p${i}`}>
              <circle cx={at[0]} cy={at[1]} r={4.5} className="fill-highlight stroke-background" strokeWidth={1.5} />
              <text x={at[0] + 7} y={at[1] - 6} fontSize={11.5} className="fill-foreground font-semibold" paintOrder="stroke" stroke="var(--background)" strokeWidth={3}>
                {p.label ?? p.name}
              </text>
            </g>
          );
        })}
      </SvgStage>
      {(model.valued || model.missing.length > 0) && (
        <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
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
