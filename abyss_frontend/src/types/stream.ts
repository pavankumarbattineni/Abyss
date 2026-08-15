export interface StreamAgentStartEvent {
  type: "agent_start";
  data: { agent_name: string };
}

export interface StreamAgentEndEvent {
  type: "agent_end";
  data: { agent_name: string };
}

export interface StreamToolStartEvent {
  type: "tool_start";
  data: { tool_name: string; agent_name: string };
}

export interface StreamToolEndEvent {
  type: "tool_end";
  data: { tool_name: string; agent_name: string; output?: string };
}

export interface StreamReasoningStartEvent {
  type: "reasoning_start";
  data: { agent: string };
}

export interface StreamReasoningTokenEvent {
  type: "reasoning_token";
  data: { content: string; agent: string };
}

export interface StreamReasoningEndEvent {
  type: "reasoning_end";
  data: { agent: string; truncated: boolean };
}

export interface StreamSynthesisStartEvent {
  type: "synthesis_start";
  data: { agents_completed: string[] };
}

export interface StreamTokenEvent {
  type: "token";
  data: { content: string };
}

export interface StreamThreadTitleEvent {
  type: "thread_title";
  data: { title: string };
}

export interface StreamDoneEvent {
  type: "done";
  data: { message_id: string; total_chunks: number };
}

export interface StreamErrorEvent {
  type: "error";
  data: { message: string };
}

export interface StreamToolInterruptCall {
  tool_call_id: string;
  tool_name: string;
  tool_id: string;
  args: Record<string, unknown>;
}

export interface StreamToolInterrupt {
  interrupt_id: string;
  reason: string;
  agent_id: string;
  tool_calls: StreamToolInterruptCall[];
}

export interface StreamToolApprovalRequiredEvent {
  type: "tool_approval_required";
  data: { interrupts: StreamToolInterrupt[] };
}

export type StreamEvent = { id: string } & (
  | StreamAgentStartEvent
  | StreamAgentEndEvent
  | StreamToolStartEvent
  | StreamToolEndEvent
  | StreamReasoningStartEvent
  | StreamReasoningTokenEvent
  | StreamReasoningEndEvent
  | StreamSynthesisStartEvent
  | StreamTokenEvent
  | StreamThreadTitleEvent
  | StreamDoneEvent
  | StreamErrorEvent
  | StreamToolApprovalRequiredEvent
);

export type ToolApprovalDecisionType = "allow_once" | "always_allow" | "deny";

export interface ToolApprovalDecision {
  tool_call_id: string;
  decision: ToolApprovalDecisionType;
}

export interface ToolApprovalPayload {
  interrupt_id: string;
  decisions: ToolApprovalDecision[];
}

export interface ToolApprovalRequest {
  approvals: ToolApprovalPayload[];
}

export interface ToolApprovalResponse {
  message_id: string;
  stream_id: string;
  // Only "PENDING" has been observed from the backend; other values are unconfirmed, so this
  // isn't narrowed to a literal union.
  status: string;
}

export type StreamStatus = "RUNNING" | "COMPLETED" | "FAILED" | "CANCELLED" | "AWAITING_APPROVAL";

export interface StreamCancelResponse {
  stream_id: string;
  status: StreamStatus;
}

export interface ReasoningThoughtStep {
  agent: string;
  step: "thought";
  content: string;
  duration_ms: number;
  truncated: boolean;
}

export interface ReasoningToolCallStep {
  agent: string;
  step: "tool_call";
  tool_name: string;
  input: string;
  output: string;
  duration_ms: number;
  truncated: boolean;
}

export type ReasoningStep = ReasoningThoughtStep | ReasoningToolCallStep;

export interface ReasoningLog {
  steps: ReasoningStep[];
}

export interface StreamPendingApproval {
  interrupts: StreamToolInterrupt[];
}

export interface StreamStatusResponse {
  stream_id: string;
  status: StreamStatus;
  total_chunks: number;
  partial_content: string | null;
  reasoning: ReasoningLog | null;
  pending_approval: StreamPendingApproval | null;
}
