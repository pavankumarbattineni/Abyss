import { cn } from "@/lib/utils";
import type { ScheduleRunStatus } from "@/types";

const STATUS_STYLES: Record<ScheduleRunStatus, string> = {
  COMPLETED: "bg-success/10 text-success",
  FAILED: "bg-destructive/10 text-destructive",
  RUNNING: "bg-primary/10 text-primary",
  PENDING: "bg-muted text-muted-foreground",
  SKIPPED: "bg-muted text-muted-foreground",
};

interface RunStatusBadgeProps {
  status: ScheduleRunStatus;
}

export function RunStatusBadge({ status }: RunStatusBadgeProps) {
  return (
    <span
      className={cn(
        "rounded-full px-2 py-0.5 text-xs font-medium capitalize",
        STATUS_STYLES[status],
      )}
    >
      {status.toLowerCase()}
    </span>
  );
}
