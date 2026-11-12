"use client";

import { useState } from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { Plus, Search } from "lucide-react";

import { Button, Input } from "@/components/ui";
import { agentService } from "@/services";
import type { Agent } from "@/types";
import { AgentCard, AgentCardSkeleton } from "./agent-card";

export const AgentsPage = () => {
  const [search, setSearch] = useState<string>("");
  const {
    data: agents = [],
    isLoading,
    isError,
  } = useQuery<Agent[]>({
    queryKey: ["agents"],
    queryFn: () => agentService.getAgents(),
  });
  const filtered = agents.filter((agent) =>
    agent.name.toLowerCase().includes(search.toLowerCase()),
  );

  return (
    <div className="flex flex-col gap-5 p-4 sm:p-6">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="mr-auto text-xl font-semibold tracking-tight text-foreground">Agents</h1>
        <div className="relative w-full sm:w-64">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search agents"
            aria-label="Search agents"
            className="pl-9"
          />
        </div>
        <Button size="sm" asChild>
          <Link href="/agents/create">
            <Plus className="size-4" />
            New agent
          </Link>
        </Button>
      </div>

      {isLoading ? (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 6 }).map((_, index) => (
            <AgentCardSkeleton key={index} />
          ))}
        </div>
      ) : isError ? (
        <div className="py-16 text-center text-sm text-destructive" role="alert">
          Your agents didn&apos;t load. Reload the page to try again.
        </div>
      ) : filtered.length > 0 ? (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {filtered.map((agent) => (
            <AgentCard key={agent.id} agent={agent} />
          ))}
        </div>
      ) : agents.length === 0 ? (
        <div className="flex flex-col items-center rounded-xl border border-dashed border-border px-6 py-16 text-center">
          <h2 className="text-lg font-semibold text-foreground">Create your first agent</h2>
          <p className="mt-2 max-w-sm text-sm text-muted-foreground">
            Describe what it should do, pick a model, and connect the tools it needs.
          </p>
          <Button className="mt-6" asChild>
            <Link href="/agents/create">
              <Plus className="size-4" />
              New agent
            </Link>
          </Button>
        </div>
      ) : (
        <div className="py-16 text-center text-sm text-muted-foreground">
          No agents match &ldquo;{search}&rdquo;.
        </div>
      )}
    </div>
  );
};
