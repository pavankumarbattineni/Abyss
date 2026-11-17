from datetime import datetime
from typing import Annotated, Optional

from pydantic import BaseModel, Field, StringConstraints, field_validator

from constants import (
    MAX_SKILLS_PER_USER,
    SKILL_DESCRIPTION_MAX_LENGTH,
    SKILL_INSTRUCTIONS_MAX_LENGTH,
    SKILL_INSTRUCTIONS_MIN_LENGTH,
    SKILL_NAME_MAX_LENGTH,
)

# The agent loads a skill by this name, so keep it plain: letters, digits,
# spaces, hyphens and underscores, starting with a letter or digit.
SKILL_NAME_PATTERN = r"^[A-Za-z0-9][A-Za-z0-9 _-]*$"


class SkillUpsert(BaseModel):
    """Create a skill (no id) or update the caller's skill with this id.

    With agent_id (the Agent Builder), the skill is also assigned to that one
    agent. Without it (the Skills screen), it only goes into the library.
    """

    id: Optional[str] = Field(default=None, max_length=36)
    agent_id: Optional[str] = Field(default=None, max_length=36)
    name: Annotated[
        str,
        StringConstraints(
            strip_whitespace=True, min_length=1, max_length=SKILL_NAME_MAX_LENGTH, pattern=SKILL_NAME_PATTERN
        ),
    ]
    description: Annotated[
        str, StringConstraints(strip_whitespace=True, min_length=1, max_length=SKILL_DESCRIPTION_MAX_LENGTH)
    ]
    instructions: Annotated[
        str,
        StringConstraints(
            strip_whitespace=True,
            min_length=SKILL_INSTRUCTIONS_MIN_LENGTH,
            max_length=SKILL_INSTRUCTIONS_MAX_LENGTH,
        ),
    ]

    @field_validator("name")
    @classmethod
    def _single_spaces(cls, name: str) -> str:
        return " ".join(name.split())


class SkillResponse(BaseModel):
    id: str
    name: str
    description: str
    instructions: str
    created_at: datetime
    updated_at: datetime
    # How many of the user's agents the skill is assigned to.
    agent_count: int = 0

    model_config = {"from_attributes": True}


class AgentSkillsAssign(BaseModel):
    """Skills from the user's library to assign to an agent (already assigned ones are skipped)."""

    skill_ids: list[str] = Field(min_length=1, max_length=MAX_SKILLS_PER_USER)
