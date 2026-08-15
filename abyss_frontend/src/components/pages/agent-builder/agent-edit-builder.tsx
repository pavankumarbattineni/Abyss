"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft } from "lucide-react";
import { toast } from "sonner";
import { z } from "zod";

import { AgentAvatar } from "@/components/layout";
import { ChatPanel, ConfirmDialog } from "@/components/shared";
import { Button, Skeleton } from "@/components/ui";
import { useChatStream, useResizablePanel } from "@/hooks";
import { cn } from "@/lib/utils";
import { agentService, threadService } from "@/services";
import type { Agent, AgentToolRef, Message, SubAgent, Tool } from "@/types";
import { AgentIdentityDrawer } from "./agent-identity-drawer";
import { BuilderCanvas } from "./builder-canvas";
import { ChatThreadPopover } from "./chat-thread-popover";
import { SubAgentDrawer, type SubAgentFormValues } from "./sub-agent-drawer";

const editAgentSchema = z.object({
  name: z.string().trim().min(1, "Name is required"),
  description: z.string().trim().optional(),
  system_prompt: z.string().trim().min(1, "Instructions are required"),
});

type EditAgentValues = z.infer<typeof editAgentSchema>;

interface AgentEditBuilderPageProps {
  agentId: string;
}

export const AgentEditBuilderPage = ({ agentId }: AgentEditBuilderPageProps) => {
  const queryClient = useQueryClient();
  const { data: agent, isLoading } = useQuery<Agent>({
    queryKey: ["agent", agentId],
    queryFn: () => agentService.getAgent(agentId),
  });
  const [showChat, setShowChat] = useState<boolean>(false);
  const [agentDrawerOpen, setAgentDrawerOpen] = useState<boolean>(false);
  const [subAgentDrawerOpen, setSubAgentDrawerOpen] = useState<boolean>(false);
  const [editingSubAgent, setEditingSubAgent] = useState<SubAgent | null>(null);
  const [deletingSubAgent, setDeletingSubAgent] = useState<SubAgent | null>(null);

  const [subAgents, setSubAgents] = useState<SubAgent[]>([]);
  const [selectedTools, setSelectedTools] = useState<AgentToolRef[]>([]);
  const [selectedModelId, setSelectedModelId] = useState<string>("default");
  
  const [chatThreadId, setChatThreadId] = useState<string | undefined>(undefined);
  const hasSeeded = useRef<boolean>(false);
  const { width, isDragging, handlePointerDown } = useResizablePanel({
    initialWidth: 380,
    minWidth: 300,
    maxWidth: 560,
  });

  const {
    pendingMessages: chatMessages,
    isSending: isChatSending,
    isStreaming: isChatStreaming,
    streamingContent: chatStreamingContent,
    reasoningTrace: chatReasoningTrace,
    pendingApprovals: chatPendingApprovals,
    isResolvingApproval: isChatResolvingApproval,
    sendMessage: sendChatMessage,
    cancelStream: cancelChatStream,
    resolveApprovals: resolveChatApprovals,
  } = useChatStream({
    agentId,
    threadId: chatThreadId,
    onThreadCreated: setChatThreadId,
  });

  const { data: chatHistory, isLoading: isChatHistoryLoading } = useQuery<Message[]>({
    queryKey: ["thread-messages", chatThreadId],
    queryFn: () => threadService.getMessages(chatThreadId as string),
    enabled: !!chatThreadId,
  });

  const hasChatActive =
    !!chatThreadId || chatMessages.length > 0 || isChatSending || isChatStreaming;
  const displayChatMessages = useMemo(
    () => (hasChatActive ? [...(chatHistory ?? []), ...chatMessages] : undefined),
    [hasChatActive, chatHistory, chatMessages],
  );

  const form = useForm<EditAgentValues>({
    resolver: zodResolver(editAgentSchema),
    defaultValues: { name: "", description: "", system_prompt: "" },
    mode: "onChange",
  });
  const values = form.watch();

  useEffect(() => {
    if (agent && !hasSeeded.current) {
      form.reset({
        name: agent.name,
        description: agent.description,
        system_prompt: agent.system_prompt,
      });
      setSubAgents(agent.sub_agents);
      setSelectedTools(agent.tools);
      setSelectedModelId(agent.llm_model_id);
      hasSeeded.current = true;
    }
  }, [agent, form]);

  const displayAgent: Agent | undefined = agent
    ? {
        ...agent,
        name: values.name || agent.name,
        description: values.description ?? agent.description,
        system_prompt: values.system_prompt || agent.system_prompt,
        tools: selectedTools,
        sub_agents: subAgents,
      }
    : undefined;

  const isIdentityValid = editAgentSchema.safeParse(values).success;
  const isIdentityDirty = agent
    ? values.name !== agent.name ||
      (values.description ?? "") !== agent.description ||
      values.system_prompt !== agent.system_prompt
    : false;
  const toolIds = selectedTools.map((tool) => tool.id).sort();
  const isToolsDirty = agent
    ? JSON.stringify(toolIds) !==
      JSON.stringify(agent.tools.map((tool) => tool.id).sort())
    : false;
  const isModelDirty = agent ? selectedModelId !== agent.llm_model_id : false;
  const hasChanges = isIdentityDirty || isToolsDirty || isModelDirty;

  const { mutate: saveChanges, isPending: isSaving } = useMutation({
    mutationFn: () =>
      agentService.updateAgent(agentId, {
        name: values.name,
        description: values.description ?? "",
        system_prompt: values.system_prompt,
        tools: selectedTools.map((tool) => tool.id),
        llm_model_id: selectedModelId,
      }),
    onSuccess: (updatedAgent) => {
      queryClient.setQueryData(["agent", agentId], updatedAgent);
      queryClient.setQueryData<Agent[]>(["agents"], (prev) =>
        prev
          ? prev.map((item) => (item.id === agentId ? updatedAgent : item))
          : prev,
      );
      form.reset({
        name: updatedAgent.name,
        description: updatedAgent.description,
        system_prompt: updatedAgent.system_prompt,
      });
      setSubAgents(updatedAgent.sub_agents);
      setSelectedTools(updatedAgent.tools);
      setSelectedModelId(updatedAgent.llm_model_id);
      toast.success("Changes saved");
    },
    onError: () => {
      toast.error("Failed to save changes. Please try again.");
    },
  });

  const handleToggleTool = (tool: Tool) => {
    setSelectedTools((prev) =>
      prev.some((selected) => selected.id === tool.id)
        ? prev.filter((selected) => selected.id !== tool.id)
        : [
            ...prev,
            { id: tool.id, name: tool.name, display_name: tool.display_name },
          ],
    );
  };

  const handleRemoveTool = (id: string) => {
    setSelectedTools((prev) => prev.filter((tool) => tool.id !== id));
  };

  const handleAddSubAgentClick = () => {
    setEditingSubAgent(null);
    setSubAgentDrawerOpen(true);
  };

  const handleEditSubAgentClick = (subAgent: SubAgent) => {
    setEditingSubAgent(subAgent);
    setSubAgentDrawerOpen(true);
  };

  const { mutate: deleteSubAgent, isPending: isDeletingSubAgent } = useMutation({
    mutationFn: (subAgentId: string) => agentService.deleteSubAgent(subAgentId),
    onSuccess: (_data, subAgentId) => {
      setSubAgents((prev) => prev.filter((subAgent) => subAgent.id !== subAgentId));
      queryClient.setQueryData<Agent>(["agent", agentId], (prev) =>
        prev
          ? {
              ...prev,
              sub_agents: prev.sub_agents.filter((subAgent) => subAgent.id !== subAgentId),
            }
          : prev,
      );
      toast.success("Sub-agent deleted");
      setDeletingSubAgent(null);
    },
    onError: () => {
      toast.error("Failed to delete sub-agent. Please try again.");
    },
  });

  const handleDeleteSubAgentClick = (id: string) => {
    const target = subAgents.find((subAgent) => subAgent.id === id);
    if (!target) return;

    const isPersisted = agent?.sub_agents.some((subAgent) => subAgent.id === id) ?? false;
    if (isPersisted) {
      setDeletingSubAgent(target);
    } else {
      setSubAgents((prev) => prev.filter((subAgent) => subAgent.id !== id));
    }
  };

  const { mutate: createSubAgent, isPending: isAddingSubAgent } = useMutation({
    mutationFn: (payload: SubAgentFormValues) =>
      agentService.createSubAgent(agentId, {
        name: payload.name,
        description: payload.description ?? "",
        system_prompt: payload.system_prompt,
        tools: payload.tools.map((tool) => tool.id),
      }),
    onSuccess: (updatedAgent) => {
      setSubAgents(updatedAgent.sub_agents);
      setSelectedTools(updatedAgent.tools);
      queryClient.setQueryData(["agent", agentId], updatedAgent);
      queryClient.setQueryData<Agent[]>(["agents"], (prev) =>
        prev
          ? prev.map((item) => (item.id === agentId ? updatedAgent : item))
          : prev,
      );
      toast.success("Sub-agent added");
      setSubAgentDrawerOpen(false);
    },
    onError: () => {
      toast.error("Failed to add sub-agent. Please try again.");
    },
  });

  const { mutate: updateSubAgent, isPending: isUpdatingSubAgent } = useMutation({
    mutationFn: ({ id, values }: { id: string; values: SubAgentFormValues }) =>
      agentService.updateAgent(agentId, {
        sub_agents: [
          {
            id,
            name: values.name,
            description: values.description ?? "",
            system_prompt: values.system_prompt,
            tools: values.tools.map((tool) => tool.id),
          },
        ],
      }),
    onSuccess: (updatedAgent) => {
      setSubAgents(updatedAgent.sub_agents);
      setSelectedTools(updatedAgent.tools);
      queryClient.setQueryData(["agent", agentId], updatedAgent);
      queryClient.setQueryData<Agent[]>(["agents"], (prev) =>
        prev ? prev.map((item) => (item.id === agentId ? updatedAgent : item)) : prev,
      );
      toast.success("Sub-agent updated");
      setSubAgentDrawerOpen(false);
    },
    onError: () => {
      toast.error("Failed to update sub-agent. Please try again.");
    },
  });

  const handleSubmitSubAgent = (subAgentValues: SubAgentFormValues) => {
    if (editingSubAgent) {
      updateSubAgent({ id: editingSubAgent.id, values: subAgentValues });
    } else {
      createSubAgent(subAgentValues);
    }
  };

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-3 border-b border-border-soft px-4 py-3">
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          aria-label="Back to agent"
          className="text-muted-foreground hover:text-foreground"
          asChild
        >
          <Link href={`/agents/${agentId}`}>
            <ArrowLeft className="size-4" />
          </Link>
        </Button>
        <AgentAvatar name={displayAgent?.name ?? "Agent"} className="size-8 text-xs" />
        {isLoading ? (
          <Skeleton className="h-4 w-40" />
        ) : (
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold">
              {displayAgent?.name ?? "Untitled Agent"}
            </p>
            <p className="truncate text-xs text-muted-foreground">
              {displayAgent?.description || "Agent description..."}
            </p>
          </div>
        )}
        <Button
          type="button"
          size="sm"
          className="ml-auto"
          disabled={!isIdentityValid || !hasChanges}
          loading={isSaving}
          onClick={() => saveChanges()}
        >
          Save Changes
        </Button>
      </div>

      <div className="flex min-h-0 flex-1">
        {showChat && (
          <>
            <div style={{ width }} className="flex h-full flex-col shrink-0">
              <ChatThreadPopover
                agentId={agentId}
                activeThreadId={chatThreadId}
                onSelectThread={setChatThreadId}
              />
              <ChatPanel
                agent={displayAgent}
                isLoading={isLoading}
                showHeader={false}
                messages={displayChatMessages}
                isMessagesLoading={isChatHistoryLoading}
                onSendMessage={sendChatMessage}
                onCancelStream={cancelChatStream}
                isSending={isChatSending}
                isStreaming={isChatStreaming}
                streamingContent={chatStreamingContent}
                reasoningTrace={chatReasoningTrace}
                pendingApprovals={chatPendingApprovals}
                isResolvingApproval={isChatResolvingApproval}
                onResolveApproval={resolveChatApprovals}
              />
            </div>
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
          </>
        )}

        <div className="relative min-w-0 flex-1">
          <BuilderCanvas
            agent={displayAgent}
            isLoading={isLoading}
            showChat={showChat}
            onToggleChat={() => setShowChat((prev) => !prev)}
            onAgentClick={() => setAgentDrawerOpen(true)}
            onAddSubAgent={handleAddSubAgentClick}
            onEditSubAgent={handleEditSubAgentClick}
            onDeleteSubAgent={handleDeleteSubAgentClick}
            selectedTools={selectedTools}
            onToggleTool={handleToggleTool}
            onRemoveTool={handleRemoveTool}
          />
        </div>
      </div>

      <AgentIdentityDrawer
        agent={displayAgent}
        open={agentDrawerOpen}
        onOpenChange={setAgentDrawerOpen}
        editable
        nameValue={values.name}
        descriptionValue={values.description ?? ""}
        instructionsValue={values.system_prompt}
        modelValue={selectedModelId}
        onNameChange={(value) =>
          form.setValue("name", value, { shouldValidate: true })
        }
        onDescriptionChange={(value) =>
          form.setValue("description", value, { shouldValidate: true })
        }
        onInstructionsChange={(value) =>
          form.setValue("system_prompt", value, { shouldValidate: true })
        }
        onModelChange={setSelectedModelId}
      />

      <SubAgentDrawer
        open={subAgentDrawerOpen}
        onOpenChange={setSubAgentDrawerOpen}
        subAgent={editingSubAgent}
        onSubmit={handleSubmitSubAgent}
        isSubmitting={isAddingSubAgent || isUpdatingSubAgent}
      />

      <ConfirmDialog
        open={!!deletingSubAgent}
        onOpenChange={(open) => {
          if (!open) setDeletingSubAgent(null);
        }}
        title="Delete sub-agent"
        description={`Delete "${deletingSubAgent?.name}"? This cannot be undone.`}
        confirmLabel="Delete"
        variant="destructive"
        loading={isDeletingSubAgent}
        onConfirm={() => {
          if (deletingSubAgent) deleteSubAgent(deletingSubAgent.id);
        }}
      />
    </div>
  );
};
