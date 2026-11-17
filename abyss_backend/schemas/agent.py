from typing import Optional

from pydantic import BaseModel, Field

from constants import MAX_SKILLS_PER_USER, MAX_SUB_AGENTS_PER_AGENT


class SubAgentCreate(BaseModel):
    name: str = Field(min_length=1, max_length=255)
    description: Optional[str] = Field(default=None, max_length=2000)
    system_prompt: str = Field(min_length=1, max_length=32_000)
    tools: list[str] = Field(default=[], max_length=50, description="MCPTool IDs to assign")


class AgentToolInfo(BaseModel):
    id: str
    name: str
    display_name: str
    permission_state: str = "allowed"


class AgentSkillInfo(BaseModel):
    """A skill assigned to the agent (the library's name and description)."""

    id: str
    name: str
    description: str


class SubAgentInfo(BaseModel):
    id: str
    name: str
    description: Optional[str] = None
    system_prompt: str
    tools: list[AgentToolInfo]


class SubAgentUpdate(BaseModel):
    id: str
    name: Optional[str] = Field(default=None, min_length=1, max_length=255)
    description: Optional[str] = Field(default=None, max_length=2000)
    system_prompt: Optional[str] = Field(default=None, min_length=1, max_length=32_000)
    tools: Optional[list[str]] = Field(default=None, max_length=50, description="MCPTool IDs to assign")


class AgentCreate(BaseModel):
    name: str = Field(min_length=1, max_length=255)
    description: Optional[str] = Field(default=None, max_length=2000)
    system_prompt: str = Field(min_length=1, max_length=32_000)
    tools: list[str] = Field(default=[], max_length=50, description="MCPTool IDs to assign")
    skills: list[str] = Field(
        default=[], max_length=MAX_SKILLS_PER_USER, description="Skill IDs from the user's library to assign"
    )
    sub_agents: list[SubAgentCreate] = Field(default=[], max_length=MAX_SUB_AGENTS_PER_AGENT)


class AgentUpdate(BaseModel):
    name: Optional[str] = Field(default=None, min_length=1, max_length=255)
    description: Optional[str] = Field(default=None, max_length=2000)
    system_prompt: Optional[str] = Field(default=None, min_length=1, max_length=32_000)
    tools: Optional[list[str]] = Field(default=None, max_length=50, description="MCPTool IDs to assign")
    sub_agents: Optional[list[SubAgentUpdate]] = None


class AgentResponse(BaseModel):
    id: str
    name: str
    description: Optional[str] = None
    system_prompt: str
    tools: list[AgentToolInfo]
    skills: list[AgentSkillInfo] = []
    sub_agents: list[SubAgentInfo]


class AgentSampleQuestionsResponse(BaseModel):
    questions: list[str] = []
