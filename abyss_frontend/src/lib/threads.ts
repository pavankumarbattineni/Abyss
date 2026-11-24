import type { QueryClient } from "@tanstack/react-query";
import { isAxiosError } from "axios";

import type { Thread } from "@/types";

/** How a thread without a title is listed: a new one, whose title is still being
 * generated alongside its first answer (it streams in as a thread_title event). */
export const NEW_THREAD_LABEL = "New thread";

export function threadLabel(thread: Pick<Thread, "title"> | null | undefined): string {
  return thread?.title?.trim() || NEW_THREAD_LABEL;
}

const threadsKey = (agentId: string) => ["threads", agentId] as const;

/** A thread just created is listed right away -- first, as a new thread -- instead
 * of waiting for the list to be fetched again (which can take longer than its title). */
export function listNewThread(queryClient: QueryClient, thread: Thread): void {
  queryClient.setQueryData<Thread[]>(threadsKey(thread.agent_id), (prev) => [
    thread,
    ...(prev ?? []).filter((t) => t.id !== thread.id),
  ]);
}

/** The thread's title, once generated, in every list that shows it. */
export function setThreadTitle(queryClient: QueryClient, agentId: string, threadId: string, title: string): boolean {
  let listed = false;
  queryClient.setQueryData<Thread[]>(threadsKey(agentId), (prev) =>
    prev?.map((t) => {
      if (t.id !== threadId) return t;
      listed = true;
      return { ...t, title };
    }),
  );
  return listed;
}

/** A thread that no longer exists (deleted here or elsewhere): out of the lists and caches. */
export function forgetThread(queryClient: QueryClient, agentId: string, threadId: string): void {
  queryClient.setQueryData<Thread[]>(threadsKey(agentId), (prev) => prev?.filter((t) => t.id !== threadId));
  queryClient.removeQueries({ queryKey: ["thread-messages", threadId] });
  void queryClient.invalidateQueries({ queryKey: threadsKey(agentId) });
}

/** True when the server says the thread doesn't exist (any more): HTTP 404. */
export function isThreadGone(error: unknown): boolean {
  return isAxiosError(error) && error.response?.status === 404;
}

/** What a thread looks like before the server's copy arrives. */
export function newThread(id: string, agentId: string, userId = ""): Thread {
  const now = new Date().toISOString();
  return { id, agent_id: agentId, user_id: userId, title: null, created_at: now, updated_at: now };
}
