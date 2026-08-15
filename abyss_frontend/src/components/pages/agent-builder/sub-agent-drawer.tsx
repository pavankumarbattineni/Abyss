"use client";

import { useState } from "react";
import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import { Check, Plus, X } from "lucide-react";
import { z } from "zod";

import {
  Button,
  Drawer,
  DrawerContent,
  DrawerDescription,
  DrawerHeader,
  DrawerTitle,
  FormError,
  Input,
  Label,
  Textarea,
} from "@/components/ui";
import type { AgentToolRef, SubAgent, Tool } from "@/types";
import { ToolboxToolsPopover } from "./toolbox-tools-popover";

const subAgentSchema = z.object({
  name: z.string().trim().min(1, "Name is required"),
  description: z.string().trim().optional(),
  system_prompt: z.string().trim().min(1, "Instructions are required"),
});

type SubAgentFieldValues = z.infer<typeof subAgentSchema>;

export type SubAgentFormValues = SubAgentFieldValues & { tools: AgentToolRef[] };

interface SubAgentDrawerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  subAgent?: SubAgent | null;
  onSubmit: (values: SubAgentFormValues) => void;
  isSubmitting?: boolean;
}

export function SubAgentDrawer({
  open,
  onOpenChange,
  subAgent,
  onSubmit,
  isSubmitting = false,
}: SubAgentDrawerProps) {
  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isValid },
  } = useForm<SubAgentFieldValues>({
    resolver: zodResolver(subAgentSchema),
    defaultValues: { name: "", description: "", system_prompt: "" },
    mode: "onChange",
  });
  const [selectedTools, setSelectedTools] = useState<AgentToolRef[]>([]);
  const [seededKey, setSeededKey] = useState<string | null>(null);
  const openKey = open ? (subAgent?.id ?? "__new__") : null;

  if (open && openKey !== seededKey) {
    setSeededKey(openKey);
    reset({
      name: subAgent?.name ?? "",
      description: subAgent?.description ?? "",
      system_prompt: subAgent?.system_prompt ?? "",
    });
    setSelectedTools(subAgent?.tools ?? []);
  } else if (!open && seededKey !== null) {
    setSeededKey(null);
  }

  const selectedIds = new Set(selectedTools.map((tool) => tool.id));

  const handleToggleTool = (tool: Tool) => {
    setSelectedTools((prev) =>
      prev.some((selected) => selected.id === tool.id)
        ? prev.filter((selected) => selected.id !== tool.id)
        : [...prev, { id: tool.id, name: tool.name, display_name: tool.display_name }],
    );
  };

  const handleRemoveTool = (id: string) => {
    setSelectedTools((prev) => prev.filter((tool) => tool.id !== id));
  };

  return (
    <Drawer open={open} onOpenChange={onOpenChange} direction="right">
      <DrawerContent className="data-[vaul-drawer-direction=right]:w-1/2 data-[vaul-drawer-direction=right]:sm:max-w-none">
        <form
          onSubmit={handleSubmit((values) => {
            onSubmit({ ...values, tools: selectedTools });
          })}
          className="flex flex-1 flex-col"
        >
          <DrawerHeader className="flex-row items-start justify-between gap-3 pr-12">
            <div className="flex flex-col gap-0.5">
              <DrawerTitle>Sub-agent</DrawerTitle>
              <DrawerDescription>
                Name this sub-agent and describe how it should behave.
              </DrawerDescription>
            </div>
            <Button
              type="submit"
              size="sm"
              className="shrink-0"
              disabled={!isValid || isSubmitting}
              loading={isSubmitting}
            >
              <Check className="size-4" />
              {subAgent ? "Save" : "Add"}
            </Button>
          </DrawerHeader>

          <div className="flex flex-1 flex-col gap-4 overflow-y-auto p-4">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="sub-agent-name">
                Name <span className="text-destructive">*</span>
              </Label>
              <Input
                id="sub-agent-name"
                autoFocus
                placeholder="Untitled Sub-agent"
                {...register("name")}
              />
              <FormError message={errors.name?.message} />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="sub-agent-description">Description</Label>
              <Input
                id="sub-agent-description"
                placeholder="What does this sub-agent do?"
                {...register("description")}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="sub-agent-instructions">
                Instructions <span className="text-destructive">*</span>
              </Label>
              <Textarea
                id="sub-agent-instructions"
                placeholder="How should this sub-agent behave?"
                className="min-h-48"
                {...register("system_prompt")}
              />
              <FormError message={errors.system_prompt?.message} />
            </div>

            <div className="flex flex-col gap-1.5">
              <div className="flex items-center justify-between">
                <Label>Tools</Label>
                <ToolboxToolsPopover
                  selectedIds={selectedIds}
                  onToggleTool={handleToggleTool}
                  trigger={
                    <Button type="button" variant="ghost" size="xs">
                      <Plus className="size-3.5" />
                      Add
                    </Button>
                  }
                />
              </div>
              {selectedTools.length > 0 ? (
                <div className="flex flex-col gap-1 rounded-lg border border-border-soft p-1.5">
                  {selectedTools.map((tool) => (
                    <div
                      key={tool.id}
                      className="flex items-center justify-between gap-2 rounded-md px-1.5 py-1 hover:bg-muted"
                    >
                      <span className="truncate text-xs text-foreground">
                        {tool.display_name}
                      </span>
                      <button
                        type="button"
                        aria-label="Remove tool"
                        className="flex size-5 shrink-0 items-center justify-center rounded text-muted-foreground hover:text-destructive"
                        onClick={() => handleRemoveTool(tool.id)}
                      >
                        <X className="size-3" />
                      </button>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-xs text-muted-foreground">No tools attached</p>
              )}
            </div>
          </div>
        </form>
      </DrawerContent>
    </Drawer>
  );
}
