"use client";

import { useState } from "react";
import Link from "next/link";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { History, Pencil, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { ActionMenu, ConfirmDialog } from "@/components/shared";
import { Button } from "@/components/ui";
import { scheduleService } from "@/services";
import type { Schedule } from "@/types";

interface ScheduleActionsProps {
  agentId: string;
  schedule: Schedule;
  onEdit: (schedule: Schedule) => void;
}

export function ScheduleActions({ agentId, schedule, onEdit }: ScheduleActionsProps) {
  const [deleteOpen, setDeleteOpen] = useState<boolean>(false);
  const queryClient = useQueryClient();

  const { mutate: deleteSchedule, isPending: isDeleting } = useMutation({
    mutationFn: () => scheduleService.deleteSchedule(agentId, schedule.id),
    onSuccess: (response) => {
      queryClient.invalidateQueries({ queryKey: ["schedules", agentId] });
      toast.success(response.message);
      setDeleteOpen(false);
    },
    onError: () => {
      toast.error("Failed to delete schedule. Please try again.");
    },
  });

  return (
    <div className="flex items-center gap-1">
      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        className="text-muted-foreground hover:text-foreground"
        aria-label="View run history"
        asChild
      >
        <Link href={`/agents/${agentId}/schedules/${schedule.id}/runs`}>
          <History className="size-3.5" />
        </Link>
      </Button>
      <ActionMenu
        items={[
          { label: "Edit", icon: Pencil, onClick: () => onEdit(schedule) },
          {
            label: "Delete",
            icon: Trash2,
            variant: "destructive",
            onClick: () => setDeleteOpen(true),
          },
        ]}
      />
      <ConfirmDialog
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        title="Delete schedule"
        description="Delete this schedule? It will stop running automatically."
        confirmLabel="Delete"
        variant="destructive"
        loading={isDeleting}
        onConfirm={() => deleteSchedule()}
      />
    </div>
  );
}
