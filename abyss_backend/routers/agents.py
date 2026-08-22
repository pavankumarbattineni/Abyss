from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession

from database.session import get_async_session
from schemas.agent import AgentCreate, AgentResponse, AgentSampleQuestionsResponse, AgentUpdate, SubAgentCreate
from schemas.thread import ThreadResponse
from services.agent_service import AgentService
from services.thread_service import ThreadService
from utils.auth import get_current_user, get_current_user_flexible

router = APIRouter(prefix="/agents", tags=["agents"])
agent_service = AgentService()
thread_service = ThreadService()


@router.post("", response_model=AgentResponse, status_code=status.HTTP_201_CREATED)
async def create_agent(
    request: AgentCreate,
    user_id: str = Depends(get_current_user_flexible),
    session: AsyncSession = Depends(get_async_session),
):
    """Create a new agent with optional sub-agents.

    Creates a parent (supervisor) agent and all listed sub-agents atomically.
    Sub-agents are stored as child Agent rows (parent_id set to the parent).
    Tool names are resolved against your registered MCP server; use
    GET /mcp-connections/{id}/tools to discover available tool names.

    Args:
        request: Agent creation payload including name, system_prompt, tools,
            and an optional list of sub-agent definitions.
        user_id: JWT-authenticated user ID (injected by dependency).
        session: Async database session (injected by dependency).

    Returns:
        The created AgentResponse with nested sub-agent data.

    Raises:
        HTTPException 400: If a service-level constraint is violated.
    """
    return await agent_service.create(session, user_id, request)


@router.get("", response_model=list[AgentResponse])
async def list_agents(
    user_id: str = Depends(get_current_user_flexible),
    session: AsyncSession = Depends(get_async_session),
):
    """List all agents owned by the authenticated user.

    Sub-agents are no longer stored in the agents table, so all returned
    records are top-level (supervisor) agents. Sub-agents appear nested
    inside each agent's response.

    Args:
        user_id: JWT-authenticated user ID (injected by dependency).
        session: Async database session (injected by dependency).

    Returns:
        List of AgentResponse objects, each with nested sub-agent data.
    """
    return await agent_service.get_all(session, user_id)


@router.get("/{agent_id}", response_model=AgentResponse)
async def get_agent(
    agent_id: str,
    user_id: str = Depends(get_current_user),
    session: AsyncSession = Depends(get_async_session),
):
    """Fetch a single agent by ID.

    Args:
        agent_id: The agent's unique identifier.
        user_id: JWT-authenticated user ID (injected by dependency).
        session: Async database session (injected by dependency).

    Returns:
        The AgentResponse with nested sub-agent data.

    Raises:
        HTTPException 422: If not found or not owned by the user.
    """
    return await agent_service.get_by_id(session, agent_id, user_id)


@router.put("/{agent_id}", response_model=AgentResponse)
async def update_agent(
    agent_id: str,
    request: AgentUpdate,
    user_id: str = Depends(get_current_user_flexible),
    session: AsyncSession = Depends(get_async_session),
):
    """Update an agent's name, description, system prompt, or tools list.

    Only non-null fields are written. When 'tools' is updated the MCP tool
    registry entry for this agent is refreshed immediately. Sub-agent
    structure cannot be modified after creation.

    Args:
        agent_id: The agent's unique identifier.
        request: Partial update payload; omitted fields are left unchanged.
        user_id: JWT-authenticated user ID (injected by dependency).
        session: Async database session (injected by dependency).

    Returns:
        The updated AgentResponse with nested sub-agent data.

    Raises:
        HTTPException 422: If not found or not owned by the user.
    """
    return await agent_service.update(session, agent_id, user_id, request)


