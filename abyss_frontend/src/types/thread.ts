import type { ReasoningLog } from "./stream";

export interface Thread {
  id: string;
  user_id: string;
  agent_id: string;
  title: string;
  created_at: string;
  /** Last use (a new message); thread lists are ordered by it. */
  updated_at: string;
}

export interface ThreadCreateRequest {
  agent_id: string;
}

export interface ThreadCreateResponse {
  thread_id: string;
}

export interface ThreadUpdateRequest {
  title: string;
}

// "summary": earlier conversation condensed for the agent (shown collapsible).
// "error": a friendly notice saved when a run failed (e.g. the model provider was down).
export type MessageRole = "user" | "assistant" | "summary" | "error";

export interface Message {
  id: string;
  thread_id: string;
  role: MessageRole;
  content: string;
  is_partial: boolean;
  reasoning: ReasoningLog | null;
  created_at: string;
}

export interface SendMessageRequest {
  message: string;
}

export type SendMessageStatus = "PENDING";

export interface SendMessageResponse {
  message_id: string;
  stream_id: string;
  status: SendMessageStatus;
}
