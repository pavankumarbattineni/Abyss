"use client";

import { useState } from "react";
import { Check, ChevronDown } from "lucide-react";
import { toast } from "sonner";

import {
  Button,
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
  Drawer,
  DrawerContent,
  DrawerDescription,
  DrawerHeader,
  DrawerTitle,
  Heading,
  Input,
  Label,
  Textarea,
} from "@/components/ui";
import type { Agent } from "@/types";
import { ModelSection } from "./model-section";

interface AgentIdentityDrawerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  agent?: Agent;
  editable?: boolean;
  nameValue?: string;
  descriptionValue?: string;
  instructionsValue?: string;
  modelValue?: string;
  onNameChange?: (value: string) => void;
  onDescriptionChange?: (value: string) => void;
  onInstructionsChange?: (value: string) => void;
  onModelChange?: (value: string) => void;
}

function SectionHeader({ title }: { title: string }) {
  return (
    <CollapsibleTrigger className="group flex w-full items-center justify-between gap-2 py-1 text-left">
      <Heading as="h3" size="sm" className="uppercase">
        {title}
      </Heading>
      <ChevronDown className="size-4 transition-transform group-data-[state=closed]:-rotate-90" />
    </CollapsibleTrigger>
  );
}

export function AgentIdentityDrawer({
  open,
  onOpenChange,
  agent,
  editable = false,
  nameValue,
  descriptionValue,
  instructionsValue,
  modelValue,
  onNameChange,
  onDescriptionChange,
  onInstructionsChange,
  onModelChange,
}: AgentIdentityDrawerProps) {
  const [modelNeedsApiKey, setModelNeedsApiKey] = useState<boolean>(false);

  const requestClose = () => {
    if (modelNeedsApiKey) {
      toast.error("Add an API key for the selected model before closing.");
      return;
    }
    onOpenChange(false);
  };

  return (
    <Drawer
      open={open}
      onOpenChange={(nextOpen) => (nextOpen ? onOpenChange(true) : requestClose())}
      direction="right"
      modal={false}
    >
      <DrawerContent className="data-[vaul-drawer-direction=right]:w-1/2 data-[vaul-drawer-direction=right]:sm:max-w-none">
        <DrawerHeader className="flex-row items-start justify-between gap-3 pr-12">
          <div className="flex flex-col gap-0.5">
            <DrawerTitle>Agent</DrawerTitle>
            <DrawerDescription>
              {editable
                ? "Name your agent and describe how it should behave."
                : "Identity and instructions for this agent."}
            </DrawerDescription>
          </div>
          {editable && (
            <Button
              type="button"
              size="sm"
              className="shrink-0"
              onClick={requestClose}
            >
              <Check className="size-4" />
              Done
            </Button>
          )}
        </DrawerHeader>

        <div className="flex flex-1 flex-col gap-5 overflow-y-auto p-4">
          {editable ? (
            <>
              <Collapsible defaultOpen className="flex flex-col gap-3">
                <SectionHeader title="Identity" />
                <CollapsibleContent className="flex flex-col gap-4">
                  <div className="flex flex-col gap-1.5">
                    <Label htmlFor="agent-name">
                      Name <span className="text-destructive">*</span>
                    </Label>
                    <Input
                      id="agent-name"
                      autoFocus
                      value={nameValue}
                      onChange={(event) => onNameChange?.(event.target.value)}
                      placeholder="Untitled Agent"
                    />
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <Label htmlFor="agent-description">Description</Label>
                    <Input
                      id="agent-description"
                      value={descriptionValue}
                      onChange={(event) => onDescriptionChange?.(event.target.value)}
                      placeholder="What does this agent do?"
                    />
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <Label htmlFor="agent-instructions">
                      Instructions <span className="text-destructive">*</span>
                    </Label>
                    <Textarea
                      id="agent-instructions"
                      value={instructionsValue}
                      onChange={(event) => onInstructionsChange?.(event.target.value)}
                      placeholder="How should this agent behave?"
                      className="min-h-40"
                    />
                  </div>
                </CollapsibleContent>
              </Collapsible>

              <Collapsible defaultOpen className="flex flex-col gap-3 border-t border-border-soft pt-4">
                <SectionHeader title="Advanced settings" />
                <CollapsibleContent>
                  <ModelSection
                    value={modelValue}
                    onChange={(value) => onModelChange?.(value)}
                    onNeedsApiKeyChange={setModelNeedsApiKey}
                  />
                </CollapsibleContent>
              </Collapsible>
            </>
          ) : (
            <>
              <div className="flex flex-col gap-1">
                <span className="text-xs font-medium text-muted-foreground">
                  Name
                </span>
                <p className="text-sm">{agent?.name ?? "Untitled Agent"}</p>
              </div>
              <div className="flex flex-col gap-1">
                <span className="text-xs font-medium text-muted-foreground">
                  Description
                </span>
                <p className="text-sm text-muted-foreground">
                  {agent?.description || "No description yet."}
                </p>
              </div>
              <div className="flex flex-col gap-1">
                <span className="text-xs font-medium text-muted-foreground">
                  Instructions
                </span>
                <p className="whitespace-pre-wrap text-sm text-muted-foreground">
                  {agent?.system_prompt || "No instructions configured."}
                </p>
              </div>
            </>
          )}
        </div>
      </DrawerContent>
    </Drawer>
  );
}
