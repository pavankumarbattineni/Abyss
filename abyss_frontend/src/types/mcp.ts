export type McpConnectionStatus = "connected" | "disconnected";

export interface McpConnection {
  id: string;
  name: string;
  url: string;
  transport: string;
  status: McpConnectionStatus;
  tools_count: number;
  sync_warning: string | null;
}

export interface McpConnectionRequest {
  name: string;
  url: string;
  api_key: string;
  transport: string;
}

export interface McpConnectionUpdateRequest {
  name: string;
}

export type ToolPermission = "allowed" | "requires_approval" | "blocked";

export interface ToolPermissionRequest {
  permission_state: ToolPermission;
}
