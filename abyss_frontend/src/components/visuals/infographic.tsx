import { CircleCheck } from "lucide-react";

import type { InfographicData } from "@/lib/visuals/schemas";
import { iconFor } from "./icons";

/** Theme colours for chart series, in order. */
const SERIES = ["var(--primary)", "var(--highlight)", "var(--sage-text)", "var(--warning)", "var(--success)", "var(--muted-foreground)"];

/** The stats strip fills its row whatever the number of stats (static classes for Tailwind). */
const STAT_COLUMNS: Record<number, string> = { 3: "@2xl:grid-cols-3", 4: "@2xl:grid-cols-4" };

type Chart = NonNullable<InfographicData["sections"][number]["chart"]>;

function Bars({ chart }: { chart: Chart }) {
  const max = Math.max(...chart.data.map((d) => d.value), 0) || 1;
  return (
    <ul className="mt-2.5 space-y-1.5">
      {chart.data.map((d, i) => (
        <li key={d.label} className="grid grid-cols-[minmax(0,7rem)_minmax(0,1fr)_auto] items-center gap-2 text-[12px]">
          <span className="truncate text-muted-foreground">{d.label}</span>
          <span className="h-2.5 overflow-hidden rounded-full bg-muted">
            <span
              className="block h-full rounded-full"
              style={{ width: `${Math.max(2, (d.value / max) * 100)}%`, background: SERIES[i % SERIES.length] }}
            />
          </span>
          <span className="font-semibold tabular-nums">{d.value.toLocaleString()}</span>
        </li>
      ))}
    </ul>
  );
}

function Donut({ chart }: { chart: Chart }) {
  const total = chart.data.reduce((sum, d) => sum + Math.max(0, d.value), 0) || 1;
  const r = 15.9155; // circumference 100
  // Each slice starts where the previous ended (from 12 o'clock).
  const shares = chart.data.map((d) => (Math.max(0, d.value) / total) * 100);
  const starts = shares.map((_, i) => 25 - shares.slice(0, i).reduce((a, b) => a + b, 0));
  return (
    <div className="mt-2.5 flex items-center gap-4">
      <svg viewBox="0 0 42 42" className="size-24 shrink-0" role="img" aria-label="Pie chart">
        <circle cx="21" cy="21" r={r} fill="none" stroke="var(--muted)" strokeWidth="6" />
        {chart.data.map((d, i) => {
          const share = shares[i];
          return (
            <circle
              key={d.label}
              cx="21"
              cy="21"
              r={r}
              fill="none"
              stroke={SERIES[i % SERIES.length]}
              strokeWidth="6"
              strokeDasharray={`${share} ${100 - share}`}
              strokeDashoffset={starts[i]}
            />
          );
        })}
      </svg>
      <ul className="space-y-1 text-[12px]">
        {chart.data.map((d, i) => (
          <li key={d.label} className="flex items-center gap-1.5">
            <span className="size-2.5 shrink-0 rounded-sm" style={{ background: SERIES[i % SERIES.length] }} />
            <span className="text-muted-foreground">{d.label}</span>
            <span className="font-semibold tabular-nums">{Math.round((Math.max(0, d.value) / total) * 100)}%</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Key facts at a glance: a stats strip, illustrated sections with small charts, then the takeaways. */
export function InfographicVisual({ data }: { data: InfographicData }) {
  return (
    <div className="@container space-y-3">
      {data.stats.length > 0 && (
        <dl className={`grid gap-2 ${data.stats.length === 1 ? "grid-cols-1" : "grid-cols-2"} ${STAT_COLUMNS[data.stats.length] ?? ""}`}>
          {data.stats.map((stat) => (
            <div key={stat.label} className="flex flex-col-reverse rounded-xl bg-primary px-3 py-3 text-primary-foreground">
              <dt className="text-[12px] leading-snug opacity-85">{stat.label}</dt>
              <dd className="text-2xl leading-tight font-bold tracking-tight">{stat.value}</dd>
            </div>
          ))}
        </dl>
      )}
      <div className="grid gap-2.5 @xl:grid-cols-2">
        {data.sections.map((section, i) => {
          const Icon = iconFor(section.icon);
          const wide = data.sections.length % 2 === 1 && i === data.sections.length - 1;
          return (
            <section key={section.title} className={`rounded-xl border border-border bg-background p-3.5 ${wide ? "@xl:col-span-2" : ""}`}>
              <p className="flex items-center gap-2.5 font-semibold text-foreground">
                <span className="grid size-9 shrink-0 place-items-center rounded-full bg-highlight-soft text-highlight">
                  <Icon className="size-[18px]" aria-hidden="true" />
                </span>
                {section.title}
              </p>
              {section.text && <p className="mt-2 text-[13px] leading-relaxed text-muted-foreground">{section.text}</p>}
              {section.points.length > 0 && (
                <ul className="mt-2 space-y-1">
                  {section.points.map((point) => (
                    <li key={point} className="flex gap-2 text-[13px] leading-snug">
                      <span aria-hidden="true" className="mt-[0.45em] size-1.5 shrink-0 rounded-full bg-highlight" />
                      {point}
                    </li>
                  ))}
                </ul>
              )}
              {section.chart && (section.chart.type === "pie" ? <Donut chart={section.chart} /> : <Bars chart={section.chart} />)}
            </section>
          );
        })}
      </div>
      {data.takeaways.length > 0 && (
        <div className="rounded-xl border border-border bg-muted/50 p-3.5">
          <p className="text-[11px] font-semibold tracking-[0.14em] text-sage-text">KEY TAKEAWAYS</p>
          <ul className="mt-2 space-y-1.5">
            {data.takeaways.map((t) => (
              <li key={t} className="flex gap-2 text-[13px] leading-snug">
                <CircleCheck className="mt-0.5 size-4 shrink-0 text-sage-text" aria-hidden="true" />
                {t}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
