"use client";

import { useEffect, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import { forgetThread, isThreadGone } from "@/lib/threads";

/** Retry a thread query on passing errors, but not when the thread no longer exists. */
export function retryUnlessThreadGone(failureCount: number, error: unknown): boolean {
  return !isThreadGone(error) && failureCount < 3;
}

/**
 * An open thread whose messages can't be loaded because it no longer exists
 * (deleted in another tab or device, or a stale link): it leaves the lists, the
 * user is told once, and `onGone` moves them to a new chat -- instead of an
 * empty page whose next question would fail.
 */
export function useThreadGone(agentId: string, threadId: string | undefined, error: unknown, onGone: () => void): void {
  const queryClient = useQueryClient();
  const handled = useRef<string | null>(null);
  const onGoneRef = useRef(onGone);
  useEffect(() => {
    onGoneRef.current = onGone; // the latest callback, without re-running the check below
  });

  useEffect(() => {
    if (!threadId || handled.current === threadId || !isThreadGone(error)) return;
    handled.current = threadId;
    forgetThread(queryClient, agentId, threadId);
    toast.info("This chat no longer exists. Starting a new one.");
    onGoneRef.current();
  }, [agentId, threadId, error, queryClient]);
}
