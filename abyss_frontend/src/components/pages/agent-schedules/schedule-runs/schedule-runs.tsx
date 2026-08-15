"use client";

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { format } from "date-fns";
import type { ColumnDef } from "@tanstack/react-table";

import { Breadcrumbs, PageHeader } from "@/components/shared";
import { Card, DataTable } from "@/components/ui";
import { scheduleService } from "@/services";
import type { ScheduleRun } from "@/types";
import { RunStatusBadge } from "./run-status-badge";

function buildColumns(agentId: string): ColumnDef<ScheduleRun>[] {
  return [
    {
      accessorKey: "status",
      header: "Status",
      cell: ({ getValue }) => <RunStatusBadge status={getValue<ScheduleRun["status"]>()} />,
    },
    {
      accessorKey: "scheduled_for",
      header: "Scheduled for",
      cell: ({ getValue }) => (
        <span className="text-sm text-foreground">
          {format(new Date(getValue<string>()), "MMM d, yyyy h:mm a")}
        </span>
      ),
    },
    {
      accessorKey: "created_at",
      header: "Started at",
      cell: ({ getValue }) => (
        <span className="text-xs text-muted-foreground">
          {format(new Date(getValue<string>()), "MMM d, yyyy h:mm a")}
        </span>
      ),
    },
    {
      id: "thread",
      header: "Thread",
      cell: ({ row }) => (
        <Link
          href={`/agents/${agentId}/threads/${row.original.thread_id}`}
          className="text-sm text-primary hover:underline"
        >
          View conversation
        </Link>
      ),
    },
    {
      accessorKey: "error_message",
      header: "Error",
      cell: ({ getValue }) => {
        const message = getValue<string | null>();
        return message ? (
          <span className="line-clamp-1 max-w-xs text-xs text-destructive">{message}</span>
        ) : (
          <span className="text-xs text-muted-foreground">—</span>
        );
      },
    },
  ];
}

interface ScheduleRunsPageProps {
  agentId: string;
  scheduleId: string;
}

export const ScheduleRunsPage = ({ agentId, scheduleId }: ScheduleRunsPageProps) => {
  const {
    data: runs = [],
    isLoading,
    isError,
  } = useQuery<ScheduleRun[]>({
    queryKey: ["schedule-runs", scheduleId],
    queryFn: () => scheduleService.getScheduleRuns(agentId, scheduleId),
  });

  const sortedRuns = [...runs].sort(
    (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime(),
  );

  return (
    <div className="flex flex-col gap-5 p-6">
      <div className="flex flex-col gap-2">
        <Breadcrumbs
          items={[
            { label: "Schedules", href: `/agents/${agentId}/schedules` },
            { label: "Run history" },
          ]}
        />
        <PageHeader title="Run history" description="Past runs for this schedule, newest first." />
      </div>

      <Card className="overflow-hidden p-0">
        <DataTable
          columns={buildColumns(agentId)}
          data={sortedRuns}
          isLoading={isLoading}
          emptyMessage={isError ? "Failed to load run history." : "No runs yet for this schedule."}
        />
      </Card>
    </div>
  );
};
