"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { ChevronsLeft, Menu, MessageSquare } from "lucide-react";

import { Button, Heading, Skeleton } from "@/components/ui";
import { cn } from "@/lib/utils";
import { threadService } from "@/services";
import type { Agent, Thread } from "@/types";
import { ThreadActions } from "./thread-actions";

const COLLAPSED_WIDTH = 40;

interface ThreadSidebarProps {
  agent?: Agent;
  agentId: string;
  isLoading: boolean;
  width: number;
  collapsed: boolean;
  onCollapsedChange: (collapsed: boolean) => void;
  isResizing: boolean;
}

export function ThreadSidebar({
  agent,
  agentId,
  isLoading,
  width,
  collapsed,
  onCollapsedChange,
  isResizing,
}: ThreadSidebarProps) {
  const pathname = usePathname();

  const { data: threads = [], isLoading: isThreadsLoading } = useQuery<Thread[]>({
    queryKey: ["threads", agentId],
    queryFn: () => threadService.getThreads(agentId),
  });

  return (
    <aside
      style={{ width: collapsed ? COLLAPSED_WIDTH : width }}
      className={cn(
        "flex shrink-0 flex-col overflow-hidden",
        !isResizing && "transition-[width] duration-200",
      )}
    >
      {collapsed ? (
        <div className="flex flex-1 flex-col items-center py-3">
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-label="Expand threads"
            className="text-muted-foreground hover:text-foreground"
            onClick={() => onCollapsedChange(false)}
          >
            <Menu className="size-4" />
          </Button>
        </div>
      ) : (
        <>
          <div className="flex items-center justify-between gap-1 p-4">
            {isLoading ? (
              <Skeleton className="h-5 w-32" />
            ) : (
              <Heading as="div" size="sm" className="truncate">
                {agent?.name ?? "Agent"}
              </Heading>
            )}
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              aria-label="Collapse threads"
              className="ml-auto shrink-0 text-muted-foreground hover:text-foreground"
              onClick={() => onCollapsedChange(true)}
            >
              <ChevronsLeft className="size-4" />
            </Button>
          </div>

          <div className="flex flex-1 flex-col gap-0.5 overflow-y-auto px-2 pb-2">
            {isThreadsLoading ? (
              <div className="flex flex-col gap-1.5 px-2 py-1">
                <Skeleton className="h-8 w-full" />
                <Skeleton className="h-8 w-full" />
                <Skeleton className="h-8 w-full" />
              </div>
            ) : threads.length > 0 ? (
              threads.map((thread) => {
                const isActive = pathname === `/agents/${agentId}/threads/${thread.id}`;
                return (
                  <div
                    key={thread.id}
                    className={cn(
                      "group flex items-center gap-1 rounded-md px-2 py-1.5",
                      isActive ? "bg-muted" : "hover:bg-muted/60",
                    )}
                  >
                    <Link
                      href={`/agents/${agentId}/threads/${thread.id}`}
                      className="flex min-w-0 flex-1 items-center gap-2 text-left"
                    >
                      <MessageSquare className="size-3.5 shrink-0 text-muted-foreground" />
                      <span className="truncate text-sm text-foreground">
                        {thread.title || "Untitled thread"}
                      </span>
                    </Link>
                    <div className="shrink-0 opacity-0 group-hover:opacity-100">
                      <ThreadActions thread={thread} agentId={agentId} isActive={isActive} />
                    </div>
                  </div>
                );
              })
            ) : (
              <div className="flex flex-1 flex-col items-center justify-center gap-1 px-4 text-center">
                <p className="text-sm text-muted-foreground">No threads yet</p>
                <p className="text-xs text-muted-foreground">
                  Start a conversation to create one.
                </p>
              </div>
            )}
          </div>
        </>
      )}
    </aside>
  );
}
