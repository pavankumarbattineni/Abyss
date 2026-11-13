"use client";

import { useMemo, useRef, useState } from "react";
import { ChevronRight } from "lucide-react";

import { parseServerDate } from "@/lib/server-date";
import { formatDuration, spanDisplayName, spanTypeStyle } from "@/lib/trace-format";
import { cn } from "@/lib/utils";
import type { TraceSpan } from "@/types";

interface Timing {
  offset: number; // ms from trace start
  duration: number; // ms
}

/** Span timings relative to the trace, and the trace's total length. */
export function useTimeline(spans: TraceSpan[]) {
  return useMemo(() => {
    const starts = spans.map((s) => parseServerDate(s.start_time).getTime());
    const ends = spans.map((s, i) => (s.end_time ? parseServerDate(s.end_time).getTime() : starts[i]));
    const origin = Math.min(...starts);
    const total = Math.max(1, Math.max(...ends) - origin);
    const timings = new Map<string, Timing>(
      spans.map((s, i) => [s.id, { offset: starts[i] - origin, duration: Math.max(0, ends[i] - starts[i]) }]),
    );
    return { origin, total, timings };
  }, [spans]);
}

const TICKS = [0, 0.25, 0.5, 0.75, 1];

/** LangChain/LangGraph plumbing: middleware wrappers, pass-through steps, and
 * a specialist's internal graph directly under its own tool call (it repeats
 * the tool's name). Hidden by default; their children move up to the nearest
 * meaningful ancestor. The root is never hidden. */
export function isFrameworkSpan(span: TraceSpan, parent?: TraceSpan): boolean {
  if (span.run_type !== "chain" || !span.parent_id) return false;
  return (
    /Middleware(\.|$)/.test(span.name) ||
    /^(RunnableSequence|RunnableLambda|ChannelWrite|ChannelRead|Branch<)/.test(span.name) ||
    parent?.run_type === "tool"
  );
}

interface TreeRow {
  span: TraceSpan;
  parent: string | null; // nearest shown ancestor
  depth: number;
}

/** The spans to show, with parents/depth recomputed when plumbing is hidden. */
function buildRows(spans: TraceSpan[], showAll: boolean): TreeRow[] {
  const byId = new Map(spans.map((s) => [s.id, s]));
  const hidden = (id: string | null): boolean => {
    const span = id ? byId.get(id) : undefined;
    return !showAll && !!span && isFrameworkSpan(span, span.parent_id ? byId.get(span.parent_id) : undefined);
  };
  const rows: TreeRow[] = [];
  const depthOf = new Map<string, number>();
  for (const span of spans) {
    if (hidden(span.id)) continue;
    let parent = span.parent_id;
    while (parent && hidden(parent)) parent = byId.get(parent)?.parent_id ?? null;
    const depth = parent ? (depthOf.get(parent) ?? 0) + 1 : 0;
    depthOf.set(span.id, depth);
    rows.push({ span, parent, depth });
  }
  return rows;
}

interface SpanWaterfallProps {
  spans: TraceSpan[];
  selectedId: string | null;
  onSelect: (id: string) => void;
}

