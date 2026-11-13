import Link from "next/link";
import { Brain, Wrench } from "lucide-react";

import { RelativeTime } from "@/components/shared/relative-time";
import { formatCost, formatDuration, formatTokens } from "@/lib/trace-format";
import { cn } from "@/lib/utils";
import type { TraceStatus, TraceSummary } from "@/types";

export function StatusDot({ status, className }: { status: TraceStatus; className?: string }) {
  const label = status === "error" ? "Failed" : status === "pending" ? "In progress" : "Succeeded";
  return (
    <span
      role="img"
      aria-label={label}
      title={label}
      className={cn(
        "inline-block size-2 shrink-0 rounded-full",
        status === "error" && "bg-destructive",
        status === "pending" && "animate-pulse bg-[var(--viz-4)]",
        status === "success" && "bg-[var(--sage-text)]",
        className,
      )}
    />
  );
}

/** What the run was about: the user's question, else the run's name. */
function runTitle(trace: TraceSummary): string {
  return trace.input_preview?.split("\n")[0] || trace.name;
}

const GRID = "md:grid md:grid-cols-[minmax(0,1fr)_7rem_9rem_5rem_5.5rem_6rem] md:items-center md:gap-4";

export function TraceTable({ traces }: { traces: TraceSummary[] }) {
  const maxLatency = Math.max(1, ...traces.map((t) => t.latency_ms ?? 0));
  return (
    <div className="overflow-hidden rounded-xl border border-border bg-card">
      <div
        className={cn(GRID, "hidden border-b border-border bg-muted/50 px-4 py-2 text-xs font-medium text-muted-foreground")}
        role="row"
      >
        <span>Run</span>
        <span>Started</span>
        <span>Duration</span>
        <span className="text-right">Tokens</span>
        <span className="text-right">Cost</span>
        <span>Steps</span>
      </div>
      <ul>
        {traces.map((trace) => (
          <li key={trace.id} className="border-b border-border last:border-b-0">
            <Link
              href={`/tracing/${trace.id}`}
              className={cn(
                GRID,
                "group block px-4 py-3 transition-colors hover:bg-accent/60 focus-visible:bg-accent/60 focus-visible:outline-none",
              )}
            >
              {/* Run */}
              <span className="flex min-w-0 items-start gap-3">
                <StatusDot status={trace.status} className="mt-1.5" />
                <span className="min-w-0">
                  <span className="block truncate text-sm font-medium text-foreground group-hover:underline group-hover:underline-offset-2">
                    {runTitle(trace)}
                  </span>
                  <span className="flex min-w-0 items-center gap-2 text-xs text-muted-foreground">
                    <span className="truncate">{trace.kind === "thread_title" ? "Thread title" : trace.name}</span>
                    {trace.models[0] && (
                      <span className="hidden truncate font-mono text-[11px] sm:inline">{trace.models[0]}</span>
                    )}
                    {trace.error_count > 0 && (
                      <span className="shrink-0 text-destructive">
                        {trace.error_count} error{trace.error_count === 1 ? "" : "s"}
                      </span>
                    )}
                  </span>
                </span>
              </span>

              {/* Mobile: one compact metrics line */}
              <span className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 pl-5 font-mono text-xs tabular-nums text-muted-foreground md:hidden">
                <RelativeTime value={trace.start_time} className="font-sans" />
                <span>{formatDuration(trace.latency_ms)}</span>
                <span>{formatTokens(trace.total_tokens)} tok</span>
                <span>{formatCost(trace.total_cost)}</span>
              </span>

              {/* Desktop columns */}
              <RelativeTime value={trace.start_time} className="hidden text-sm text-muted-foreground md:inline" />
              <span className="hidden min-w-0 items-center gap-2 md:flex">
                <span className="w-14 shrink-0 font-mono text-sm tabular-nums text-foreground">
                  {formatDuration(trace.latency_ms)}
                </span>
                <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted" aria-hidden="true">
                  <span
                    className={cn("block h-full rounded-full", trace.status === "error" ? "bg-destructive" : "bg-[var(--sage-text)]")}
                    style={{ width: `${Math.max(4, ((trace.latency_ms ?? 0) / maxLatency) * 100)}%` }}
                  />
                </span>
              </span>
              <span className="hidden text-right font-mono text-sm tabular-nums text-foreground md:block">
                {formatTokens(trace.total_tokens)}
              </span>
              <span className="hidden text-right font-mono text-sm tabular-nums text-foreground md:block">
                {formatCost(trace.total_cost)}
              </span>
              <span className="hidden items-center gap-3 font-mono text-xs tabular-nums text-muted-foreground md:flex">
                <span className="flex items-center gap-1" title={`${trace.llm_calls} LLM calls`}>
                  <Brain className="size-3.5 text-[var(--viz-1)]" aria-hidden="true" />
                  {trace.llm_calls}
                </span>
                <span className="flex items-center gap-1" title={`${trace.tool_calls} tool calls`}>
                  <Wrench className="size-3.5 text-[var(--viz-4)]" aria-hidden="true" />
                  {trace.tool_calls}
                </span>
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
