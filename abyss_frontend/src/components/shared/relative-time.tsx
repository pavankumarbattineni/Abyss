"use client";

import { useNow } from "@/hooks/use-now";
import { formatFullDateTime, formatRelativeTime } from "@/lib/relative-time";
import { parseServerDate } from "@/lib/server-date";
import { cn } from "@/lib/utils";

interface RelativeTimeProps {
  /** ISO timestamp (or Date) to describe. */
  value: string | Date;
  className?: string;
}

/** "Just now" / "5 min ago" / "2 hours ago" / "Nov 8, 2026" -- see
 * formatRelativeTime -- kept current by the shared useNow clock. Hovering
 * shows the exact date and time. */
export function RelativeTime({ value, className }: RelativeTimeProps) {
  const now = useNow();
  const date = parseServerDate(value);
  if (Number.isNaN(date.getTime())) return null;

  return (
    <time
      dateTime={date.toISOString()}
      title={formatFullDateTime(date)}
      className={cn("text-xs whitespace-nowrap text-muted-foreground tabular-nums", className)}
    >
      {formatRelativeTime(date, now)}
    </time>
  );
}
