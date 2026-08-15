"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";

import { ChatPanel } from "@/components/shared";
import { useChatStream, useResizablePanel } from "@/hooks";
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
  const { data: messages, isLoading: isMessagesLoading } = useQuery<Message[]>({
    queryKey: ["thread-messages", threadId],
    queryFn: () => threadService.getMessages(threadId as string),
    enabled: !!threadId,
  });
  const [collapsed, setCollapsed] = useState<boolean>(false);
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
      onThreadCreated: (newThreadId) =>
        router.push(`/agents/${agentId}/threads/${newThreadId}`),
    });

  const hasActiveConversation = !!threadId || pendingMessages.length > 0 || isSending || isStreaming;
  const displayMessages = useMemo(
    () => (hasActiveConversation ? [...(messages ?? []), ...pendingMessages] : undefined),
    [hasActiveConversation, messages, pendingMessages],
  );

  return (
    <div className="flex h-full">
      <ThreadSidebar
        agent={agent}
        agentId={agentId}
        isLoading={isLoading}
        width={width}
        collapsed={collapsed}
        onCollapsedChange={setCollapsed}
        isResizing={isDragging}
      />

      {!collapsed && (
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
        onSendMessage={sendMessage}
        onCancelStream={cancelStream}
        isSending={isSending}
        isStreaming={isStreaming}
        streamingContent={streamingContent}
        reasoningTrace={reasoningTrace}
        pendingApprovals={pendingApprovals}
        isResolvingApproval={isResolvingApproval}
        onResolveApproval={resolveApprovals}
      />
    </div>
  );
};
