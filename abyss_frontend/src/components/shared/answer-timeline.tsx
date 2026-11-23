"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import { BookOpenText, Brain, ChevronRight, Loader2, Shapes, UsersRound, Wrench } from "lucide-react";

import { answerParts, humanizeIdentifier, mainAgentName } from "@/lib/reasoning";
import { cn } from "@/lib/utils";
import type { ReasoningTrace, TimelineItem } from "@/types";
import { CopyButton } from "./copy-button";
import { MarkdownContent } from "./markdown-content";

interface AnswerTimelineProps {
  /** The answer text (streamed so far, or saved). */
  content: string;
  trace: ReasoningTrace;
  isStreaming: boolean;
  /** Stream labels -> display names: the main agent's label ("agent") and
   * each specialist's tool name map to the names the user gave them. */
  agentNames?: Record<string, string>;
}

/**
 * An answer shown the way it happened, as in Claude: the text the agent
 * wrote, and -- at the point where it took them -- its steps (thinking, tool
 * calls, specialists' work) as a quiet one-line group. Each group appears as
 * its first step starts and grows while it runs (open, with the live step
 * marked); once the agent writes again it folds to its one-line summary and
 * the text continues below it. Nothing is gathered at the top: a turn that
 * searches, answers part one, searches again and answers part two reads in
 * exactly that order, live and after a reload (see lib/reasoning answerParts).
 */
export function AnswerTimeline({ content, trace, isStreaming, agentNames = {} }: AnswerTimelineProps) {
  const main = mainAgentName(trace);
  const displayName = (label: string): string =>
    agentNames[label] ?? (label === main ? "Agent" : humanizeIdentifier(label));
  const isMain = (label: string): boolean => label === main;

  const parts = useMemo(() => {
    // A thought that never got any text (the model went straight to acting) has nothing to show.
    const items = trace.timeline.filter((item) => !(item.kind === "thought" && !item.content.trim() && !isStreaming));
    return answerParts(content, items);
  }, [content, trace.timeline, isStreaming]);

  return (
    <div className="flex min-w-0 flex-col">
      {parts.map((part, index) => {
        const isLast = index === parts.length - 1;
        return part.kind === "text" ? (
          <MarkdownContent key={`text-${index}`} content={part.text} isStreaming={isStreaming && isLast} />
        ) : (
          <ActivityGroup
            key={`steps-${index}`}
            items={part.items}
            trace={trace}
            live={isStreaming && isLast}
            displayName={displayName}
            isMain={isMain}
            // Space from the text around it; none above the very first part.
            className={cn(index > 0 && "mt-1", !isLast && "mb-4")}
          />
        );
      })}
    </div>
  );
}

function ActivityGroup({
  items,
  trace,
  live,
  displayName,
  isMain,
  className,
}: {
  items: TimelineItem[];
  trace: ReasoningTrace;
  live: boolean;
  displayName: (label: string) => string;
  isMain: (label: string) => boolean;
  className?: string;
}) {
  // Open while it's what the agent is doing now; folds away once it writes again.
  const [open, setOpen] = useState<boolean>(live);
  const wasLive = useRef<boolean>(live);
  useEffect(() => {
    if (wasLive.current !== live) setOpen(live);
    wasLive.current = live;
  }, [live]);

  const isRunning = (item: TimelineItem, index: number): boolean =>
    item.kind === "tool_call"
      ? item.status === "running"
      : item.kind === "delegation"
        ? trace.agents[item.target]?.status === "running"
        : live && index === items.length - 1;

  const title = live ? currentActivity(items.at(-1), displayName, isMain) : summarize(items, displayName);

  return (
    <div className={cn("min-w-0 font-sans", className)}>
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        className="group/steps flex max-w-full items-center gap-1.5 rounded-md py-1 text-left text-sm text-muted-foreground transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
      >
        {live && (
          <span className="relative mr-0.5 flex size-2 shrink-0" aria-hidden="true">
            <span className="absolute inline-flex size-full animate-ping rounded-full bg-highlight opacity-60" />
            <span className="relative inline-flex size-2 rounded-full bg-highlight" />
          </span>
        )}
        <span className={cn("truncate", live && "text-foreground/80")}>{title}</span>
        <ChevronRight
          className={cn("size-4 shrink-0 transition-transform", open && "rotate-90")}
          aria-hidden="true"
        />
      </button>

      {open && (
        <ol className="mt-1.5 min-w-0 divide-y divide-border-soft overflow-hidden rounded-xl border border-border-soft">
          {items.map((item, index) => (
            <StepRow
              key={item.id}
              item={item}
              running={isRunning(item, index)}
              nested={!!trace.agents[item.agent]?.isDelegated}
              displayName={displayName}
            />
          ))}
        </ol>
      )}
    </div>
  );
}

