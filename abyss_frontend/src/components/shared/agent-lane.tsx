"use client";

import { useState } from "react";
import { CheckCircle2, ChevronDown, ChevronRight, Loader2, XCircle } from "lucide-react";

import type { AgentLane as AgentLaneData } from "@/types";
import { ToolCallChip } from "./tool-call-chip";

interface AgentLaneProps {
  lane: AgentLaneData;
}

export function AgentLane({ lane }: AgentLaneProps) {
  const [expanded, setExpanded] = useState<boolean>(lane.status === "running");
  const toolCallCount = lane.segments.filter((segment) => segment.kind === "tool_call").length;

  return (
    <div className="min-w-0 rounded-lg border border-border-soft bg-surface-raised/50 px-3 py-2">
      <button
        type="button"
        onClick={() => setExpanded((prev) => !prev)}
        className="flex w-full items-center gap-2 text-left text-sm"
      >
        {lane.status === "running" ? (
          <Loader2 className="size-3.5 shrink-0 animate-spin text-muted-foreground" />
        ) : lane.status === "failed" ? (
          <XCircle className="size-3.5 shrink-0 text-destructive" />
        ) : (
          <CheckCircle2 className="size-3.5 shrink-0 text-muted-foreground" />
        )}
        <span className="font-medium">{lane.agentName}</span>
        {toolCallCount > 0 && (
          <span className="text-xs text-muted-foreground">
            {toolCallCount} tool call{toolCallCount > 1 ? "s" : ""}
          </span>
        )}
        <span className="ml-auto text-muted-foreground">
          {expanded ? <ChevronDown className="size-3.5" /> : <ChevronRight className="size-3.5" />}
        </span>
      </button>

      {expanded && (
        <div className="mt-2 flex min-w-0 flex-col gap-2 pl-6">
          {lane.segments.map((segment) =>
            segment.kind === "thought" ? (
              <p
                key={segment.id}
                className="text-[13px] whitespace-pre-wrap text-muted-foreground"
              >
                {segment.content}
              </p>
            ) : (
              <ToolCallChip key={segment.id} toolCall={segment.toolCall} />
            ),
          )}
        </div>
      )}
    </div>
  );
}
