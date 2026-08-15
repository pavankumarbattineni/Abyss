import logging
from collections import defaultdict
from typing import Optional

from sqlalchemy import func, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from constants import MCP_CONNECTION_STATUS_CONNECTED, MCP_CONNECTION_STATUS_DISCONNECTED
from database.models import Agent, AgentTool, MCPConnection, MCPTool
from schemas.mcp import MCPConnectionCreate, MCPConnectionUpdate, MCPToolResponse
from utils.encryption import decrypt_value, encrypt_value

logger = logging.getLogger(__name__)


class MCPService:

    # Internal helpers

    async def _validate_connection(
        self, name: str, url: str, raw_api_key: str, transport: str
    ) -> list:
        """Validate a new MCP server by fetching its tool list before any DB write.

        Takes the raw (unencrypted) API key so it can be called before the
        MCPConnection record exists. Returns the tool list on success.

        Raises:
            ValueError: Auth failure (401/403) or server unreachable (all others).
        """
        from langchain_mcp_adapters.client import MultiServerMCPClient

        client = MultiServerMCPClient({
            name: {
                "url": url,
                "transport": transport,
                "headers": {"x-api-key": raw_api_key},
            }
        })
        try:
            return await client.get_tools()
        except Exception as exc:
            real = (
                exc.exceptions[0]
                if hasattr(exc, "exceptions") and exc.exceptions
                else exc
            )
            # Duck-typed status code check — works regardless of HTTP library
            status_code = getattr(getattr(real, "response", None), "status_code", None)
            if status_code in (401, 403):
                raise ValueError(
                    f"Authentication failed for MCP server '{name}'. "
                    "Verify the API key and try again."
                )
            raise ValueError(
                f"Could not reach MCP server '{name}' at {url}. "
                "Verify the URL is correct and the server is running."
            )

    async def _fetch_remote_tools(
        self, name: str, url: str, api_key_encrypted: str, transport: str
    ) -> Optional[list]:
        """HTTP-only: fetch the tool list from the MCP server. No DB session touched.

        Used by refresh_mcp_connection_tools. Keeping this separate from DB
        work ensures no connection is held in the pool while the external
        HTTP call is in flight.
        """
        from langchain_mcp_adapters.client import MultiServerMCPClient

        client = MultiServerMCPClient({
            name: {
                "url": url,
                "transport": transport,
                "headers": {"x-api-key": decrypt_value(api_key_encrypted)},
            }
        })
        try:
            return await client.get_tools()
        except Exception as exc:
            logger.warning("Could not fetch tools from MCP server '%s': %s", name, exc)
            return None

    async def _persist_synced_tools(
        self, db: AsyncSession, connection_id: str, remote_tools: list
    ) -> None:
        """DB-only: upsert the fetched tool list into mcp_tools.

        Existing tools still on the server are refreshed and reactivated.
        Tools no longer present are soft-deleted. New tools are inserted.
        """
        existing_result = await db.execute(
            select(MCPTool).where(MCPTool.connection_id == connection_id)
        )
        existing_by_name: dict[str, MCPTool] = {
            t.name: t for t in existing_result.scalars().all()
        }
        incoming_names = {t.name for t in remote_tools}

        for name, tool in existing_by_name.items():
            if name not in incoming_names and tool.is_active:
                tool.is_active = False

        for rt in remote_tools:
            existing = existing_by_name.get(rt.name)
            if existing:
                existing.description = rt.description
                existing.is_active = True
            else:
                db.add(MCPTool(
                    connection_id=connection_id,
                    name=rt.name,
                    description=rt.description,
                ))

        await db.flush()
        logger.info("Synced %d tool(s) for connection %s", len(remote_tools), connection_id)

    async def _get_connection(
        self, db: AsyncSession, user_id: str, connection_id: str
    ) -> MCPConnection:
        result = await db.execute(
            select(MCPConnection).where(
                MCPConnection.id == connection_id,
                MCPConnection.user_id == user_id,
                MCPConnection.is_active == True,
            )
        )
        conn = result.scalar_one_or_none()
        if not conn:
            raise ValueError("MCP connection not found")
        return conn

    async def _collect_affected_agents_and_parents(
        self, db: AsyncSession, tool_ids: list[str]
    ) -> tuple[list[str], list[str]]:
        """Find every agent with an (active) tool link to any of tool_ids,
        plus the parent agent of any of those that are sub-agents.

        Shared by delete/disconnect/connect — all three need the exact same
        "who does this affect" query before touching in-memory state.

        Returns:
            (affected_agent_ids, parent_ids) — parent_ids may overlap with
            affected_agent_ids and is not deduplicated against it; callers
            already union the two into a set before invalidating caches.
        """
        if not tool_ids:
            return [], []

        agent_ids_result = await db.execute(
            select(AgentTool.agent_id).distinct().where(
                AgentTool.tool_id.in_(tool_ids),
                AgentTool.is_active == True,
            )
        )
        affected_agent_ids = list(agent_ids_result.scalars().all())

        parent_ids: list[str] = []
        if affected_agent_ids:
            parent_result = await db.execute(
                select(Agent.parent_id).where(
                    Agent.id.in_(affected_agent_ids),
                    Agent.parent_id.is_not(None),
                )
            )
            parent_ids = list(parent_result.scalars().all())

        return affected_agent_ids, parent_ids

    # MCPConnection CRUD

    async def create_mcp_connection(
        self, db: AsyncSession, user_id: str, data: MCPConnectionCreate
    ) -> tuple[MCPConnection, int]:
        """Register an MCP server for a user after validating connectivity.

        The MCP server is contacted and its tool list is fetched BEFORE any DB
        write. If the server is unreachable or returns an auth error the
        connection is rejected with a clear ValueError — nothing is persisted.
        On success the connection and its tools are committed in one transaction.

        Args:
            db: Active async database session.
            user_id: The authenticated user's ID.
            data: MCP connection details (name, URL, api_key, transport).

        Returns:
            Tuple of (MCPConnection ORM instance, tool_count int).

        Raises:
            ValueError: Duplicate URL, auth failure, or server unreachable.
        """
        # Step 1: Fast duplicate-URL guard before any network call
        existing = await db.execute(
            select(MCPConnection.id).where(
                MCPConnection.user_id == user_id,
                MCPConnection.url == str(data.url),
                MCPConnection.is_active == True,
            )
        )
        if existing.scalar_one_or_none():
            raise ValueError("An active MCP connection with this URL already exists.")

        # Step 2: Validate URL and API key — raises ValueError on failure.
        # No DB connection is held during this network call.
        remote_tools = await self._validate_connection(
            data.name, str(data.url), data.api_key, data.transport
        )

        # Step 3: Persist the connection and its tools in one atomic transaction.
        # flush() assigns conn.id without committing, so _persist_synced_tools
        # can reference it before the single final commit.
        conn = MCPConnection(
            user_id=user_id,
            name=data.name,
            url=str(data.url),
            api_key=encrypt_value(data.api_key),
            transport=data.transport,
        )
        db.add(conn)
        await db.flush()

        # Step 4: Persist the already-fetched tools (no second HTTP call).
        if remote_tools:
            await self._persist_synced_tools(db, conn.id, remote_tools)

        await db.commit()
        await db.refresh(conn)
        return conn, len(remote_tools)

    async def get_mcp_connections(
        self, db: AsyncSession, user_id: str
    ) -> list[tuple[MCPConnection, int]]:
        result = await db.execute(
            select(MCPConnection, func.count(MCPTool.id).label("tools_count"))
            .outerjoin(
                MCPTool,
                (MCPTool.connection_id == MCPConnection.id) & (MCPTool.is_active == True),
            )
            .where(MCPConnection.user_id == user_id, MCPConnection.is_active == True)
            .group_by(MCPConnection.id)
        )
        return result.all()

    async def update_mcp_connection(
        self, db: AsyncSession, user_id: str, connection_id: str, data: MCPConnectionUpdate
    ) -> MCPConnection:
        """Rename an MCP connection. URL and credentials cannot be changed — create
        a new connection if the server endpoint changes.

        Args:
            db: Active async database session.
            user_id: The authenticated user's ID.
            connection_id: The MCPConnection's string ID.
            data: New name for the connection.

        Returns:
            The updated MCPConnection ORM instance.

        Raises:
            ValueError: If not found or not owned by the user.
        """
        conn = await self._get_connection(db, user_id, connection_id)

        if data.name == conn.name:
            raise ValueError("The new name must be different from the current name")

        conn.name = data.name
        await db.commit()
        await db.refresh(conn)
        return conn

    async def delete_mcp_connection(
        self, db: AsyncSession, user_id: str, connection_id: str
    ) -> str:
        """Soft-delete an MCP connection with full cleanup.

        Clears the in-memory tool registry for every agent that used tools
        from this connection. Bulk-deactivates AgentTool junction records and
        MCPTool records. Returns the connection name for the response message.

        Args:
            db: Active async database session.
            user_id: The authenticated user's ID.
            connection_id: The MCPConnection's string ID.

        Returns:
            The name of the deleted connection.

        Raises:
            ValueError: If not found or not owned by the user.
        """
        from utils.mcp_client import evict_connection_from_registry, remove_connection_client
        from utils.graph_builder import invalidate_graph_cache

        conn = await self._get_connection(db, user_id, connection_id)
        conn_name = conn.name

        # Collect all tool IDs belonging to this connection
        tool_ids_result = await db.execute(
            select(MCPTool.id).where(MCPTool.connection_id == conn.id)
        )
        tool_ids = list(tool_ids_result.scalars().all())

        # Collect affected agent IDs BEFORE any mutations so we can update
        # the in-memory state AFTER the commit succeeds.
        affected_agent_ids, parent_ids = await self._collect_affected_agents_and_parents(db, tool_ids)

        if tool_ids:
            # Bulk-deactivate AgentTool junction records
            await db.execute(
                update(AgentTool)
                .where(AgentTool.tool_id.in_(tool_ids))
                .values(is_active=False)
            )

        # Bulk-deactivate MCPTool records
        await db.execute(
            update(MCPTool)
            .where(MCPTool.connection_id == conn.id, MCPTool.is_active == True)
            .values(is_active=False)
        )

        conn.is_active = False

        # Commit DB changes BEFORE touching in-memory state.
        await db.commit()

        # Surgically remove only this connection's tool objects from each
        # affected agent — tools from other connections are preserved.
        evict_connection_from_registry(connection_id, affected_agent_ids)
        remove_connection_client(connection_id)

        # Invalidate compiled graphs so the next request rebuilds with the
        # updated registry. Also invalidate parent graphs of any sub-agents
        # since parent graphs bake in sub-agent tool objects at compile time.
        all_to_invalidate = set(affected_agent_ids) | set(parent_ids)
        for agent_id in all_to_invalidate:
            invalidate_graph_cache(agent_id)

        return conn_name

    async def set_connection_status(
        self, db: AsyncSession, user_id: str, connection_id: str, new_status: str
    ) -> tuple[MCPConnection, int]:
        """Connect or disconnect an MCP connection — the single entry point
        for both directions of the toggle (see MCP_CONNECTION_STATUS_*).

        Args:
            db: Active async database session.
            user_id: The authenticated user's ID.
            connection_id: The MCPConnection's string ID.
            new_status: MCP_CONNECTION_STATUS_CONNECTED or _DISCONNECTED.

        Returns:
            Tuple of (MCPConnection ORM instance with status already
            updated, tool_count). tool_count is the freshly-synced count
            when connecting, or the connection's existing active tool count
            when disconnecting.

        Raises:
            ValueError: If not found, not owned by the user, already in the
                requested status, or (when connecting) the MCP server is
                unreachable.
        """
        if new_status == MCP_CONNECTION_STATUS_DISCONNECTED:
            conn, tool_count = await self._disconnect_mcp_connection(db, user_id, connection_id)
        else:
            conn, tool_count = await self._connect_mcp_connection(db, user_id, connection_id)
        return conn, tool_count

    async def _disconnect_mcp_connection(
        self, db: AsyncSession, user_id: str, connection_id: str
    ) -> tuple[MCPConnection, int]:
        """Temporarily pause an MCP connection without deleting anything.

        Unlike delete, this leaves MCPTool rows and AgentTool assignments
        untouched — only the connection's status flips, and its tools are
        evicted from the live in-memory registry so agents stop invoking
        them. Reconnecting restores everything exactly as it was, with no
        reassignment needed.

        Args:
            db: Active async database session.
            user_id: The authenticated user's ID.
            connection_id: The MCPConnection's string ID.

        Returns:
            Tuple of (MCPConnection with status already updated, existing
            active tool count).

        Raises:
            ValueError: If not found, not owned by the user, or already disconnected.
        """
        from utils.mcp_client import evict_connection_from_registry, remove_connection_client
        from utils.graph_builder import invalidate_graph_cache

        conn = await self._get_connection(db, user_id, connection_id)
        if conn.status == MCP_CONNECTION_STATUS_DISCONNECTED:
            raise ValueError(f"'{conn.name}' is already disconnected")

        tool_ids_result = await db.execute(
            select(MCPTool.id).where(MCPTool.connection_id == conn.id, MCPTool.is_active == True)
        )
        tool_ids = list(tool_ids_result.scalars().all())
        affected_agent_ids, parent_ids = await self._collect_affected_agents_and_parents(db, tool_ids)

        conn.status = MCP_CONNECTION_STATUS_DISCONNECTED
        await db.commit()

        evict_connection_from_registry(connection_id, affected_agent_ids)
        remove_connection_client(connection_id)

        for agent_id in set(affected_agent_ids) | set(parent_ids):
            invalidate_graph_cache(agent_id)

        return conn, len(tool_ids)

    async def _connect_mcp_connection(
        self, db: AsyncSession, user_id: str, connection_id: str
    ) -> tuple[MCPConnection, int]:
        """Reconnect a previously-disconnected MCP connection.

        Re-validates reachability and re-syncs the tool list (same as
        refresh_mcp_connection_tools) before flipping status back, then
        re-registers this connection's tools for every agent that still
        has an active AgentTool link to one of them — since disconnect
        never touched those links, this restores exactly what was assigned
        before, with no manual reassignment required.

        Args:
            db: Active async database session.
            user_id: The authenticated user's ID.
            connection_id: The MCPConnection's string ID.

        Returns:
            Tuple of (MCPConnection with status already updated, synced tool count).

        Raises:
            ValueError: If not found, not owned by the user, already
                connected, or the MCP server is unreachable.
        """
        from utils.mcp_client import sync_connection_tools_in_registry
        from utils.graph_builder import invalidate_graph_cache

        conn = await self._get_connection(db, user_id, connection_id)
        if conn.status == MCP_CONNECTION_STATUS_CONNECTED:
            raise ValueError(f"'{conn.name}' is already connected")

        remote_tools = await self._fetch_remote_tools(
            conn.name, conn.url, conn.api_key, conn.transport
        )
        if remote_tools is None:
            raise ValueError(f"Could not reach MCP server '{conn.name}' — connection left disconnected")

        await self._persist_synced_tools(db, conn.id, remote_tools)

        active_tool_ids_result = await db.execute(
            select(MCPTool.id).where(MCPTool.connection_id == conn.id, MCPTool.is_active == True)
        )
        active_tool_ids = list(active_tool_ids_result.scalars().all())

        all_affected_agent_ids: list[str] = []
        active_tools_by_agent: dict[str, list[str]] = defaultdict(list)
        parent_ids: list[str] = []
        if active_tool_ids:
            affected_result = await db.execute(
                select(AgentTool.agent_id).distinct().where(
                    AgentTool.tool_id.in_(active_tool_ids),
                    AgentTool.is_active == True,
                )
            )
            all_affected_agent_ids = list(affected_result.scalars().all())

            if all_affected_agent_ids:
                active_result = await db.execute(
                    select(AgentTool.agent_id, MCPTool.name)
                    .join(MCPTool, AgentTool.tool_id == MCPTool.id)
                    .where(
                        AgentTool.agent_id.in_(all_affected_agent_ids),
                        AgentTool.is_active == True,
                        MCPTool.is_active == True,
                        MCPTool.connection_id == conn.id,
                    )
                )
                for agent_id, tool_name in active_result:
                    active_tools_by_agent[agent_id].append(tool_name)

                parent_result = await db.execute(
                    select(Agent.parent_id).where(
                        Agent.id.in_(all_affected_agent_ids),
                        Agent.parent_id.is_not(None),
                    )
                )
                parent_ids = list(parent_result.scalars().all())

        conn.status = MCP_CONNECTION_STATUS_CONNECTED
        await db.commit()

        await sync_connection_tools_in_registry(
            conn, dict(active_tools_by_agent), all_affected_agent_ids, db,
        )

        for agent_id in set(all_affected_agent_ids) | set(parent_ids):
            invalidate_graph_cache(agent_id)

        return conn, len(remote_tools)

    # Tool discovery

    async def list_mcp_tools(
        self,
        db: AsyncSession,
        user_id: str,
        connection_id: Optional[str] = None,
    ) -> list[MCPToolResponse]:
        """Return active MCP tools for the authenticated user.

        Without a filter, returns every active tool across all of the user's
        active connections. When connection_id is supplied, only tools from
        that specific connection are returned.

        Args:
            db: Active async database session.
            user_id: The authenticated user's ID.
            connection_id: Optional MCPConnection ID to filter by.

        Returns:
            List of MCPToolResponse objects, each including connection_id and
            connection_name so the caller can identify the source connection.

        Raises:
            ValueError: If connection_id is supplied but not found or not owned
                by the user.
        """
        stmt = (
            select(MCPTool, MCPConnection.id.label("conn_id"), MCPConnection.name.label("conn_name"))
            .join(MCPConnection, MCPTool.connection_id == MCPConnection.id)
            .where(
                MCPConnection.user_id == user_id,
                MCPConnection.is_active == True,
                MCPConnection.status == MCP_CONNECTION_STATUS_CONNECTED,
                MCPTool.is_active == True,
            )
            .order_by(MCPTool.created_at.asc())
        )

        if connection_id:
            # _get_connection raises ValueError when the ID is not found or not
            # owned by the user — no separate ownership check needed below.
            await self._get_connection(db, user_id, connection_id)
            stmt = stmt.where(MCPConnection.id == connection_id)

        result = await db.execute(stmt)
        return [
            MCPToolResponse(
                id=row.MCPTool.id,
                name=row.MCPTool.name,
                display_name=row.MCPTool.name.replace("_", " ").replace("-", " ").title(),
                description=row.MCPTool.description,
                connection_id=row.conn_id,
                connection_name=row.conn_name,
                permission_state=row.MCPTool.permission_state,
            )
            for row in result.all()
        ]

    async def set_tool_permission(
        self,
        db: AsyncSession,
        user_id: str,
        permission_state: str,
        connection_id: Optional[str] = None,
        tool_id: Optional[str] = None,
    ) -> list[MCPToolResponse]:
        """Update one tool's permission_state, or every tool under a
        connection, and keep the in-memory registry in sync either way.

        Exactly one of connection_id/tool_id must be supplied — the caller
        (router) is responsible for that validation; this method trusts
        whichever one it's given as the sole scoping key.

        This is a global change — every agent that uses an affected tool
        shares the same gate, so every affected agent's compiled graph cache
        (and its parent's, for sub-agents) must be invalidated, not just one.
        When scoped to a connection, that fan-out happens per tool, so a
        connection with many tools still ends up with every affected agent's
        cache invalidated exactly once (deduplicated via a set), not once per
        tool.

        Args:
            db: Active async database session.
            user_id: The authenticated user's ID (ownership check via the
                connection either way).
            permission_state: 'allowed' | 'requires_approval' | 'blocked'.
            connection_id: If supplied, apply permission_state to every
                active tool under this connection.
            tool_id: If supplied, apply permission_state to just this tool.

        Returns:
            MCPToolResponse for every tool actually updated — a single-item
            list when scoped by tool_id.

        Raises:
            ValueError: If the tool/connection is not found or not owned by
                the user.
        """
        from constants import TOOL_PERMISSION_BLOCKED
        from utils.graph_builder import invalidate_graph_cache
        from utils.mcp_client import register_tools_for_id, set_tool_permission_in_registry

        if tool_id is not None:
            anchor_result = await db.execute(
                select(MCPTool.connection_id, MCPConnection.id, MCPConnection.name)
                .join(MCPConnection, MCPTool.connection_id == MCPConnection.id)
                .where(
                    MCPTool.id == tool_id,
                    MCPTool.is_active == True,
                    MCPConnection.user_id == user_id,
                    MCPConnection.is_active == True,
                )
            )
            anchor = anchor_result.first()
            if not anchor:
                raise ValueError("Tool not found")
            resolved_connection_id, conn_id, conn_name = anchor
        else:
            conn_result = await db.execute(
                select(MCPConnection.id, MCPConnection.name).where(
                    MCPConnection.id == connection_id,
                    MCPConnection.user_id == user_id,
                    MCPConnection.is_active == True,
                )
            )
            conn = conn_result.first()
            if not conn:
                raise ValueError("Connection not found")
            resolved_connection_id, conn_id, conn_name = conn.id, conn.id, conn.name

        tools_stmt = select(MCPTool).where(
            MCPTool.connection_id == resolved_connection_id,
            MCPTool.is_active == True,
        )
        if tool_id is not None:
            tools_stmt = tools_stmt.where(MCPTool.id == tool_id)
        tools = (await db.execute(tools_stmt)).scalars().all()

        # A tool transitioning FROM blocked needs a live re-fetch, not just a
        # flag flip: set_tool_permission_in_registry's blocked branch already
        # removed its tool object from every agent's in-memory registry, so
        # there's nothing left there to un-block — unblocking silently no-ops
        # (including cache invalidation) unless we go back to the DB to find
        # who should have it and re-register them for real.
        unblocking_tool_ids = [
            tool.id for tool in tools
            if tool.permission_state == TOOL_PERMISSION_BLOCKED and permission_state != TOOL_PERMISSION_BLOCKED
        ]

        for tool in tools:
            tool.permission_state = permission_state
        await db.commit()

        affected_agent_ids: set[str] = set()
        for tool in tools:
            affected_agent_ids.update(set_tool_permission_in_registry(tool.id, permission_state))

        if unblocking_tool_ids:
            agents_result = await db.execute(
                select(AgentTool.agent_id, Agent.user_id)
                .join(Agent, Agent.id == AgentTool.agent_id)
                .where(
                    AgentTool.tool_id.in_(unblocking_tool_ids),
                    AgentTool.is_active == True,
                    Agent.is_active == True,
                )
                .distinct()
            )
            for agent_id, agent_user_id in agents_result.all():
                names_result = await db.execute(
                    select(MCPTool.name)
                    .join(AgentTool, AgentTool.tool_id == MCPTool.id)
                    .where(
                        AgentTool.agent_id == agent_id,
                        AgentTool.is_active == True,
                        MCPTool.is_active == True,
                    )
                )
                tool_names = list(names_result.scalars().all())
                if tool_names:
                    await register_tools_for_id(agent_id, agent_user_id, tool_names, db)
                affected_agent_ids.add(agent_id)

        if affected_agent_ids:
            parent_result = await db.execute(
                select(Agent.id, Agent.parent_id).where(Agent.id.in_(affected_agent_ids))
            )
            for aid, parent_id in parent_result.all():
                invalidate_graph_cache(parent_id or aid)

        return [
            MCPToolResponse(
                id=tool.id,
                name=tool.name,
                display_name=tool.name.replace("_", " ").replace("-", " ").title(),
                description=tool.description,
                connection_id=conn_id,
                connection_name=conn_name,
                permission_state=tool.permission_state,
            )
            for tool in tools
        ]

    async def refresh_mcp_connection_tools(
        self, db: AsyncSession, user_id: str, connection_id: str
    ) -> tuple[str, int]:
        """Sync the latest tool definitions from the MCP server.

        Fetches the current tool list, upserts it into mcp_tools (insert new,
        update changed, deactivate removed), cascades AgentTool deactivation for
        tools no longer present, and reloads the in-memory registry for every
        affected agent.

        Args:
            db: Active async database session.
            user_id: The authenticated user's ID.
            connection_id: The MCPConnection's string ID.

        Returns:
            Tuple of (connection_name, synced_tool_count).

        Raises:
            ValueError: If the connection is not found, not owned by the user,
                or the MCP server is unreachable.
        """
        from utils.mcp_client import sync_connection_tools_in_registry
        from utils.graph_builder import invalidate_graph_cache

        conn = await self._get_connection(db, user_id, connection_id)
        conn_name = conn.name

        remote_tools = await self._fetch_remote_tools(
            conn.name, conn.url, conn.api_key, conn.transport
        )
        if remote_tools is None:
            raise ValueError(f"Could not reach MCP server '{conn.name}'")

        # Upsert: insert new tools, update changed, deactivate removed.
        # _persist_synced_tools flushes but does not commit.
        await self._persist_synced_tools(db, conn.id, remote_tools)

        # Cascade: deactivate AgentTool links whose MCPTool is now inactive.
        # Scoped to this connection only — avoids touching other connections.
        inactive_ids_result = await db.execute(
            select(MCPTool.id).where(
                MCPTool.connection_id == conn.id,
                MCPTool.is_active == False,
            )
        )
        inactive_tool_ids = list(inactive_ids_result.scalars().all())
        if inactive_tool_ids:
            await db.execute(
                update(AgentTool)
                .where(AgentTool.tool_id.in_(inactive_tool_ids))
                .values(is_active=False)
            )

        # Every agent that has (or had) any tool link to this connection.
        all_tool_ids_result = await db.execute(
            select(MCPTool.id).where(MCPTool.connection_id == conn.id)
        )
        all_tool_ids = list(all_tool_ids_result.scalars().all())

        all_affected_agent_ids: list[str] = []
        active_tools_by_agent: dict[str, list[str]] = defaultdict(list)

        if all_tool_ids:
            affected_result = await db.execute(
                select(AgentTool.agent_id).distinct().where(
                    AgentTool.tool_id.in_(all_tool_ids)
                )
            )
            all_affected_agent_ids = list(affected_result.scalars().all())

            # Per-agent: only the tools from THIS connection that are still
            # active after the refresh — tools from other connections are
            # untouched in the registry and need no re-fetch.
            if all_affected_agent_ids:
                active_result = await db.execute(
                    select(AgentTool.agent_id, MCPTool.name)
                    .join(MCPTool, AgentTool.tool_id == MCPTool.id)
                    .where(
                        AgentTool.agent_id.in_(all_affected_agent_ids),
                        AgentTool.is_active == True,
                        MCPTool.is_active == True,
                        MCPTool.connection_id == conn.id,
                    )
                )
                for agent_id, tool_name in active_result:
                    active_tools_by_agent[agent_id].append(tool_name)

        # Resolve parent agents for any affected sub-agents so their compiled
        # graphs can also be invalidated after the refresh.
        parent_ids: list[str] = []
        if all_affected_agent_ids:
            parent_result = await db.execute(
                select(Agent.parent_id).where(
                    Agent.id.in_(all_affected_agent_ids),
                    Agent.parent_id.is_not(None),
                )
            )
            parent_ids = list(parent_result.scalars().all())

        await db.commit()

        # Update the in-memory registry — only the refreshed connection is
        # contacted. Each affected agent's tool objects from this connection
        # are surgically replaced; tools from other connections are preserved.
        # Tool objects are identified by mcp_connection_id metadata, not name,
        # so same-name tools on different servers are handled correctly.
        await sync_connection_tools_in_registry(
            conn,
            dict(active_tools_by_agent),
            all_affected_agent_ids,
            db,
        )

        # Invalidate compiled graphs so the next chat request rebuilds them
        # with the updated registry. Parent graphs must also be invalidated
        # since they embed sub-agent tool objects at compile time.
        all_to_invalidate = set(all_affected_agent_ids) | set(parent_ids)
        for agent_id in all_to_invalidate:
            invalidate_graph_cache(agent_id)

        return conn_name, len(remote_tools)
