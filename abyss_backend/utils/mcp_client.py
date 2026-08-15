import logging
from collections import defaultdict

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from constants import MCP_CONNECTION_STATUS_CONNECTED, TOOL_PERMISSION_BLOCKED, TOOL_PERMISSION_REQUIRES_APPROVAL
from database.models import Agent, AgentTool, MCPConnection, MCPTool
from utils.encryption import decrypt_value

logger = logging.getLogger(__name__)

# registry_id (agent.id) -> list of LangChain tools
_agent_tool_registry: dict[str, list] = {}

# registry_id (agent.id) -> {tool_name: requires_permission}
_agent_tool_permissions: dict[str, dict[str, bool]] = {}

# connection_id -> active MultiServerMCPClient instance.
# Kept alive so their internal async sessions are not garbage-collected.
_active_mcp_clients: dict[str, object] = {}


def _build_server_config(conns: list[MCPConnection]) -> dict:
    """Build a MultiServerMCPClient server config from a list of connections."""
    return {
        conn.name: {
            "url": conn.url,
            "transport": conn.transport,
            "headers": {"x-api-key": decrypt_value(conn.api_key)},
        }
        for conn in conns
    }


async def _tag_tools_with_ids(tools: list, connection_id: str, db: AsyncSession) -> None:
    """Stamp mcp_connection_id and tool_id onto each fetched LangChain tool's metadata.

    tool_id lets the tools-execution node (graph_builder.make_tools_node) put
    an exact MCPTool.id on each gated call's interrupt payload, so the
    tool-approvals endpoint can resolve "Always Allow" by primary key instead
    of by name — MCPTool.name is only unique per-connection, not globally, so
    name-based resolution alone could be ambiguous across a user's connections.
    """
    id_by_name_result = await db.execute(
        select(MCPTool.name, MCPTool.id).where(MCPTool.connection_id == connection_id)
    )
    id_by_name = {name: tid for name, tid in id_by_name_result}
    for t in tools:
        if t.metadata is None:
            t.metadata = {}
        t.metadata["mcp_connection_id"] = connection_id
        t.metadata["tool_id"] = id_by_name.get(t.name)


async def build_agent_tool_registry(db: AsyncSession) -> None:
    """Build the in-memory tool registry for all agents at startup.

    Loads all active MCPConnections grouped by user_id (multiple connections
    per user are supported). One MultiServerMCPClient is created per user
    combining all their connections.

    Args:
        db: Active async database session.
    """
    from langchain_mcp_adapters.client import MultiServerMCPClient

    conns_result = await db.execute(
        select(MCPConnection).where(
            MCPConnection.is_active == True,
            MCPConnection.status == MCP_CONNECTION_STATUS_CONNECTED,
        )
    )
    conns_by_user: dict[str, list[MCPConnection]] = defaultdict(list)
    for c in conns_result.scalars().all():
        conns_by_user[c.user_id].append(c)

    agents_result = await db.execute(
        select(Agent).where(Agent.is_active == True)
    )
    all_agents = agents_result.scalars().all()

    # Single batch query for all agents' tools — avoids N+1 on startup.
    # Blocked tools are excluded here so they never enter an agent's tool set
    # at all, regardless of AgentTool assignment.
    all_agent_ids = [a.id for a in all_agents]
    tools_by_agent: dict[str, list[str]] = defaultdict(list)
    permissions_by_agent: dict[str, dict[str, bool]] = defaultdict(dict)
    if all_agent_ids:
        batch_result = await db.execute(
            select(AgentTool.agent_id, MCPTool.name, MCPTool.permission_state)
            .join(MCPTool, AgentTool.tool_id == MCPTool.id)
            .where(
                AgentTool.agent_id.in_(all_agent_ids),
                AgentTool.is_active == True,
                MCPTool.is_active == True,
                MCPTool.permission_state != TOOL_PERMISSION_BLOCKED,
            )
        )
        for agent_id, tool_name, permission_state in batch_result:
            tools_by_agent[agent_id].append(tool_name)
            permissions_by_agent[agent_id][tool_name] = (permission_state == TOOL_PERMISSION_REQUIRES_APPROVAL)

    agents_with_tools = [
        (agent, tools_by_agent[agent.id])
        for agent in all_agents
        if tools_by_agent.get(agent.id)
    ]

    by_user: dict[str, list[tuple[Agent, list[str]]]] = defaultdict(list)
    for agent, tool_names in agents_with_tools:
        by_user[agent.user_id].append((agent, tool_names))

    loaded = 0
    for user_id, agent_entries in by_user.items():
        user_conns = conns_by_user.get(user_id)
        if not user_conns:
            continue

        # Connect to each MCP server independently so one unreachable server
        # does not block tools from the remaining servers.
        all_tools: list = []
        for conn in user_conns:
            client = MultiServerMCPClient(_build_server_config([conn]))
            try:
                conn_tools = await client.get_tools()
                await _tag_tools_with_ids(conn_tools, conn.id, db)
                all_tools.extend(conn_tools)
                _active_mcp_clients[conn.id] = client
            except Exception as exc:
                real = (
                    exc.exceptions[0]
                    if hasattr(exc, "exceptions") and exc.exceptions
                    else exc
                )
                logger.warning(
                    "MCP server '%s' unreachable (user %s): %s",
                    conn.name, user_id, real,
                )

        if not all_tools:
            continue
        for agent, tool_names in agent_entries:
            allowed = set(tool_names)
            filtered = [t for t in all_tools if t.name in allowed]
            if filtered:
                _agent_tool_registry[agent.id] = filtered
                _agent_tool_permissions[agent.id] = dict(permissions_by_agent[agent.id])
                loaded += 1

    logger.info("MCP tool registry built: %d agent(s) loaded", loaded)