/** One step: a single line (what, on what, how long) that opens to its details. */
function StepRow({
  item,
  running,
  nested,
  displayName,
}: {
  item: TimelineItem;
  running: boolean;
  nested: boolean;
  displayName: (label: string) => string;
}) {
  const [expanded, setExpanded] = useState<boolean>(false);
  const call = item.kind === "tool_call" ? describeCall(item.toolName, item.input) : null;
  // Distinct marks: thinking, a specialist, a skill (a playbook it followed), a
  // visual format's spec, and any other tool.
  const Icon =
    item.kind === "thought"
      ? Brain
      : item.kind === "delegation"
        ? UsersRound
        : call?.type === "skill"
          ? BookOpenText
          : call?.type === "format"
            ? Shapes
            : Wrench;
  const who = nested ? `${displayName(item.agent)} · ` : "";

  let verb: string;
  let subject = "";
  let preview = "";
  let hasDetails: boolean;
  if (item.kind === "thought") {
    verb = running ? "Thinking" : "Thought";
    preview = running ? lastLine(item.content) : firstLine(item.content);
    hasDetails = !!item.content.trim();
  } else if (item.kind === "delegation") {
    verb = running ? "Asking" : "Asked";
    subject = displayName(item.target);
    preview = item.task;
    hasDetails = !!item.task;
  } else if (call?.type === "skill") {
    // A skill that loaded comes back as <skill name="...">; anything else (a
    // misspelt or deleted skill) was only looked for.
    verb = running ? "Reading skill" : skillLoaded(item.output) ? "Followed skill" : "Looked for skill";
    subject = call.name;
    hasDetails = !!item.output;
  } else if (call?.type === "format") {
    verb = running ? "Preparing" : "Prepared";
    subject = call.name;
    hasDetails = false;
  } else {
    verb = running ? "Using" : "Used";
    subject = humanizeIdentifier(item.toolName);
    preview = inputPreview(item.input);
    hasDetails = !!(item.input || item.output);
  }
  const duration = item.kind !== "delegation" ? formatDuration(item.durationMs) : null;

  return (
    <li className="min-w-0">
      <button
        type="button"
        disabled={!hasDetails}
        onClick={() => setExpanded((value) => !value)}
        aria-expanded={hasDetails ? expanded : undefined}
        className={cn(
          "flex w-full min-w-0 items-center gap-2.5 px-3 py-2 text-left text-[13px] transition-colors focus-visible:bg-muted/50 focus-visible:outline-none enabled:hover:bg-muted/40",
          nested && "pl-8",
        )}
      >
        {running ? (
          <Loader2 className="size-3.5 shrink-0 animate-spin text-muted-foreground" aria-hidden="true" />
        ) : (
          <Icon className="size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
        )}
        <span className="shrink-0 text-muted-foreground">
          {who}
          {verb}
        </span>
        {subject && <span className="shrink-0 font-medium text-foreground">{subject}</span>}
        {preview && <span className="min-w-0 flex-1 truncate text-foreground/75">{preview}</span>}
        {!preview && <span className="flex-1" />}
        {duration && <span className="shrink-0 text-xs text-muted-foreground tabular-nums">{duration}</span>}
        {hasDetails && (
          <ChevronRight
            className={cn("size-3.5 shrink-0 text-muted-foreground transition-transform", expanded && "rotate-90")}
            aria-hidden="true"
          />
        )}
      </button>
      {expanded && hasDetails && (
        <div className={cn("min-w-0 px-3 pb-3 pl-9", nested && "pl-14")}>
          {item.kind === "thought" && (
            <div className="text-[13px] leading-relaxed wrap-break-word text-muted-foreground">
              <ReactMarkdown remarkPlugins={[remarkGfm]} components={THOUGHT_MARKDOWN}>
                {tidyThought(item.content)}
              </ReactMarkdown>
            </div>
          )}
          {item.kind === "delegation" && (
            <p className="text-[13px] leading-relaxed wrap-break-word whitespace-pre-wrap text-muted-foreground">{item.task}</p>
          )}
          {item.kind === "tool_call" && (
            <div className="flex min-w-0 flex-col gap-1.5">
              {item.input && <ToolPayload label="Input" text={item.input} />}
              {item.output && <ToolPayload label="Result" text={item.output} />}
            </div>
          )}
        </div>
      )}
    </li>
  );
}

