"use client";

import { useMemo, useState } from "react";
import { Ban, Check, ShieldCheck } from "lucide-react";

import { Button } from "@/components/ui";
import { cn } from "@/lib/utils";
import type {
  StreamToolInterrupt,
  ToolApprovalDecision,
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

function toDecision(choice: ToolApprovalDecisionType): ToolApprovalDecision {
  if (choice === "deny") return { type: "reject" };
  return choice === "always_allow" ? { type: "approve", always_allow: true } : { type: "approve" };
}

export function ToolApprovalPanel({
  interrupts,
  isSubmitting = false,
  onSubmit,
}: ToolApprovalPanelProps) {
  const [decisions, setDecisions] = useState<Record<string, ToolApprovalDecisionType>>({});

  // Decisions are positional per interrupt, so each call is keyed by interrupt id + index.
  const allToolCalls = useMemo(
    () =>
      interrupts.flatMap((interrupt) =>
        interrupt.action_requests.map((action, index) => ({
          key: `${interrupt.interrupt_id}:${index}`,
          action,
        })),
      ),
    [interrupts],
  );
  const isComplete = allToolCalls.every(({ key }) => decisions[key]);

  const handleSubmit = () => {
    const approvals: ToolApprovalPayload[] = interrupts.map((interrupt) => ({
      interrupt_id: interrupt.interrupt_id,
      decisions: interrupt.action_requests.map((_, index) =>
        toDecision(decisions[`${interrupt.interrupt_id}:${index}`]),
      ),
    }));
    onSubmit(approvals);
  };

  return (
    <div className="flex flex-col gap-3 rounded-2xl border border-warning/30 bg-warning/5 p-4">
      <p className="text-sm font-medium text-foreground">Approval needed before continuing</p>

      <div className="flex flex-col gap-2.5">
        {allToolCalls.map(({ key, action }) => (
          <div
            key={key}
            className="flex flex-col gap-2 rounded-lg border border-border-soft bg-surface-raised p-3"
          >
            <span className="font-mono text-xs font-medium text-foreground">
              {action.name}
            </span>
            {Object.keys(action.args).length > 0 && (
              <pre className="overflow-x-auto rounded-md bg-muted/50 p-2 text-xs text-muted-foreground">
                {JSON.stringify(action.args, null, 2)}
              </pre>
            )}
            <div className="flex flex-wrap gap-1.5">
              {DECISION_OPTIONS.map((option) => {
                const Icon = option.icon;
                const isActive = decisions[key] === option.value;
                return (
                  <button
                    key={option.value}
                    type="button"
                    disabled={isSubmitting}
                    onClick={() =>
                      setDecisions((prev) => ({
                        ...prev,
                        [key]: option.value,
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
