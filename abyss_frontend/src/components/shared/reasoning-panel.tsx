"use client";

import { useEffect, useRef, useState } from "react";
import { ChevronDown, ChevronRight, Infinity as InfinityIcon } from "lucide-react";

import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui";
import type { ReasoningTrace } from "@/types";
import { AgentLane } from "./agent-lane";

function Thinking() {
  return (
    <span className="relative inline-flex size-5 shrink-0 items-center justify-center">
      <InfinityIcon className="size-5 text-muted-foreground" />
      <span className="absolute inset-0 flex items-center justify-center">
        <span
          className="size-2 animate-ping rounded-full bg-primary"
          style={{ animationDuration: "1.5s" }}
        />
      </span>
    </span>
  );
}

interface ReasoningPanelProps {
  trace: ReasoningTrace;
  isStreaming: boolean;
}

export function ReasoningPanel({ trace, isStreaming }: ReasoningPanelProps) {
  const [open, setOpen] = useState<boolean>(isStreaming);
  const wasStreamingRef = useRef<boolean>(isStreaming);

  useEffect(() => {
    if (wasStreamingRef.current && !isStreaming) {
      setOpen(false);
    } else if (!wasStreamingRef.current && isStreaming) {
      setOpen(true);
    }
    wasStreamingRef.current = isStreaming;
  }, [isStreaming]);

  if (trace.order.length === 0 && !trace.synthesis) return null;

  const agentCount = trace.order.length;
  const summary = isStreaming
    ? "Thinking…"
    : `Thought using ${agentCount} agent${agentCount === 1 ? "" : "s"}`;

  return (
    <Collapsible open={open} onOpenChange={setOpen} className="mb-2 w-full min-w-0">
      <CollapsibleTrigger className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground">
        {isStreaming && <Thinking />}
        {summary}
        {open ? <ChevronDown className="size-3" /> : <ChevronRight className="size-3" />}
      </CollapsibleTrigger>
      <CollapsibleContent className="mt-2 flex min-w-0 flex-col gap-2">
        {trace.order.map((agentName) => (
          <AgentLane key={agentName} lane={trace.lanes[agentName]} />
        ))}
        {trace.synthesis && (
          <p className="text-xs text-muted-foreground">
            Combining results from {trace.synthesis.agentsCompleted.join(", ")}
          </p>
        )}
      </CollapsibleContent>
    </Collapsible>
  );
}
