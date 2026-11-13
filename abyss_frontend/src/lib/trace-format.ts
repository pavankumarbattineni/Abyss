import { Bot, Brain, Database, FileText, Link2, Search, Wrench, type LucideIcon } from "lucide-react";

import type { SpanType, TraceSpan } from "@/types";

/** 850 ms, 4.2 s, 1 m 05 s. */
export function formatDuration(ms: number | null | undefined): string {
  if (ms == null) return "—";
  if (ms < 1000) return `${Math.round(ms)} ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(ms < 10_000 ? 2 : 1)} s`;
  const minutes = Math.floor(ms / 60_000);
  const seconds = Math.round((ms % 60_000) / 1000);
  return `${minutes} m ${String(seconds).padStart(2, "0")} s`;
}

/** 980, 12.4k, 1.2M. */
export function formatTokens(value: number | null | undefined): string {
  if (!value) return "0";
  if (value < 1000) return String(value);
  if (value < 1_000_000) return `${(value / 1000).toFixed(value < 10_000 ? 1 : 0)}k`;
  return `${(value / 1_000_000).toFixed(1)}M`;
}

/** $0.0012, $0.48, $12.30 -- small amounts keep significant digits. */
export function formatCost(value: number | null | undefined): string {
  if (value == null) return "—";
  if (value === 0) return "$0";
  if (value < 0.01) return `$${value.toPrecision(2)}`;
  return `$${value.toFixed(2)}`;
}

export function formatPercent(rate: number): string {
  if (rate === 0) return "0%";
  if (rate < 0.001) return "<0.1%";
  return `${(rate * 100).toFixed(rate < 0.1 ? 1 : 0)}%`;
}

interface SpanTypeStyle {
  label: string;
  icon: LucideIcon;
  /** CSS colour (a design token) for bars and icons. */
  color: string;
}

const SPAN_TYPES: Record<string, SpanTypeStyle> = {
  chain: { label: "Step", icon: Link2, color: "var(--sage-text)" },
  llm: { label: "LLM", icon: Brain, color: "var(--viz-1)" },
  tool: { label: "Tool", icon: Wrench, color: "var(--viz-4)" },
  retriever: { label: "Retriever", icon: Search, color: "var(--viz-3)" },
  embedding: { label: "Embedding", icon: Database, color: "var(--viz-7)" },
  prompt: { label: "Prompt", icon: FileText, color: "var(--muted-foreground)" },
  parser: { label: "Parser", icon: FileText, color: "var(--muted-foreground)" },
};

export function spanTypeStyle(type: SpanType): SpanTypeStyle {
  return SPAN_TYPES[type] ?? { label: type, icon: Bot, color: "var(--muted-foreground)" };
}

/** Human names for LangGraph/LangChain internals; everything else as-is. */
export function spanDisplayName(span: TraceSpan): string {
  const names: Record<string, string> = {
    "abyss.agent_turn": "Agent run",
    "abyss.thread_title": "Thread title",
    LangGraph: "Agent graph",
    model: "Model call",
    tools: "Tool execution",
    ChatOpenAI: "OpenAI chat",
    ChatAnthropic: "Anthropic chat",
    ChatGoogleGenerativeAI: "Gemini chat",
  };
  if (names[span.name]) return names[span.name];
  // Specialists and MCP tools are snake_case tool names: make them readable.
  if (span.run_type === "tool" && /^[a-z0-9]+(_[a-z0-9]+)+$/.test(span.name)) {
    const words = span.name.replace(/_/g, " ");
    return words.charAt(0).toUpperCase() + words.slice(1);
  }
  return span.name;
}