/** What the agent is doing right now, for a group that's still running. */
function currentActivity(
  item: TimelineItem | undefined,
  name: (label: string) => string,
  isMain: (label: string) => boolean,
): string {
  if (!item) return "Thinking…";
  switch (item.kind) {
    case "delegation":
      return `Asking ${name(item.target)}…`;
    case "tool_call": {
      if (item.status !== "running") return "Thinking…";
      const call = describeCall(item.toolName, item.input);
      return call.type === "skill"
        ? `Reading skill ${call.name}…`
        : call.type === "format"
          ? `Preparing ${call.name}…`
          : `Using ${humanizeIdentifier(item.toolName)}…`;
    }
    default:
      return isMain(item.agent) ? "Thinking…" : `${name(item.agent)} is thinking…`;
  }
}

/** A finished group in one line: the tools used and specialists asked, or --
 * when it was only thinking -- what the thinking was about. */
function summarize(items: TimelineItem[], name: (label: string) => string): string {
  const toolCounts = new Map<string, number>();
  const asked: string[] = [];
  const skills: string[] = [];
  for (const item of items) {
    if (item.kind === "tool_call") {
      const call = describeCall(item.toolName, item.input);
      if (call.type === "skill") {
        if (skillLoaded(item.output) && !skills.includes(call.name)) skills.push(call.name);
        continue;
      }
      if (call.type === "format") continue; // preparing a visual is part of answering, not a lookup
      const tool = humanizeIdentifier(item.toolName);
      toolCounts.set(tool, (toolCounts.get(tool) ?? 0) + 1);
    } else if (item.kind === "delegation" && !asked.includes(name(item.target))) {
      asked.push(name(item.target));
    }
  }
  const tools = [...toolCounts].map(([tool, count]) => (count > 1 ? `${tool} ×${count}` : tool));
  const phrases = [
    skills.length > 0 && `followed skill ${listOf(skills)}`,
    asked.length > 0 && `asked ${listOf(asked)}`,
    tools.length > 0 && `used ${listOf(tools)}`,
  ].filter((phrase): phrase is string => !!phrase);
  if (phrases.length > 0) {
    const text = phrases.join(", ");
    return text.charAt(0).toUpperCase() + text.slice(1);
  }
  const thought = items.find((item) => item.kind === "thought" && item.content.trim());
  return thought?.kind === "thought" ? firstLine(thought.content) || "Thought" : "Thought";
}

/** What a tool call was: loading one of the user's skills (abyss_agents/skills.py
 * load_skill), getting a visual format's spec (get_visual_format), or a tool. */
function describeCall(toolName: string, input: string | undefined): { type: "skill" | "format" | "tool"; name: string } {
  const arg = (() => {
    try {
      const value: unknown = JSON.parse(input ?? "");
      return value && typeof value === "object" ? String((value as { name?: unknown }).name ?? "") : "";
    } catch {
      return "";
    }
  })();
  if (toolName === "load_skill") return { type: "skill", name: arg || "a skill" };
  if (toolName === "get_visual_format") return { type: "format", name: arg ? `${humanizeIdentifier(arg)} visual` : "a visual" };
  if (toolName === "search_images") return { type: "tool", name: "Wikimedia image search" };
  return { type: "tool", name: humanizeIdentifier(toolName) };
}

