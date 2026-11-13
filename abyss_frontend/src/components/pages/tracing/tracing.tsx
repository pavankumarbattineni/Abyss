"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { parseAsInteger, parseAsStringLiteral, useQueryState } from "nuqs";
import { Activity, ChevronLeft, ChevronRight, RefreshCw, Search } from "lucide-react";
import { toast } from "sonner";

import { RelativeTime } from "@/components/shared/relative-time";
import { Button, Input, Select, SelectContent, SelectItem, SelectTrigger, SelectValue, Skeleton } from "@/components/ui";
import { useDebounce } from "@/hooks";
import { cn } from "@/lib/utils";
import { traceService } from "@/services";
import type { TraceListResponse, TraceStats } from "@/types";
import { TraceActivityChart } from "./trace-activity-chart";
import { TraceKpis } from "./trace-kpis";
import { TraceTable } from "./trace-table";

const PERIODS = [
  { days: 1, label: "24 h" },
  { days: 7, label: "7 days" },
  { days: 14, label: "14 days" },
] as const;
const STATUSES = ["all", "success", "error"] as const;
const KINDS = ["all", "agent_turn", "thread_title"] as const;
const PAGE_SIZE = 25;

export const TracingPage = () => {
  const queryClient = useQueryClient();
  const [days, setDays] = useQueryState("days", parseAsInteger.withDefault(7));
  const [status, setStatus] = useQueryState("status", parseAsStringLiteral(STATUSES).withDefault("all"));
  const [kind, setKind] = useQueryState("kind", parseAsStringLiteral(KINDS).withDefault("agent_turn"));
  const [page, setPage] = useQueryState("page", parseAsInteger.withDefault(1));
  const [q, setQ] = useQueryState("q", { defaultValue: "" });
  const [search, setSearch] = useState<string>(q);
  const debouncedSearch = useDebounce(search, 300);

  useEffect(() => {
    if (debouncedSearch !== q) {
      void setQ(debouncedSearch || null);
      void setPage(1);
    }
  }, [debouncedSearch, q, setQ, setPage]);

  const listQuery = useQuery<TraceListResponse>({
    queryKey: ["traces", "list", days, status, kind, q, page],
    queryFn: () =>
      traceService.list({
        days,
        status: status === "all" ? undefined : status,
        kind: kind === "all" ? undefined : kind,
        q: q || undefined,
        page,
        page_size: PAGE_SIZE,
      }),
    placeholderData: (previous) => previous,
  });
  const statsQuery = useQuery<TraceStats>({
    queryKey: ["traces", "stats", days],
    queryFn: () => traceService.stats(days),
  });

  const sync = useMutation({
    mutationFn: () => traceService.sync(),
    onSuccess: (result) => {
      void queryClient.invalidateQueries({ queryKey: ["traces"] });
      if (!result.enabled) toast.info("Tracing isn't configured on this server.");
      else if (result.synced) toast.success(`Synced ${result.synced} trace${result.synced === 1 ? "" : "s"} from LangSmith`);
      else toast.success("Already up to date");
    },
    onError: () => toast.error("Couldn't reach LangSmith. Try again in a moment."),
  });

  const data = listQuery.data;
  const filtersActive = status !== "all" || kind !== "agent_turn" || !!q;
  const from = data && data.total ? (data.page - 1) * data.page_size + 1 : 0;
  const to = data ? Math.min(data.page * data.page_size, data.total) : 0;

  return (
    <div className="mx-auto flex w-full max-w-7xl flex-col gap-5 p-4 sm:p-6">
      {/* Header */}
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-xl font-semibold tracking-tight text-foreground">Tracing</h1>
          <p className="text-sm text-muted-foreground">
            Every run of your agents, step by step, as recorded by LangSmith.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div role="tablist" aria-label="Period" className="inline-flex rounded-lg border border-border bg-card p-0.5">
            {PERIODS.map((period) => (
              <button
                key={period.days}
                type="button"
                role="tab"
                aria-selected={days === period.days}
                onClick={() => {
                  void setDays(period.days);
                  void setPage(1);
                }}
                className={cn(
                  "rounded-md px-3 py-1.5 text-xs font-medium transition-colors focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none",
                  days === period.days ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground",
                )}
              >
                {period.label}
              </button>
            ))}
          </div>
          <Button variant="outline" size="sm" onClick={() => sync.mutate()} disabled={sync.isPending}>
            <RefreshCw className={cn("size-3.5", sync.isPending && "animate-spin")} aria-hidden="true" />
            {sync.isPending ? "Syncing…" : "Refresh"}
          </Button>
        </div>
      </div>
      {data?.last_synced_at && (
        <p className="-mt-3 text-xs text-muted-foreground">
          Last sync: <RelativeTime value={data.last_synced_at} />
        </p>
      )}

      {data && !data.enabled ? (
        <EmptyPanel
          title="Tracing isn't set up on this server"
          body="Turn on LangSmith tracing in the backend configuration (ABYSS_CONFIG.LANGSMITH) and every agent run will appear here."
        />
      ) : (
        <>
          <TraceKpis stats={statsQuery.data} isLoading={statsQuery.isLoading} />
          <TraceActivityChart days={days} data={statsQuery.data?.by_day} isLoading={statsQuery.isLoading} />

          {/* Filters */}
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative min-w-0 flex-1 basis-full sm:max-w-xs sm:basis-auto">
              <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
              <Input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Search questions and answers"
                aria-label="Search runs"
                className="pl-9"
              />
            </div>
            <Select value={status} onValueChange={(value) => { void setStatus(value as (typeof STATUSES)[number]); void setPage(1); }}>
              <SelectTrigger className="min-w-0 flex-1 sm:w-36 sm:flex-none" aria-label="Status">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All statuses</SelectItem>
                <SelectItem value="success">Succeeded</SelectItem>
                <SelectItem value="error">Failed</SelectItem>
              </SelectContent>
            </Select>
            <Select value={kind} onValueChange={(value) => { void setKind(value as (typeof KINDS)[number]); void setPage(1); }}>
              <SelectTrigger className="min-w-0 flex-1 sm:w-40 sm:flex-none" aria-label="Run type">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="agent_turn">Agent runs</SelectItem>
                <SelectItem value="thread_title">Thread titles</SelectItem>
                <SelectItem value="all">All runs</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* Runs */}
          {listQuery.isLoading ? (
            <div className="flex flex-col gap-px overflow-hidden rounded-xl border border-border">
              {Array.from({ length: 6 }).map((_, index) => (
                <Skeleton key={index} className="h-14 rounded-none" />
              ))}
            </div>
          ) : listQuery.isError ? (
            <EmptyPanel title="Runs didn't load" body="Reload the page to try again." />
          ) : data && data.items.length > 0 ? (
            <>
              <TraceTable traces={data.items} />
              {data.total > data.page_size && (
                <nav aria-label="Pages" className="flex items-center justify-between gap-2 text-sm text-muted-foreground">
                  <span className="tabular-nums">
                    {from}–{to} of {data.total}
                  </span>
                  <span className="flex gap-1">
                    <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => void setPage(page - 1)}>
                      <ChevronLeft className="size-4" aria-hidden="true" /> Newer
                    </Button>
                    <Button variant="outline" size="sm" disabled={to >= data.total} onClick={() => void setPage(page + 1)}>
                      Older <ChevronRight className="size-4" aria-hidden="true" />
                    </Button>
                  </span>
                </nav>
              )}
            </>
          ) : filtersActive ? (
            <EmptyPanel title="No runs match these filters" body="Try another period, status or search term." />
          ) : (
            <EmptyPanel
              title="No runs yet"
              body="Chat with one of your agents and its run appears here a few seconds after it finishes."
              action={
                <Button size="sm" asChild>
                  <Link href="/agents">Go to your agents</Link>
                </Button>
              }
            />
          )}
        </>
      )}
    </div>
  );
};

function EmptyPanel({ title, body, action }: { title: string; body: string; action?: React.ReactNode }) {
  return (
    <div className="flex flex-col items-center rounded-xl border border-dashed border-border px-6 py-14 text-center">
      <Activity className="mb-3 size-6 text-muted-foreground" aria-hidden="true" />
      <h2 className="font-semibold text-foreground">{title}</h2>
      <p className="mt-1 max-w-md text-sm text-muted-foreground">{body}</p>
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}
