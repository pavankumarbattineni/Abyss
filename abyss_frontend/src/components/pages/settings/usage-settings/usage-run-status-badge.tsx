import { cn } from "@/lib/utils";
import type { UsageRunStatus } from "@/types";

const STATUS_STYLES: Record<UsageRunStatus, string> = {
  COMPLETED: "bg-success/10 text-success",
  FAILED: "bg-destructive/10 text-destructive",
  RUNNING: "bg-primary/15 text-sage-text",
  CANCELLED: "bg-muted text-muted-foreground",
};

interface UsageRunStatusBadgeProps {
  status: UsageRunStatus;
}

export function UsageRunStatusBadge({ status }: UsageRunStatusBadgeProps) {
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