/** load_skill returns the skill wrapped in <skill name="..."> when it loaded. */
function skillLoaded(output: string | undefined): boolean {
  return !!output?.trimStart().startsWith("<skill");
}

function listOf(names: string[]): string {
  return names.length <= 3 ? names.join(", ") : `${names.slice(0, 3).join(", ")} and ${names.length - 3} more`;
}

/** The first line of a thought, without Markdown marks: its gist. */
function firstLine(text: string): string {
  const line = text.split("\n").map((l) => l.trim()).find(Boolean) ?? "";
  return plain(line);
}

/** The newest line of a thought still being written. */
function lastLine(text: string): string {
  const lines = text.split("\n").map((l) => l.trim()).filter(Boolean);
  return plain(lines.at(-1) ?? "");
}

function plain(text: string): string {
  return text.replace(/[*_`#>]+/g, "").replace(/\s+/g, " ").trim();
}

/** A tool call's input in a few words: its argument values, not raw JSON. */
function inputPreview(input: string | undefined): string {
  if (!input) return "";
  try {
    const value: unknown = JSON.parse(input);
    if (value && typeof value === "object") {
      return Object.values(value as Record<string, unknown>)
        .filter((v) => typeof v === "string" || typeof v === "number")
        .join(" · ");
    }
    return String(value);
  } catch {
    return input;
  }
}

function formatDuration(ms: number | undefined): string | null {
  if (!ms) return null;
  return ms < 1000 ? `${ms} ms` : `${(ms / 1000).toFixed(1)} s`;
}

/** Thoughts can be Markdown (native model reasoning, e.g. Gemini's "**Title**"
 * + paragraph summaries): render it compactly -- bold titles, even spacing,
 * no raw asterisks or runs of blank lines. */
const THOUGHT_MARKDOWN: Components = {
  p: ({ children }) => <p className="mt-1.5 first:mt-0">{children}</p>,
  strong: ({ children }) => <strong className="font-medium text-foreground">{children}</strong>,
  em: ({ children }) => <em>{children}</em>,
  ul: ({ children }) => <ul className="mt-1.5 list-disc space-y-0.5 pl-4 first:mt-0">{children}</ul>,
  ol: ({ children }) => <ol className="mt-1.5 list-decimal space-y-0.5 pl-4 first:mt-0">{children}</ol>,
  li: ({ children }) => <li>{children}</li>,
  h1: ({ children }) => <p className="mt-2 font-medium text-foreground first:mt-0">{children}</p>,
  h2: ({ children }) => <p className="mt-2 font-medium text-foreground first:mt-0">{children}</p>,
  h3: ({ children }) => <p className="mt-2 font-medium text-foreground first:mt-0">{children}</p>,
  code: ({ children }) => <code className="rounded bg-muted px-1 font-mono text-[12px]">{children}</code>,
  pre: ({ children }) => <pre className="mt-1.5 overflow-x-auto rounded bg-muted p-2 text-[12px]">{children}</pre>,
  a: ({ children }) => <span className="underline underline-offset-2">{children}</span>,
};

/** Trim each line and collapse runs of blank lines into one paragraph break. */
function tidyThought(text: string): string {
  return text
    .split("\n")
    .map((line) => line.trimEnd())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function ToolPayload({ label, text }: { label: string; text: string }) {
  return (
    <div className="min-w-0 overflow-hidden rounded-md border border-border-soft">
      <div className="flex items-center justify-between border-b border-border-soft bg-muted/60 px-2 py-0.5 text-[11px] text-muted-foreground">
        {label}
        <CopyButton label={`Copy ${label.toLowerCase()}`} text={text} />
      </div>
      <pre className="max-h-48 overflow-auto p-2 font-mono text-xs whitespace-pre-wrap wrap-break-word text-muted-foreground">
        {text}
      </pre>
    </div>
  );
}
