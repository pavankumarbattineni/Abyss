"use client";

import { cn } from "@/lib/utils";
import { ELEMENT_BY_SYMBOL, ELEMENTS, FAMILY_LABELS, type ChemicalElement, type ElementFamily } from "@/lib/visuals/elements";
import type { PeriodicTableData } from "@/lib/visuals/schemas";
import { formatTick } from "@/lib/visuals/science";

// Soft family colours from the chart palette (readable text on top in both themes).
const FAMILY_COLOR: Record<ElementFamily, string> = {
  "alkali-metal": "var(--viz-1)",
  "alkaline-earth-metal": "var(--viz-2)",
  "transition-metal": "var(--viz-3)",
  "post-transition-metal": "var(--viz-4)",
  metalloid: "var(--viz-5)",
  nonmetal: "var(--viz-6)",
  halogen: "var(--viz-7)",
  "noble-gas": "var(--viz-8)",
  lanthanide: "var(--viz-2)",
  actinide: "var(--viz-4)",
};

function Cell({
  e,
  tint,
  strength,
  dim,
  value,
  focused,
}: {
  e: ChemicalElement;
  tint: string;
  strength: number;
  dim: boolean;
  value?: number;
  focused: boolean;
}) {
  return (
    <div
      title={`${e.number} ${e.name}${value !== undefined ? ` — ${formatTick(value)}` : ""}`}
      className={cn(
        "relative flex aspect-square min-w-0 flex-col items-center justify-center rounded-[3px] border text-center leading-none transition-opacity",
        focused ? "border-foreground ring-2 ring-foreground/60" : "border-border/70",
        dim && "opacity-35",
      )}
      style={{ gridColumn: e.column, gridRow: e.row, background: `color-mix(in oklab, ${tint} ${Math.round(strength * 100)}%, var(--card))` }}
    >
      <span className="absolute top-0.5 left-0.5 text-[7px] text-muted-foreground tabular-nums">{e.number}</span>
      <span className="text-[11px] font-bold text-foreground">{e.symbol}</span>
      {value !== undefined && <span className="mt-0.5 text-[6.5px] text-foreground/80 tabular-nums">{formatTick(Number(value.toPrecision(3)))}</span>}
    </div>
  );
}

/**
 * The periodic table: families colour-coded by default; `highlight` picks out
 * elements (the rest dim); `values` turns it into a heat map of a trend
 * (electronegativity, atomic radius...) with a min-max key; `focus` adds a
 * detail card with that element's electron configuration.
 */
export function PeriodicTableVisual({ data }: { data: PeriodicTableData }) {
  const highlight = new Set(data.highlight.map((s) => s.toLowerCase()));
  const values = new Map(Object.entries(data.values ?? {}).map(([k, v]) => [k.toLowerCase(), v]));
  const nums = [...values.values()].filter(Number.isFinite);
  const lo = nums.length ? Math.min(...nums) : 0;
  const hi = nums.length ? Math.max(...nums) : 1;
  const focus = data.focus ? ELEMENT_BY_SYMBOL.get(data.focus.trim().toLowerCase()) : undefined;
  const families = [...new Set(ELEMENTS.map((e) => e.family))];

  return (
    <div className="font-sans">
      <div className="overflow-x-auto pb-1">
        <div className="grid min-w-[560px] gap-[2px]" style={{ gridTemplateColumns: "repeat(18, minmax(0, 1fr))", gridTemplateRows: "repeat(7, auto) 8px repeat(2, auto)" }}>
          {ELEMENTS.map((e) => {
            const key = e.symbol.toLowerCase();
            const v = values.get(key);
            const valued = values.size > 0;
            const strength = valued ? (v === undefined ? 0 : 0.15 + 0.7 * ((v - lo) / (hi - lo || 1))) : highlight.size ? (highlight.has(key) ? 0.55 : 0.12) : 0.3;
            return (
              <Cell
                key={e.number}
                e={e}
                tint={valued ? "var(--viz-1)" : FAMILY_COLOR[e.family]}
                strength={strength}
                dim={(highlight.size > 0 && !highlight.has(key)) || (valued && v === undefined && !highlight.has(key))}
                value={v}
                focused={focus?.number === e.number}
              />
            );
          })}
        </div>
      </div>
      <div className="mt-3 flex flex-wrap items-start gap-x-6 gap-y-3 text-xs text-muted-foreground">
        {values.size > 0 ? (
          <div className="flex items-center gap-2">
            <span>{data.valueLabel ?? "Value"}:</span>
            <span className="tabular-nums">{formatTick(lo)}</span>
            <span className="h-2.5 w-28 rounded-full" style={{ background: "linear-gradient(to right, color-mix(in oklab, var(--viz-1) 15%, var(--card)), color-mix(in oklab, var(--viz-1) 85%, var(--card)))" }} />
            <span className="tabular-nums">{formatTick(hi)}</span>
          </div>
        ) : (
          !highlight.size && (
            <div className="flex flex-wrap gap-x-3 gap-y-1">
              {families.map((f) => (
                <span key={f} className="inline-flex items-center gap-1">
                  <span className="size-2.5 rounded-sm" style={{ background: `color-mix(in oklab, ${FAMILY_COLOR[f]} 45%, var(--card))` }} />
                  {FAMILY_LABELS[f]}
                </span>
              ))}
            </div>
          )
        )}
        {data.legend && <p className="text-foreground/80">{data.legend}</p>}
      </div>
      {focus && (
        <div className="mt-3 flex items-center gap-4 rounded-xl border border-border bg-card p-3">
          <div className="grid size-16 shrink-0 place-items-center rounded-lg border border-foreground/30 text-center">
            <span className="text-[10px] text-muted-foreground">{focus.number}</span>
            <span className="-mt-1 text-2xl font-bold">{focus.symbol}</span>
          </div>
          <div className="min-w-0 text-sm">
            <p className="font-semibold text-foreground">{focus.name}</p>
            <p className="text-muted-foreground">{FAMILY_LABELS[focus.family]}</p>
            {data.configuration && <p className="mt-1 font-mono text-[13px] text-foreground">{data.configuration}</p>}
          </div>
        </div>
      )}
    </div>
  );
}
