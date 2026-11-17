"""Skills: the user's library (CRUD), agent assignments, and the reads agents need at run time.

A skill belongs to one user. It reaches an agent only through an AgentSkill
link that the user adds; one skill can be linked to many agents. Unassigning
removes a link; deleting a skill removes the skill and all its links.
Every query is scoped by user_id, so another user's skill or agent behaves as
"not found".
"""
from collections import defaultdict
from dataclasses import dataclass
from typing import Optional

from sqlalchemy import delete, func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from constants import MAX_SKILLS_PER_USER
from database.models import Agent, AgentSkill, Skill
from schemas.skill import SkillUpsert


@dataclass(frozen=True)
class SkillSummary:
    """What an agent sees before it decides to use a skill."""

    id: str
    name: str
    description: str


class SkillService:
    # -- Library ----------------------------------------------------------------

    async def list_skills(self, db: AsyncSession, user_id: str) -> list[tuple[Skill, int]]:
        """The user's skills, most recently updated first, each with its count of assigned agents."""
        assigned = (
            select(func.count(AgentSkill.id))
            .join(Agent, Agent.id == AgentSkill.agent_id)
            .where(AgentSkill.skill_id == Skill.id, Agent.is_active == True)
            .scalar_subquery()
        )
        result = await db.execute(
            select(Skill, assigned).where(Skill.user_id == user_id).order_by(Skill.updated_at.desc())
        )
        return [(skill, count) for skill, count in result.all()]

    async def agent_count(self, db: AsyncSession, skill_id: str) -> int:
        """How many active agents the skill is assigned to."""
        return await db.scalar(
            select(func.count(AgentSkill.id))
            .join(Agent, Agent.id == AgentSkill.agent_id)
            .where(AgentSkill.skill_id == skill_id, Agent.is_active == True)
        ) or 0

    async def upsert_skill(self, db: AsyncSession, user_id: str, data: SkillUpsert) -> tuple[Skill, bool]:
        """Create a skill, or update it when data.id is set. Returns (skill, created).

        With data.agent_id, the skill is also assigned to that agent (in the
        same transaction); without it, the library is the only change.

        Raises:
            ValueError: unknown skill or agent, a name the user already uses,
                or the per-user limit reached (returned to the client as 422).
        """
        if data.agent_id:
            await _owned_agent(db, user_id, data.agent_id)
        if data.id:
            skill = await self._get(db, user_id, data.id)
        else:
            count = await db.scalar(select(func.count(Skill.id)).where(Skill.user_id == user_id))
            if (count or 0) >= MAX_SKILLS_PER_USER:
                raise ValueError(
                    f"You can have up to {MAX_SKILLS_PER_USER} skills. Delete one to add another."
                )
            skill = Skill(user_id=user_id)

        same_name = [Skill.user_id == user_id, func.lower(Skill.name) == data.name.lower()]
        if data.id:
            same_name.append(Skill.id != skill.id)
        if await db.scalar(select(Skill.id).where(*same_name)):
            raise ValueError(_name_taken(data.name))

        skill.name = data.name
        skill.description = data.description
        skill.instructions = data.instructions
        if not data.id:
            db.add(skill)
        try:
            if data.agent_id:
                await db.flush()  # assigns skill.id for the link
                await _link(db, data.agent_id, [skill.id])
            await db.commit()
        except IntegrityError as exc:  # a concurrent request took the name
            await db.rollback()
            raise ValueError(_name_taken(data.name)) from exc
        await db.refresh(skill)
        return skill, not data.id

    async def delete_skill(self, db: AsyncSession, user_id: str, skill_id: str) -> str:
        """Delete the user's skill (and, by cascade, every assignment). Returns its name."""
        skill = await self._get(db, user_id, skill_id)
        await db.delete(skill)
        await db.commit()
        return skill.name

    # -- Assignments --------------------------------------------------------------

    async def assign(self, db: AsyncSession, user_id: str, agent_id: str, skill_ids: list[str]) -> None:
        """Assign library skills to one of the user's agents. Already assigned ones are skipped.

        Raises:
            ValueError: unknown agent, or a skill id that isn't in the user's library.
        """
        await _owned_agent(db, user_id, agent_id)
        await link_skills(db, user_id, agent_id, skill_ids)
        await db.commit()

    async def unassign(self, db: AsyncSession, user_id: str, agent_id: str, skill_id: str) -> None:
        """Remove a skill from an agent. The skill stays in the library.

        Raises:
            ValueError: unknown agent, or the skill isn't assigned to it.
        """
        await _owned_agent(db, user_id, agent_id)
        result = await db.execute(
            delete(AgentSkill).where(AgentSkill.agent_id == agent_id, AgentSkill.skill_id == skill_id)
        )
        if not result.rowcount:
            raise ValueError("This skill isn't assigned to the agent")
        await db.commit()

    # -- Agent run time and responses --------------------------------------------

    async def assigned_skills(
        self, db: AsyncSession, user_id: str, agent_ids: list[str]
    ) -> dict[str, list[SkillSummary]]:
        """Each agent's assigned skills (names and descriptions only) in one query."""
        if not agent_ids:
            return {}
        result = await db.execute(
            select(AgentSkill.agent_id, Skill.id, Skill.name, Skill.description)
            .join(Skill, Skill.id == AgentSkill.skill_id)
            .where(AgentSkill.agent_id.in_(agent_ids), Skill.user_id == user_id)
            .order_by(func.lower(Skill.name))
        )
        by_agent: dict[str, list[SkillSummary]] = defaultdict(list)
        for row in result:
            by_agent[row.agent_id].append(SkillSummary(id=row.id, name=row.name, description=row.description))
        return by_agent

    async def instructions(
        self, db: AsyncSession, user_id: str, agent_id: str, skill_id: str
    ) -> Optional[str]:
        """The skill's instructions, or None if it was deleted or unassigned from the agent."""
        return await db.scalar(
            select(Skill.instructions)
            .join(AgentSkill, AgentSkill.skill_id == Skill.id)
            .where(AgentSkill.agent_id == agent_id, Skill.id == skill_id, Skill.user_id == user_id)
        )

    async def _get(self, db: AsyncSession, user_id: str, skill_id: str) -> Skill:
        skill = await db.scalar(select(Skill).where(Skill.id == skill_id, Skill.user_id == user_id))
        if skill is None:
            raise ValueError("Skill not found")
        return skill


