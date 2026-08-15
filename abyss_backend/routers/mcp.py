from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.ext.asyncio import AsyncSession

from database.session import get_async_session
from schemas.mcp import (
    MCPConnectionCreate, MCPConnectionResponse, MCPConnectionStatusUpdate, MCPConnectionUpdate,
    MCPRefreshResponse, MCPToolPermissionUpdate, MCPToolResponse,
)
from services.mcp_service import MCPService
from utils.auth import get_current_user, get_current_user_flexible

router = APIRouter(tags=["mcp"])
mcp_service = MCPService()


@router.post("/mcp-connections", response_model=MCPConnectionResponse, status_code=status.HTTP_201_CREATED)
async def create_mcp_connection(
    request: MCPConnectionCreate,
    user_id: str = Depends(get_current_user),
    db: AsyncSession = Depends(get_async_session),
):
    """Register an MCP server connection for the authenticated user.

    The MCP server is contacted and validated before the connection is saved.
    If the URL is unreachable or the API key is invalid the request is rejected
    with a 422 and the connection is not stored. On success, tools are synced
    immediately and available for agents.

    Args:
        request: MCP connection details — name, URL, api_key, and transport.
        user_id: JWT-authenticated user ID (injected by dependency).
        db: Async database session (injected by dependency).

    Returns:
        The created MCPConnectionResponse with the synced tool count.

    Raises:
        HTTPException 422: Duplicate URL, unreachable server, or invalid API key.
    """
    conn, tool_count = await mcp_service.create_mcp_connection(db, user_id, request)
    resp = MCPConnectionResponse.model_validate(conn)
    resp.tools_count = tool_count
    return resp


@router.get("/mcp-connections", response_model=list[MCPConnectionResponse])
async def list_mcp_connections(
    user_id: str = Depends(get_current_user_flexible),
    db: AsyncSession = Depends(get_async_session),
):
    """List all MCP connections belonging to the authenticated user.

    Args:
        user_id: JWT-authenticated user ID (injected by dependency).
        db: Async database session (injected by dependency).

    Returns:
        List of MCPConnectionResponse objects, each including tools_count.
    """
    rows = await mcp_service.get_mcp_connections(db, user_id)
    result = []
    for conn, tools_count in rows:
        resp = MCPConnectionResponse.model_validate(conn)
        resp.tools_count = tools_count
        result.append(resp)
    return result


@router.patch("/mcp-connections/{connection_id}")
async def update_mcp_connection(
    connection_id: str,
    request: MCPConnectionUpdate,
    user_id: str = Depends(get_current_user),
    db: AsyncSession = Depends(get_async_session),
):
    """Rename an MCP connection.

    Only the display name can be changed. To change the server URL or
    credentials, delete this connection and create a new one.

    Args:
        connection_id: The MCP connection's unique identifier.
        request: New name for the connection.
        user_id: JWT-authenticated user ID (injected by dependency).
        db: Async database session (injected by dependency).

    Returns:
        Confirmation message with the updated name.

    Raises:
        HTTPException 422: If not found, not owned by the user, or name unchanged.
    """
    conn = await mcp_service.update_mcp_connection(db, user_id, connection_id, request)
    return {"message": f"Updated Successfully to '{conn.name}'"}


@router.delete("/mcp-connections/{connection_id}")
async def delete_mcp_connection(
    connection_id: str,
    user_id: str = Depends(get_current_user),
    db: AsyncSession = Depends(get_async_session),
):
    """Soft-delete an MCP connection and cascade cleanup.

    Deactivates all associated tools and AgentTool links, and evicts
    affected agents from the in-memory tool registry.

    Args:
        connection_id: The MCP connection's unique identifier.
        user_id: JWT-authenticated user ID (injected by dependency).
        db: Async database session (injected by dependency).

    Returns:
        Confirmation message including the connection name.

    Raises:
        HTTPException 422: If not found or not owned by the user.
    """
    conn_name = await mcp_service.delete_mcp_connection(db, user_id, connection_id)
    return {"message": f"{conn_name} mcp connection deleted successfully"}


@router.patch("/mcp-connections/{connection_id}/status", response_model=MCPConnectionResponse)
async def set_mcp_connection_status(
    connection_id: str,
    request: MCPConnectionStatusUpdate,
    user_id: str = Depends(get_current_user),
    db: AsyncSession = Depends(get_async_session),
):
    """Connect or disconnect an MCP connection without deleting it.

    Disconnecting temporarily pauses the connection: its configuration,
    MCPTool catalog, and every agent's tool assignments are left untouched —
    only its tools are pulled from the live registry so agents stop invoking
    them. Connecting re-validates the server is reachable, re-syncs its tool
    list, and restores it to every agent that still has an active assignment
    to one of its tools — no manual reassignment needed either way.

    Args:
        connection_id: The MCP connection's unique identifier.
        request: The target status — "connected" or "disconnected".
        user_id: JWT-authenticated user ID (injected by dependency).
        db: Async database session (injected by dependency).

    Returns:
        MCPConnectionResponse reflecting the new status and current tool count.

    Raises:
        HTTPException 422: If not found, not owned by the user, already in
            the requested status, or (when connecting) the MCP server is
            unreachable (left disconnected).
    """
    conn, tool_count = await mcp_service.set_connection_status(
        db, user_id, connection_id, request.status
    )
    resp = MCPConnectionResponse.model_validate(conn)
    resp.tools_count = tool_count
    return resp


