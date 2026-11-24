"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ChevronDown, MessageSquare } from "lucide-react";

import { Button, Popover, PopoverContent, PopoverTrigger, Skeleton } from "@/components/ui";
import { ThreadTooltip } from "@/components/shared/thread-tooltip";
import { cn } from "@/lib/utils";
import { threadService } from "@/services";
import type { Thread } from "@/types";
import { threadLabel } from "@/lib/threads";

interface ChatThreadPopoverProps {
  agentId: string;
  activeThreadId?: string;
  onSelectThread: (threadId: string) => void;
}

export function ChatThreadPopover({
  agentId,
  activeThreadId,
  onSelectThread,
}: ChatThreadPopoverProps) {
  const { data: threads = [], isLoading } = useQuery<Thread[]>({
    queryKey: ["threads", agentId],
    queryFn: () => threadService.getThreads(agentId),
  });

  const activeThread = threads.find((thread) => thread.id === activeThreadId);
  const [open, setOpen] = useState(false);

  return (
    <div className="flex items-center justify-between gap-2 border-b border-border-soft px-3 py-2">
      {activeThread ? (
        <ThreadTooltip thread={activeThread} side="bottom">
          <span tabIndex={0} className="truncate rounded-sm text-sm font-medium text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none">
            {threadLabel(activeThread)}
          </span>
        </ThreadTooltip>
      ) : (
        <span className="truncate text-sm font-medium text-foreground">
          {activeThreadId ? threadLabel(null) : "New conversation"}
        </span>
      )}
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-label="Switch thread"
            className="shrink-0 text-muted-foreground hover:text-foreground"
          >
            <ChevronDown className="size-3.5" />
          </Button>
        </PopoverTrigger>
        <PopoverContent
          align="end"
          className="w-64 gap-0.5 p-1"
          // Keep focus on the trigger, so the first thread's tooltip doesn't pop up on open.
          onOpenAutoFocus={(event) => event.preventDefault()}
        >
          {isLoading ? (
            <div className="flex flex-col gap-1.5 p-2">
              <Skeleton className="h-4 w-full" />
              <Skeleton className="h-4 w-3/4" />
            </div>
          ) : threads.length > 0 ? (
            threads.map((thread) => (
              <ThreadTooltip key={thread.id} thread={thread}>
              <button
                type="button"
                onClick={() => {
                  onSelectThread(thread.id);
                  setOpen(false);
                }}
                className={cn(
                  "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-muted",
                  thread.id === activeThreadId
                    ? "bg-accent font-medium text-foreground"
                    : "text-foreground",
                )}
              >
                <MessageSquare className="size-3.5 shrink-0 text-muted-foreground" />
                <span className="truncate">{threadLabel(thread)}</span>
              </button>
              </ThreadTooltip>
            ))
          ) : (
            <p className="px-2 py-1.5 text-sm text-muted-foreground">No threads yet</p>
          )}
        </PopoverContent>
      </Popover>
    </div>
  );
}
