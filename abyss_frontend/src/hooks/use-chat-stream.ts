"use client";

import { useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useQueryState } from "nuqs";
import { toast } from "sonner";

import { streamService, threadService } from "@/services";
import type {
  Message,
  ReasoningTrace,
  StreamEvent,
  StreamToolInterrupt,
  Thread,
  ToolApprovalPayload,
} from "@/types";
import { useReasoningTrace } from "./use-reasoning-trace";

interface UseChatStreamOptions {
  agentId: string;
  threadId?: string;
  onThreadCreated?: (threadId: string) => void;
}

interface UseChatStreamResult {
  pendingMessages: Message[];
  isSending: boolean;
  isStreaming: boolean;
  streamingContent: string;
  reasoningTrace: ReasoningTrace;
  pendingApprovals: StreamToolInterrupt[];
  isResolvingApproval: boolean;
  sendMessage: (text: string) => Promise<void>;
  cancelStream: () => void;
  resolveApprovals: (approvals: ToolApprovalPayload[]) => Promise<void>;
}

const STREAM_ID_PARAM = "streamId";

export function useChatStream({
  agentId,
  threadId,
  onThreadCreated,
}: UseChatStreamOptions): UseChatStreamResult {
  const queryClient = useQueryClient();
  const reasoning = useReasoningTrace();

  // The stream_id lives in the URL's query string (via nuqs) rather than any client storage —
  // the URL is exactly what a refresh re-requests, so there's nothing to lose. Read the current
  // value through a ref inside the resume effect below rather than as a dependency, so setting
  // it ourselves on send/done/cancel doesn't retrigger that effect mid-stream.
  const [streamIdParam, setStreamIdParam] = useQueryState(STREAM_ID_PARAM);
  const streamIdParamRef = useRef(streamIdParam);

  const [pendingMessages, setPendingMessages] = useState<Message[]>([]);
  const [isSending, setIsSending] = useState<boolean>(false);
  const [isStreaming, setIsStreaming] = useState<boolean>(false);
  const [streamingContent, setStreamingContent] = useState<string>("");
  const [pendingApprovals, setPendingApprovals] = useState<StreamToolInterrupt[]>([]);
  const [isResolvingApproval, setIsResolvingApproval] = useState<boolean>(false);
  const streamControllerRef = useRef<AbortController | null>(null);
  const streamIdRef = useRef<string | null>(null);
  const accumulatedRef = useRef<string>("");
  const activeThreadIdRef = useRef<string | undefined>(threadId);
  const isNewThreadRef = useRef<boolean>(false);
  // The last SSE event id actually processed for the current stream, sent back as
  // Last-Event-ID on reconnect so the backend can resume after it instead of replaying the
  // whole history. Also used to drop any already-processed event a replay sends anyway,
  // since re-dispatching a historical tool_start/tool_end into the reasoning trace would
  // duplicate it there even though the ids themselves are otherwise harmless to see twice.
  const lastEventIdRef = useRef<string | null>(null);

  const [conversationThreadId, setConversationThreadId] = useState<string | undefined>(threadId);
  if (threadId !== conversationThreadId) {
    setConversationThreadId(threadId);
    setPendingMessages([]);
    setIsSending(false);
    setIsStreaming(false);
    setStreamingContent("");
    setPendingApprovals([]);
  }

  const createStreamHandler = (resolvedThreadId: string, isNewThread: boolean) =>
    (event: StreamEvent) => {
      // A reconnect can replay events already processed before the disconnect (no
      // Last-Event-ID support on the backend yet) — ids are monotonically increasing per
      // stream, so drop anything at or below the last one actually handled.
      if (event.id) {
        const eventId = Number(event.id);
        const lastId = lastEventIdRef.current !== null ? Number(lastEventIdRef.current) : -1;
        if (!Number.isNaN(eventId) && eventId <= lastId) return;
        lastEventIdRef.current = event.id;
      }

      reasoning.dispatch(event);

      if (event.type === "token") {
        accumulatedRef.current += event.data.content;
        setStreamingContent(accumulatedRef.current);
      } else if (event.type === "thread_title") {
        queryClient.setQueryData<Thread[]>(["threads", agentId], (prev) =>
          prev
            ? prev.map((item) =>
                item.id === resolvedThreadId
                  ? { ...item, title: event.data.title }
                  : item,
              )
            : prev,
        );
      } else if (event.type === "done") {
        const assistantMessage: Message = {
          id: event.data.message_id,
          thread_id: resolvedThreadId,
          role: "assistant",
          content: accumulatedRef.current,
          is_partial: false,
          reasoning: null,
          created_at: new Date().toISOString(),
        };

        setPendingMessages((prev) => {
          const next = [...prev, assistantMessage];
          if (isNewThread) {
            queryClient.setQueryData<Message[]>(["thread-messages", resolvedThreadId], next);
          }
          return next;
        });
        streamIdRef.current = null;
        setStreamingContent("");
        setIsStreaming(false);

        if (isNewThread) {
          // Navigating to the new thread's own URL already leaves the query string behind, so
          // don't also call setStreamIdParam here — clearing it on the current (about-to-be-
          // abandoned) URL and navigating away both touch the router in the same tick, and can
          // race with each other.
          queryClient.invalidateQueries({ queryKey: ["threads", agentId] });
          onThreadCreated?.(resolvedThreadId);
        } else {
          setStreamIdParam(null);
        }
      } else if (event.type === "error") {
        toast.error(event.data.message || "Something went wrong while streaming the response.");
        streamIdRef.current = null;
        setIsStreaming(false);
        setStreamingContent("");
        setStreamIdParam(null);
      } else if (event.type === "tool_approval_required") {
        // The event only signals that the backend has paused — an SSE reconnect can replay
        // history, so the event's own payload isn't trustworthy as "this is pending right now."
        // getStreamStatus is the idempotent source of truth for what's actually still pending.
        const targetStreamId = streamIdRef.current;
        if (!targetStreamId) return;

        streamService
          .getStreamStatus(targetStreamId)
          .then((status) => {
            if (status.status === "AWAITING_APPROVAL") {
              setPendingApprovals(status.pending_approval?.interrupts ?? []);
            }
          })
          .catch(() => {
            toast.error("Failed to load the pending tool approval. Please refresh.");
          });
      }
    };

  const createStreamHandlerRef = useRef(createStreamHandler);
  
  const reasoningRef = useRef(reasoning);
  useEffect(() => {
    createStreamHandlerRef.current = createStreamHandler;
    reasoningRef.current = reasoning;
    streamIdParamRef.current = streamIdParam;
  });

  // The single place that turns a stream_id into UI state: RUNNING hydrates partial content/
  // reasoning and opens the live connection; AWAITING_APPROVAL renders the pending approval
  // straight from the status response; anything else means there's nothing left to resume.
  // Used both for the on-mount resume (persisted stream_id from the URL) and for reconnecting
  // after a tool-approval decision is submitted.
  const resumeStream = async (
    targetStreamId: string,
    resolvedThreadId: string,
    isNewThread: boolean,
    isCancelled: () => boolean = () => false,
  ) => {
    try {
      const status = await streamService.getStreamStatus(targetStreamId);
      if (isCancelled()) return;

      if (status.status === "AWAITING_APPROVAL") {
        streamIdRef.current = targetStreamId;
        activeThreadIdRef.current = resolvedThreadId;
        setStreamIdParam(targetStreamId);
        setStreamingContent("");
        setIsStreaming(true);
        setPendingApprovals(status.pending_approval?.interrupts ?? []);
        return;
      }

      if (status.status !== "RUNNING") {
        setStreamIdParam(null);
        return;
      }

      streamIdRef.current = targetStreamId;
      accumulatedRef.current = status.partial_content ?? "";
      activeThreadIdRef.current = resolvedThreadId;
      setStreamIdParam(targetStreamId);
      setStreamingContent(accumulatedRef.current);
      setIsStreaming(true);
      setPendingApprovals([]);
      if (status.reasoning) reasoningRef.current.hydrate(status.reasoning.steps);

      streamControllerRef.current = streamService.openStream(
        targetStreamId,
        createStreamHandlerRef.current(resolvedThreadId, isNewThread),
        lastEventIdRef.current ?? undefined,
      );
    } catch {
      if (!isCancelled()) setStreamIdParam(null);
    }
  };

  useEffect(() => {
    streamIdRef.current = null;
    accumulatedRef.current = "";
    lastEventIdRef.current = null;
    reasoningRef.current.reset();

    let cancelled = false;
    const persistedStreamId = streamIdParamRef.current;
    if (threadId && persistedStreamId) {
      resumeStream(persistedStreamId, threadId, false, () => cancelled);
    }

    return () => {
      cancelled = true;
      streamControllerRef.current?.abort();
      streamControllerRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [threadId]);

  const sendMessage = async (text: string) => {
    const isNewThread = !threadId;
    isNewThreadRef.current = isNewThread;
    setPendingApprovals([]);

    const userMessage: Message = {
      id: `local-user-${crypto.randomUUID()}`,
      thread_id: threadId ?? "",
      role: "user",
      content: text,
      is_partial: false,
      reasoning: null,
      created_at: new Date().toISOString(),
    };
    setPendingMessages((prev) => [...prev, userMessage]);
    setIsSending(true);

    try {
      let activeThreadId = threadId;
      if (!activeThreadId) {
        const created = await threadService.createThread({ agent_id: agentId });
        activeThreadId = created.thread_id;
      }
      const resolvedThreadId = activeThreadId;
      activeThreadIdRef.current = resolvedThreadId;

      const { stream_id } = await threadService.sendMessage(resolvedThreadId, {
        message: text,
      });

      streamIdRef.current = stream_id;
      accumulatedRef.current = "";
      lastEventIdRef.current = null;
      reasoning.reset();
      setIsSending(false);
      setIsStreaming(true);
      setStreamingContent("");
      setStreamIdParam(stream_id);

      streamControllerRef.current = streamService.openStream(
        stream_id,
        createStreamHandler(resolvedThreadId, isNewThread),
      );
    } catch {
      toast.error("Failed to send message. Please try again.");
      setIsSending(false);
    }
  };

  const cancelStream = () => {
    const streamId = streamIdRef.current;
    if (!streamId) return;

    streamControllerRef.current?.abort();
    streamControllerRef.current = null;
    streamIdRef.current = null;

    const resolvedThreadId = activeThreadIdRef.current;
    const content = accumulatedRef.current;

    setStreamIdParam(null);
    setPendingApprovals([]);

    if (content && resolvedThreadId) {
      setPendingMessages((prev) => [
        ...prev,
        {
          id: `local-assistant-${crypto.randomUUID()}`,
          thread_id: resolvedThreadId,
          role: "assistant",
          content,
          is_partial: true,
          reasoning: null,
          created_at: new Date().toISOString(),
        },
      ]);
    }
    setStreamingContent("");
    setIsStreaming(false);

    streamService.cancelStream(streamId).catch(() => {
      toast.error("Failed to stop the response cleanly, but generation has been halted locally.");
    });
  };

  const resolveApprovals = async (approvals: ToolApprovalPayload[]) => {
    const streamId = streamIdRef.current;
    const resolvedThreadId = activeThreadIdRef.current;
    if (!streamId || !resolvedThreadId) return;

    setPendingApprovals([]);
    setIsResolvingApproval(true);

    // The connection that delivered `tool_approval_required` ends once the backend pauses for
    // human input — submitting a decision doesn't resume it, it starts a fresh one, same as the
    // persisted-stream resume path above.
    streamControllerRef.current?.abort();
    streamControllerRef.current = null;

    try {
      const result = await streamService.submitToolApprovals(streamId, approvals);
      // The response's own stream_id is the one to reconnect to — it may differ from the
      // stream_id that raised the interrupt. resumeStream then decides, from status, whether
      // that stream is now RUNNING or needs yet another approval (multi-step tool calls).
      await resumeStream(result.stream_id, resolvedThreadId, isNewThreadRef.current);
    } catch {
      toast.error("Failed to submit tool approval. Please try again.");
    } finally {
      setIsResolvingApproval(false);
    }
  };

  return {
    pendingMessages,
    isSending,
    isStreaming,
    streamingContent,
    reasoningTrace: reasoning.trace,
    pendingApprovals,
    isResolvingApproval,
    sendMessage,
    cancelStream,
    resolveApprovals,
  };
}
