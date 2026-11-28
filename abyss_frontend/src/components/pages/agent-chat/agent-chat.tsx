"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";

import { ChatPanel } from "@/components/shared/chat-panel";
import { handOverDraft } from "@/lib/drafts";
import {
  COMPACT_QUERY,
  retryUnlessThreadGone,
  useChatStream,
  useMediaQuery,
  useResizablePanel,
  useThreadGone,
} from "@/hooks";
import { mergeMessages } from "@/lib/chat-messages";
import { cn } from "@/lib/utils";
import { agentService, threadService } from "@/services";
import type { Agent, Message } from "@/types";
import { ThreadSidebar } from "./thread-sidebar";

interface AgentChatPageProps {
  agentId: string;
  threadId?: string;
}

export const AgentChatPage = ({ agentId, threadId }: AgentChatPageProps) => {
  const router = useRouter();
  const { data: agent, isLoading } = useQuery<Agent>({
    queryKey: ["agent", agentId],
    queryFn: () => agentService.getAgent(agentId),
  });
  const { data: messages, isLoading: isMessagesLoading, error: messagesError } = useQuery<Message[]>({
    queryKey: ["thread-messages", threadId],
    queryFn: () => threadService.getMessages(threadId as string),
    enabled: !!threadId,
    retry: retryUnlessThreadGone,
  });
  // A deleted thread (another tab, a stale link): to a new chat instead of a dead page.
  useThreadGone(agentId, threadId, messagesError, () => router.replace(`/agents/${agentId}`));
  const [collapsed, setCollapsed] = useState<boolean>(false);
  // Phones and tablets: the thread list starts closed and opens over the
  // chat, so it never squeezes the chat next to the main sidebar.
  const isMobile = useMediaQuery(COMPACT_QUERY);
  // Remembers which thread the list was opened on, so moving to another
  // thread closes it without an effect.
  const threadKey = threadId ?? "new";
  const [threadsOpenOn, setThreadsOpenOn] = useState<string | null>(null);
  const mobileThreadsOpen = threadsOpenOn === threadKey;
  const setMobileThreadsOpen = (open: boolean) =>
    setThreadsOpenOn(open ? threadKey : null);
  const threadsCollapsed = isMobile ? !mobileThreadsOpen : collapsed;
  const { width, isDragging, handlePointerDown } = useResizablePanel({
    initialWidth: 380,
    minWidth: 220,
    maxWidth: 420,
  });

  const {
    pendingMessages,
    isSending,
    isStreaming,
    streamingContent,
    reasoningTrace,
    pendingApprovals,
    isResolvingApproval,
    sendMessage,
    cancelStream,
    resolveApprovals,
  } = useChatStream({
    agentId,
    threadId,
    // The first message moves straight to the thread's URL, which resumes the stream there, so
    // refreshing mid-answer works from the first message on (see useChatStream).
    onThreadStarted: (newThreadId, streamId) => {
      // Whatever is typed in the box meanwhile goes along to the thread's page.
      handOverDraft(`${agentId}:new`, `${agentId}:${newThreadId}`);
      router.replace(`/agents/${agentId}/threads/${newThreadId}?streamId=${encodeURIComponent(streamId)}`);
    },
    // The open thread was deleted: the question waits in a new chat's input.
    onThreadGone: () => router.replace(`/agents/${agentId}`),
  });

  const hasActiveConversation =
    !!threadId || pendingMessages.length > 0 || isSending || isStreaming;
  const displayMessages = useMemo(
    () =>
      hasActiveConversation
        ? mergeMessages(messages, pendingMessages)
        : undefined,
    [hasActiveConversation, messages, pendingMessages],
  );

  return (
    // overflow-hidden: the chat scrolls inside its own panes; nothing here may
    // make the page (the dashboard's <main>) scrollable around them.
    <div className="relative flex h-full overflow-hidden">
      {isMobile && mobileThreadsOpen && (
        <div
          className="absolute inset-0 z-20 bg-foreground/20"
          aria-hidden="true"
          onClick={() => setMobileThreadsOpen(false)}
        />
      )}
      {/* On phones the closed thread list takes no room: it opens from the
          chat header's Threads button instead of a side rail. */}
      {!(isMobile && threadsCollapsed) && (
        <ThreadSidebar
          agent={agent}
          agentId={agentId}
          isLoading={isLoading}
          width={isMobile ? 300 : width}
          collapsed={threadsCollapsed}
          onCollapsedChange={
            isMobile ? (value) => setMobileThreadsOpen(!value) : setCollapsed
          }
          isResizing={isDragging}
          className={
            isMobile && mobileThreadsOpen
              ? "absolute inset-y-0 left-0 z-30 max-w-[85vw] border-r border-border bg-background shadow-xl"
              : undefined
          }
        />
      )}

      {!threadsCollapsed && !isMobile && (
        <div
          role="separator"
          aria-orientation="vertical"
          onPointerDown={handlePointerDown}
          className="group relative shrink-0 cursor-col-resize px-1.5"
        >
          <div
            className={cn(
              "h-full w-px bg-border transition-colors group-hover:bg-ring",
              isDragging && "bg-ring",
            )}
          />
        </div>
      )}

      <ChatPanel
        agent={agent}
        isLoading={isLoading}
        messages={displayMessages}
        isMessagesLoading={isMessagesLoading}
        onNewThread={() => router.push(`/agents/${agentId}`)}
        onOpenThreads={isMobile ? () => setMobileThreadsOpen(true) : undefined}
        onSendMessage={sendMessage}
        onCancelStream={cancelStream}
        isSending={isSending}
        isStreaming={isStreaming}
        streamingContent={streamingContent}
        reasoningTrace={reasoningTrace}
        pendingApprovals={pendingApprovals}
        isResolvingApproval={isResolvingApproval}
        onResolveApproval={resolveApprovals}
        draftKey={`${agentId}:${threadKey}`}
      />
    </div>
  );
};
