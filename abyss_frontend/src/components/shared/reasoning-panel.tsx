"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Brain, Check, ChevronDown, Loader2, UsersRound, Wrench } from "lucide-react";

import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui";
import { humanizeIdentifier, mainAgentName } from "@/lib/reasoning";
import { cn } from "@/lib/utils";
import type { ReasoningTrace, TimelineItem } from "@/types";
import { CopyButton } from "./copy-button";

/** Thoughts longer than this start collapsed to a few lines. */
const LONG_THOUGHT_CHARS = 280;

interface ReasoningPanelProps {
  trace: ReasoningTrace;
  isStreaming: boolean;
  /** Stream labels -> display names: the main agent's label ("agent") and
   * each specialist's tool name map to the names the user gave them. */
  agentNames?: Record<string, string>;
}

/**
 * How the agent got to its answer, as one chronological timeline: the main
 * agent's thinking, the tasks it handed to specialists (whose own work is
 * nested under them), and every tool call. Collapsed to a one-line summary
 * once the answer is done; while running, the summary shows what is
 * happening right now.
 */
export function ReasoningPanel({ trace, isStreaming, agentNames = {} }: ReasoningPanelProps) {
  const [open, setOpen] = useState<boolean>(isStreaming);
  const wasStreamingRef = useRef<boolean>(isStreaming);

  // Open while the answer streams, fold away once it's done.
  useEffect(() => {
    if (wasStreamingRef.current !== isStreaming) setOpen(isStreaming);
    wasStreamingRef.current = isStreaming;
  }, [isStreaming]);

  const main = mainAgentName(trace);
  const displayName = (label: string): string =>
    agentNames[label] ?? (label === main ? "Agent" : humanizeIdentifier(label));

  const items = useMemo(
    () =>
      trace.timeline.filter(
        (item) => !(item.kind === "thought" && !item.content.trim() && !isStreaming),
      ),
    [trace.timeline, isStreaming],
  );
  if (items.length === 0 && !isStreaming) return null;

  const specialists = new Set(
    trace.timeline.flatMap((item) => (item.kind === "delegation" ? [item.target] : [])),
  ).size;
  const toolCalls = trace.timeline.filter((item) => item.kind === "tool_call").length;
  const summaryParts = [
    specialists > 0 && `consulted ${specialists} specialist${specialists === 1 ? "" : "s"}`,
    toolCalls > 0 && `${toolCalls} tool call${toolCalls === 1 ? "" : "s"}`,
  ].filter(Boolean);
  const summary = isStreaming
    ? currentActivity(items.at(-1), displayName)
    : ["Reasoning", ...summaryParts].join(" · ");

  return (
    <Collapsible open={open} onOpenChange={setOpen} className="mb-3 w-full min-w-0 font-sans">
      <CollapsibleTrigger
        className="group/summary flex max-w-full items-center gap-2 rounded-md py-0.5 text-xs text-muted-foreground transition-colors hover:text-foreground"
        aria-label={open ? "Hide reasoning" : "Show reasoning"}
      >
        {isStreaming ? (
          <span className="relative flex size-2 shrink-0" aria-hidden="true">
            <span className="absolute inline-flex size-full animate-ping rounded-full bg-highlight opacity-60" />
            <span className="relative inline-flex size-2 rounded-full bg-highlight" />
          </span>
        ) : (
          <Check className="size-3.5 shrink-0 text-sage-text" aria-hidden="true" />
        )}
        <span className="truncate">{summary}</span>
        <ChevronDown
          className={cn("size-3.5 shrink-0 transition-transform", !open && "-rotate-90")}
          aria-hidden="true"
        />
      </CollapsibleTrigger>

      <CollapsibleContent>
        <ol className="relative mt-2 ml-2.5 flex min-w-0 flex-col gap-3 border-l border-border pl-4">
          {items.map((item, index) => {
            const isSpecialist = !!trace.agents[item.agent]?.isDelegated;
            const isLive =
              isStreaming &&
              index === items.length - 1 &&
              trace.agents[item.agent]?.status === "running";
            return (
              <li key={item.id} className={cn("relative min-w-0", isSpecialist && "ml-5")}>
                <StepIcon item={item} isLive={isLive} />
                {item.kind === "thought" && (
                  <ThoughtStep
                    who={displayName(item.agent)}
                    content={item.content}
                    isLive={isLive}
                  />
                )}
                {item.kind === "delegation" && (
                  <DelegationStep target={displayName(item.target)} task={item.task} />
                )}
                {item.kind === "tool_call" && <ToolStep item={item} />}
              </li>
            );
          })}
          {!isStreaming && specialists > 0 && (
            <li className="relative min-w-0">
              <span className="absolute top-0.5 -left-[25px] flex size-[17px] items-center justify-center rounded-full border border-border bg-background">
                <Check className="size-2.5 text-sage-text" aria-hidden="true" />
              </span>
              <p className="text-xs text-muted-foreground">Combined the findings into the answer</p>
            </li>
          )}
        </ol>
      </CollapsibleContent>
    </Collapsible>
  );
}

