"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import {
  ArrowUp,
  CalendarClock,
  MessageCircle,
  MessageSquarePlus,
  Paperclip,
  Pencil,
  Square,
} from "lucide-react";
import { toast } from "sonner";

import { AgentAvatar } from "@/components/layout";
import { Button, Heading, Skeleton, Textarea } from "@/components/ui";
import { buildReasoningTrace, EMPTY_REASONING_TRACE, settleAllLanes } from "@/lib/reasoning";
import { cn } from "@/lib/utils";
import type { Agent, Message, ReasoningTrace, StreamToolInterrupt, ToolApprovalPayload } from "@/types";
import { MarkdownContent } from "./markdown-content";
import { ReasoningPanel } from "./reasoning-panel";
import { ToolApprovalPanel } from "./tool-approval-panel";

interface ChatPanelProps {
  agent?: Agent;
  isLoading: boolean;
  showHeader?: boolean;
  disabled?: boolean;
  messages?: Message[];
  isMessagesLoading?: boolean;
  onNewThread?: () => void;
  onSendMessage?: (message: string) => void;
  onCancelStream?: () => void;
  isSending?: boolean;
  isStreaming?: boolean;
  streamingContent?: string;
  reasoningTrace?: ReasoningTrace;
  pendingApprovals?: StreamToolInterrupt[];
  isResolvingApproval?: boolean;
  onResolveApproval?: (approvals: ToolApprovalPayload[]) => void;
}