async def link_skills(db: AsyncSession, user_id: str, agent_id: str, skill_ids: list[str]) -> None:
    """Link the user's skills to an agent (no commit). Unknown or foreign ids raise ValueError.

    The caller has checked that the agent belongs to the user. Shared by the
    assign API and agent creation.
    """
    wanted = list(dict.fromkeys(skill_ids))  # de-duplicated, order kept
    if not wanted:
        return
    owned = set(
        (await db.execute(select(Skill.id).where(Skill.id.in_(wanted), Skill.user_id == user_id))).scalars()
    )
    if unknown := [sid for sid in wanted if sid not in owned]:
        raise ValueError(f"These skills aren't in your library: {unknown}")
    await _link(db, agent_id, wanted)


async def _link(db: AsyncSession, agent_id: str, skill_ids: list[str]) -> None:
    """Add the missing AgentSkill rows, so a skill is never assigned twice."""
    existing = set(
        (
            await db.execute(
                select(AgentSkill.skill_id).where(
                    AgentSkill.agent_id == agent_id, AgentSkill.skill_id.in_(skill_ids)
                )
            )
        ).scalars()
    )
    for skill_id in skill_ids:
        if skill_id not in existing:
            db.add(AgentSkill(agent_id=agent_id, skill_id=skill_id))
    await db.flush()


async def _owned_agent(db: AsyncSession, user_id: str, agent_id: str) -> None:
    """Raise ValueError unless agent_id is one of the user's active agents."""
    found = await db.scalar(
        select(Agent.id).where(Agent.id == agent_id, Agent.user_id == user_id, Agent.is_active == True)
    )
    if not found:
        raise ValueError("Agent not found")


def _name_taken(name: str) -> str:
    return f"You already have a skill named '{name}'. Choose another name."
