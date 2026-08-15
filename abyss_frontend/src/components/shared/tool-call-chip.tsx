"use client";

import { useState } from "react";
import { ChevronDown, ChevronRight, Loader2, Wrench } from "lucide-react";

import type { ToolCallRecord } from "@/types";

interface ToolCallChipProps {
  toolCall: ToolCallRecord;
}

export function ToolCallChip({ toolCall }: ToolCallChipProps) {
  const [expanded, setExpanded] = useState<boolean>(false);
  const hasOutput = !!toolCall.output;

  return (
    <div className="flex min-w-0 flex-col gap-1">
      <button
        type="button"
        onClick={() => setExpanded((prev) => !prev)}
        disabled={!hasOutput}
        className="inline-flex w-fit items-center gap-1 rounded-full border border-border-soft bg-surface-raised px-2 py-0.5 text-xs text-muted-foreground disabled:cursor-default"
      >
        {toolCall.status === "running" ? (
          <Loader2 className="size-3 animate-spin" />
        ) : (
          <Wrench className="size-3" />
        )}
        {toolCall.toolName}
        {hasOutput &&
          (expanded ? (
            <ChevronDown className="size-3" />
          ) : (
            <ChevronRight className="size-3" />
          ))}
      </button>
      {expanded && hasOutput && (
        <pre className="max-h-40 max-w-full overflow-auto rounded-md border border-border-soft bg-muted/60 p-2 text-xs whitespace-pre-wrap wrap-break-word text-muted-foreground">
          {toolCall.output}
        </pre>
      )}
    </div>
  );
}
