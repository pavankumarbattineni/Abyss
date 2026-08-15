import { api } from "@/lib/axios";
import type {
  Message,
  SendMessageRequest,
  SendMessageResponse,
  Thread,
  ThreadCreateRequest,
  ThreadCreateResponse,
  ThreadUpdateRequest,
} from "@/types";

class ThreadService {
  async getThreads(agentId: string): Promise<Thread[]> {
    const { data } = await api.get<Thread[]>(`/agents/${agentId}/threads`);
    return data;
  }

  async createThread(payload: ThreadCreateRequest): Promise<ThreadCreateResponse> {
    const { data } = await api.post<ThreadCreateResponse>("/threads", payload);
    return data;
  }

  async getThread(id: string): Promise<Thread> {
    const { data } = await api.get<Thread>(`/threads/${id}`);
    return data;
  }

  async updateThread(id: string, payload: ThreadUpdateRequest): Promise<Thread> {
    const { data } = await api.patch<Thread>(`/threads/${id}`, payload);
    return data;
  }

  async deleteThread(id: string): Promise<void> {
    await api.delete(`/threads/${id}`);
  }

  async sendMessage(
    threadId: string,
    payload: SendMessageRequest,
  ): Promise<SendMessageResponse> {
    const { data } = await api.post<SendMessageResponse>(
      `/threads/${threadId}/messages`,
      payload,
    );
    return data;
  }

  async getMessages(threadId: string): Promise<Message[]> {
    const { data } = await api.get<Message[]>(`/threads/${threadId}/messages`);
    return data;
  }
}

export const threadService = new ThreadService();
