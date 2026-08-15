import logging
from collections import defaultdict
from typing import Optional

from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from constants import MCP_CONNECTION_STATUS_CONNECTED
from database.models import (
    Agent, AgentSchedule, AgentTool, LlmCredential, MCPConnection, MCPTool, Provider, ProviderModel,
)
from schemas.agent import AgentCreate, AgentResponse, AgentToolInfo, AgentUpdate, SubAgentCreate, SubAgentInfo

logger = logging.getLogger(__name__)


# Helpers


async def _validate_llm_model_selection(
    session: AsyncSession, user_id: str, llm_model_id: Optional[str]
) -> None:
    """Block saving a non-Default model selection unless it's a real, active
    model with a valid credential already configured for its provider.

    llm_model_id=None means "Default" (platform key) — no checks needed.
    """
    if llm_model_id is None:
        return

    result = await session.execute(
        select(Provider.id, Provider.name)
        .join(ProviderModel, ProviderModel.provider_id == Provider.id)
        .where(
            ProviderModel.id == llm_model_id,
            ProviderModel.is_active == True,
            Provider.is_active == True,
        )
    )
    row = result.first()
    if not row:
        raise ValueError(f"Unknown or inactive model: {llm_model_id}")
    provider_id, provider_name = row

    cred_result = await session.execute(
        select(LlmCredential.id).where(
            LlmCredential.user_id == user_id,
            LlmCredential.provider_id == provider_id,
            LlmCredential.is_active == True,
        )
    )
    if not cred_result.scalar_one_or_none():
        raise ValueError(f"Add your {provider_name} API key in Settings before selecting this model")


async def _resolve_llm_model_map(
    session: AsyncSession, llm_model_ids: set[str]
) -> dict[str, tuple[str, str, str]]:
    """Batch-resolve llm_model_id -> (provider_name, model_name, display_name)."""
    if not llm_model_ids:
        return {}
    result = await session.execute(
        select(ProviderModel.id, Provider.name, ProviderModel.model_name, ProviderModel.display_name)
        .join(Provider, Provider.id == ProviderModel.provider_id)
        .where(ProviderModel.id.in_(llm_model_ids))
    )
    return {row[0]: (row[1], row[2], row[3]) for row in result.all()}


async def _set_agent_tools(
    session: AsyncSession, agent_id: str, tool_ids: list[str], user_id: str
) -> None:
    """Replace the active tool set for an agent using exactly two queries.

    Loads all existing AgentTool links, deactivates them in Python, then
    batch-validates all requested tool IDs in one SELECT and upserts links.
    Unknown or inaccessible tool IDs are logged and skipped without raising.

    Args:
        session: Active async database session.
        agent_id: The Agent.id whose tools are being replaced.
        tool_ids: List of MCPTool primary-key IDs to assign.
        user_id: The owning user's ID, used to scope the MCPTool ownership check.
    """
    # Query 1: load all existing links for this agent (active + inactive)
    existing_result = await session.execute(
        select(AgentTool).where(AgentTool.agent_id == agent_id)
    )
    existing_links = existing_result.scalars().all()
    existing_by_tool_id: dict[str, AgentTool] = {at.tool_id: at for at in existing_links}

    # Deactivate all current links in Python — stays in sync with the session
    for at in existing_links:
        at.is_active = False

    if not tool_ids:
        await session.flush()
        return

    # Query 2: batch-validate all requested IDs in one hit, scoped to the user
    tools_result = await session.execute(
        select(MCPTool)
        .join(MCPConnection, MCPTool.connection_id == MCPConnection.id)
        .where(
            MCPTool.id.in_(tool_ids),
            MCPTool.is_active == True,
            MCPConnection.user_id == user_id,
            MCPConnection.is_active == True,
            MCPConnection.status == MCP_CONNECTION_STATUS_CONNECTED,
        )
    )
    found_tools = tools_result.scalars().all()
    found_ids = {t.id for t in found_tools}

    unknown = set(tool_ids) - found_ids
    if unknown:
        raise ValueError(
            f"The following tool ID(s) do not exist or are no longer active: "
            f"{sorted(unknown)}"
        )

    # Reactivate existing links or create new ones
    for tool in found_tools:
        agent_tool = existing_by_tool_id.get(tool.id)
        if agent_tool:
            agent_tool.is_active = True
        else:
            session.add(AgentTool(agent_id=agent_id, tool_id=tool.id))

    await session.flush()


