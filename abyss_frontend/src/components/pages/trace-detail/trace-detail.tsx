"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, MessageSquare } from "lucide-react";

import { RelativeTime } from "@/components/shared/relative-time";
import { Button, Skeleton } from "@/components/ui";
import { formatCost, formatDuration, formatTokens } from "@/lib/trace-format";
import { cn } from "@/lib/utils";
import { traceService } from "@/services";
import type { TraceDetail } from "@/types";
import { StatusDot } from "../tracing/trace-table";
import { SpanInspector } from "./span-inspector";
import { SpanWaterfall, useTimeline } from "./span-waterfall";

export const TraceDetailPage = ({ traceId }: { traceId: string }) => {
  const { data: trace, isLoading, isError } = useQuery<TraceDetail>({
    queryKey: ["traces", "detail", traceId],
    queryFn: () => traceService.get(traceId),
    // Still being ingested: look again shortly.
    refetchInterval: (query) => (query.state.data && !query.state.data.complete ? 5000 : false),
  });

  if (isLoading) {
    return (
      <div className="mx-auto flex w-full max-w-7xl flex-col gap-4 p-4 sm:p-6">
        <Skeleton className="h-5 w-24" />
        <Skeleton className="h-8 w-2/3" />
        <Skeleton className="h-16 w-full" />
        <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,26rem)]">
          <Skeleton className="h-96" />
          <Skeleton className="h-96" />
        </div>
      </div>
    );
  }
  if (isError || !trace) {
    return (
      <div className="mx-auto flex w-full max-w-7xl flex-col items-center gap-3 p-10 text-center">
        <h1 className="text-lg font-semibold">This trace isn&apos;t available</h1>
        <p className="text-sm text-muted-foreground">It may be older than 14 days, or belong to someone else.</p>
        <Button variant="outline" size="sm" asChild>
          <Link href="/tracing">Back to Tracing</Link>
        </Button>
      </div>
    );
  }
  return <TraceView trace={trace} />;
};

function TraceView({ trace }: { trace: TraceDetail }) {
  const firstError = trace.spans.find((s) => s.status === "error");
  const [selectedId, setSelectedId] = useState<string>((firstError ?? trace.spans[0])?.id ?? "");
  const { timings } = useTimeline(trace.spans);
  const selected = useMemo(() => trace.spans.find((s) => s.id === selectedId) ?? trace.spans[0], [trace.spans, selectedId]);
  const title = trace.input_preview?.split("\n")[0] || trace.name;
  const threadHref = trace.thread_id && trace.agent_id ? `/agents/${trace.agent_id}/threads/${trace.thread_id}` : null;

  const metrics = [
    { label: "Duration", value: formatDuration(trace.latency_ms) },
    { label: "Tokens", value: formatTokens(trace.total_tokens), detail: `${formatTokens(trace.prompt_tokens)} in · ${formatTokens(trace.completion_tokens)} out` },
    { label: "Cost", value: formatCost(trace.total_cost) },
    { label: "LLM calls", value: String(trace.llm_calls) },
    { label: "Tool calls", value: String(trace.tool_calls) },
    { label: "Spans", value: String(trace.span_count), detail: trace.error_count ? `${trace.error_count} failed` : undefined, error: trace.error_count > 0 },
  ];

  return (
    <div className="mx-auto flex w-full max-w-7xl flex-col gap-4 p-4 sm:p-6">
      <Link
        href="/tracing"
        className="inline-flex w-fit items-center gap-1 rounded text-sm text-muted-foreground hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
      >
        <ArrowLeft className="size-4" aria-hidden="true" /> Tracing
      </Link>

      {/* Title + actions */}
      <header className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0 flex-1">
          <h1 title={title} className="line-clamp-3 text-lg leading-snug font-semibold tracking-tight text-foreground [overflow-wrap:anywhere] sm:text-xl">
            {title}
          </h1>
          <p className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted-foreground">
            <span className="inline-flex items-center gap-1.5">
              <StatusDot status={trace.status} />
              {trace.status === "error" ? "Failed" : trace.status === "pending" ? "In progress" : "Succeeded"}
            </span>
            <span>{trace.kind === "thread_title" ? "Thread title" : trace.name}</span>
            <RelativeTime value={trace.start_time} className="text-sm" />
            {trace.models.map((model) => (
              <span key={model} className="rounded-md bg-muted px-1.5 py-0.5 font-mono text-xs text-foreground">
                {model}
              </span>
            ))}
            {!trace.complete && <span className="text-[var(--viz-4)]">Still syncing from LangSmith…</span>}
          </p>
        </div>
        <div className="flex shrink-0 flex-wrap gap-2">
          {threadHref && (
            <Button variant="outline" size="sm" asChild>
              <Link href={threadHref}>
                <MessageSquare className="size-3.5" aria-hidden="true" /> Open thread
              </Link>
            </Button>
          )}
        </div>
      </header>

      {trace.error && (
        <div role="alert" className="rounded-xl border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive">
          <span className="font-semibold">Run failed: </span>
          <span className="[overflow-wrap:anywhere]">{trace.error.split("\n")[0]}</span>
        </div>
      )}

      {/* Metrics strip */}
      <dl className="grid grid-cols-2 gap-px overflow-hidden rounded-xl border border-border bg-border sm:grid-cols-3 lg:grid-cols-6">
        {metrics.map((metric) => (
          <div key={metric.label} className="min-w-0 bg-card px-4 py-2.5">
            <dt className="text-xs text-muted-foreground">{metric.label}</dt>
            <dd className="flex items-baseline gap-1.5">
              <span className={cn("font-mono text-lg font-semibold tabular-nums", metric.error ? "text-destructive" : "text-foreground")}>
                {metric.value}
              </span>
              {metric.detail && <span className="truncate text-xs text-muted-foreground">{metric.detail}</span>}
            </dd>
          </div>
        ))}
      </dl>

      {/* Tree + waterfall | inspector */}
      <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,26rem)]">
        <SpanWaterfall spans={trace.spans} selectedId={selected?.id ?? null} onSelect={setSelectedId} />
        {selected && (
          <div className="lg:sticky lg:top-4 lg:flex lg:max-h-[calc(100dvh-2rem)] lg:flex-col">
            <SpanInspector
              key={selected.id}
              span={selected}
              offsetMs={timings.get(selected.id)?.offset ?? 0}
            />
          </div>
        )}
      </div>
    </div>
  );
}
