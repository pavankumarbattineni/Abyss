"use client";

import { useState } from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { format } from "date-fns";
import { toast } from "sonner";
import type { ColumnDef } from "@tanstack/react-table";
import type { PaginationState } from "@tanstack/react-table";

import { PageHeader } from "@/components/shared";
import { Card, DataTable } from "@/components/ui";
import { useDebounce } from "@/hooks";
import { usageService } from "@/services";
import { downloadBlob } from "@/utils/download";
import { formatCompactNumber } from "@/utils/format-number";
import type { UsageRun, UsageRunsQuery, UsageSummary } from "@/types";
import { DEFAULT_USAGE_FILTERS, UsageFilters, type UsageFiltersValue } from "./usage-filters";
import { UsageRunStatusBadge } from "./usage-run-status-badge";
import { UsageSummaryCards } from "./usage-summary-cards";

// The API types start_date/end_date as date-time, so a bare "YYYY-MM-DD" from the date input
// needs a time component — start of day for the lower bound, end of day for the upper one so
// the selected end date is actually included.
function toStartOfDayIso(date: string): string {
  return new Date(`${date}T00:00:00`).toISOString();
}

function toEndOfDayIso(date: string): string {
  return new Date(`${date}T23:59:59.999`).toISOString();
}

function buildQuery(filters: UsageFiltersValue): Omit<UsageRunsQuery, "page" | "page_size"> {
  return {
    agent_id: filters.agentId,
    status: filters.status,
    provider: filters.provider.trim() || undefined,
    model: filters.model.trim() || undefined,
    start_date: filters.startDate ? toStartOfDayIso(filters.startDate) : undefined,
    end_date: filters.endDate ? toEndOfDayIso(filters.endDate) : undefined,
  };
}

const columns: ColumnDef<UsageRun>[] = [
  {
    accessorKey: "agent_name",
    header: "Agent",
    cell: ({ row }) => (
      <Link
        href={`/agents/${row.original.agent_id}/threads/${row.original.thread_id}`}
        className="font-medium text-primary hover:underline"
      >
        {row.original.agent_name}
      </Link>
    ),
  },
  {
    accessorKey: "status",
    header: "Status",
    cell: ({ getValue }) => <UsageRunStatusBadge status={getValue<UsageRun["status"]>()} />,
  },
  {
    id: "model",
    header: "Model",
    cell: ({ row }) => {
      const { provider, model } = row.original;
      const label = [provider, model].filter(Boolean).join(" / ");
      return <span className="text-xs text-muted-foreground">{label || "—"}</span>;
    },
  },
  {
    accessorKey: "input_tokens",
    header: "Input",
    cell: ({ getValue }) => {
      const value = getValue<number | null>();
      return (
        <span className="text-xs text-muted-foreground">
          {value != null ? formatCompactNumber(value) : "—"}
        </span>
      );
    },
  },
  {
    accessorKey: "cache_read_tokens",
    header: "Cache read",
    cell: ({ getValue }) => {
      const value = getValue<number | null>();
      return (
        <span className="text-xs text-muted-foreground">
          {value != null ? formatCompactNumber(value) : "—"}
        </span>
      );
    },
  },
  {
    accessorKey: "output_tokens",
    header: "Output",
    cell: ({ getValue }) => {
      const value = getValue<number | null>();
      return (
        <span className="text-xs text-muted-foreground">
          {value != null ? formatCompactNumber(value) : "—"}
        </span>
      );
    },
  },
  {
    accessorKey: "total_tokens",
    header: "Total tokens",
    cell: ({ getValue }) => {
      const value = getValue<number | null>();
      return (
        <span className="text-xs font-medium text-foreground">
          {value != null ? formatCompactNumber(value) : "—"}
        </span>
      );
    },
  },
  {
    accessorKey: "cost_usd",
    header: "Cost",
    cell: ({ getValue }) => {
      const value = getValue<number | null>();
      return (
        <span className="text-sm text-foreground">
          {value != null ? `$${value.toFixed(4)}` : "—"}
        </span>
      );
    },
  },
  {
    accessorKey: "created_at",
    header: "Started",
    cell: ({ getValue }) => (
      <span className="text-xs text-muted-foreground">
        {format(new Date(getValue<string>()), "MMM d, yyyy h:mm a")}
      </span>
    ),
  },
];

export const UsageSettingsPage = () => {
  const [filters, setFilters] = useState<UsageFiltersValue>(DEFAULT_USAGE_FILTERS);
  const [pagination, setPagination] = useState<PaginationState>({
    pageIndex: 0,
    pageSize: 10,
  });
  const [isDownloading, setIsDownloading] = useState<boolean>(false);

  const { data: summary, isLoading: isSummaryLoading } = useQuery<UsageSummary>({
    queryKey: ["usage-summary"],
    queryFn: () => usageService.getSummary(),
  });

  const debouncedProvider = useDebounce(filters.provider, 300);
  const debouncedModel = useDebounce(filters.model, 300);

  const runsQuery: UsageRunsQuery = {
    ...buildQuery({ ...filters, provider: debouncedProvider, model: debouncedModel }),
    page: pagination.pageIndex + 1,
    page_size: pagination.pageSize,
  };

  const {
    data: runsResponse,
    isLoading: isRunsLoading,
    isError,
  } = useQuery({
    queryKey: ["usage-runs", runsQuery],
    queryFn: () => usageService.getRuns(runsQuery),
  });

  const handleFiltersChange = (next: UsageFiltersValue) => {
    setFilters(next);
    setPagination((prev) => ({ ...prev, pageIndex: 0 }));
  };

  const handleDownload = async () => {
    setIsDownloading(true);
    try {
      const blob = await usageService.downloadRuns(buildQuery(filters));
      downloadBlob(blob, `usage-runs-${format(new Date(), "yyyy-MM-dd")}.csv`);
    } catch {
      toast.error("Failed to download usage runs. Please try again.");
    } finally {
      setIsDownloading(false);
    }
  };

  return (
    <div className="flex flex-col gap-5">
      <PageHeader title="Usage" description="Token usage and cost across your agent runs." />

      <UsageSummaryCards summary={summary} isLoading={isSummaryLoading} />

      <Card className="overflow-hidden p-0">
        <UsageFilters
          value={filters}
          onChange={handleFiltersChange}
          onDownload={handleDownload}
          isDownloading={isDownloading}
        />
        <DataTable
          columns={columns}
          data={runsResponse?.items ?? []}
          isLoading={isRunsLoading}
          pagination
          manualPagination
          totalRows={runsResponse?.total}
          paginationState={pagination}
          onPaginationChange={setPagination}
          emptyMessage={isError ? "Failed to load usage runs." : "No usage runs yet."}
        />
      </Card>
    </div>
  );
};