export function ChatPanel({
  agent,
  isLoading,
  showHeader = true,
  disabled = false,
  messages,
  isMessagesLoading = false,
  onNewThread,
  onSendMessage,
  onCancelStream,
  isSending = false,
  isStreaming = false,
  streamingContent = "",
  reasoningTrace = EMPTY_REASONING_TRACE,
  pendingApprovals = [],
  isResolvingApproval = false,
  onResolveApproval,
}: ChatPanelProps) {
  const [draft, setDraft] = useState<string>("");
  const [spacerHeight, setSpacerHeight] = useState<number>(0);
  const hasThread = messages !== undefined;
  const scrollRef = useRef<HTMLDivElement>(null);
  const messageRefs = useRef<Map<string, HTMLDivElement>>(new Map());
  const lastMessageIdRef = useRef<string | null>(null);
  const pendingScrollIdRef = useRef<string | null>(null);

  useEffect(() => {
    if (!isMessagesLoading && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [isMessagesLoading]);

  useEffect(() => {
    if (!messages || messages.length === 0) return;
    const lastMessage = messages[messages.length - 1];
    if (lastMessage.id === lastMessageIdRef.current) return;
    lastMessageIdRef.current = lastMessage.id;

    if (lastMessage.role === "user") {
      const container = scrollRef.current;
      const node = messageRefs.current.get(lastMessage.id);
      if (container && node) {
        const available = container.clientHeight - node.offsetHeight - 24;
        setSpacerHeight(Math.max(available, 0));
        pendingScrollIdRef.current = lastMessage.id;
      }
    } else {
      setSpacerHeight(0);
    }
  }, [messages]);

  useEffect(() => {
    const id = pendingScrollIdRef.current;
    if (!id) return;
    pendingScrollIdRef.current = null;

    const container = scrollRef.current;
    const node = messageRefs.current.get(id);
    if (!container || !node) return;

    const containerRect = container.getBoundingClientRect();
    const nodeRect = node.getBoundingClientRect();
    const offset = nodeRect.top - containerRect.top;
    container.scrollTo({ top: container.scrollTop + offset - 5, behavior: "smooth" });
  }, [spacerHeight]);

  const handleSend = () => {
    const trimmed = draft.trim();
    if (!trimmed || isSending || isStreaming) return;
    onSendMessage?.(trimmed);
    setDraft("");
  };

  const handleKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      handleSend();
    }
  };

  const composer = (
    <div className="w-full max-w-3xl rounded-3xl border border-border-soft bg-surface-raised p-3 shadow-sm transition-colors focus-within:border-ring focus-within:ring-1 focus-within:ring-ring/50">
      <Textarea
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        onKeyDown={handleKeyDown}
        placeholder={`Message ${agent?.name ?? "the agent"}...`}
        className="field-sizing-content max-h-52 min-h-16 w-full resize-none overflow-y-auto border-0 bg-transparent p-1 shadow-none focus-visible:ring-0 dark:bg-transparent"
      />
      <div className="flex items-center justify-between gap-2 pt-3">
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          className="rounded-full text-muted-foreground hover:text-foreground"
          aria-label="Attach file"
          onClick={() => toast("Attachments coming soon")}
        >
          <Paperclip className="size-4" />
        </Button>
        {isStreaming ? (
          <Button
            type="button"
            variant="outline"
            size="icon-sm"
            className="rounded-full"
            aria-label="Stop generating"
            onClick={onCancelStream}
          >
            <Square className="size-3 fill-current" />
          </Button>
        ) : (
          <Button
            type="button"
            size="icon-sm"
            className="rounded-full"
            disabled={!draft.trim() || isSending}
            aria-label="Send message"
            onClick={handleSend}
          >
            <ArrowUp className="size-4" />
          </Button>
        )}
      </div>
    </div>
  );

  const emptyHero = (
    <div className="flex w-full flex-col items-center gap-4">
      <AgentAvatar name={agent?.name ?? "Agent"} className="size-14 text-lg" />
      <div className="flex flex-col gap-1">
        <Heading as="h2" size="lg">
          Start a chat with {agent?.name ?? "this agent"}
        </Heading>
        <p className="text-sm text-muted-foreground">
          Ask a question or give it a task to get started.
        </p>
      </div>
      {composer}
    </div>
  );

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      {showHeader && (
        <div className="flex items-center justify-end gap-2 p-4">
          {hasThread && (
            <Button type="button" size="sm" onClick={onNewThread}>
              <MessageSquarePlus className="size-3.5" />
              New thread
            </Button>
          )}
          <Button type="button" variant="outline" size="sm" asChild>
            <Link href={`/agents/${agent?.id ?? ""}/schedules`}>
              <CalendarClock className="size-3.5" />
              Schedules
            </Link>
          </Button>
          <Button type="button" variant="outline" size="sm" asChild>
            <Link href={`/agents/${agent?.id ?? ""}/builder`}>
              <Pencil className="size-3.5" />
              Edit
            </Link>
          </Button>
        </div>
      )}

      {isLoading ? (
        <div className="flex flex-1 flex-col items-center justify-center px-6 text-center">
          <Skeleton className="h-4 w-48" />
        </div>
      ) : disabled ? (
        <div className="flex flex-1 flex-col items-center justify-center px-6 text-center">
          <div className="flex flex-col items-center gap-3">
            <MessageCircle className="size-8 text-muted-foreground" />
            <div className="flex flex-col gap-1.5">
              <Heading as="h2" size="lg">
                Chat isn&apos;t available yet
              </Heading>
              <p className="max-w-xs text-sm text-muted-foreground">
                Create this agent to start testing prompts and see how it
                responds.
              </p>
            </div>
          </div>
        </div>
      ) : hasThread ? (
        isMessagesLoading ? (
          <div className="flex-1 overflow-y-auto px-6 py-6">
            <div className="mx-auto flex w-full max-w-3xl flex-col gap-6">
              <Skeleton className="h-16 w-2/3" />
              <Skeleton className="ml-auto h-10 w-1/2" />
              <Skeleton className="h-20 w-3/4" />
            </div>
          </div>
        ) : messages.length === 0 && !isStreaming ? (
          <div className="flex flex-1 flex-col items-center justify-center px-6 text-center">
            {emptyHero}
          </div>
        ) : (
          <>
            <div
              ref={scrollRef}
              className="flex-1 overflow-x-hidden overflow-y-auto px-6 py-6"
            >
              <div className="mx-auto flex w-full max-w-3xl flex-col gap-6">
                {messages.map((message, index) => (
                  <div
                    key={message.id}
                    ref={(node) => {
                      if (node) {
                        messageRefs.current.set(message.id, node);
                      } else {
                        messageRefs.current.delete(message.id);
                      }
                    }}
                    className={cn(
                      "flex min-w-0 items-start gap-3",
                      message.role === "user" && "flex-row-reverse",
                    )}
                  >
                    {message.role === "assistant" && (
                      <AgentAvatar
                        name={agent?.name ?? "Agent"}
                        className="size-8 shrink-0 text-xs"
                      />
                    )}
                    <div
                      className={cn(
                        "min-w-0 wrap-break-word",
                        message.role === "user"
                          ? "max-w-[75%] overflow-x-auto rounded-2xl rounded-tr-none bg-muted px-4 py-2.5 text-sm text-foreground"
                          : "w-full py-1 text-foreground",
                      )}
                    >
                      {message.role === "assistant" ? (
                        <>
                          {message.reasoning ? (
                            <ReasoningPanel
                              trace={settleAllLanes(
                                buildReasoningTrace(message.reasoning.steps),
                                "succeeded",
                              )}
                              isStreaming={false}
                            />
                          ) : (
                            !isStreaming &&
                            index === messages.length - 1 && (
                              <ReasoningPanel trace={reasoningTrace} isStreaming={false} />
                            )
                          )}
                          <MarkdownContent content={message.content} />
                        </>
                      ) : (
                        <p className="whitespace-pre-wrap wrap-break-word">{message.content}</p>
                      )}
                    </div>
                  </div>
                ))}

                {isStreaming && (
                  <div className="flex min-w-0 items-start gap-3">
                    <AgentAvatar
                      name={agent?.name ?? "Agent"}
                      className="size-8 shrink-0 text-xs"
                    />
                    <div className="min-w-0 w-full py-1 text-foreground wrap-break-word">
                      <ReasoningPanel trace={reasoningTrace} isStreaming={true} />
                      {streamingContent && <MarkdownContent content={streamingContent} />}
                      {pendingApprovals.length > 0 ? (
                        <ToolApprovalPanel
                          interrupts={pendingApprovals}
                          isSubmitting={isResolvingApproval}
                          onSubmit={(approvals) => onResolveApproval?.(approvals)}
                        />
                      ) : (
                        !streamingContent && (
                          <div className="flex items-center gap-1 py-1">
                            <span className="size-1.5 animate-bounce rounded-full bg-muted-foreground" />
                            <span className="size-1.5 animate-bounce rounded-full bg-muted-foreground delay-150" />
                            <span className="size-1.5 animate-bounce rounded-full bg-muted-foreground delay-300" />
                          </div>
                        )
                      )}
                    </div>
                  </div>
                )}

                <div aria-hidden style={{ height: spacerHeight }} />
              </div>
            </div>

            <div className="flex justify-center border-t border-border-soft p-4">
              {composer}
            </div>
          </>
        )
      ) : (
        <div className="flex flex-1 flex-col items-center justify-center px-6 text-center">
          {emptyHero}
        </div>
      )}
    </div>
  );
}
