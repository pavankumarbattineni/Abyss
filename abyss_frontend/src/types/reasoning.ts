export type AgentLaneStatus = "running" | "succeeded" | "failed";

export interface ToolCallRecord {
  id: string;
  toolName: string;
  status: "running" | "succeeded";
  output?: string;
}

export type LaneSegment =
  | { kind: "thought"; id: string; content: string }
  | { kind: "tool_call"; id: string; toolCall: ToolCallRecord };

export interface AgentLane {
  agentName: string;
  status: AgentLaneStatus;
  segments: LaneSegment[];
  // True once an agent_start has been seen for this lane, i.e. it was actually delegated to
  // (a sub-agent) rather than just reasoning directly (the top-level orchestrator, which only
  // ever gets reasoning_start/reasoning_end with no delegation wrapper around it).
  isDelegated: boolean;
}

export interface SynthesisState {
  agentsCompleted: string[];
}

export interface ReasoningTrace {
  lanes: Record<string, AgentLane>;
  order: string[];
  synthesis: SynthesisState | null;
}
