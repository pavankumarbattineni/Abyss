"use client";

import { useState } from "react";
import { AlertTriangle, ExternalLink, Wrench } from "lucide-react";

import { CopyButton } from "@/components/shared/copy-button";
import { formatFullDateTime } from "@/lib/relative-time";
import { parseServerDate } from "@/lib/server-date";
import { formatCost, formatDuration, formatTokens, spanDisplayName, spanTypeStyle } from "@/lib/trace-format";
import { cn } from "@/lib/utils";
import type { TraceMessage, TraceSpan } from "@/types";
import { StatusDot } from "../tracing/trace-table";

type Tab = "input" | "output" | "metadata";

interface SpanInspectorProps {
  span: TraceSpan;
  /** ms from the start of the trace. */
  offsetMs: number;
  langsmithUrl: string | null;
}

export function SpanInspector({ span, offsetMs, langsmithUrl }: SpanInspectorProps) {
  const [tab, setTab] = useState<Tab>("input");
  const style = spanTypeStyle(span.run_type);
  const Icon = style.icon;
  const payload = tab === "input" ? span.inputs : tab === "output" ? span.outputs : span.meta;
  const truncated = (tab === "input" && span.inputs_truncated) || (tab === "output" && span.outputs_truncated);

  return (
    <section aria-label="Span details" className="flex min-w-0 flex-col overflow-hidden rounded-xl border border-border bg-card">
      {/* Identity */}
      <header className="border-b border-border px-4 py-3">
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <span
            className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 font-medium"
            style={{ color: style.color, background: `color-mix(in srgb, ${style.color} 12%, transparent)` }}
          >
            <Icon className="size-3" aria-hidden="true" />
            {style.label}
          </span>
          <StatusDot status={span.status} />
          <span>{span.status === "error" ? "Failed" : span.status === "pending" ? "In progress" : "Succeeded"}</span>
        </div>
        <h2 className="mt-1.5 truncate text-base font-semibold text-foreground" title={span.name}>
          {spanDisplayName(span)}
        </h2>
      </header>

      {/* Measurements */}
      <dl className="grid grid-cols-2 gap-x-4 gap-y-3 border-b border-border px-4 py-3 text-sm">
        <Metric label="Duration" value={formatDuration(span.latency_ms)} />
        <Metric
          label="Started"
          value={`+${formatDuration(offsetMs)}`}
          title={formatFullDateTime(parseServerDate(span.start_time))}
        />
        {span.total_tokens > 0 && (
          <Metric
            label="Tokens"
            value={formatTokens(span.total_tokens)}
            detail={`${formatTokens(span.prompt_tokens)} in · ${formatTokens(span.completion_tokens)} out`}
          />
        )}
        {span.total_cost != null && <Metric label="Cost" value={formatCost(span.total_cost)} />}
        {span.model && (
          <div className="col-span-2 min-w-0">
            <dt className="text-xs text-muted-foreground">Model</dt>
            <dd className="truncate font-mono text-sm text-foreground">{span.model}</dd>
          </div>
        )}
      </dl>

      {span.error && (
        <div role="alert" className="mx-4 mt-3 rounded-lg border border-destructive/30 bg-destructive/5 p-3">
          <p className="flex items-center gap-1.5 text-xs font-semibold text-destructive">
            <AlertTriangle className="size-3.5" aria-hidden="true" /> Error
          </p>
          <pre className="mt-1 max-h-40 overflow-auto font-mono text-xs whitespace-pre-wrap break-words text-destructive">
            {span.error}
          </pre>
        </div>
      )}

      {/* Payload */}
      <div className="flex items-center justify-between gap-2 px-4 pt-3">
        <div role="tablist" aria-label="Span data" className="inline-flex rounded-lg bg-muted p-0.5">
          {(["input", "output", "metadata"] as const).map((value) => (
            <button
              key={value}
              type="button"
              role="tab"
              aria-selected={tab === value}
              onClick={() => setTab(value)}
              className={cn(
                "rounded-md px-2.5 py-1 text-xs font-medium capitalize transition-colors focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none",
                tab === value ? "bg-card text-foreground shadow-xs" : "text-muted-foreground hover:text-foreground",
              )}
            >
              {value}
            </button>
          ))}
        </div>
        {payload != null && <CopyButton label={`Copy ${tab}`} text={JSON.stringify(payload, null, 2)} />}
      </div>
      <div className="min-h-0 flex-1 overflow-auto px-4 pt-2 pb-4" role="tabpanel">
        {/* Keyed by tab: each tab starts with fresh fold states. */}
        <Payload key={tab} value={payload} />
        {truncated && (
          <p className="mt-2 text-xs text-muted-foreground">
            Trimmed to 16 KB.{" "}
            {langsmithUrl && (
              <a href={langsmithUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-0.5 text-sage-text underline underline-offset-2 hover:text-foreground">
                Full payload in LangSmith <ExternalLink className="size-3" aria-hidden="true" />
              </a>
            )}
          </p>
        )}
      </div>
    </section>
  );
}

function Metric({ label, value, detail, title }: { label: string; value: string; detail?: string; title?: string }) {
  return (
    <div className="min-w-0" title={title}>
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="font-mono text-sm tabular-nums text-foreground">
        {value}
        {detail && <span className="ml-1.5 font-sans text-xs text-muted-foreground">{detail}</span>}
      </dd>
    </div>
  );
}

function isMessageList(value: unknown): value is { messages: TraceMessage[] } {
  if (!value || typeof value !== "object" || !("messages" in value)) return false;
  const messages = (value as { messages: unknown }).messages;
  return Array.isArray(messages) && messages.every((m) => m && typeof m === "object" && "role" in m && "content" in m);
}

function Payload({ value }: { value: unknown }) {
  if (value == null || (typeof value === "object" && Object.keys(value as object).length === 0)) {
    return <p className="py-6 text-center text-sm text-muted-foreground">Nothing recorded.</p>;
  }
  if (isMessageList(value)) return <MessageList messages={value.messages} />;
  if (typeof value === "object" && "_truncated" in (value as object)) {
    return <CodeView text={String((value as { _truncated: string })._truncated)} />;
  }
  return <CodeView text={JSON.stringify(value, null, 2)} />;
}

function CodeView({ text }: { text: string }) {
  return (
    <pre className="overflow-x-auto rounded-lg bg-muted/60 p-3 font-mono text-xs leading-relaxed whitespace-pre-wrap break-words text-foreground">
      {text}
    </pre>
  );
}

const ROLE_LABEL: Record<TraceMessage["role"], string> = {
  system: "System",
  user: "User",
  assistant: "Assistant",
  tool: "Tool result",
};

function MessageList({ messages }: { messages: TraceMessage[] }) {
  return (
    <ol className="flex flex-col gap-3">
      {messages.map((message, index) => (
        <li key={index} className="min-w-0">
          <p className="mb-1 flex items-center gap-2 text-[11px] font-semibold tracking-wide text-muted-foreground">
            <span
              className={cn(
                "rounded px-1.5 py-0.5",
                message.role === "user" && "bg-primary/25 text-foreground",
                message.role === "assistant" && "bg-[color-mix(in_srgb,var(--viz-1)_14%,transparent)] text-[var(--viz-1)]",
                message.role === "system" && "bg-muted text-muted-foreground",
                message.role === "tool" && "bg-[color-mix(in_srgb,var(--viz-4)_16%,transparent)] text-foreground",
              )}
            >
              {ROLE_LABEL[message.role] ?? message.role}
            </span>
            {message.name && <span className="font-mono font-normal">{message.name}</span>}
          </p>
          {message.content && <MessageText text={message.content} collapsible={message.role === "system"} />}
          {message.tool_calls?.map((call, callIndex) => (
            <div key={callIndex} className="mt-2 overflow-hidden rounded-lg border border-border">
              <p className="flex items-center gap-1.5 border-b border-border bg-muted/50 px-2.5 py-1 font-mono text-xs text-foreground">
                <Wrench className="size-3 text-[var(--viz-4)]" aria-hidden="true" />
                {call.name ?? "tool"}
              </p>
              <pre className="overflow-x-auto p-2.5 font-mono text-xs whitespace-pre-wrap break-words text-muted-foreground">
                {typeof call.args === "string" ? call.args : JSON.stringify(call.args, null, 2)}
              </pre>
            </div>
          ))}
        </li>
      ))}
    </ol>
  );
}

function MessageText({ text, collapsible }: { text: string; collapsible: boolean }) {
  const long = text.length > 600;
  const [open, setOpen] = useState<boolean>(!collapsible || !long);
  return (
    <div>
      <p className={cn("text-sm leading-relaxed whitespace-pre-wrap break-words text-foreground", collapsible && !open && "line-clamp-6")}>
        {text}
      </p>
      {collapsible && long && (
        <button
          type="button"
          onClick={() => setOpen((value) => !value)}
          aria-expanded={open}
          className="mt-1 text-xs font-medium text-sage-text hover:text-foreground"
        >
          {open ? "Show less" : `Show full prompt (${text.length.toLocaleString()} characters)`}
        </button>
      )}
    </div>
  );
}
