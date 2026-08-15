import { Handle, Position, type Node, type NodeProps } from "@xyflow/react";
import { Paperclip, Pencil, Plus, Trash2, X } from "lucide-react";

import { Button, Heading, Skeleton } from "@/components/ui";
import { AddServerDialog } from "@/components/pages/mcp/add-server-dialog";
import type { Agent, AgentToolRef, SubAgent, Tool } from "@/types";
import { ToolboxToolsPopover } from "./toolbox-tools-popover";

export enum BuilderNodeId {
  Agent = "agent",
  Toolbox = "toolbox",
  SubAgents = "sub-agents",
  Skills = "skills",
}

export type AgentNodeType = Node<
  { agent?: Agent; isLoading: boolean },
  "agentNode"
>;
export type ToolboxNodeType = Node<
  {
    selectedTools: AgentToolRef[];
    selectedIds: Set<string>;
    onToggleTool: (tool: Tool) => void;
    onRemoveTool: (id: string) => void;
  },
  "toolboxNode"
>;
export type SubAgentsNodeType = Node<
  {
    subAgents: SubAgent[];
    onAddClick: () => void;
    onEditClick: (subAgent: SubAgent) => void;
    onDeleteClick: (id: string) => void;
  },
  "subAgentsNode"
>;
export type SkillsNodeType = Node<Record<string, never>, "skillsNode">;

function NodeHeader({ label, action }: { label: string; action?: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-2 border-b border-border-soft bg-surface px-3 py-2">
      <Heading as="div" size="xs">
        {label}
      </Heading>
      {action}
    </div>
  );
}

export function AgentNode({ data }: NodeProps<AgentNodeType>) {
  return (
    <div className="w-72 overflow-hidden rounded-xl border border-border bg-surface-raised shadow-sm">
      <NodeHeader label="Agent" />
      <div className="border-b border-border-soft p-3">
        {data.isLoading ? (
          <Skeleton className="h-4 w-32" />
        ) : (
          <span className="text-sm font-semibold">
            {data.agent?.name ?? "Untitled Agent"}
          </span>
        )}
      </div>
      <NodeHeader
        label="Instructions"
        action={
          <button
            type="button"
            className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
          >
            <Pencil className="size-3" />
            Edit
          </button>
        }
      />
      <div className="p-3">
        <p className="line-clamp-2 text-xs text-muted-foreground">
          {data.agent?.system_prompt || "No instructions configured."}
        </p>
      </div>
      <Handle type="source" position={Position.Bottom} className="bg-primary!" />
    </div>
  );
}

export function ToolboxNode({ data }: NodeProps<ToolboxNodeType>) {
  return (
    <div className="w-60 overflow-hidden rounded-xl border border-border bg-surface-raised shadow-sm">
      <Handle type="target" position={Position.Top} className="bg-primary!" />
      <NodeHeader
        label="Toolbox"
        action={
          <div className="flex items-center gap-1">
            <ToolboxToolsPopover
              selectedIds={data.selectedIds}
              onToggleTool={data.onToggleTool}
              trigger={
                <Button
                  type="button"
                  variant="ghost"
                  size="xs"
                  onClick={(event) => event.stopPropagation()}
                >
                  <Plus className="size-3.5" />
                  Add
                </Button>
              }
            />
            <AddServerDialog
              trigger={
                <Button
                  type="button"
                  variant="ghost"
                  size="xs"
                  onClick={(event) => event.stopPropagation()}
                >
                  <Paperclip className="size-3.5" />
                  MCP
                </Button>
              }
            />
          </div>
        }
      />
      <div className="nowheel flex max-h-48 flex-col gap-1 overflow-y-auto p-3">
        {data.selectedTools.length > 0 ? (
          data.selectedTools.map((tool) => (
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
                onClick={(event) => {
                  event.stopPropagation();
                  data.onRemoveTool(tool.id);
                }}
              >
                <X className="size-3" />
              </button>
            </div>
          ))
        ) : (
          <p className="px-1.5 text-xs text-muted-foreground">No tools configured</p>
        )}
      </div>
    </div>
  );
}

export function SubAgentsNode({ data }: NodeProps<SubAgentsNodeType>) {
  return (
    <div className="w-60 overflow-hidden rounded-xl border border-border bg-surface-raised shadow-sm">
      <Handle type="target" position={Position.Top} className="bg-primary!" />
      <NodeHeader
        label="Sub-agents"
        action={
          <Button
            type="button"
            variant="ghost"
            size="xs"
            onClick={(event) => {
              event.stopPropagation();
              data.onAddClick();
            }}
          >
            <Plus className="size-3.5" />
            Add
          </Button>
        }
      />
      <div className="flex flex-col gap-1 p-3">
        {data.subAgents.length > 0 ? (
          data.subAgents.map((subAgent) => (
            <div
              key={subAgent.id}
              className="flex items-center justify-between gap-2 rounded-md px-1.5 py-1 hover:bg-muted"
            >
              <span className="truncate text-xs text-foreground">
                {subAgent.name}
              </span>
              <div className="flex shrink-0 items-center gap-0.5">
                <button
                  type="button"
                  aria-label="Edit sub-agent"
                  className="flex size-5 items-center justify-center rounded text-muted-foreground hover:text-foreground"
                  onClick={(event) => {
                    event.stopPropagation();
                    data.onEditClick(subAgent);
                  }}
                >
                  <Pencil className="size-3" />
                </button>
                <button
                  type="button"
                  aria-label="Delete sub-agent"
                  className="flex size-5 items-center justify-center rounded text-muted-foreground hover:text-destructive"
                  onClick={(event) => {
                    event.stopPropagation();
                    data.onDeleteClick(subAgent.id);
                  }}
                >
                  <Trash2 className="size-3" />
                </button>
              </div>
            </div>
          ))
        ) : (
          <p className="px-1.5 text-xs text-muted-foreground">No sub-agents configured</p>
        )}
      </div>
    </div>
  );
}

export function SkillsNode() {
  return (
    <div className="w-60 overflow-hidden rounded-xl border border-dashed border-border bg-surface-raised/60 opacity-80 shadow-sm">
      <Handle type="target" position={Position.Top} className="bg-muted-foreground!" />
      <NodeHeader
        label="Skills"
        action={
          <Button
            type="button"
            variant="ghost"
            size="icon-xs"
            aria-label="Add skill"
            disabled
          >
            <Plus className="size-3.5" />
          </Button>
        }
      />
      <div className="p-3">
        <p className="text-xs text-muted-foreground">
          Coming soon — reusable capabilities you can attach to any agent.
        </p>
      </div>
    </div>
  );
}
