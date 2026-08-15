export type UsageRunStatus = "RUNNING" | "COMPLETED" | "FAILED" | "CANCELLED";

export interface UsageSummary {
  total_spent_usd: number;
  total_threads: number;
  total_runs: number;
  total_agents: number;
}

export interface UsageRun {
  stream_id: string;
  thread_id: string;
  agent_id: string;
  agent_name: string;
  status: UsageRunStatus;
  input_tokens: number | null;
  cache_read_tokens: number | null;
  output_tokens: number | null;
  total_tokens: number | null;
  cost_usd: number | null;
  llm_source: string | null;
  provider: string | null;
  model: string | null;
  created_at: string;
  // Not shown null in any confirmed example, but a still-RUNNING run has no completion time yet.
  completed_at: string | null;
}

export interface UsageRunsQuery {
  agent_id?: string;
  start_date?: string;
  end_date?: string;
  provider?: string;
  model?: string;
  status?: UsageRunStatus;
  page?: number;
  page_size?: number;
}

export interface UsageRunsResponse {
  items: UsageRun[];
  total: number;
  page: number;
  page_size: number;
}