function currentActivity(item: TimelineItem | undefined, name: (label: string) => string): string {
  if (!item) return "Thinking…";
  switch (item.kind) {
    case "delegation":
      return `Asking ${name(item.target)}…`;
    case "tool_call":
      return item.status === "running" ? `Using ${humanizeIdentifier(item.toolName)}…` : "Thinking…";
    default:
      return `${name(item.agent)} is thinking…`;
  }
}

/** The marker on the timeline rail. */
function StepIcon({ item, isLive }: { item: TimelineItem; isLive: boolean }) {
  const Icon = item.kind === "thought" ? Brain : item.kind === "delegation" ? UsersRound : Wrench;
  const running = isLive || (item.kind === "tool_call" && item.status === "running");
  return (
    <span
      className="absolute top-0.5 -left-[25px] flex size-[17px] items-center justify-center rounded-full border border-border bg-background text-muted-foreground"
      aria-hidden="true"
    >
      {running ? <Loader2 className="size-2.5 animate-spin" /> : <Icon className="size-2.5" />}
    </span>
  );
}

function ThoughtStep({ who, content, isLive }: { who: string; content: string; isLive: boolean }) {
  const text = content.trim();
  const isLong = text.length > LONG_THOUGHT_CHARS;
  const [expanded, setExpanded] = useState<boolean>(false);
  const clamped = isLong && !expanded && !isLive;
  return (
    <div className="min-w-0">
      <p className="text-xs font-medium text-foreground">{who}</p>
      <p
        className={cn(
          "mt-0.5 text-[13px] leading-relaxed whitespace-pre-wrap wrap-break-word text-muted-foreground",
          clamped && "line-clamp-3",
        )}
      >
        {text || "…"}
      </p>
      {isLong && !isLive && (
        <button
          type="button"
          onClick={() => setExpanded((value) => !value)}
          className="mt-0.5 text-xs text-sage-text hover:text-foreground"
        >
          {expanded ? "Show less" : "Show more"}
        </button>
      )}
    </div>
  );
}

function DelegationStep({ target, task }: { target: string; task: string }) {
  const [expanded, setExpanded] = useState<boolean>(false);
  const isLong = task.length > 160;
  return (
    <div className="min-w-0">
      <p className="text-xs text-foreground">
        Asked <span className="font-medium">{target}</span>
      </p>
      {task && (
        <p
          className={cn(
            "mt-0.5 text-[13px] leading-relaxed wrap-break-word text-muted-foreground",
            isLong && !expanded && "line-clamp-2",
          )}
        >
          {task}
        </p>
      )}
      {isLong && (
        <button
          type="button"
          onClick={() => setExpanded((value) => !value)}
          className="mt-0.5 text-xs text-sage-text hover:text-foreground"
        >
          {expanded ? "Show less" : "Show task"}
        </button>
      )}
    </div>
  );
}

function formatDuration(ms: number | undefined): string | null {
  if (!ms) return null;
  return ms < 1000 ? `${ms} ms` : `${(ms / 1000).toFixed(1)} s`;
}

function ToolStep({ item }: { item: Extract<TimelineItem, { kind: "tool_call" }> }) {
  const [expanded, setExpanded] = useState<boolean>(false);
  const hasDetails = !!(item.input || item.output);
  const duration = formatDuration(item.durationMs);
  return (
    <div className="min-w-0">
      <div className="flex flex-wrap items-baseline gap-x-2 text-xs">
        <span className="text-foreground">
          {item.status === "running" ? "Using " : "Used "}
          <span className="font-medium">{humanizeIdentifier(item.toolName)}</span>
        </span>
        {duration && <span className="text-muted-foreground tabular-nums">{duration}</span>}
        {hasDetails && (
          <button
            type="button"
            onClick={() => setExpanded((value) => !value)}
            aria-expanded={expanded}
            className="text-sage-text hover:text-foreground"
          >
            {expanded ? "Hide details" : "Details"}
          </button>
        )}
      </div>
      {expanded && (
        <div className="mt-1.5 flex min-w-0 flex-col gap-1.5">
          {item.input && <ToolPayload label="Input" text={item.input} />}
          {item.output && <ToolPayload label="Result" text={item.output} />}
        </div>
      )}
    </div>
  );
}

function ToolPayload({ label, text }: { label: string; text: string }) {
  return (
    <div className="min-w-0 overflow-hidden rounded-md border border-border">
      <div className="flex items-center justify-between border-b border-border bg-muted px-2 py-0.5 text-[11px] text-muted-foreground">
        {label}
        <CopyButton label={`Copy ${label.toLowerCase()}`} text={text} />
      </div>
      <pre className="max-h-48 overflow-auto bg-card p-2 font-mono text-xs whitespace-pre-wrap wrap-break-word text-muted-foreground">
        {text}
      </pre>
    </div>
  );
}
