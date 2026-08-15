"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft } from "lucide-react";
import { toast } from "sonner";
import { z } from "zod";

import { AgentAvatar } from "@/components/layout";
import { ChatPanel } from "@/components/shared";
import { Button } from "@/components/ui";
import { useResizablePanel } from "@/hooks";
import { cn } from "@/lib/utils";
import { agentService } from "@/services";
import type { Agent, AgentToolRef, SubAgent, Tool } from "@/types";
import { AgentIdentityDrawer } from "../agent-builder/agent-identity-drawer";
import { BuilderCanvas } from "../agent-builder/builder-canvas";
import { SubAgentDrawer, type SubAgentFormValues } from "../agent-builder/sub-agent-drawer";

const createAgentSchema = z.object({
  name: z.string().trim().min(1, "Name is required"),
  description: z.string().trim().optional(),
  system_prompt: z.string().trim().min(1, "Instructions are required"),
});

type CreateAgentValues = z.infer<typeof createAgentSchema>;

export const AgentCreatePage = () => {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [showChat, setShowChat] = useState<boolean>(false);
  const [agentDrawerOpen, setAgentDrawerOpen] = useState<boolean>(false);
  const [subAgentDrawerOpen, setSubAgentDrawerOpen] = useState<boolean>(false);
  const [editingSubAgent, setEditingSubAgent] = useState<SubAgent | null>(null);
  const [subAgents, setSubAgents] = useState<SubAgent[]>([]);
  const [selectedTools, setSelectedTools] = useState<AgentToolRef[]>([]);
  const [selectedModelId, setSelectedModelId] = useState<string>("default");
  const { width, isDragging, handlePointerDown } = useResizablePanel({
    initialWidth: 380,
    minWidth: 300,
    maxWidth: 560,
  });

  const form = useForm<CreateAgentValues>({
    resolver: zodResolver(createAgentSchema),
    defaultValues: { name: "", description: "", system_prompt: "" },
    mode: "onChange",
  });
  const values = form.watch();

  const draftAgent: Agent = {
    id: "new",
    name: values.name || "Untitled Agent",
    description: values.description ?? "",
    system_prompt: values.system_prompt ?? "",
    llm_model_id: selectedModelId,
    tools: selectedTools,
    sub_agents: subAgents,
  };

  const { mutate: createAgent, isPending: isCreating } = useMutation({
    mutationFn: () =>
      agentService.createAgent({
        name: draftAgent.name,
        description: draftAgent.description,
        system_prompt: draftAgent.system_prompt,
        tools: selectedTools.map((tool) => tool.id),
        sub_agents: subAgents.map((subAgent) => ({
          name: subAgent.name,
          description: subAgent.description,
          system_prompt: subAgent.system_prompt,
          tools: subAgent.tools.map((tool) => tool.id),
        })),
        llm_model_id: selectedModelId,
      }),
    onSuccess: (createdAgent) => {
      queryClient.setQueryData<Agent[]>(["agents"], (prev) =>
        prev ? [...prev, createdAgent] : [createdAgent],
      );
      queryClient.setQueryData(["agent", createdAgent.id], createdAgent);
      toast.success("Agent created");
      router.push(`/agents/${createdAgent.id}/builder`);
    },
    onError: () => {
      toast.error("Failed to create agent. Please try again.");
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

  const handleDeleteSubAgent = (id: string) => {
    setSubAgents((prev) => prev.filter((subAgent) => subAgent.id !== id));
  };

  const handleSubmitSubAgent = (subAgentValues: SubAgentFormValues) => {
    if (editingSubAgent) {
      setSubAgents((prev) =>
        prev.map((subAgent) =>
          subAgent.id === editingSubAgent.id
            ? {
                ...subAgent,
                ...subAgentValues,
                description: subAgentValues.description ?? "",
              }
            : subAgent,
        ),
      );
    } else {
      setSubAgents((prev) => [
        ...prev,
        {
          id: crypto.randomUUID(),
          name: subAgentValues.name,
          description: subAgentValues.description ?? "",
          system_prompt: subAgentValues.system_prompt,
          tools: subAgentValues.tools,
        },
      ]);
    }
    setSubAgentDrawerOpen(false);
  };

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-3 border-b border-border-soft px-4 py-3">
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          aria-label="Back to agents"
          className="text-muted-foreground hover:text-foreground"
          asChild
        >
          <Link href="/agents">
            <ArrowLeft className="size-4" />
          </Link>
        </Button>
        <AgentAvatar name={draftAgent.name} className="size-8 text-xs" />
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold">{draftAgent.name}</p>
          <p className="truncate text-xs text-muted-foreground">
            {draftAgent.description || "Agent description..."}
          </p>
        </div>
        <Button
          type="button"
          size="sm"
          className="ml-auto"
          disabled={!form.formState.isValid}
          loading={isCreating}
          onClick={() => createAgent()}
        >
          Create Agent
        </Button>
      </div>

      <div className="flex min-h-0 flex-1">
        {showChat && (
          <>
            <div style={{ width }} className="flex h-full shrink-0">
              <ChatPanel
                agent={draftAgent}
                isLoading={false}
                showHeader={false}
                disabled
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
            agent={draftAgent}
            isLoading={false}
            showChat={showChat}
            onToggleChat={() => setShowChat((prev) => !prev)}
            onAgentClick={() => setAgentDrawerOpen(true)}
            onAddSubAgent={handleAddSubAgentClick}
            onEditSubAgent={handleEditSubAgentClick}
            onDeleteSubAgent={handleDeleteSubAgent}
            selectedTools={selectedTools}
            onToggleTool={handleToggleTool}
            onRemoveTool={handleRemoveTool}
          />
        </div>
      </div>

      <AgentIdentityDrawer
        agent={draftAgent}
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
      />
    </div>
  );
};