def get_tools_for_agent(registry_id: str) -> list:
    """Return the cached LangChain tools for a given agent ID.

    Args:
        registry_id: An Agent.id (top-level or sub-agent).

    Returns:
        List of LangChain tool objects, or an empty list if not registered.
    """
    return _agent_tool_registry.get(registry_id, [])


def get_tool_permissions_for_agent(registry_id: str) -> dict[str, bool]:
    """Return the {tool_name: requires_permission} map for a given agent ID.

    Args:
        registry_id: An Agent.id (top-level or sub-agent).

    Returns:
        Mapping of tool name to whether it requires approval before execution.
        A tool absent from the map is treated as not requiring permission.
    """
    return _agent_tool_permissions.get(registry_id, {})


async def register_tools_for_id(
    registry_id: str,
    user_id: str,
    tools_filter: list[str],
    db: AsyncSession,
) -> None:
    """Load (or reload) MCP tools for a single agent into the registry.

    Fetches all active connections for the user and builds a unified tool set
    across all their MCP servers. Only tools named in tools_filter are stored,
    and any tool whose permission_state is 'blocked' is excluded even if the
    caller included it — blocking is a global kill switch, independent of
    what any single agent's tool assignment says.

    Args:
        registry_id: The Agent.id to key in the registry.
        user_id: The owning user's ID, used to look up their MCPConnections.
        tools_filter: Tool names this agent is allowed to use.
        db: Active async database session.
    """
    if not tools_filter:
        return

    from langchain_mcp_adapters.client import MultiServerMCPClient

    conn_result = await db.execute(
        select(MCPConnection).where(
            MCPConnection.user_id == user_id,
            MCPConnection.is_active == True,
            MCPConnection.status == MCP_CONNECTION_STATUS_CONNECTED,
        )
    )
    conns = conn_result.scalars().all()
    if not conns:
        return

    # Connect to each MCP server independently so one unreachable server
    # does not block tools from the remaining servers.
    all_tools: list = []
    reachable = 0
    for conn in conns:
        client = MultiServerMCPClient(_build_server_config([conn]))
        try:
            conn_tools = await client.get_tools()
            await _tag_tools_with_ids(conn_tools, conn.id, db)
            all_tools.extend(conn_tools)
            _active_mcp_clients[conn.id] = client
            reachable += 1
        except Exception as exc:
            real = (
                exc.exceptions[0]
                if hasattr(exc, "exceptions") and exc.exceptions
                else exc
            )
            logger.warning(
                "MCP server '%s' unreachable — skipped for agent %s: %s",
                conn.name, registry_id, real,
            )

    permission_result = await db.execute(
        select(MCPTool.name, MCPTool.permission_state).where(MCPTool.name.in_(tools_filter))
    )
    permission_by_name = {name: state for name, state in permission_result}

    allowed = {
        name for name in tools_filter
        if permission_by_name.get(name) != TOOL_PERMISSION_BLOCKED
    }
    tools = [t for t in all_tools if t.name in allowed]
    if tools:
        _agent_tool_registry[registry_id] = tools
        _agent_tool_permissions[registry_id] = {
            t.name: permission_by_name.get(t.name) == TOOL_PERMISSION_REQUIRES_APPROVAL for t in tools
        }
    logger.info(
        "Registered %d tool(s) for %s (%d/%d server(s) reachable)",
        len(tools), registry_id, reachable, len(conns),
    )


