"use client";

import { useEffect } from "react";
import { ReactFlow, Controls, Panel, useNodesState, type Edge } from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { PanelLeft } from "lucide-react";

import { Button } from "@/components/ui";
import type { Agent, AgentToolRef, SubAgent, Tool } from "@/types";
import {
  AgentNode,
  BuilderNodeId,
  ToolboxNode,
  SubAgentsNode,
  SkillsNode,
  type AgentNodeType,
  type ToolboxNodeType,
  type SubAgentsNodeType,
  type SkillsNodeType,
} from "./builder-nodes";

const nodeTypes = {
  agentNode: AgentNode,
  toolboxNode: ToolboxNode,
  subAgentsNode: SubAgentsNode,
  skillsNode: SkillsNode,
};

type BuilderNode =
  | AgentNodeType
  | ToolboxNodeType
  | SubAgentsNodeType
  | SkillsNodeType;

const INITIAL_NODES: BuilderNode[] = [
  {
    id: BuilderNodeId.Agent,
    type: "agentNode",
    position: { x: 424, y: 40 },
    data: { agent: undefined, isLoading: true },
  },
  {
    id: BuilderNodeId.Toolbox,
    type: "toolboxNode",
    position: { x: 120, y: 300 },
    data: {
      selectedTools: [],
      selectedIds: new Set(),
      onToggleTool: () => {},
      onRemoveTool: () => {},
    },
  },
  {
    id: BuilderNodeId.SubAgents,
    type: "subAgentsNode",
    position: { x: 430, y: 300 },
    data: {
      subAgents: [],
      onAddClick: () => {},
      onEditClick: () => {},
      onDeleteClick: () => {},
    },
  },
  {
    id: BuilderNodeId.Skills,
    type: "skillsNode",
    position: { x: 740, y: 300 },
    data: {},
  },
];

const edges: Edge[] = [
  {
    id: "agent-toolbox",
    source: BuilderNodeId.Agent,
    target: BuilderNodeId.Toolbox,
    type: "default",
    style: { strokeDasharray: "4 4" },
  },
  {
    id: "agent-sub-agents",
    source: BuilderNodeId.Agent,
    target: BuilderNodeId.SubAgents,
    type: "default",
    style: { strokeDasharray: "4 4" },
  },
  {
    id: "agent-skills",
    source: BuilderNodeId.Agent,
    target: BuilderNodeId.Skills,
    type: "default",
    style: { strokeDasharray: "4 4" },
  },
];

interface BuilderCanvasProps {
  agent?: Agent;
  isLoading: boolean;
  showChat: boolean;
  onToggleChat: () => void;
  onAgentClick: () => void;
  onAddSubAgent: () => void;
  onEditSubAgent: (subAgent: SubAgent) => void;
  onDeleteSubAgent: (id: string) => void;
  selectedTools: AgentToolRef[];
  onToggleTool: (tool: Tool) => void;
  onRemoveTool: (id: string) => void;
}

export function BuilderCanvas({
  agent,
  isLoading,
  showChat,
  onToggleChat,
  onAgentClick,
  onAddSubAgent,
  onEditSubAgent,
  onDeleteSubAgent,
  selectedTools,
  onToggleTool,
  onRemoveTool,
}: BuilderCanvasProps) {
  const [nodes, setNodes, onNodesChange] =
    useNodesState<BuilderNode>(INITIAL_NODES);

  useEffect(() => {
    setNodes((prev) =>
      prev.map((node) => {
        if (node.id === BuilderNodeId.Agent) {
          return { ...node, data: { agent, isLoading } } as AgentNodeType;
        }
        if (node.id === BuilderNodeId.Toolbox) {
          return {
            ...node,
            data: {
              selectedTools,
              selectedIds: new Set(selectedTools.map((tool) => tool.id)),
              onToggleTool,
              onRemoveTool,
            },
          } as ToolboxNodeType;
        }
        if (node.id === BuilderNodeId.SubAgents) {
          return {
            ...node,
            data: {
              subAgents: agent?.sub_agents ?? [],
              onAddClick: onAddSubAgent,
              onEditClick: onEditSubAgent,
              onDeleteClick: onDeleteSubAgent,
            },
          } as SubAgentsNodeType;
        }
        return node;
      }),
    );
  }, [
    agent,
    isLoading,
    onAddSubAgent,
    onEditSubAgent,
    onDeleteSubAgent,
    selectedTools,
    onToggleTool,
    onRemoveTool,
    setNodes,
  ]);

  return (
    <ReactFlow
      nodes={nodes}
      edges={edges}
      nodeTypes={nodeTypes}
      onNodesChange={onNodesChange}
      nodesConnectable={false}
      onNodeClick={(_, node) => {
        if (node.id === BuilderNodeId.Agent) {
          onAgentClick();
        }
      }}
      fitView
      fitViewOptions={{ padding: 0.3 }}
      proOptions={{ hideAttribution: true }}
    >
      <Controls showInteractive={false} />
      <Panel position="top-left">
        <Button type="button" variant="outline" size="sm" onClick={onToggleChat}>
          <PanelLeft className="size-3.5" />
          {showChat ? "Hide Chat" : "Show Chat"}
        </Button>
      </Panel>
    </ReactFlow>
  );
}
