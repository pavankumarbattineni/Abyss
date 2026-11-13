export type TraceStatus = "success" | "error" | "pending";
export type TraceKind = "agent_turn" | "thread_title";
export type SpanType = "chain" | "llm" | "tool" | "retriever" | "prompt" | "parser" | "embedding" | string;

export interface TraceSummary {
  id: string;
  kind: TraceKind;
  name: string;
  status: TraceStatus;
  error: string | null;
  thread_id: string | null;
  agent_id: string | null;
  start_time: string;
  end_time: string | null;
  latency_ms: number | null;
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
  total_cost: number | null;
  span_count: number;
  llm_calls: number;
  tool_calls: number;
  error_count: number;
  models: string[];
  input_preview: string | null;
  output_preview: string | null;
  complete: boolean;
}

export interface TraceListResponse {
  items: TraceSummary[];
  total: number;
  page: number;
  page_size: number;
  /** False when LangSmith tracing isn't configured on the server. */
  enabled: boolean;
  last_synced_at: string | null;
}

export interface TraceListQuery {
  days: number;
  status?: TraceStatus;
  kind?: TraceKind;
  q?: string;
  page?: number;
  page_size?: number;
}

/** A message as stored for LLM spans (normalised from LangChain's formats). */
export interface TraceMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
  name?: string;
  tool_calls?: { name: string | null; args: unknown }[];
}

export interface TraceSpan {
  id: string;
  parent_id: string | null;
  position: number;
  depth: number;
  name: string;
  run_type: SpanType;
  status: TraceStatus;
  error: string | null;
  start_time: string;
  end_time: string | null;
  latency_ms: number | null;
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
  total_cost: number | null;
  model: string | null;
  /** LLM spans: { messages: TraceMessage[] }. Trimmed payloads: { _truncated: string }. */
  inputs: unknown;
  outputs: unknown;
  inputs_truncated: boolean;
  outputs_truncated: boolean;
  meta: Record<string, unknown> | null;
}

export interface TraceDetail extends TraceSummary {
  langsmith_url: string | null;
  spans: TraceSpan[];
}

export interface TraceDayStat {
  date: string;
  traces: number;
  errors: number;
  p50_latency_ms: number | null;
  total_tokens: number;
  total_cost: number;
}

export interface TraceModelStat {
  model: string;
  calls: number;
  total_tokens: number;
  total_cost: number;
  avg_latency_ms: number | null;
}

export interface TraceStats {
  days: number;
  traces: number;
  errors: number;
  error_rate: number;
  p50_latency_ms: number | null;
  p95_latency_ms: number | null;
  total_tokens: number;
  total_cost: number;
  by_day: TraceDayStat[];
  by_model: TraceModelStat[];
}

export interface TraceSyncResponse {
  enabled: boolean;
  synced: number;
}