def set_tool_permission_in_registry(tool_id: str, permission_state: str) -> list[str]:
    """Apply an MCPTool.permission_state change to every agent's in-memory registry.

    Called after a static PATCH /mcp-tools/{tool_id} update or a live
    "Always Allow" decision, so already-cached tool lists/permission maps
    reflect the new state without needing a full connection refetch.

    Blocking removes the tool object from every affected agent's registry
    entirely (never offered to the LLM again). Unblocking a previously-blocked
    tool is NOT handled here — the tool object was dropped and isn't cached
    anywhere to restore, so picking it back up requires a connection refresh
    (POST /mcp-connections/{id}/refresh).

    Args:
        tool_id: The MCPTool.id whose permission_state changed.
        permission_state: The new state (see constants.TOOL_PERMISSION_*).

    Returns:
        List of affected Agent.id (top-level or sub-agent) whose compiled
        graph cache must be invalidated, since each embeds this permissions
        map in its "tools" node closure at build time.
    """
    affected: list[str] = []
    for agent_id, tools in list(_agent_tool_registry.items()):
        match = next((t for t in tools if (t.metadata or {}).get("tool_id") == tool_id), None)
        if not match:
            continue
        affected.append(agent_id)
        if permission_state == TOOL_PERMISSION_BLOCKED:
            remaining = [t for t in tools if t is not match]
            if remaining:
                _agent_tool_registry[agent_id] = remaining
            else:
                _agent_tool_registry.pop(agent_id, None)
            _agent_tool_permissions.get(agent_id, {}).pop(match.name, None)
        else:
            _agent_tool_permissions.setdefault(agent_id, {})[match.name] = (
                permission_state == TOOL_PERMISSION_REQUIRES_APPROVAL
            )
    return affected


def remove_agent_from_registry(registry_id: str) -> None:
    """Remove an agent's tools from the registry on soft-delete.

    Args:
        registry_id: The Agent.id to remove.
    """
    _agent_tool_registry.pop(registry_id, None)
    _agent_tool_permissions.pop(registry_id, None)


def remove_connection_client(connection_id: str) -> None:
    """Drop the cached MCP client for a deleted connection.

    Args:
        connection_id: The MCPConnection.id to remove.
    """
    _active_mcp_clients.pop(connection_id, None)


def evict_connection_from_registry(
    connection_id: str,
    affected_agent_ids: list[str],
) -> None:
    """Remove one connection's tools from the registry without touching other connections.

    Agents whose only tools came from this connection are removed from the
    registry entirely. Agents with tools from other connections retain them.

    Args:
        connection_id: The MCPConnection.id being deleted.
        affected_agent_ids: Agent IDs that had at least one tool from this connection.
    """
    for agent_id in affected_agent_ids:
        existing = _agent_tool_registry.get(agent_id, [])
        kept = [
            t for t in existing
            if (t.metadata or {}).get("mcp_connection_id") != connection_id
        ]
        if kept:
            _agent_tool_registry[agent_id] = kept
        else:
            _agent_tool_registry.pop(agent_id, None)


