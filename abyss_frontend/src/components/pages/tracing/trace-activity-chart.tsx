"use client";

import { useMemo } from "react";
import { Bar, CartesianGrid, ComposedChart, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

import { Skeleton } from "@/components/ui";
import { formatDuration } from "@/lib/trace-format";
import type { TraceDayStat } from "@/types";

interface ChartRow {
  date: string;
  label: string;
  ok: number;
  errors: number;
  p50: number | null;
}

/** Every day of the period, including quiet ones, so the axis is continuous. */
function fillDays(days: number, data: TraceDayStat[]): ChartRow[] {
  const byDate = new Map(data.map((d) => [d.date, d]));
  const rows: ChartRow[] = [];
  const today = new Date();
  for (let offset = days - 1; offset >= 0; offset--) {
    const day = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate() - offset));
    const key = day.toISOString().slice(0, 10);
    const stat = byDate.get(key);
    rows.push({
      date: key,
      label: day.toLocaleDateString(undefined, { month: "short", day: "numeric", timeZone: "UTC" }),
      ok: stat ? stat.traces - stat.errors : 0,
      errors: stat?.errors ?? 0,
      p50: stat?.p50_latency_ms ?? null,
    });
  }
  return rows;
}

function ChartTooltip({ active, payload }: { active?: boolean; payload?: { payload: ChartRow }[] }) {
  if (!active || !payload?.length) return null;
  const row = payload[0].payload;
  return (
    <div className="rounded-lg border border-border bg-popover px-3 py-2 text-xs shadow-md">
      <p className="mb-1 font-medium text-foreground">{row.label}</p>
      <p className="text-muted-foreground">
        <span className="font-mono tabular-nums text-foreground">{row.ok + row.errors}</span> runs
        {row.errors > 0 && (
          <>
            {" · "}
            <span className="font-mono tabular-nums text-destructive">{row.errors}</span> failed
          </>
        )}
      </p>
      <p className="text-muted-foreground">
        p50 latency <span className="font-mono tabular-nums text-foreground">{formatDuration(row.p50)}</span>
      </p>
    </div>
  );
}

export function TraceActivityChart({ days, data, isLoading }: { days: number; data?: TraceDayStat[]; isLoading: boolean }) {
  const rows = useMemo(() => fillDays(days, data ?? []), [days, data]);
  return (
    <section aria-labelledby="trace-activity" className="rounded-xl border border-border bg-card p-4">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h2 id="trace-activity" className="text-sm font-semibold text-foreground">
          Activity
        </h2>
        <div className="flex items-center gap-4 text-xs text-muted-foreground" aria-hidden="true">
          <span className="flex items-center gap-1.5">
            <span className="size-2.5 rounded-[3px] bg-[var(--sage-text)]" /> Runs
          </span>
          <span className="flex items-center gap-1.5">
            <span className="size-2.5 rounded-[3px] bg-destructive" /> Failed
          </span>
          <span className="flex items-center gap-1.5">
            <span className="h-0.5 w-3 rounded bg-[var(--viz-1)]" /> p50 latency
          </span>
        </div>
      </div>
      {isLoading ? (
        <Skeleton className="h-44 w-full" />
      ) : (
        <div className="h-44" role="img" aria-label={`Runs per day over the last ${days} days`}>
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={rows} margin={{ top: 4, right: 4, bottom: 0, left: -12 }}>
              <CartesianGrid vertical={false} stroke="var(--border)" />
              <XAxis
                dataKey="label"
                tickLine={false}
                axisLine={false}
                tick={{ fontSize: 11, fill: "var(--muted-foreground)" }}
                interval="preserveStartEnd"
                minTickGap={16}
              />
              <YAxis
                yAxisId="runs"
                allowDecimals={false}
                tickLine={false}
                axisLine={false}
                width={36}
                tick={{ fontSize: 11, fill: "var(--muted-foreground)" }}
              />
              <YAxis yAxisId="latency" orientation="right" hide />
              <Tooltip content={<ChartTooltip />} cursor={{ fill: "var(--muted)", opacity: 0.6 }} />
              <Bar yAxisId="runs" dataKey="ok" stackId="runs" fill="var(--sage-text)" maxBarSize={28} />
              <Bar yAxisId="runs" dataKey="errors" stackId="runs" fill="var(--destructive)" radius={[3, 3, 0, 0]} maxBarSize={28} />
              <Line
                yAxisId="latency"
                dataKey="p50"
                type="monotone"
                stroke="var(--viz-1)"
                strokeWidth={2}
                // A line needs two points; show dots while there are few.
                dot={rows.filter((r) => r.p50 != null).length <= 2 ? { r: 3, fill: "var(--viz-1)" } : false}
                connectNulls
                isAnimationActive={false}
              />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      )}
    </section>
  );
}