@router.post("/mcp-connections/{connection_id}/refresh", response_model=MCPRefreshResponse)
async def refresh_mcp_tools(
    connection_id: str,
    user_id: str = Depends(get_current_user),
    db: AsyncSession = Depends(get_async_session),
):
    """Sync the latest tool definitions from the MCP server.

    Fetches the current tool list from the remote server and upserts it into
    the local mcp_tools catalog:
    - New tools are inserted.
    - Existing tools are updated if their metadata changed.
    - Tools no longer present on the server are deactivated.
    - AgentTool links to removed tools are cascaded inactive.
    - In-memory tool registry is reloaded for all affected agents.

    Args:
        connection_id: The MCP connection's unique identifier.
        user_id: JWT-authenticated user ID (injected by dependency).
        db: Async database session (injected by dependency).

    Returns:
        MCPRefreshResponse with the connection_id, synced tool count, and message.

    Raises:
        HTTPException 422: If connection not found, not owned by user,
            or the MCP server is unreachable.
    """
    conn_name, tool_count = await mcp_service.refresh_mcp_connection_tools(
        db, user_id, connection_id
    )
    return MCPRefreshResponse(
        connection_id=connection_id,
        tool_count=tool_count,
        message=f"Synced {tool_count} tool(s) from '{conn_name}'",
    )


@router.get("/mcp-tools", response_model=list[MCPToolResponse])
async def list_mcp_tools(
    connection_id: Optional[str] = Query(default=None, description="Filter tools by a specific MCP connection ID. Omit to return tools from all connections."),
    user_id: str = Depends(get_current_user_flexible),
    db: AsyncSession = Depends(get_async_session),
):
    """List active MCP tools for the authenticated user.

    Without a filter, returns every active tool across all of the user's MCP
    connections. Use the optional connection_id query parameter to narrow
    results to a single connection.

    Use this endpoint to discover valid tool IDs before creating or updating
    an agent's tools list.

    Args:
        connection_id: Optional MCP connection ID to filter by.
        user_id: JWT-authenticated user ID (injected by dependency).
        db: Async database session (injected by dependency).

    Returns:
        List of MCPToolResponse objects, each including connection_id and
        connection_name identifying the source connection.

    Raises:
        HTTPException 422: If connection_id is supplied but not found or not
            owned by the user.
    """
    return await mcp_service.list_mcp_tools(db, user_id, connection_id)


@router.patch("/mcp-tools", response_model=list[MCPToolResponse])
async def set_tool_permission(
    request: MCPToolPermissionUpdate,
    connection_id: Optional[str] = Query(default=None, description="Apply permission_state to every active tool under this connection."),
    tool_id: Optional[str] = Query(default=None, description="Apply permission_state to just this tool."),
    user_id: str = Depends(get_current_user),
    db: AsyncSession = Depends(get_async_session),
):
    """Set a tool's permission gate: allowed, requires_approval, or blocked.

    Exactly one of connection_id/tool_id must be supplied — connection_id
    applies permission_state to every active tool under that connection in
    one call, tool_id scopes it to just that one tool. This is global per
    tool, not per-agent — every agent that has an affected tool assigned
    shares the same gate. 'blocked' removes the tool from every agent's
    available tool set immediately; re-enabling a previously-blocked tool may
    require POST /mcp-connections/{connection_id}/refresh to pick it back up
    if the in-memory registry had already dropped it.

    Args:
        request: The new permission_state.
        connection_id: Scope to every tool under this connection.
        tool_id: Scope to just this tool.
        user_id: JWT-authenticated user ID (injected by dependency).
        db: Async database session (injected by dependency).

    Returns:
        MCPToolResponse for every tool actually updated — a single-item list
        when scoped by tool_id.

    Raises:
        HTTPException 422: If neither or both of connection_id/tool_id are
            supplied, or if the referenced tool/connection is not found or
            not owned by the user.
    """
    if (connection_id is None) == (tool_id is None):
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail="Provide exactly one of connection_id or tool_id",
        )
    return await mcp_service.set_tool_permission(
        db, user_id, request.permission_state, connection_id=connection_id, tool_id=tool_id
    )
