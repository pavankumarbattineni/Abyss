"use client";

import { useState } from "react";
import katex from "katex";
import "katex/contrib/mhchem";
import { ChevronLeft, ChevronRight, ListOrdered } from "lucide-react";

import { Button } from "@/components/ui";
import { cn } from "@/lib/utils";
import type { StepsData } from "@/lib/visuals/schemas";

const escape = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

function tex(source: string, display: boolean): string {
  // KaTeX escapes everything it outputs; trust:false blocks \href and friends.
  return katex.renderToString(source, { displayMode: display, throwOnError: false, strict: "ignore", trust: false });
}

/** Plain text with $$...$$ and $...$ math, as HTML (text escaped, math by KaTeX). */
function richText(text: string): string {
  return text
    .split(/(\$\$[\s\S]+?\$\$|(?<![\\$\w])\$(?=[^\s$])[^$\n]*?[^\s$\\]\$(?![\d$]))/)
    .map((part, i) => {
      if (i % 2 === 0) return escape(part);
      return part.startsWith("$$") ? tex(part.slice(2, -2), false) : tex(part.slice(1, -1), false);
    })
    .join("");
}

function ArrayState({ values, highlight, pointers }: { values: (number | string)[]; highlight: number[]; pointers: Record<string, number> }) {
  const hot = new Set(highlight);
  const byIndex = new Map<number, string[]>();
  for (const [name, i] of Object.entries(pointers)) byIndex.set(i, [...(byIndex.get(i) ?? []), name]);
  return (
    <div className="mt-3 overflow-x-auto pb-1">
      <div className="inline-flex gap-1">
        {values.map((v, i) => (
          <div key={i} className="flex w-11 flex-col items-center gap-1">
            <span className="text-[10px] text-muted-foreground tabular-nums">{i}</span>
            <span
              className={cn(
                "grid h-10 w-11 place-items-center rounded-md border font-mono text-sm font-semibold tabular-nums",
                hot.has(i) ? "border-foreground bg-[color-mix(in_oklab,var(--viz-1)_30%,var(--card))]" : "border-border bg-card",
              )}
            >
              {String(v)}
            </span>
            <span className="min-h-4 text-center text-[11px] leading-tight font-semibold text-[var(--viz-2)]">{byIndex.get(i)?.join(", ")}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function Step({ step, index }: { step: StepsData["steps"][number]; index: number }) {
  return (
    <div className="min-w-0">
      <p className="text-[15px] font-semibold text-foreground">
        <span className="mr-2 text-muted-foreground tabular-nums">{index + 1}.</span>
        {step.title ?? `Step ${index + 1}`}
      </p>
      {step.text && <p className="mt-1.5 text-[14.5px] leading-relaxed text-foreground/90" dangerouslySetInnerHTML={{ __html: richText(step.text) }} />}
      {step.math && <div className="mt-2 overflow-x-auto py-1" dangerouslySetInnerHTML={{ __html: tex(step.math, true) }} />}
      {step.array && (
        <ArrayState
          values={step.array}
          highlight={(step.highlight ?? []).map(Number)}
          pointers={Object.fromEntries(Object.entries(step.pointers ?? {}).map(([k, v]) => [k, Number(v)]))}
        />
      )}
    </div>
  );
}

/**
 * A step-by-step walk-through: derivations and proofs (text with inline math
 * and a display equation per step) or algorithm traces (an array's state with
 * highlighted cells and named pointers). One step at a time with Back/Next,
 * or all of them at once.
 */
export function StepsVisual({ data }: { data: StepsData }) {
  const [current, setCurrent] = useState(0);
  const [all, setAll] = useState(false);
  const total = data.steps.length;
  return (
    <div className="font-sans">
      {all ? (
        <ol className="flex flex-col gap-5">
          {data.steps.map((s, i) => (
            <li key={i}>
              <Step step={s} index={i} />
            </li>
          ))}
        </ol>
      ) : (
        <div className="min-h-28" aria-live="polite">
          <Step step={data.steps[current]} index={current} />
        </div>
      )}
      <div className="mt-4 flex flex-wrap items-center gap-2" data-export-skip="">
        {!all && (
          <>
            <Button variant="outline" size="sm" onClick={() => setCurrent((c) => Math.max(0, c - 1))} disabled={current === 0}>
              <ChevronLeft className="size-4" />
              Back
            </Button>
            <Button variant="outline" size="sm" onClick={() => setCurrent((c) => Math.min(total - 1, c + 1))} disabled={current === total - 1}>
              Next
              <ChevronRight className="size-4" />
            </Button>
            <div className="mx-1 flex items-center gap-1" aria-hidden="true">
              {data.steps.map((_, i) => (
                <button
                  key={i}
                  type="button"
                  tabIndex={-1}
                  onClick={() => setCurrent(i)}
                  className={cn("size-2 rounded-full transition-colors", i === current ? "bg-foreground" : "bg-border hover:bg-muted-foreground")}
                />
              ))}
            </div>
            <span className="text-xs text-muted-foreground tabular-nums">
              Step {current + 1} of {total}
            </span>
          </>
        )}
        <Button variant="ghost" size="sm" className="ml-auto" onClick={() => setAll((v) => !v)} aria-pressed={all}>
          <ListOrdered className="size-4" />
          {all ? "One at a time" : "Show all"}
        </Button>
      </div>
    </div>
  );
}
