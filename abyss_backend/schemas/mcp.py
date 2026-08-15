from typing import Literal, Optional

from pydantic import AnyHttpUrl, BaseModel, Field

from constants import MCP_DEFAULT_TRANSPORT


class MCPConnectionCreate(BaseModel):
    name: str = Field(min_length=1, max_length=255)
    url: AnyHttpUrl
    api_key: str = Field(min_length=1, max_length=512)
    transport: Literal["streamable_http", "sse"] = MCP_DEFAULT_TRANSPORT


class MCPConnectionUpdate(BaseModel):
    name: str = Field(min_length=1, max_length=255)


class MCPConnectionStatusUpdate(BaseModel):
    status: Literal["connected", "disconnected"]


class MCPConnectionResponse(BaseModel):
    id: str
    name: str
    url: str
    transport: str
    status: Literal["connected", "disconnected"]
    tools_count: int = 0
    sync_warning: Optional[str] = None

    model_config = {"from_attributes": True}


class MCPToolResponse(BaseModel):
    id: str
    name: str
    display_name: str
    description: Optional[str] = None
    connection_id: str
    connection_name: str
    permission_state: str = "allowed"


class MCPToolPermissionUpdate(BaseModel):
    permission_state: Literal["allowed", "requires_approval", "blocked"]


class MCPRefreshResponse(BaseModel):
    connection_id: str
    tool_count: int
    message: str
