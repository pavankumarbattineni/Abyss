"""Skills: CRUD for the API, plus the two reads agents need at run time.

A skill belongs to one user and is available to all of that user's agents.
Every query is scoped by user_id, so a skill id from another user behaves as
"not found".
"""
from dataclasses import dataclass
from typing import Optional

from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from constants import MAX_SKILLS_PER_USER
from database.models import Skill
from schemas.skill import SkillUpsert


@dataclass(frozen=True)
class SkillSummary:
    """What an agent sees before it decides to use a skill."""

    id: str
    name: str
    description: str


class SkillService:
    async def list_skills(self, db: AsyncSession, user_id: str) -> list[Skill]:
        result = await db.execute(
            select(Skill).where(Skill.user_id == user_id).order_by(Skill.updated_at.desc())
        )
        return list(result.scalars().all())

    async def upsert_skill(self, db: AsyncSession, user_id: str, data: SkillUpsert) -> tuple[Skill, bool]:
        """Create a skill, or update it when data.id is set. Returns (skill, created).

        Raises:
            ValueError: unknown id, a name the user already uses, or the
                per-user limit reached (returned to the client as 422).
        """
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
            await db.commit()
        except IntegrityError as exc:  # a concurrent request took the name
            await db.rollback()
            raise ValueError(_name_taken(data.name)) from exc
        await db.refresh(skill)
        return skill, not data.id

    async def delete_skill(self, db: AsyncSession, user_id: str, skill_id: str) -> str:
        """Delete the user's skill and return its name. Raises ValueError if not found."""
        skill = await self._get(db, user_id, skill_id)
        await db.delete(skill)
        await db.commit()
        return skill.name

    # -- Agent run time -------------------------------------------------------

    async def catalog(self, db: AsyncSession, user_id: str) -> list[SkillSummary]:
        """Names and descriptions only -- instructions are not read until used."""
        result = await db.execute(
            select(Skill.id, Skill.name, Skill.description)
            .where(Skill.user_id == user_id)
            .order_by(func.lower(Skill.name))
        )
        return [SkillSummary(id=row.id, name=row.name, description=row.description) for row in result]

    async def instructions(self, db: AsyncSession, user_id: str, skill_id: str) -> Optional[str]:
        """The skill's instructions, or None if it no longer exists."""
        return await db.scalar(
            select(Skill.instructions).where(Skill.id == skill_id, Skill.user_id == user_id)
        )

    async def _get(self, db: AsyncSession, user_id: str, skill_id: str) -> Skill:
        skill = await db.scalar(select(Skill).where(Skill.id == skill_id, Skill.user_id == user_id))
        if skill is None:
            raise ValueError("Skill not found")
        return skill


def _name_taken(name: str) -> str:
    return f"You already have a skill named '{name}'. Choose another name."
