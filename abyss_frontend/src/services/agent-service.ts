import { api } from "@/lib/axios";
import type { Agent, AgentRequest, AgentUpdateRequest, SubAgentRequest, Tool } from "@/types";

class AgentService {
  async getAgents(): Promise<Agent[]> {
    const { data } = await api.get<Agent[]>("/agents");
    return data;
  }

  async createAgent(payload: AgentRequest): Promise<Agent> {
    const { data } = await api.post<Agent>("/agents", payload);
    return data;
  }

  async getAgent(id: string): Promise<Agent> {
    const { data } = await api.get<Agent>(`/agents/${id}`);
    return data;
  }

  async updateAgent(id: string, payload: AgentUpdateRequest): Promise<Agent> {
    const { data } = await api.put<Agent>(`/agents/${id}`, payload);
    return data;
  }

  async deleteAgent(id: string): Promise<void> {
    await api.delete(`/agents/${id}`);
  }

  async createSubAgent(agentId: string, payload: SubAgentRequest): Promise<Agent> {
    const { data } = await api.post<Agent>(`/agents/${agentId}/sub-agents`, payload);
    return data;
  }

  async deleteSubAgent(subAgentId: string): Promise<void> {
    await api.delete(`/agents/sub-agents/${subAgentId}`);
  }

  async getTools(): Promise<Tool[]> {
    const { data } = await api.get<Tool[]>("/mcp-tools");
    return data;
  }
}

export const agentService = new AgentService();
