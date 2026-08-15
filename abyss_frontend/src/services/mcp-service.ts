import { api } from "@/lib/axios";
import type {
  McpConnection,
  McpConnectionRequest,
  McpConnectionStatus,
  McpConnectionUpdateRequest,
  Tool,
  ToolPermission,
} from "@/types";

class McpService {
  async getConnections(): Promise<McpConnection[]> {
    const { data } = await api.get<McpConnection[]>("/mcp-connections");
    return data;
  }

  async createConnection(payload: McpConnectionRequest): Promise<McpConnection> {
    const { data } = await api.post<McpConnection>("/mcp-connections", payload);
    return data;
  }

  async updateConnection(
    id: string,
    payload: McpConnectionUpdateRequest,
  ): Promise<McpConnection> {
    const { data } = await api.patch<McpConnection>(
      `/mcp-connections/${id}`,
      payload,
    );
    return data;
  }

  async deleteConnection(id: string): Promise<void> {
    await api.delete(`/mcp-connections/${id}`);
  }

  async refreshConnection(id: string): Promise<McpConnection> {
    const { data } = await api.post<McpConnection>(`/mcp-connections/${id}/refresh`);
    return data;
  }

  async updateConnectionStatus(
    id: string,
    status: McpConnectionStatus,
  ): Promise<McpConnection> {
    const { data } = await api.patch<McpConnection>(`/mcp-connections/${id}/status`, {
      status,
    });
    return data;
  }

  async getConnectionTools(connectionId: string): Promise<Tool[]> {
    const { data } = await api.get<Tool[]>("/mcp-tools", {
      params: { connection_id: connectionId },
    });
    return data;
  }

  async updateToolPermission(toolId: string, permission: ToolPermission): Promise<Tool[]> {
    const { data } = await api.patch<Tool[]>(
      "/mcp-tools",
      { permission_state: permission },
      { params: { tool_id: toolId } },
    );
    return data;
  }

  async updateConnectionToolsPermission(
    connectionId: string,
    permission: ToolPermission,
  ): Promise<Tool[]> {
    const { data } = await api.patch<Tool[]>(
      "/mcp-tools",
      { permission_state: permission },
      { params: { connection_id: connectionId } },
    );
    return data;
  }
}

export const mcpService = new McpService();
