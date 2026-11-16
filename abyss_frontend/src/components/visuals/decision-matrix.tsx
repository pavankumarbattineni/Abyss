import { Check, Minus, Trophy } from "lucide-react";

import type { DecisionMatrixData } from "@/lib/visuals/schemas";
import { cn } from "@/lib/utils";

/**
 * Options scored on weighted criteria. Totals are computed here (weighted
 * average as a 0-100 score), never taken from the model, and the winner is
 * marked. Score cells are tinted by value; on phones the table scrolls
 * sideways with the option names pinned.
 */
export function DecisionMatrixVisual({ data }: { data: DecisionMatrixData }) {
  const totalWeight = data.criteria.reduce((sum, c) => sum + c.weight, 0) || 1;
  const scored = data.options.map((option) => {
    const scores = data.criteria.map((_, i) => Math.min(10, Math.max(0, option.scores[i] ?? 0)));
    const total = scores.reduce((sum, s, i) => sum + s * data.criteria[i].weight, 0) / (totalWeight * 10);
    return { ...option, scores, total: Math.round(total * 100) };
  });
  const ranked = [...scored].sort((a, b) => b.total - a.total);
  const best = ranked[0]?.total;
  const rank = new Map(ranked.map((o, i) => [o.name, i + 1]));

  return (
    <div className="space-y-4">
      <div className="overflow-x-auto rounded-xl border border-border">
        <table className="w-full border-collapse text-[13px]">
          <thead>
            <tr className="bg-muted">
              <th className="sticky left-0 z-10 bg-muted px-3 py-2 text-left font-semibold">Option</th>
              {data.criteria.map((c) => (
                <th key={c.name} className="min-w-[5.5rem] px-2 py-2 text-center align-bottom font-semibold">
                  <span className="block leading-tight">{c.name}</span>
                  <span className="mt-1 inline-flex gap-0.5" aria-label={`weight ${c.weight} of 5`}>
                    {Array.from({ length: 5 }, (_, i) => (
                      <span key={i} className={cn("h-1.5 w-2 rounded-sm", i < c.weight ? "bg-primary" : "bg-border")} />
                    ))}
                  </span>
                </th>
              ))}
              <th className="px-3 py-2 text-center font-semibold">Score</th>
            </tr>
          </thead>
          <tbody>
            {scored.map((option) => {
              const winner = option.total === best;
              return (
                <tr key={option.name} className={cn("border-t border-border", winner && "bg-primary/8")}>
                  <th scope="row" className={cn("sticky left-0 z-10 px-3 py-2 text-left font-semibold", winner ? "bg-[color-mix(in_oklab,var(--primary)_8%,var(--card))]" : "bg-card")}>
                    <span className="flex items-center gap-1.5">
                      {winner && <Trophy className="size-3.5 shrink-0 text-highlight" aria-label="Best option" />}
                      {option.name}
                    </span>
                  </th>
                  {option.scores.map((score, i) => (
                    <td key={i} className="px-2 py-1.5 text-center">
                      <span
                        className="inline-grid min-w-9 place-items-center rounded-md px-1.5 py-1 font-semibold tabular-nums"
                        style={{
                          background: `color-mix(in oklab, var(--primary) ${Math.round(score * 6.5)}%, transparent)`,
                        }}
                      >
                        {score}
                      </span>
                    </td>
                  ))}
                  <td className="px-3 py-1.5">
                    <div className="flex items-center gap-2">
                      <div className="h-2 min-w-12 flex-1 overflow-hidden rounded-full bg-muted">
                        <div className={cn("h-full rounded-full", winner ? "bg-highlight" : "bg-primary")} style={{ width: `${option.total}%` }} />
                      </div>
                      <span className="w-8 text-right font-bold tabular-nums">{option.total}</span>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {data.recommendation && (
        <p className="flex gap-2 rounded-xl border border-highlight/30 bg-highlight-soft px-3.5 py-2.5 text-[13px] leading-relaxed">
          <Trophy className="mt-0.5 size-4 shrink-0 text-highlight" aria-hidden="true" />
          <span>{data.recommendation}</span>
        </p>
      )}

      {scored.some((o) => o.pros.length || o.cons.length || o.summary) && (
        <div className="grid gap-3 sm:grid-cols-2">
          {ranked.map((option) => (
            <div key={option.name} className="rounded-xl border border-border bg-background p-3">
              <p className="flex items-center justify-between gap-2 font-semibold">
                <span>{option.name}</span>
                <span className="shrink-0 rounded-full bg-muted px-2 py-0.5 text-[11px] font-medium text-muted-foreground tabular-nums">
                  #{rank.get(option.name)} · {option.total}/100
                </span>
              </p>
              {option.summary && <p className="mt-1 text-[12.5px] text-muted-foreground">{option.summary}</p>}
              <ul className="mt-2 space-y-1 text-[12.5px]">
                {option.pros.map((p) => (
                  <li key={`p${p}`} className="flex gap-1.5">
                    <Check className="mt-0.5 size-3.5 shrink-0 text-success" aria-label="Pro" />
                    {p}
                  </li>
                ))}
                {option.cons.map((c) => (
                  <li key={`c${c}`} className="flex gap-1.5 text-muted-foreground">
                    <Minus className="mt-0.5 size-3.5 shrink-0 text-destructive" aria-label="Con" />
                    {c}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
