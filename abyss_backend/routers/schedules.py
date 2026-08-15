from fastapi import APIRouter, Depends, status
from sqlalchemy.ext.asyncio import AsyncSession

from database.session import get_async_session
from schemas.schedule import ScheduleCreate, ScheduleResponse, ScheduleRunResponse, ScheduleUpdate
from services.schedule_service import ScheduleService
from utils.auth import get_current_user_flexible

router = APIRouter(prefix="/agents/{agent_id}/schedules", tags=["schedules"])
schedule_service = ScheduleService()


@router.post("", response_model=ScheduleResponse, status_code=status.HTTP_201_CREATED)
async def create_schedule(
    agent_id: str,
    request: ScheduleCreate,
    user_id: str = Depends(get_current_user_flexible),
    session: AsyncSession = Depends(get_async_session),
):
    """Create a new schedule rule for an agent.

    Args:
        agent_id: The agent's unique identifier.
        request: Schedule creation payload (schedule_type plus its required fields).
        user_id: JWT-authenticated user ID (injected by dependency).
        session: Async database session (injected by dependency).

    Returns:
        The created ScheduleResponse, including next_run_at.

    Raises:
        HTTPException 422: If the agent is not found, the agent already has
            MAX_SCHEDULES_PER_AGENT active schedules, or an identical active
            schedule already exists for this agent.
    """
    return await schedule_service.create(session, agent_id, user_id, request)


@router.get("", response_model=list[ScheduleResponse])
async def list_schedules(
    agent_id: str,
    user_id: str = Depends(get_current_user_flexible),
    session: AsyncSession = Depends(get_async_session),
):
    """List all active schedules for an agent.

    Args:
        agent_id: The agent's unique identifier.
        user_id: JWT-authenticated user ID (injected by dependency).
        session: Async database session (injected by dependency).

    Returns:
        List of ScheduleResponse objects.

    Raises:
        HTTPException 422: If the agent is not found or not owned by the user.
    """
    return await schedule_service.list_for_agent(session, agent_id, user_id)


@router.patch("/{schedule_id}", response_model=ScheduleResponse)
async def update_schedule(
    agent_id: str,
    schedule_id: str,
    request: ScheduleUpdate,
    user_id: str = Depends(get_current_user_flexible),
    session: AsyncSession = Depends(get_async_session),
):
    """Update a schedule's recurrence or input_query. Use DELETE to deactivate.

    Args:
        agent_id: The agent's unique identifier.
        schedule_id: The schedule's unique identifier.
        request: Partial update payload; omitted fields are left unchanged.
        user_id: JWT-authenticated user ID (injected by dependency).
        session: Async database session (injected by dependency).

    Returns:
        The updated ScheduleResponse.

    Raises:
        HTTPException 422: If not found, not owned by the user, the resulting
            recurrence combination is invalid, or it collides with another
            active schedule for this agent.
    """
    return await schedule_service.update(session, agent_id, schedule_id, user_id, request)


@router.delete("/{schedule_id}")
async def delete_schedule(
    agent_id: str,
    schedule_id: str,
    user_id: str = Depends(get_current_user_flexible),
    session: AsyncSession = Depends(get_async_session),
):
    """Soft-delete a schedule.

    Args:
        agent_id: The agent's unique identifier.
        schedule_id: The schedule's unique identifier.
        user_id: JWT-authenticated user ID (injected by dependency).
        session: Async database session (injected by dependency).

    Raises:
        HTTPException 422: If not found or not owned by the user.
    """
    await schedule_service.delete(session, agent_id, schedule_id, user_id)
    return {"message": "Schedule deleted successfully"}


@router.get("/{schedule_id}/runs", response_model=list[ScheduleRunResponse])
async def list_schedule_runs(
    agent_id: str,
    schedule_id: str,
    user_id: str = Depends(get_current_user_flexible),
    session: AsyncSession = Depends(get_async_session),
):
    """List execution history for a schedule, newest first.

    Args:
        agent_id: The agent's unique identifier.
        schedule_id: The schedule's unique identifier.
        user_id: JWT-authenticated user ID (injected by dependency).
        session: Async database session (injected by dependency).

    Returns:
        List of ScheduleRunResponse objects.

    Raises:
        HTTPException 422: If not found or not owned by the user.
    """
    return await schedule_service.get_runs(session, agent_id, schedule_id, user_id)
