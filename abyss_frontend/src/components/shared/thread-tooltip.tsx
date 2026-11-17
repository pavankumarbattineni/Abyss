"use client";

import { formatDistanceStrict } from "date-fns";

import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui";
import { useNow } from "@/hooks/use-now";
import { formatFullDateTime } from "@/lib/relative-time";
import { parseServerDate } from "@/lib/server-date";
import type { Thread } from "@/types";

interface ThreadTooltipProps {
  thread: Pick<Thread, "title" | "created_at"> & Partial<Pick<Thread, "updated_at">>;
  children: React.ReactElement;
  side?: "top" | "right" | "bottom" | "left";
}

/**
 * Wraps a (usually truncated) thread title: the tooltip shows the full title,
 * when the thread was last used (its latest message; the creation time for a
 * thread never used) and how long ago that was ("2 minutes ago"), kept
 * current by the shared clock.
 */
export function ThreadTooltip({ thread, children, side = "right" }: ThreadTooltipProps) {
  const now = useNow();
  const lastUsed = parseServerDate(thread.updated_at ?? thread.created_at);
  const valid = !Number.isNaN(lastUsed.getTime());

  return (
    <Tooltip>
      <TooltipTrigger asChild>{children}</TooltipTrigger>
      <TooltipContent side={side} sideOffset={8} className="flex max-w-72 flex-col items-start gap-0.5 break-words">
        <span className="font-medium">{thread.title || "Untitled thread"}</span>
        {valid && (
          <>
            <span className="text-background/75 tabular-nums">
              Last used <time dateTime={lastUsed.toISOString()}>{formatFullDateTime(lastUsed)}</time>
            </span>
            <span className="text-background/75 tabular-nums">
              {lastUsed > now ? "just now" : formatDistanceStrict(lastUsed, now, { addSuffix: true })}
            </span>
          </>
        )}
      </TooltipContent>
    </Tooltip>
  );
}
