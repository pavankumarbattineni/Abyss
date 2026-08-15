"use client";

import { useState } from "react";
import Link from "next/link";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import { AgentAvatar } from "@/components/layout";
import { ConfirmDialog } from "@/components/shared";
import { Button, Card, Heading, Skeleton } from "@/components/ui";
import { agentService } from "@/services";
import type { Agent } from "@/types";

interface AgentCardProps {
  agent: Agent;
}

export function AgentCard({ agent }: AgentCardProps) {
  const [deleteOpen, setDeleteOpen] = useState<boolean>(false);
  const queryClient = useQueryClient();

  const { mutate: deleteAgent, isPending: isDeleting } = useMutation({
    mutationFn: () => agentService.deleteAgent(agent.id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["agents"] });
      toast.success("Agent deleted");
      setDeleteOpen(false);
    },
    onError: () => {
      toast.error("Failed to delete agent. Please try again.");
    },
  });

  return (
    <Card className="flex flex-col gap-4 p-4">
      <Link href={`/agents/${agent.id}`} className="flex items-center gap-3">
        <AgentAvatar name={agent.name} />
        <div className="min-w-0">
          <Heading as="div" size="sm" className="truncate hover:underline">
            {agent.name}
          </Heading>
        </div>
      </Link>

      <p className="line-clamp-2 min-h-10 text-sm text-muted-foreground">
        {agent.description}
      </p>

      <div className="flex flex-wrap items-center gap-2 border-t border-border-soft pt-2 mt-auto">
        <span className="text-xs text-muted-foreground">
          {agent.tools.length} tools
        </span>
        <span className="text-xs text-muted-foreground">
          {agent.sub_agents.length} sub-agents
        </span>
        <div className="ml-auto flex gap-1.5">
          <Button variant="outline" size="sm" asChild>
            <Link href={`/agents/${agent.id}/builder`}>Edit</Link>
          </Button>
          <Button
            variant="destructive"
            size="sm"
            onClick={() => setDeleteOpen(true)}
          >
            Delete
          </Button>
        </div>
      </div>

      <ConfirmDialog
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        title="Delete agent"
        description={`Delete "${agent.name}"? This cannot be undone.`}
        confirmLabel="Delete"
        variant="destructive"
        loading={isDeleting}
        onConfirm={() => deleteAgent()}
      />
    </Card>
  );
}

export function AgentCardSkeleton() {
  return (
    <Card className="flex flex-col gap-4 p-4">
      <div className="flex items-center gap-3">
        <Skeleton className="size-9 rounded-lg" />
        <Skeleton className="h-4 w-2/3" />
      </div>

      <div className="flex flex-col gap-1.5">
        <Skeleton className="h-3 w-full" />
        <Skeleton className="h-3 w-4/5" />
      </div>

      <div className="flex items-center gap-2 border-t border-border-soft pt-3">
        <Skeleton className="h-3 w-14" />
        <Skeleton className="h-3 w-20" />
        <div className="ml-auto flex gap-1.5">
          <Skeleton className="h-9 w-14 rounded-lg" />
          <Skeleton className="h-9 w-16 rounded-lg" />
        </div>
      </div>
    </Card>
  );
}
