"use client";

import { useMemo, useState } from "react";
import { Ban, Check, ShieldCheck } from "lucide-react";

import { Button } from "@/components/ui";
import { cn } from "@/lib/utils";
import type {
  StreamToolInterrupt,
  ToolApprovalDecisionType,
  ToolApprovalPayload,
} from "@/types";

interface ToolApprovalPanelProps {
  interrupts: StreamToolInterrupt[];
  isSubmitting?: boolean;
  onSubmit: (approvals: ToolApprovalPayload[]) => void;
}

const DECISION_OPTIONS: {
  value: ToolApprovalDecisionType;
  label: string;
  icon: React.ElementType;
}[] = [
  { value: "allow_once", label: "Allow once", icon: Check },
  { value: "always_allow", label: "Always allow", icon: ShieldCheck },
  { value: "deny", label: "Deny", icon: Ban },
];

export function ToolApprovalPanel({
  interrupts,
  isSubmitting = false,
  onSubmit,
}: ToolApprovalPanelProps) {
  const [decisions, setDecisions] = useState<Record<string, ToolApprovalDecisionType>>({});

  const allToolCalls = useMemo(
    () => interrupts.flatMap((interrupt) => interrupt.tool_calls),
    [interrupts],
  );
  const isComplete = allToolCalls.every((toolCall) => decisions[toolCall.tool_call_id]);

  const handleSubmit = () => {
    const approvals: ToolApprovalPayload[] = interrupts.map((interrupt) => ({
      interrupt_id: interrupt.interrupt_id,
      decisions: interrupt.tool_calls.map((toolCall) => ({
        tool_call_id: toolCall.tool_call_id,
        decision: decisions[toolCall.tool_call_id],
      })),
    }));
    onSubmit(approvals);
  };

  return (
    <div className="flex flex-col gap-3 rounded-2xl border border-warning/30 bg-warning/5 p-4">
      <p className="text-sm font-medium text-foreground">Approval needed before continuing</p>

      <div className="flex flex-col gap-2.5">
        {allToolCalls.map((toolCall) => (
          <div
            key={toolCall.tool_call_id}
            className="flex flex-col gap-2 rounded-lg border border-border-soft bg-surface-raised p-3"
          >
            <span className="font-mono text-xs font-medium text-foreground">
              {toolCall.tool_name}
            </span>
            {Object.keys(toolCall.args).length > 0 && (
              <pre className="overflow-x-auto rounded-md bg-muted/50 p-2 text-xs text-muted-foreground">
                {JSON.stringify(toolCall.args, null, 2)}
              </pre>
            )}
            <div className="flex flex-wrap gap-1.5">
              {DECISION_OPTIONS.map((option) => {
                const Icon = option.icon;
                const isActive = decisions[toolCall.tool_call_id] === option.value;
                return (
                  <button
                    key={option.value}
                    type="button"
                    disabled={isSubmitting}
                    onClick={() =>
                      setDecisions((prev) => ({
                        ...prev,
                        [toolCall.tool_call_id]: option.value,
                      }))
                    }
                    className={cn(
                      "inline-flex items-center gap-1.5 rounded-md border border-border px-2.5 py-1.5 text-xs font-medium text-muted-foreground transition-colors disabled:opacity-50",
                      isActive &&
                        (option.value === "deny"
                          ? "border-destructive bg-destructive/10 text-destructive"
                          : "border-success bg-success/10 text-success"),
                    )}
                  >
                    <Icon className="size-3.5" />
                    {option.label}
                  </button>
                );
              })}
            </div>
          </div>
        ))}
      </div>

      <Button
        type="button"
        size="sm"
        className="self-end"
        disabled={!isComplete}
        loading={isSubmitting}
        onClick={handleSubmit}
      >
        Submit
      </Button>
    </div>
  );
}
