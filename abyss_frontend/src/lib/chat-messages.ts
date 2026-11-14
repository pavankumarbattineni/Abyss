import type { Message } from "@/types";

const LOCAL_ASSISTANT_PREFIX = "local-assistant-";

/**
 * The conversation to show: the saved messages, then the ones this page added
 * since (the question just sent, the answer that streamed in).
 *
 * The saved list is refetched whenever React Query decides to (window focus,
 * invalidation…), and by then it may already hold what's still pending here.
 * A pending message is dropped once the server has it:
 * - same id (questions get their saved id on send; answers and summaries carry
 *   theirs from the stream);
 * - a stopped answer only has a local id: it's dropped once the saved list has
 *   an answer right after its question.
 */
export function mergeMessages(saved: Message[] | undefined, pending: Message[]): Message[] {
  const list = saved ?? [];
  if (!pending.length) return list;
  const index = new Map(list.map((message, i) => [message.id, i]));
  const unsaved = pending.filter((message, i) => {
    if (index.has(message.id)) return false;
    if (message.id.startsWith(LOCAL_ASSISTANT_PREFIX) && i > 0) {
      const question = index.get(pending[i - 1].id);
      if (question !== undefined && list[question + 1]?.role === "assistant") return false;
    }
    return true;
  });
  return unsaved.length ? [...list, ...unsaved] : list;
}
