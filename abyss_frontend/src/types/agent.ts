import type { ToolPermission } from "./mcp";

export interface AgentToolRef {
  id: string;
  name: string;
  display_name: string;
}

export interface SubAgent {
  id: string;
  name: string;
  description: string;
  system_prompt: string;
  tools: AgentToolRef[];
}

export interface Agent {
  id: string;
  name: string;
  description: string;
  system_prompt: string;
  llm_model_id: string;
  tools: AgentToolRef[];
  sub_agents: SubAgent[];
}

export interface SubAgentRequest {
  name: string;
  description: string;
  system_prompt: string;
  tools: string[];
}

export interface AgentRequest {
  name: string;
  description: string;
  system_prompt: string;
  tools: string[];
  sub_agents: SubAgentRequest[];
  llm_model_id: string;
}

export interface SubAgentUpdateRequest {
  id: string;
  name: string;
  description: string;
  system_prompt: string;
  tools: string[];
}

export interface AgentUpdateRequest {
  name?: string;
  description?: string;
  system_prompt?: string;
  tools?: string[];
  sub_agents?: SubAgentUpdateRequest[];
  llm_model_id?: string;
}

export interface Tool {
  id: string;
  name: string;
  display_name: string;
  description: string;
  connection_id: string;
  connection_name: string;
  permission_state: ToolPermission;
}