async def sync_connection_tools_in_registry(
    connection: MCPConnection,
    active_tools_by_agent: dict[str, list[str]],
    all_affected_agent_ids: list[str],
    db: AsyncSession,
) -> None:
    """Re-register tools for a single refreshed MCP connection.

    Only the refreshed connection is contacted. For each affected agent the
    tool objects from that connection are replaced with fresh ones while
    tool objects from every other connection are left untouched.

    Tool objects are identified by their mcp_connection_id metadata tag (set
    when tools are fetched), so name collisions across different connections
    are handled correctly.

    On server unreachability the stale tool objects from this connection are
    evicted from every affected agent so agents do not invoke a broken server.
    Other connections' tool objects are always preserved.

    Args:
        connection: The MCPConnection that was refreshed.
        active_tools_by_agent: Mapping of agent_id -> tool names from THIS
            connection that the agent is still allowed to use after the refresh.
        all_affected_agent_ids: Every agent that had any tool link to this
            connection, including agents whose tools were all removed.
        db: Active async database session, used to refresh each tool's
            permission_state for the permissions map (a refresh can surface
            tools whose permission_state changed since the last registration).
    """
    from langchain_mcp_adapters.client import MultiServerMCPClient

    if not all_affected_agent_ids:
        return

    client = MultiServerMCPClient(_build_server_config([connection]))
    try:
        fresh_tools = await client.get_tools()
        await _tag_tools_with_ids(fresh_tools, connection.id, db)
        _active_mcp_clients[connection.id] = client
    except Exception as exc:
        real = (
            exc.exceptions[0]
            if hasattr(exc, "exceptions") and exc.exceptions
            else exc
        )
        logger.warning(
            "MCP server '%s' unreachable during registry sync — "
            "evicting its tools from %d agent(s): %s",
            connection.name, len(all_affected_agent_ids), real,
        )
        _active_mcp_clients.pop(connection.id, None)
        evict_connection_from_registry(connection.id, all_affected_agent_ids)
        return

    fresh_by_name = {t.name: t for t in fresh_tools}

    permission_result = await db.execute(
        select(MCPTool.name, MCPTool.permission_state).where(MCPTool.connection_id == connection.id)
    )
    permission_by_name = {name: state for name, state in permission_result}

    for agent_id in all_affected_agent_ids:
        allowed_from_conn = {
            n for n in active_tools_by_agent.get(agent_id, [])
            if permission_by_name.get(n) != TOOL_PERMISSION_BLOCKED
        }
        existing = _agent_tool_registry.get(agent_id, [])

        # Preserve tool objects from every other connection — identified by
        # metadata tag, not name, so same-name tools on different servers
        # are handled correctly.
        kept_from_others = [
            t for t in existing
            if (t.metadata or {}).get("mcp_connection_id") != connection.id
        ]

        # Fresh objects limited to what this agent is allowed from this connection.
        from_this_conn = [fresh_by_name[n] for n in allowed_from_conn if n in fresh_by_name]

        updated = kept_from_others + from_this_conn
        if updated:
            _agent_tool_registry[agent_id] = updated
        else:
            _agent_tool_registry.pop(agent_id, None)

        # Refresh this connection's slice of the permissions map — other
        # connections' entries are untouched.
        permissions = _agent_tool_permissions.setdefault(agent_id, {})
        for n in allowed_from_conn:
            permissions[n] = permission_by_name.get(n) == TOOL_PERMISSION_REQUIRES_APPROVAL

        logger.info(
            "Registry synced for agent %s: %d tool(s) from '%s', %d total",
            agent_id, len(from_this_conn), connection.name, len(updated),
        )
