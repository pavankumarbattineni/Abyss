from fastapi import APIRouter, Depends, Response, status
from sqlalchemy.ext.asyncio import AsyncSession

from database.session import get_async_session
from schemas.skill import SkillResponse, SkillUpsert
from services.skill_service import SkillService
from utils.auth import get_current_user, get_current_user_flexible

router = APIRouter(prefix="/skills", tags=["skills"])
skill_service = SkillService()


@router.post("", response_model=SkillResponse, status_code=status.HTTP_201_CREATED)
async def upsert_skill(
    request: SkillUpsert,
    response: Response,
    user_id: str = Depends(get_current_user),
    db: AsyncSession = Depends(get_async_session),
):
    """Create a skill, or update one when `id` is given.

    Skills live in the user's library. With `agent_id` (Agent Studio) the
    skill is also assigned to that agent only; without it (the Skills screen)
    it is not assigned to any agent. An update reaches every agent the skill
    is assigned to from their next message.

    Args:
        request: id (omit to create), agent_id (optional), name, description
            and instructions.
        response: Set to 200 when an existing skill is updated.
        user_id: JWT-authenticated user ID (injected by dependency).
        db: Async database session (injected by dependency).

    Returns:
        The saved skill. 201 when created, 200 when updated.

    Raises:
        HTTPException 422: Invalid fields, unknown skill or agent, a name
            already used by this user, or the per-user skill limit reached.
    """
    skill, created = await skill_service.upsert_skill(db, user_id, request)
    if not created:
        response.status_code = status.HTTP_200_OK
    count = await skill_service.agent_count(db, skill.id)
    return SkillResponse.model_validate(skill).model_copy(update={"agent_count": count})


@router.get("", response_model=list[SkillResponse])
async def list_skills(
    user_id: str = Depends(get_current_user_flexible),
    db: AsyncSession = Depends(get_async_session),
):
    """List the user's skills library, most recently updated first.

    Args:
        user_id: JWT or API-key authenticated user ID (injected by dependency).
        db: Async database session (injected by dependency).

    Returns:
        List of SkillResponse objects, each with the number of agents it is assigned to.
    """
    return [
        SkillResponse.model_validate(skill).model_copy(update={"agent_count": count})
        for skill, count in await skill_service.list_skills(db, user_id)
    ]


@router.delete("/{skill_id}")
async def delete_skill(
    skill_id: str,
    user_id: str = Depends(get_current_user),
    db: AsyncSession = Depends(get_async_session),
):
    """Delete a skill from the library and unassign it from every agent.

    To remove a skill from one agent only, use DELETE /agents/{agent_id}/skills/{skill_id}.

    Args:
        skill_id: The skill's unique identifier.
        user_id: JWT-authenticated user ID (injected by dependency).
        db: Async database session (injected by dependency).

    Returns:
        Confirmation message including the skill name.

    Raises:
        HTTPException 422: If not found or not owned by the user.
    """
    name = await skill_service.delete_skill(db, user_id, skill_id)
    return {"message": f"Skill '{name}' deleted"}
