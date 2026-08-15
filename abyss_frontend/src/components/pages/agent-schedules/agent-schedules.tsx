"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { format } from "date-fns";
import { Plus } from "lucide-react";
import { toast } from "sonner";
import type { ColumnDef } from "@tanstack/react-table";

import { Breadcrumbs, PageHeader } from "@/components/shared";
import { Button, Card, DataTable } from "@/components/ui";
import { cn, getApiErrorMessage } from "@/lib/utils";
import { agentService, scheduleService } from "@/services";
import type { Agent, Schedule, ScheduleRequest, ScheduleUpdateRequest } from "@/types";
import { formatScheduleFrequency } from "./format-schedule";
import { ScheduleActions } from "./schedule-actions";
import { ScheduleFormDrawer } from "./schedule-form-drawer";

function buildColumns(
  agentId: string,
  onEdit: (schedule: Schedule) => void,
): ColumnDef<Schedule>[] {
  return [
    {
      accessorKey: "input_query",
      header: "Prompt",
      cell: ({ getValue }) => {
        const value = getValue<string>();
        return (
          <span
            className={cn(
              "line-clamp-1 max-w-md text-sm",
              value ? "text-foreground" : "text-muted-foreground",
            )}
          >
            {value || "No prompt"}
          </span>
        );
      },
    },
    {
      id: "frequency",
      header: "Frequency",
      cell: ({ row }) => (
        <span className="text-sm text-muted-foreground">
          {formatScheduleFrequency(row.original)}
        </span>
      ),
    },
    {
      accessorKey: "next_run_at",
      header: "Next run",
      cell: ({ getValue }) => {
        const value = getValue<string | null>();
        return (
          <span className="text-xs text-muted-foreground">
            {value ? format(new Date(value), "MMM d, yyyy h:mm a") : "—"}
          </span>
        );
      },
    },
    {
      accessorKey: "last_run_at",
      header: "Last run",
      cell: ({ getValue }) => {
        const value = getValue<string | null>();
        return (
          <span className="text-xs text-muted-foreground">
            {value ? format(new Date(value), "MMM d, yyyy h:mm a") : "Never"}
          </span>
        );
      },
    },
    {
      id: "actions",
      header: "Actions",
      cell: ({ row }) => (
        <ScheduleActions agentId={agentId} schedule={row.original} onEdit={onEdit} />
      ),
    },
  ];
}

interface AgentSchedulesPageProps {
  agentId: string;
}

export const AgentSchedulesPage = ({ agentId }: AgentSchedulesPageProps) => {
  const queryClient = useQueryClient();
  const [drawerOpen, setDrawerOpen] = useState<boolean>(false);
  const [editingSchedule, setEditingSchedule] = useState<Schedule | null>(null);

  const { data: agent } = useQuery<Agent>({
    queryKey: ["agent", agentId],
    queryFn: () => agentService.getAgent(agentId),
  });

  const {
    data: schedules = [],
    isLoading,
    isError,
  } = useQuery<Schedule[]>({
    queryKey: ["schedules", agentId],
    queryFn: () => scheduleService.getSchedules(agentId),
  });

  const { mutate: createSchedule, isPending: isCreating } = useMutation({
    mutationFn: (payload: ScheduleRequest) => scheduleService.createSchedule(agentId, payload),
    onSuccess: (schedule) => {
      queryClient.setQueryData<Schedule[]>(["schedules", agentId], (prev) =>
        prev ? [schedule, ...prev] : [schedule],
      );
      if (schedule.warning) toast.warning(schedule.warning);
      toast.success("Schedule created");
      setDrawerOpen(false);
    },
    onError: (error) => {
      toast.error(getApiErrorMessage(error, "Failed to create schedule. Please try again."));
    },
  });

  const { mutate: updateSchedule, isPending: isUpdating } = useMutation({
    mutationFn: (payload: ScheduleUpdateRequest) =>
      scheduleService.updateSchedule(agentId, editingSchedule!.id, payload),
    onSuccess: (schedule) => {
      queryClient.setQueryData<Schedule[]>(["schedules", agentId], (prev) =>
        prev?.map((item) => (item.id === schedule.id ? schedule : item)),
      );
      if (schedule.warning) toast.warning(schedule.warning);
      toast.success("Schedule updated");
      setDrawerOpen(false);
      setEditingSchedule(null);
    },
    onError: (error) => {
      toast.error(getApiErrorMessage(error, "Failed to update schedule. Please try again."));
    },
  });

  const handleAddClick = () => {
    setEditingSchedule(null);
    setDrawerOpen(true);
  };

  const handleEditClick = (schedule: Schedule) => {
    setEditingSchedule(schedule);
    setDrawerOpen(true);
  };

  const handleDrawerOpenChange = (open: boolean) => {
    setDrawerOpen(open);
    if (!open) setEditingSchedule(null);
  };

  const handleSubmit = (payload: ScheduleRequest) => {
    if (editingSchedule) {
      updateSchedule({
        schedule_type: payload.schedule_type,
        interval_minutes: payload.interval_minutes,
        time_of_day: payload.time_of_day,
        weekdays: payload.weekdays,
        day_of_month: payload.day_of_month,
        input_query: payload.input_query,
      });
    } else {
      createSchedule(payload);
    }
  };

  return (
    <div className="flex flex-col gap-5 p-6">
      <div className="flex flex-col gap-2">
        <Breadcrumbs
          items={[
            { label: agent?.name ?? "Agent", href: `/agents/${agentId}` },
            { label: "Schedules" },
          ]}
        />
        <PageHeader
          title="Schedules"
          description={`Recurring runs for ${agent?.name ?? "this agent"}.`}
          actions={
            <Button type="button" size="sm" onClick={handleAddClick}>
              <Plus className="size-3.5" />
              New schedule
            </Button>
          }
        />
      </div>

      <Card className="overflow-hidden p-0">
        <DataTable
          columns={buildColumns(agentId, handleEditClick)}
          data={schedules}
          isLoading={isLoading}
          emptyMessage={
            isError ? "Failed to load schedules." : "No schedules yet for this agent."
          }
        />
      </Card>

      <ScheduleFormDrawer
        open={drawerOpen}
        onOpenChange={handleDrawerOpenChange}
        schedule={editingSchedule}
        onSubmit={handleSubmit}
        isSubmitting={isCreating || isUpdating}
      />
    </div>
  );
};
