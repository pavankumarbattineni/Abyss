/**
 * Unsent message drafts, kept outside the chat panel so they survive it being
 * re-created -- above all when a new thread gets its id: the first question
 * moves the page to the thread's URL, which mounts a new panel while the
 * user may already be typing the next question.
 *
 * In memory only (per tab): a draft is a convenience, not data to restore
 * after a reload.
 */
const drafts = new Map<string, string>();
// A thread that was just created takes over the draft of the "new thread"
// composer it came from -- read when its panel first shows, so nothing typed
// in between is missed.
const takesOver = new Map<string, string>();

export function readDraft(key: string | undefined): string {
  if (!key) return "";
  const from = takesOver.get(key);
  if (from !== undefined) {
    takesOver.delete(key);
    const carried = drafts.get(from);
    drafts.delete(from);
    if (carried) drafts.set(key, carried);
  }
  return drafts.get(key) ?? "";
}

export function writeDraft(key: string | undefined, text: string): void {
  if (!key) return;
  if (text) drafts.set(key, text);
  else drafts.delete(key);
}

/** `to` (a just-created thread) will take over `from`'s draft when first read. */
export function handOverDraft(from: string, to: string): void {
  takesOver.set(to, from);
}
