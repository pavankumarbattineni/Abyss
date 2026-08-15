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
    <div className="flex flex-col gap-5 p-6">
      <div className="flex items-center gap-3">
        <div className="relative w-64">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search agents..."
            className="pl-9"
          />
        </div>
        <Button className="ml-auto" size="sm" asChild>
          <Link href="/agents/create">
            <Plus className="size-4" />
            New Agent
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
        <div className="py-16 text-center text-sm text-destructive">
          Failed to load agents.
        </div>
      ) : filtered.length > 0 ? (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {filtered.map((agent) => (
            <AgentCard key={agent.id} agent={agent} />
          ))}
        </div>
      ) : (
        <div className="py-16 text-center text-sm text-muted-foreground">
          No agents match your search.
        </div>
      )}
    </div>
  );
};
