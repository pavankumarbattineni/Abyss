export type AgentRunStatus = "running" | "succeeded" | "failed";

/** One agent taking part in a turn: the main agent, or a specialist it
 * delegated to. */
export interface AgentRun {
  agentName: string;
  status: AgentRunStatus;
  // True once the agent was delegated to (an agent_start was seen) -- i.e. a
  // specialist, not the main agent, which only ever streams reasoning.
  isDelegated: boolean;
}

/** One step of a turn, in the order it happened across all agents. */
export type TimelineItem =
  | { kind: "thought"; id: string; agent: string; content: string; durationMs?: number }
  | { kind: "delegation"; id: string; agent: string; target: string; task: string }
  | {
      kind: "tool_call";
      id: string;
      agent: string;
      toolName: string;
      status: "running" | "succeeded";
      input?: string;
      output?: string;
      durationMs?: number;
    };

export interface SynthesisState {
  agentsCompleted: string[];
}

export interface ReasoningTrace {
  agents: Record<string, AgentRun>;
  /** Agent names in order of first appearance. */
  order: string[];
  timeline: TimelineItem[];
  synthesis: SynthesisState | null;
}
