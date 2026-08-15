import { api, API_BASE_URL, getAuthToken } from "@/lib/axios";
import type {
  StreamCancelResponse,
  StreamEvent,
  StreamStatusResponse,
  ToolApprovalPayload,
  ToolApprovalResponse,
} from "@/types";

function parseSseFrame(frame: string): StreamEvent | null {
  let id = "";
  let eventType = "";
  let data = "";

  for (const line of frame.split("\n")) {
    if (line.startsWith("id:")) {
      id = line.slice(3).trim();
    } else if (line.startsWith("event:")) {
      eventType = line.slice(6).trim();
    } else if (line.startsWith("data:")) {
      data += line.slice(5).trim();
    }
  }

  if (!eventType || !data) return null;

  const payload: unknown = JSON.parse(data);

  switch (eventType) {
    case "agent_start":
    case "agent_end":
    case "tool_start":
    case "tool_end":
    case "reasoning_start":
    case "reasoning_token":
    case "reasoning_end":
    case "synthesis_start":
    case "token":
    case "thread_title":
    case "done":
    case "error":
    case "tool_approval_required":
      return { id, type: eventType, data: payload } as StreamEvent;
    default:
      return null;
  }
}

async function readSseBody(
  body: ReadableStream<Uint8Array>,
  onEvent: (event: StreamEvent) => void,
): Promise<void> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const frames = buffer.split("\n\n");
    buffer = frames.pop() ?? "";

    for (const frame of frames) {
      const event = parseSseFrame(frame);
      if (event) onEvent(event);
    }
  }
}

class StreamService {
  openStream(
    streamId: string,
    onEvent: (event: StreamEvent) => void,
    lastEventId?: string,
  ): AbortController {
    const controller = new AbortController();

    fetch(`${API_BASE_URL}/streams/${streamId}`, {
      headers: {
        Accept: "text/event-stream",
        Authorization: `Bearer ${getAuthToken()}`,
        ...(lastEventId ? { "Last-Event-ID": lastEventId } : {}),
      },
      signal: controller.signal,
    })
      .then((response) => {
        if (!response.body) throw new Error("Stream response has no body");
        return readSseBody(response.body, onEvent);
      })
      .catch((error) => {
        if (controller.signal.aborted) return;
        onEvent({
          id: "",
          type: "error",
          data: { message: error instanceof Error ? error.message : "Stream failed" },
        });
      });

    return controller;
  }

  async cancelStream(streamId: string): Promise<StreamCancelResponse> {
    const { data } = await api.get<StreamCancelResponse>(`/streams/${streamId}`);
    return data;
  }

  async getStreamStatus(streamId: string): Promise<StreamStatusResponse> {
    const { data } = await api.get<StreamStatusResponse>(`/streams/${streamId}/status`);
    return data;
  }

  async submitToolApprovals(
    streamId: string,
    approvals: ToolApprovalPayload[],
  ): Promise<ToolApprovalResponse> {
    const { data } = await api.post<ToolApprovalResponse>(
      `/streams/${streamId}/tool-approvals`,
      { approvals },
    );
    return data;
  }
}

export const streamService = new StreamService();
