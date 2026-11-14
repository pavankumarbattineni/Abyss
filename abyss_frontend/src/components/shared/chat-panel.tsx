"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import {
  ArrowUp,
  ChevronDown,
  History,
  ChevronUp,
  Menu,
  CircleSlash,
  MessageCircle,
  MessageSquarePlus,
  Paperclip,
  Pencil,
  Square,
} from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";

import { AgentAvatar } from "@/components/layout";
import { Button, Heading, Skeleton, Textarea } from "@/components/ui";
import { buildReasoningTrace, EMPTY_REASONING_TRACE, settleAllLanes, toToolName } from "@/lib/reasoning";
import { cn } from "@/lib/utils";
import type { Agent, Message, ReasoningTrace, StreamToolInterrupt, ToolApprovalPayload } from "@/types";
import { contentForCopy } from "@/lib/interactive";
import { agentService } from "@/services";
import { CopyButton } from "./copy-button";
import { MarkdownContent } from "./markdown-content";
import { RelativeTime } from "./relative-time";
import { ReasoningPanel } from "./reasoning-panel";
import { COMPOSE_EVENT } from "./code-preview";
import { ToolApprovalPanel } from "./tool-approval-panel";

interface ChatPanelProps {
  agent?: Agent;
  isLoading: boolean;
  showHeader?: boolean;
  disabled?: boolean;
  messages?: Message[];
  isMessagesLoading?: boolean;
  onNewThread?: () => void;
  /** Phones: opens the thread list (there's no side rail there). */
  onOpenThreads?: () => void;
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

// The reading column: 48rem, widening when the chat itself has room (the app
// sidebar or thread panel closed, or a large screen). Container queries on the
// panel, so it follows the space actually available, not the window.
const CHAT_COLUMN = "max-w-3xl @5xl:max-w-4xl @7xl:max-w-5xl";

export function ChatPanel({
  agent,
  isLoading,
  showHeader = true,
  disabled = false,
  messages,
  isMessagesLoading = false,
  onNewThread,
  onOpenThreads,
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

  // "Ask the agent to fix it" in a live preview prefills the message box (not sent).
  useEffect(() => {
    const onCompose = (event: Event) => {
      const text = (event as CustomEvent<string>).detail;
      if (typeof text === "string" && text) setDraft(text);
    };
    window.addEventListener(COMPOSE_EVENT, onCompose);
    return () => window.removeEventListener(COMPOSE_EVENT, onCompose);
  }, []);

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
    <div className={cn("w-full rounded-3xl border border-border-soft bg-surface-raised p-3 shadow-sm transition-colors focus-within:border-ring focus-within:ring-1 focus-within:ring-ring/50", CHAT_COLUMN)}>
      <Textarea
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        onKeyDown={handleKeyDown}
        placeholder={`Message ${agent?.name ?? "the agent"}...`}
        className="field-sizing-content max-h-40 min-h-9 w-full sm:max-h-52 sm:min-h-16 resize-none overflow-y-auto border-0 bg-transparent p-1 shadow-none focus-visible:ring-0 dark:bg-transparent"
      />
      <div className="flex items-center justify-between gap-2 pt-2 sm:pt-3">
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

  const showsEmptyState = !disabled && (!hasThread || (!isMessagesLoading && messages.length === 0 && !isStreaming));
  const { data: sampleQuestions = [] } = useQuery<string[]>({
    queryKey: ["agents", agent?.id, "sample-questions"],
    queryFn: () => agentService.getSampleQuestions(agent!.id),
    enabled: !!agent?.id && showsEmptyState,
    staleTime: Infinity,
  });

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
      {sampleQuestions.length > 0 && (
        <div className={cn("w-full text-left", CHAT_COLUMN)}>
          <p className="mb-2 text-xs font-medium text-muted-foreground">Try asking</p>
          <ul className="flex flex-col gap-1.5">
            {sampleQuestions.map((question) => (
              <li key={question}>
                <button
                  type="button"
                  disabled={isSending || isStreaming}
                  onClick={() => onSendMessage?.(question)}
                  className="w-full rounded-lg border border-border bg-card px-3 py-2 text-left text-sm text-foreground transition-colors hover:border-primary hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none disabled:opacity-60"
                >
                  {question}
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );

  // Stream labels -> the names the user gave: the main agent streams as
  // "agent", each specialist as its tool name (see lib/reasoning toToolName).
  const agentNames: Record<string, string> = Object.fromEntries([
    ["agent", agent?.name ?? "Agent"],
    ...(agent?.sub_agents ?? []).map((sub) => [toToolName(sub.name), sub.name]),
  ]);

  return (
    <div className="@container flex min-w-0 flex-1 flex-col overflow-hidden">
      {showHeader && (
        <div className="flex items-center justify-end gap-2 px-4 py-2 sm:p-4">
          {onOpenThreads && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="mr-auto -ml-2 text-muted-foreground hover:text-foreground"
              onClick={onOpenThreads}
            >
              <Menu className="size-4" />
              Threads
            </Button>
          )}
          {hasThread && (
            <Button type="button" size="sm" onClick={onNewThread}>
              <MessageSquarePlus className="size-3.5" />
              New thread
            </Button>
          )}
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
            <div className={cn("mx-auto flex w-full flex-col gap-6", CHAT_COLUMN)}>
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
              className="flex-1 overflow-x-hidden overflow-y-auto px-4 py-6 sm:px-6"
            >
              <div className={cn("mx-auto flex w-full flex-col gap-4 sm:gap-6", CHAT_COLUMN)}>
                {messages.map((message, index) => message.role === "summary" ? (
                  <ConversationSummary key={message.id} content={message.content} />
                ) : (
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
                        className="size-8 shrink-0 text-xs max-sm:hidden"
                      />
                    )}
                    <div
                      className={cn(
                        "group/message flex min-w-0 flex-col gap-1",
                        message.role === "user" ? "max-w-[85%] items-end sm:max-w-[75%]" : "w-full items-start",
                      )}
                    >
                    <div
                      className={cn(
                        "min-w-0 wrap-break-word",
                        message.role === "user"
                          ? "max-w-full overflow-x-auto rounded-2xl rounded-tr-none bg-accent px-4 py-2.5 text-sm text-accent-foreground"
                          : "w-full rounded-2xl bg-muted/40 px-4 py-3 text-foreground",
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
                              agentNames={agentNames}
                            />
                          ) : (
                            !isStreaming &&
                            index === messages.length - 1 && (
                              <ReasoningPanel trace={reasoningTrace} isStreaming={false} agentNames={agentNames} />
                            )
                          )}
                          {message.content && <MarkdownContent content={message.content} />}
                          {message.is_partial && (
                            <div
                              className={cn(
                                "flex items-center gap-1.5 border-t border-dashed border-border-soft pt-2 text-xs text-muted-foreground",
                                message.content && "mt-3",
                              )}
                            >
                              <CircleSlash className="size-3.5 shrink-0" />
                              <span className="italic">Abyss was interrupted</span>
                            </div>
                          )}
                        </>
                      ) : (
                        <UserMessageText text={message.content} />
                      )}
                    </div>
                    <MessageMeta message={message} />
                    </div>
                  </div>
                ))}

                {isStreaming && (
                  <div className="flex min-w-0 items-start gap-3">
                    <AgentAvatar
                      name={agent?.name ?? "Agent"}
                      className="size-8 shrink-0 text-xs max-sm:hidden"
                    />
                    <div className="min-w-0 w-full rounded-2xl bg-muted/40 px-4 py-3 text-foreground wrap-break-word">
                      <ReasoningPanel trace={reasoningTrace} isStreaming={true} agentNames={agentNames} />
                      {streamingContent && <MarkdownContent content={streamingContent} isStreaming />}
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

            <div className="flex justify-center border-t border-border-soft p-3 sm:p-4">
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

/**
 * Where earlier messages were condensed into a summary for the agent (like Claude Code's
 * "compacted" marker). Collapsed to a divider; opens to show the summary itself. The earlier
 * messages stay on screen -- only what the agent remembers of them changed.
 */
function ConversationSummary({ content }: { content: string }) {
  const [open, setOpen] = useState<boolean>(false);
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-3 text-xs text-muted-foreground">
        <span className="h-px flex-1 bg-border-soft" aria-hidden="true" />
        <button
          type="button"
          onClick={() => setOpen((value) => !value)}
          aria-expanded={open}
          className="flex shrink-0 items-center gap-1.5 rounded-full border border-border-soft bg-surface-raised px-3 py-1 font-medium hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
        >
          <History className="size-3.5" aria-hidden="true" />
          Earlier conversation summarized
          {open ? <ChevronUp className="size-3.5" /> : <ChevronDown className="size-3.5" />}
        </button>
        <span className="h-px flex-1 bg-border-soft" aria-hidden="true" />
      </div>
      {open && (
        <div className="rounded-2xl border border-border-soft bg-muted/30 px-4 py-3">
          <div className="mb-2 flex items-start justify-between gap-3">
            <p className="text-xs text-muted-foreground">
              Your earlier messages stay here; the agent now remembers them through this summary.
            </p>
            <CopyButton label="Copy summary" text={content} />
          </div>
          <MarkdownContent content={content} />
        </div>
      )}
    </div>
  );
}

// Past this many characters a message you sent is shown folded to a few lines, so one long
// paste doesn't push the conversation out of view. Display only -- nothing is cut.
const USER_MESSAGE_FOLD_AT = 400;

function UserMessageText({ text }: { text: string }) {
  const [expanded, setExpanded] = useState<boolean>(false);
  const long = text.length > USER_MESSAGE_FOLD_AT;
  return (
    <div>
      <p className={cn("whitespace-pre-wrap wrap-break-word", long && !expanded && "line-clamp-4")}>{text}</p>
      {long && (
        <button
          type="button"
          onClick={() => setExpanded((value) => !value)}
          aria-expanded={expanded}
          className="mt-1.5 flex items-center gap-1 rounded text-xs font-medium text-muted-foreground hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
        >
          {expanded ? "Show less" : "Show more"}
          {expanded ? <ChevronUp className="size-3" /> : <ChevronDown className="size-3" />}
        </button>
      )}
    </div>
  );
}

/** Time and copy under a message, as in Trench: time then copy for the
 * user's messages (revealed on hover/focus, always shown on touch screens),
 * copy then time for the agent's. Copying an answer turns interactive views
 * into readable text instead of raw JSON. */
function MessageMeta({ message }: { message: Message }) {
  const isUser = message.role === "user";
  if (!message.content) {
    return (
      <div className="px-1 text-xs text-muted-foreground">
        <RelativeTime value={message.created_at} />
      </div>
    );
  }
  return (
    <div
      className={cn(
        "flex items-center gap-1 px-1 text-xs text-muted-foreground",
        isUser &&
          "opacity-0 transition-opacity group-hover/message:opacity-100 focus-within:opacity-100 [@media(hover:none)]:opacity-100",
      )}
    >
      {isUser && <RelativeTime value={message.created_at} />}
      <CopyButton
        label={isUser ? "Copy message" : "Copy response"}
        text={isUser ? message.content : contentForCopy(message.content)}
      />
      {!isUser && <RelativeTime value={message.created_at} />}
    </div>
  );
}