async def _build_agent_response(session: AsyncSession, agent: Agent) -> AgentResponse:
    """Build a fully-populated AgentResponse using exactly two batched queries.

    Query 1: all active sub-agents for this parent.
    Query 2: all active tool names for the parent + every sub-agent in one hit.
    """
    # Query 1: sub-agents
    subs_result = await session.execute(
        select(Agent).where(
            Agent.parent_id == agent.id,
            Agent.is_active == True,
        )
    )
    sub_agents_orm = subs_result.scalars().all()

    # Query 2: tools for parent + all sub-agents
    all_ids = [agent.id] + [s.id for s in sub_agents_orm]
    tools_result = await session.execute(
        select(
            AgentTool.agent_id.label("agent_id"),
            AgentTool.tool_id.label("tool_id"),
            MCPTool.name.label("tool_name"),
            MCPTool.permission_state.label("permission_state"),
        )
        .join(MCPTool, AgentTool.tool_id == MCPTool.id)
        .where(
            AgentTool.agent_id.in_(all_ids),
            AgentTool.is_active == True,
            MCPTool.is_active == True,
        )
    )
    tools_by_agent: dict[str, list[AgentToolInfo]] = defaultdict(list)
    for row in tools_result:
        tools_by_agent[row.agent_id].append(
            AgentToolInfo(
                id=row.tool_id,
                name=row.tool_name,
                display_name=row.tool_name.replace("_", " ").replace("-", " ").title(),
                permission_state=row.permission_state,
            )
        )

    llm_map = await _resolve_llm_model_map(
        session, {agent.llm_model_id} if agent.llm_model_id else set()
    )
    provider_name, model_name, display_name = llm_map.get(agent.llm_model_id, (None, None, None))

    return AgentResponse(
        id=agent.id,
        name=agent.name,
        description=agent.description,
        system_prompt=agent.system_prompt,
        tools=tools_by_agent.get(agent.id, []),
        sub_agents=[
            SubAgentInfo(
                id=sub.id,
                name=sub.name,
                description=sub.description,
                system_prompt=sub.system_prompt,
                tools=tools_by_agent.get(sub.id, []),
            )
            for sub in sub_agents_orm
        ],
        llm_model_id=agent.llm_model_id,
        llm_provider=provider_name,
        llm_model_name=model_name,
        llm_display_name=display_name,
    )


# Service