@router.delete("/{agent_id}")
async def delete_agent(
    agent_id: str,
    user_id: str = Depends(get_current_user_flexible),
    session: AsyncSession = Depends(get_async_session),
):
    """Soft-delete an agent and cascade to all its sub-agents.

    Sets is_active=False on the parent agent and all child agent rows.
    Threads and messages are retained for audit history. All affected IDs
    are removed from the live MCP tool registry.

    Args:
        agent_id: The agent's unique identifier.
        user_id: JWT-authenticated user ID (injected by dependency).
        session: Async database session (injected by dependency).

    Raises:
        HTTPException 422: If not found or not owned by the user.
    """
    agent_name = await agent_service.delete(session, agent_id, user_id)
    return {"message": f"{agent_name} deleted successfully"}


@router.post("/{agent_id}/sub-agents", response_model=AgentResponse, status_code=status.HTTP_201_CREATED)
async def add_sub_agent(
    agent_id: str,
    request: SubAgentCreate,
    user_id: str = Depends(get_current_user_flexible),
    session: AsyncSession = Depends(get_async_session),
):
    """Add a new sub-agent to an existing parent agent.

    Creates the sub-agent record, assigns its tools, registers them in the
    in-memory tool registry, and invalidates the parent's compiled graph so
    the next request rebuilds with the new sub-agent node included.

    Args:
        agent_id: The parent agent's unique identifier.
        request: Sub-agent creation payload (name, system_prompt, tools, description).
        user_id: JWT-authenticated user ID (injected by dependency).
        session: Async database session (injected by dependency).

    Returns:
        The updated parent AgentResponse including the newly added sub-agent.

    Raises:
        HTTPException 422: If the parent is not found, or a name collision exists.
    """
    return await agent_service.add_sub_agent(session, agent_id, user_id, request)


@router.delete("/sub-agents/{sub_agent_id}", response_model=AgentResponse)
async def remove_sub_agent(
    sub_agent_id: str,
    user_id: str = Depends(get_current_user_flexible),
    session: AsyncSession = Depends(get_async_session),
):
    """Remove a sub-agent from its parent agent.

    Soft-deletes the sub-agent and its tool links, evicts its registry entry,
    and invalidates the parent's compiled graph so the next request rebuilds
    without this sub-agent's node. All other sub-agents are unaffected.

    Args:
        sub_agent_id: The sub-agent's unique identifier.
        user_id: JWT-authenticated user ID (injected by dependency).
        session: Async database session (injected by dependency).

    Returns:
        The updated parent AgentResponse with the removed sub-agent absent.

    Raises:
        HTTPException 422: If the sub-agent is not found or does not belong to the user.
    """
    return await agent_service.remove_sub_agent(session, sub_agent_id, user_id)


@router.get("/{agent_id}/threads", response_model=list[ThreadResponse])
async def list_threads_for_agent(
    agent_id: str,
    user_id: str = Depends(get_current_user),
    session: AsyncSession = Depends(get_async_session),
):
    """List all threads associated with a specific agent.

    Validates agent ownership before returning threads.

    Args:
        agent_id: The agent's unique identifier.
        user_id: JWT-authenticated user ID (injected by dependency).
        session: Async database session (injected by dependency).

    Returns:
        List of ThreadResponse objects for the given agent.

    Raises:
        HTTPException 422: If not found or not owned by the user.
    """
    await agent_service.verify_agent_ownership(session, agent_id, user_id)
    return await thread_service.get_by_agent(session, agent_id, user_id)


@router.get("/{agent_id}/sample-questions", response_model=AgentSampleQuestionsResponse)
async def get_agent_sample_questions(
    agent_id: str,
    user_id: str = Depends(get_current_user),
    session: AsyncSession = Depends(get_async_session),
):
    """Return predefined sample questions for the given agent, if it has any.

    Only the Abyss Guide (matched by name) currently has predefined
    questions — every other agent gets an empty list, not an error.

    Args:
        agent_id: The agent's unique identifier.
        user_id: JWT-authenticated user ID (injected by dependency).
        session: Async database session (injected by dependency).

    Returns:
        AgentSampleQuestionsResponse with the questions, or an empty list.

    Raises:
        HTTPException 422: If not found or not owned by the user.
    """
    questions = await agent_service.get_sample_questions(session, agent_id, user_id)
    return AgentSampleQuestionsResponse(questions=questions)