/** The trace as a tree (left) on a shared time axis (right). */
export function SpanWaterfall({ spans, selectedId, onSelect }: SpanWaterfallProps) {
  const { total, timings } = useTimeline(spans);
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set());
  const [showAll, setShowAll] = useState<boolean>(false);
  const listRef = useRef<HTMLDivElement>(null);
  const frameworkCount = useMemo(() => {
    const byId = new Map(spans.map((s) => [s.id, s]));
    return spans.filter((s) => isFrameworkSpan(s, s.parent_id ? byId.get(s.parent_id) : undefined)).length;
  }, [spans]);

  const rows = useMemo(() => buildRows(spans, showAll), [spans, showAll]);
  const children = useMemo(() => {
    const map = new Map<string, number>();
    for (const row of rows) if (row.parent) map.set(row.parent, (map.get(row.parent) ?? 0) + 1);
    return map;
  }, [rows]);
  const parentOf = useMemo(() => new Map(rows.map((row) => [row.span.id, row.parent])), [rows]);

  // Hide descendants of collapsed spans (rows are in execution order, so a
  // parent always comes before its children).
  const visibleRows = useMemo(() => {
    const hidden = new Set<string>();
    return rows.filter((row) => {
      if (row.parent && (hidden.has(row.parent) || collapsed.has(row.parent))) {
        hidden.add(row.span.id);
        return false;
      }
      return true;
    });
  }, [rows, collapsed]);
  const visible = useMemo(() => visibleRows.map((row) => row.span), [visibleRows]);

  /** Open or close a span's children; without `open`, flip the current state. */
  const toggle = (id: string, open?: boolean) =>
    setCollapsed((current) => {
      const next = new Set(current);
      const shouldOpen = open ?? next.has(id);
      if (shouldOpen) next.delete(id);
      else next.add(id);
      return next;
    });

  const onKeyDown = (event: React.KeyboardEvent) => {
    const index = visible.findIndex((s) => s.id === selectedId);
    const current = visible[index];
    let target: TraceSpan | undefined;
    if (event.key === "ArrowDown") target = visible[Math.min(visible.length - 1, index + 1)];
    else if (event.key === "ArrowUp") target = visible[Math.max(0, index - 1)];
    else if (event.key === "ArrowLeft" && current) {
      if (children.has(current.id) && !collapsed.has(current.id)) toggle(current.id, false);
      else target = spans.find((s) => s.id === parentOf.get(current.id));
    } else if (event.key === "ArrowRight" && current && collapsed.has(current.id)) toggle(current.id, true);
    else return;
    event.preventDefault();
    if (target) {
      onSelect(target.id);
      listRef.current?.querySelector<HTMLElement>(`[data-span="${target.id}"]`)?.focus();
    }
  };

  return (
    <div className="overflow-hidden rounded-xl border border-border bg-card">
      {/* Time axis */}
      <div className="grid grid-cols-[minmax(0,1fr)] border-b border-border bg-muted/50 text-[11px] text-muted-foreground sm:grid-cols-[minmax(0,48%)_minmax(0,1fr)]">
        <div className="flex items-center justify-between gap-2 px-3 py-1.5">
          <span className="font-medium">Span</span>
          {frameworkCount > 0 && (
            <button
              type="button"
              onClick={() => setShowAll((value) => !value)}
              aria-pressed={showAll}
              className="rounded px-1.5 py-0.5 text-[11px] text-sage-text hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
            >
              {showAll ? "Hide framework steps" : `Show ${frameworkCount} framework steps`}
            </button>
          )}
        </div>
        <div className="relative hidden h-8 sm:block" aria-hidden="true">
          {TICKS.map((tick) => (
            <span
              key={tick}
              className={cn(
                "absolute top-2 font-mono tabular-nums",
                tick === 0 ? "left-3" : tick === 1 ? "right-3" : "-translate-x-1/2",
              )}
              style={tick > 0 && tick < 1 ? { left: `calc(0.75rem + (100% - 1.5rem) * ${tick})` } : undefined}
            >
              {formatDuration(total * tick)}
            </span>
          ))}
        </div>
      </div>

      <div ref={listRef} role="tree" aria-label="Spans" onKeyDown={onKeyDown} className="py-1">
        {visibleRows.map(({ span, depth }) => {
          const style = spanTypeStyle(span.run_type);
          const Icon = style.icon;
          const timing = timings.get(span.id) ?? { offset: 0, duration: 0 };
          const hasChildren = children.has(span.id);
          const isCollapsed = collapsed.has(span.id);
          const selected = span.id === selectedId;
          const failed = span.status === "error";
          return (
            <div
              key={span.id}
              data-span={span.id}
              role="treeitem"
              aria-level={depth + 1}
              aria-selected={selected}
              aria-expanded={hasChildren ? !isCollapsed : undefined}
              tabIndex={selected || (!selectedId && span.position === 0) ? 0 : -1}
              onClick={() => onSelect(span.id)}
              onFocus={() => !selected && onSelect(span.id)}
              className={cn(
                "group relative grid cursor-pointer grid-cols-[minmax(0,1fr)] items-center outline-none sm:grid-cols-[minmax(0,48%)_minmax(0,1fr)]",
                "hover:bg-accent/50 focus-visible:bg-accent/60",
                selected && "bg-accent",
              )}
            >
              {selected && <span className="absolute inset-y-0 left-0 w-0.5 bg-highlight" aria-hidden="true" />}
              {/* Tree cell */}
              <div className="flex min-w-0 items-center gap-1.5 py-1.5 pr-3" style={{ paddingLeft: `${0.5 + depth * 0.875}rem` }}>
                {hasChildren ? (
                  <button
                    type="button"
                    tabIndex={-1}
                    aria-label={isCollapsed ? "Expand" : "Collapse"}
                    onClick={(event) => {
                      event.stopPropagation();
                      toggle(span.id);
                    }}
                    className="flex size-5 shrink-0 items-center justify-center rounded text-muted-foreground hover:bg-muted hover:text-foreground"
                  >
                    <ChevronRight className={cn("size-3.5 transition-transform", !isCollapsed && "rotate-90")} />
                  </button>
                ) : (
                  <span className="size-5 shrink-0" />
                )}
                <Icon className="size-3.5 shrink-0" style={{ color: failed ? "var(--destructive)" : style.color }} aria-hidden="true" />
                <span className={cn("truncate text-sm", failed ? "text-destructive" : "text-foreground", selected && "font-medium")}>
                  {spanDisplayName(span)}
                </span>
                <span className="ml-auto shrink-0 pl-2 font-mono text-xs tabular-nums text-muted-foreground">
                  {formatDuration(span.latency_ms)}
                </span>
              </div>
              {/* Timeline cell */}
              <div className="relative hidden h-7 sm:block" aria-hidden="true">
                <div className="absolute inset-y-0 left-3 right-3">
                  {[0.25, 0.5, 0.75].map((tick) => (
                    <span key={tick} className="absolute inset-y-0 w-px bg-border/60" style={{ left: `${tick * 100}%` }} />
                  ))}
                  <span
                    className={cn("absolute top-1/2 h-2.5 -translate-y-1/2 rounded-sm", selected && "ring-2 ring-highlight/60")}
                    style={{
                      left: `${(timing.offset / total) * 100}%`,
                      width: `max(3px, ${(timing.duration / total) * 100}%)`,
                      background: failed ? "var(--destructive)" : style.color,
                      opacity: span.run_type === "chain" ? 0.55 : 0.95,
                    }}
                  />
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
