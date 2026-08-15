import type { ReasoningLog } from "./stream";

export interface Thread {
  id: string;
  user_id: string;
  agent_id: string;
  title: string;
  created_at: string;
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

export type MessageRole = "user" | "assistant";

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
