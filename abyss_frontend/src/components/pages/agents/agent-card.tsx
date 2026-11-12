"use client";

import { useState } from "react";
import Link from "next/link";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import { AgentAvatar } from "@/components/layout";
import { ConfirmDialog } from "@/components/shared";
import { Button, Card, Heading, Skeleton } from "@/components/ui";
import { cn } from "@/lib/utils";
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
      toast.error("The agent wasn't deleted. Try again.");
    },
  });

  const summary = agentSummary(agent);
  const specialists = agent.sub_agents.length;
  const tools = agent.tools.length;

  return (
    // The name link stretches over the whole card (after:inset-0), so the
    // card opens the chat; Edit/Delete sit above it (relative z-10).
    <Card className="group relative flex flex-col gap-3 p-4 transition-colors focus-within:border-primary hover:border-primary">
      <div className="flex items-center gap-3">
        <AgentAvatar name={agent.name} />
        <Link
          href={`/agents/${agent.id}`}
          className="min-w-0 rounded-sm after:absolute after:inset-0 after:rounded-[inherit] focus-visible:outline-none"
        >
          <Heading as="div" size="sm" className="truncate">
            {agent.name}
          </Heading>
        </Link>
      </div>

      <p
        className={cn(
          "line-clamp-3 min-h-15 text-sm leading-5",
          summary.isFallback ? "text-muted-foreground italic" : "text-muted-foreground",
        )}
      >
        {summary.text}
      </p>

      <div className="mt-auto flex flex-wrap items-center gap-x-3 gap-y-2 border-t border-border pt-3">
        <span className="text-xs text-muted-foreground">
          {plural(specialists, "specialist")} · {plural(tools, "tool")}
        </span>
        <div className="relative z-10 ml-auto flex gap-1.5">
          <Button variant="outline" size="sm" asChild>
            <Link href={`/agents/${agent.id}/builder`}>Edit</Link>
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="text-destructive hover:bg-destructive/10 hover:text-destructive"
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
        description={`Delete "${agent.name}" with its specialists and chat history? This can't be undone.`}
        confirmLabel="Delete agent"
        variant="destructive"
        loading={isDeleting}
        onConfirm={() => deleteAgent()}
      />
    </Card>
  );
}

function plural(count: number, word: string): string {
  return `${count} ${word}${count === 1 ? "" : "s"}`;
}

/** The description, or else the start of the instructions, so no card is blank. */
function agentSummary(agent: Agent): { text: string; isFallback: boolean } {
  const description = (agent.description ?? "").trim();
  if (description) return { text: description, isFallback: false };
  const instructions = (agent.system_prompt ?? "").replace(/\s+/g, " ").trim();
  if (instructions) return { text: instructions, isFallback: false };
  return { text: "No description yet. Open Edit to describe what this agent does.", isFallback: true };
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

      <div className="flex items-center gap-2 border-t border-border pt-3">
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