class AgentService:

    async def _get_agent_orm(
        self, session: AsyncSession, agent_id: str, user_id: str
    ) -> Agent:
        """Load a top-level Agent ORM instance, scoped to the requesting user."""
        result = await session.execute(
            select(Agent).where(
                Agent.id == agent_id,
                Agent.user_id == user_id,
                Agent.is_active == True,
                Agent.parent_id.is_(None),
            )
        )
        agent = result.scalar_one_or_none()
        if not agent:
            raise ValueError("Agent not found")
        return agent

    async def verify_agent_ownership(
        self, session: AsyncSession, agent_id: str, user_id: str
    ) -> None:
        """Lightweight ownership check — fetches only the ID column.

        Used by the threads endpoint to avoid loading the full agent + sub-agent
        + tools tree just for an existence/ownership assertion.

        Raises:
            ValueError: If the agent does not exist or does not belong to the user.
        """
        result = await session.execute(
            select(Agent.id).where(
                Agent.id == agent_id,
                Agent.user_id == user_id,
                Agent.is_active == True,
                Agent.parent_id.is_(None),
            )
        )
        if not result.scalar_one_or_none():
            raise ValueError("Agent not found")

    async def get_sample_questions(
        self, session: AsyncSession, agent_id: str, user_id: str
    ) -> list[str]:
        """Return the predefined sample questions for the ThinkLoop Guide agent.

        Matched by name — every other agent (including a user's own agent
        that happens to share other attributes) gets an empty list, not an
        error, since asking for sample questions on a non-Guide agent isn't
        really a mistake, it just has none.

        Args:
            session: Active async database session.
            agent_id: The agent's unique identifier.
            user_id: The authenticated user's ID (ownership check).

        Returns:
            The 5 sample questions if this is the ThinkLoop Guide, else [].

        Raises:
            ValueError: If the agent does not exist or does not belong to the user.
        """
        from constants import STARTER_AGENT_NAME

        result = await session.execute(
            select(Agent.name).where(
                Agent.id == agent_id,
                Agent.user_id == user_id,
                Agent.is_active == True,
                Agent.parent_id.is_(None),
            )
        )
        name = result.scalar_one_or_none()
        if name is None:
            raise ValueError("Agent not found")

        if name != STARTER_AGENT_NAME:
            return []

        return [
            "What is ThinkLoop and how do I get started?",
            "How does delegation between a parent agent and its sub-agents "
            "actually work, and can multiple sub-agents run at once?",
            "If I mark a tool as 'Requires Approval,' walk me through exactly "
            "what happens when an agent tries to use it, and what's the "
            "difference between Allow Once and Always Allow?",
            "I scheduled an agent to run every 30 minutes, and it needs to "
            "use a tool that requires approval — what happens?",
            "How do I use my own OpenAI API key instead of the platform "
            "default, and what happens to an agent if I remove that key later?",
        ]

    async def create(
        self, session: AsyncSession, user_id: str, data: AgentCreate
    ) -> AgentResponse:
        """Create a parent agent and all its sub-agents atomically.

        Validates that no active agent with the same name exists for this user
        and that sub-agent names are unique after LangGraph sanitization.

        Args:
            session: Active async database session.
            user_id: The authenticated user's ID.
            data: Validated AgentCreate payload.

        Returns:
            A fully-populated AgentResponse including nested sub-agent data.

        Raises:
            ValueError: On duplicate agent name or sub-agent name collision.
        """
        from utils.mcp_client import register_tools_for_id
        from utils.graph_builder import to_tool_name

        # Duplicate name check (active agents only — soft-delete allows reuse)
        existing = await session.execute(
            select(Agent.id).where(
                Agent.user_id == user_id,
                Agent.name == data.name,
                Agent.is_active == True,
                Agent.parent_id.is_(None),
            )
        )
        if existing.scalar_one_or_none():
            raise ValueError(f"An agent named '{data.name}' already exists")

        # Sub-agent node name collision check (graph_builder uses the same sanitizer)
        if data.sub_agents:
            sanitized = [to_tool_name(s.name) for s in data.sub_agents]
            if len(sanitized) != len(set(sanitized)):
                raise ValueError(
                    "Sub-agent names must be unique after sanitization "
                    "(e.g. 'Web Agent' and 'Web-Agent' both map to 'web_agent')"
                )

        await _validate_llm_model_selection(session, user_id, data.llm_model_id)

        agent = Agent(
            user_id=user_id,
            name=data.name,
            description=data.description,
            system_prompt=data.system_prompt,
            parent_id=None,
            llm_model_id=data.llm_model_id,
        )
        session.add(agent)
        await session.flush()

        await _set_agent_tools(session, agent.id, data.tools, user_id)

        sub_registrations: list[tuple[str, list[str]]] = []
        for sub_data in data.sub_agents:
            sub = Agent(
                user_id=user_id,
                name=sub_data.name,
                description=sub_data.description,
                system_prompt=sub_data.system_prompt,
                parent_id=agent.id,
            )
            session.add(sub)
            await session.flush()
            await _set_agent_tools(session, sub.id, sub_data.tools, user_id)
            sub_registrations.append((sub.id, sub_data.tools))

        await session.commit()
        await session.refresh(agent)

        # Batch-resolve tool IDs → names for the registry (one query covers all agents).
        # register_tools_for_id needs names for LangChain tool filtering.
        all_ids_to_resolve: set[str] = set(data.tools)
        for _, sub_tool_ids in sub_registrations:
            all_ids_to_resolve.update(sub_tool_ids)

        name_by_id: dict[str, str] = {}
        if all_ids_to_resolve:
            names_result = await session.execute(
                select(MCPTool.id, MCPTool.name).where(
                    MCPTool.id.in_(all_ids_to_resolve),
                    MCPTool.is_active == True,
                )
            )
            for tid, tname in names_result:
                name_by_id[tid] = tname

        if data.tools:
            tool_names = [name_by_id[tid] for tid in data.tools if tid in name_by_id]
            if tool_names:
                await register_tools_for_id(agent.id, user_id, tool_names, session)

        for sub_id, sub_tool_ids in sub_registrations:
            if sub_tool_ids:
                tool_names = [name_by_id[tid] for tid in sub_tool_ids if tid in name_by_id]
                if tool_names:
                    await register_tools_for_id(sub_id, user_id, tool_names, session)

        return await _build_agent_response(session, agent)

    async def get_all(self, session: AsyncSession, user_id: str) -> list[AgentResponse]:
        """Return all top-level agents owned by a user using three queries total.

        Query 1: all top-level agents.
        Query 2: all their sub-agents.
        Query 3: all tool names for every agent (parent + sub) in one hit.

        Args:
            session: Active async database session.
            user_id: The authenticated user's ID.

        Returns:
            List of AgentResponse objects with nested sub-agent data.
        """
        # Query 1: top-level agents
        result = await session.execute(
            select(Agent).where(
                Agent.user_id == user_id,
                Agent.is_active == True,
                Agent.parent_id.is_(None),
            ).order_by(Agent.created_at.desc())
        )
        agents = result.scalars().all()
        if not agents:
            return []

        parent_ids = [a.id for a in agents]

        # Query 2: all sub-agents for all parents
        subs_result = await session.execute(
            select(Agent).where(
                Agent.parent_id.in_(parent_ids),
                Agent.is_active == True,
            )
        )
        sub_agents = subs_result.scalars().all()

        # Query 3: all tools for all agents (parent + sub) in one query
        all_agent_ids = parent_ids + [s.id for s in sub_agents]
        tools_result = await session.execute(
            select(
                AgentTool.agent_id.label("agent_id"),
                AgentTool.tool_id.label("tool_id"),
                MCPTool.name.label("tool_name"),
                MCPTool.permission_state.label("permission_state"),
            )
            .join(MCPTool, AgentTool.tool_id == MCPTool.id)
            .where(
                AgentTool.agent_id.in_(all_agent_ids),
                AgentTool.is_active == True,
                MCPTool.is_active == True,
            )
        )
        tools_by_agent: dict[str, list[AgentToolInfo]] = defaultdict(list)
        for row in tools_result:
            tools_by_agent[row.agent_id].append(
                AgentToolInfo(
                    id=row.tool_id,
                    name=row.tool_name,
                    display_name=row.tool_name.replace("_", " ").replace("-", " ").title(),
                    permission_state=row.permission_state,
                )
            )

        subs_by_parent: dict[str, list[Agent]] = defaultdict(list)
        for sub in sub_agents:
            subs_by_parent[sub.parent_id].append(sub)

        # Query 4: batch-resolve every parent's llm_model_id -> provider/model info
        llm_map = await _resolve_llm_model_map(
            session, {a.llm_model_id for a in agents if a.llm_model_id}
        )

        return [
            AgentResponse(
                id=a.id,
                name=a.name,
                description=a.description,
                system_prompt=a.system_prompt,
                tools=tools_by_agent.get(a.id, []),
                sub_agents=[
                    SubAgentInfo(
                        id=sub.id,
                        name=sub.name,
                        description=sub.description,
                        system_prompt=sub.system_prompt,
                        tools=tools_by_agent.get(sub.id, []),
                    )
                    for sub in subs_by_parent.get(a.id, [])
                ],
                llm_model_id=a.llm_model_id,
                llm_provider=llm_map.get(a.llm_model_id, (None, None, None))[0],
                llm_model_name=llm_map.get(a.llm_model_id, (None, None, None))[1],
                llm_display_name=llm_map.get(a.llm_model_id, (None, None, None))[2],
            )
            for a in agents
        ]

    async def get_by_id(
        self, session: AsyncSession, agent_id: str, user_id: str
    ) -> AgentResponse:
        """Fetch a single top-level agent by ID, scoped to the requesting user.

        Args:
            session: Active async database session.
            agent_id: The agent's string ID.
            user_id: The authenticated user's ID.

        Returns:
            A fully-populated AgentResponse with nested sub-agent data.

        Raises:
            ValueError: If the agent does not exist or does not belong to the user.
        """
        agent = await self._get_agent_orm(session, agent_id, user_id)
        return await _build_agent_response(session, agent)

    async def update(
        self, session: AsyncSession, agent_id: str, user_id: str, data: AgentUpdate
    ) -> AgentResponse:
        """Update a parent agent and optionally any of its sub-agents.

        No-op requests (all fields None, empty sub_agents list) return
        immediately without a DB commit. Unknown sub-agent IDs raise ValueError.
        Registry state is synced after commit — clearing empty tool lists is
        handled correctly.

        Args:
            session: Active async database session.
            agent_id: The parent agent's string ID.
            user_id: The authenticated user's ID.
            data: Validated AgentUpdate payload.

        Returns:
            The updated AgentResponse with nested sub-agent data.

        Raises:
            ValueError: If the agent/sub-agent is not found, or name conflicts.
        """
        from utils.mcp_client import register_tools_for_id, remove_agent_from_registry
        from utils.graph_builder import invalidate_graph_cache

        llm_fields_set = "llm_model_id" in data.model_fields_set

        # Early return if there is literally nothing to do
        if (
            data.name is None
            and data.description is None
            and data.system_prompt is None
            and data.tools is None
            and not data.sub_agents
            and not llm_fields_set
        ):
            agent = await self._get_agent_orm(session, agent_id, user_id)
            return await _build_agent_response(session, agent)

        agent = await self._get_agent_orm(session, agent_id, user_id)

        if data.name is not None:
            if data.name != agent.name:
                conflict = await session.execute(
                    select(Agent.id).where(
                        Agent.user_id == user_id,
                        Agent.name == data.name,
                        Agent.is_active == True,
                        Agent.parent_id.is_(None),
                        Agent.id != agent_id,
                    )
                )
                if conflict.scalar_one_or_none():
                    raise ValueError(f"An agent named '{data.name}' already exists")
            agent.name = data.name

        if data.description is not None:
            agent.description = data.description
        if data.system_prompt is not None:
            agent.system_prompt = data.system_prompt
        if data.tools is not None:
            await _set_agent_tools(session, agent.id, data.tools, user_id)
        if llm_fields_set:
            await _validate_llm_model_selection(session, user_id, data.llm_model_id)
            agent.llm_model_id = data.llm_model_id

        updated_sub_tools: list[tuple[str, list[str]]] = []
        if data.sub_agents:
            sub_ids = [s.id for s in data.sub_agents]
            subs_result = await session.execute(
                select(Agent).where(
                    Agent.id.in_(sub_ids),
                    Agent.parent_id == agent_id,
                    Agent.is_active == True,
                )
            )
            subs_by_id = {sub.id: sub for sub in subs_result.scalars().all()}

            for sub_data in data.sub_agents:
                sub = subs_by_id.get(sub_data.id)
                if not sub:
                    raise ValueError(f"Sub-agent '{sub_data.id}' not found under this agent")
                if sub_data.name is not None:
                    sub.name = sub_data.name
                if sub_data.description is not None:
                    sub.description = sub_data.description
                if sub_data.system_prompt is not None:
                    sub.system_prompt = sub_data.system_prompt
                if sub_data.tools is not None:
                    await _set_agent_tools(session, sub.id, sub_data.tools, user_id)
                    updated_sub_tools.append((sub.id, sub_data.tools))

        await session.commit()
        await session.refresh(agent)

        # Batch-resolve tool IDs → names for registry (one query, all agents).
        all_ids_to_resolve: set[str] = set()
        if data.tools:
            all_ids_to_resolve.update(data.tools)
        for _, sub_tool_ids in updated_sub_tools:
            if sub_tool_ids:
                all_ids_to_resolve.update(sub_tool_ids)

        name_by_id: dict[str, str] = {}
        if all_ids_to_resolve:
            names_result = await session.execute(
                select(MCPTool.id, MCPTool.name).where(
                    MCPTool.id.in_(all_ids_to_resolve),
                    MCPTool.is_active == True,
                )
            )
            for tid, tname in names_result:
                name_by_id[tid] = tname

        # Sync in-memory registry — handle both populated AND emptied tool lists
        if data.tools is not None:
            if data.tools:
                tool_names = [name_by_id[tid] for tid in data.tools if tid in name_by_id]
                if tool_names:
                    await register_tools_for_id(agent.id, user_id, tool_names, session)
                else:
                    remove_agent_from_registry(agent.id)
            else:
                remove_agent_from_registry(agent.id)

        for sub_id, sub_tool_ids in updated_sub_tools:
            if sub_tool_ids:
                tool_names = [name_by_id[tid] for tid in sub_tool_ids if tid in name_by_id]
                if tool_names:
                    await register_tools_for_id(sub_id, user_id, tool_names, session)
                else:
                    remove_agent_from_registry(sub_id)
            else:
                remove_agent_from_registry(sub_id)

        invalidate_graph_cache(agent_id)

        return await _build_agent_response(session, agent)

    async def add_sub_agent(
        self, session: AsyncSession, agent_id: str, user_id: str, data: SubAgentCreate
    ) -> AgentResponse:
        """Add a new sub-agent to an existing parent agent.

        Validates that the parent exists and that the new sub-agent's sanitized
        name does not collide with any existing sub-agent under this parent.
        Registers tools for the new sub-agent only — the parent and other
        sub-agents are left untouched. Invalidates the parent's compiled graph
        so the next request rebuilds with the new sub-agent node included.

        Args:
            session: Active async database session.
            agent_id: The parent agent's string ID.
            user_id: The authenticated user's ID.
            data: Sub-agent creation payload.

        Returns:
            The updated parent AgentResponse with all sub-agents including the new one.

        Raises:
            ValueError: If the parent is not found, or a name collision exists.
        """
        from utils.mcp_client import register_tools_for_id
        from utils.graph_builder import to_tool_name, invalidate_graph_cache

        agent = await self._get_agent_orm(session, agent_id, user_id)

        # Check for node name collision with existing active sub-agents
        existing_result = await session.execute(
            select(Agent).where(
                Agent.parent_id == agent_id,
                Agent.is_active == True,
            )
        )
        existing_names = {to_tool_name(sub.name) for sub in existing_result.scalars().all()}
        if to_tool_name(data.name) in existing_names:
            raise ValueError(
                f"A sub-agent whose name maps to '{to_tool_name(data.name)}' already exists "
                "under this agent. Sub-agent names must be unique after sanitization."
            )

        sub = Agent(
            user_id=user_id,
            name=data.name,
            description=data.description,
            system_prompt=data.system_prompt,
            parent_id=agent_id,
        )
        session.add(sub)
        await session.flush()

        await _set_agent_tools(session, sub.id, data.tools, user_id)
        await session.commit()
        await session.refresh(sub)

        # Register tools for the new sub-agent only
        if data.tools:
            names_result = await session.execute(
                select(MCPTool.id, MCPTool.name).where(
                    MCPTool.id.in_(data.tools),
                    MCPTool.is_active == True,
                )
            )
            name_by_id = {tid: tname for tid, tname in names_result}
            tool_names = [name_by_id[tid] for tid in data.tools if tid in name_by_id]
            if tool_names:
                await register_tools_for_id(sub.id, user_id, tool_names, session)

        invalidate_graph_cache(agent_id)

        return await _build_agent_response(session, agent)

    async def remove_sub_agent(
        self, session: AsyncSession, sub_agent_id: str, user_id: str
    ) -> AgentResponse:
        """Remove a sub-agent from its parent agent.

        Soft-deletes the sub-agent and its AgentTool links. Evicts its tool
        registry entry and invalidates the parent's compiled graph so the next
        request rebuilds without this sub-agent's node. The parent and all
        remaining sub-agents are left untouched.

        Args:
            session: Active async database session.
            sub_agent_id: The sub-agent's string ID.
            user_id: The authenticated user's ID.

        Returns:
            The updated parent AgentResponse with the removed sub-agent absent.

        Raises:
            ValueError: If the sub-agent is not found or does not belong to the user.
        """
        from utils.mcp_client import remove_agent_from_registry
        from utils.graph_builder import invalidate_graph_cache

        sub_result = await session.execute(
            select(Agent).where(
                Agent.id == sub_agent_id,
                Agent.parent_id.isnot(None),
                Agent.is_active == True,
            )
        )
        sub = sub_result.scalar_one_or_none()
        if not sub:
            raise ValueError("Sub-agent not found")

        # Verify the user owns the parent agent (ownership is on the top-level agent).
        agent = await self._get_agent_orm(session, sub.parent_id, user_id)

        await session.execute(
            update(AgentTool)
            .where(AgentTool.agent_id == sub_agent_id)
            .values(is_active=False)
        )
        sub.is_active = False
        await session.commit()

        remove_agent_from_registry(sub_agent_id)
        invalidate_graph_cache(agent.id)

        return await _build_agent_response(session, agent)

    async def delete(self, session: AsyncSession, agent_id: str, user_id: str) -> str:
        """Soft-delete an agent and cascade to all its sub-agents.

        Bulk-deactivates AgentTool junction records for all affected agents,
        commits the DB changes, then — and only then — clears the in-memory
        registry and graph cache to ensure consistency on commit failure.

        Args:
            session: Active async database session.
            agent_id: The agent's string ID.
            user_id: The authenticated user's ID.

        Raises:
            ValueError: If the agent does not exist or does not belong to the user.
        """
        from utils.mcp_client import remove_agent_from_registry
        from utils.graph_builder import invalidate_graph_cache

        agent = await self._get_agent_orm(session, agent_id, user_id)
        agent_name = agent.name

        # Collect sub-agent IDs before modifying any ORM state
        subs_result = await session.execute(
            select(Agent).where(
                Agent.parent_id == agent_id,
                Agent.is_active == True,
            )
        )
        subs = subs_result.scalars().all()
        sub_ids = [sub.id for sub in subs]

        # Bulk-deactivate AgentTool junction records for parent + all sub-agents
        all_agent_ids = [agent_id] + sub_ids
        await session.execute(
            update(AgentTool)
            .where(AgentTool.agent_id.in_(all_agent_ids))
            .values(is_active=False)
        )

        # Cascade-deactivate schedules so the scheduler tick loop stops
        # picking them up for an agent that no longer exists.
        await session.execute(
            update(AgentSchedule)
            .where(AgentSchedule.agent_id.in_(all_agent_ids))
            .values(is_active=False)
        )

        for sub in subs:
            sub.is_active = False
        agent.is_active = False

        # Commit DB changes BEFORE touching in-memory state — if commit fails
        # the registry stays correct (old tools remain, agent still active in DB)
        await session.commit()

        for sub_id in sub_ids:
            remove_agent_from_registry(sub_id)
        remove_agent_from_registry(agent_id)
        invalidate_graph_cache(agent_id)

        return agent_name
