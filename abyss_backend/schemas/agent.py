from typing import Optional

from pydantic import BaseModel, Field, model_validator


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


def _normalize_llm_model_id(llm_model_id: Optional[str]) -> Optional[str]:
    """Normalize the "default" sentinel string to None.

    None is the storage-level sentinel for "Default" — resolved at request
    time to whichever provider_models row has is_platform_default=true, so
    the platform default can change without migrating agent rows. This is
    pure string normalization only; whether a real llm_model_id actually
    exists and is active requires a DB query, so that check lives in
    AgentService, not here.
    """
    if llm_model_id is None or llm_model_id == "default":
        return None
    return llm_model_id


class AgentCreate(BaseModel):
    name: str = Field(min_length=1, max_length=255)
    description: Optional[str] = Field(default=None, max_length=2000)
    system_prompt: str = Field(min_length=1, max_length=32_000)
    tools: list[str] = Field(default=[], max_length=50, description="MCPTool IDs to assign")
    sub_agents: list[SubAgentCreate] = Field(default=[], max_length=20)
    llm_model_id: Optional[str] = Field(
        default="default", description="provider_models.id, or 'default'/null = platform Default"
    )

    @model_validator(mode="after")
    def normalize_llm_model_id(self) -> "AgentCreate":
        self.llm_model_id = _normalize_llm_model_id(self.llm_model_id)
        return self


class AgentUpdate(BaseModel):
    name: Optional[str] = Field(default=None, min_length=1, max_length=255)
    description: Optional[str] = Field(default=None, max_length=2000)
    system_prompt: Optional[str] = Field(default=None, min_length=1, max_length=32_000)
    tools: Optional[list[str]] = Field(default=None, max_length=50, description="MCPTool IDs to assign")
    sub_agents: Optional[list[SubAgentUpdate]] = None
    # Omitted entirely = leave unchanged. To reset an agent to platform Default,
    # the caller sends llm_model_id="default" (or null) explicitly —
    # AgentService checks model_fields_set to tell "omitted" from "explicitly set".
    llm_model_id: Optional[str] = Field(
        default="default", description="provider_models.id, or 'default'/null = platform Default"
    )

    @model_validator(mode="after")
    def normalize_llm_model_id(self) -> "AgentUpdate":
        if "llm_model_id" in self.model_fields_set:
            self.llm_model_id = _normalize_llm_model_id(self.llm_model_id)
        return self


class AgentResponse(BaseModel):
    id: str
    name: str
    description: Optional[str] = None
    system_prompt: str
    tools: list[AgentToolInfo]
    sub_agents: list[SubAgentInfo]
    llm_model_id: Optional[str] = None
    llm_provider: Optional[str] = None
    llm_model_name: Optional[str] = None
    llm_display_name: Optional[str] = None


class AgentSampleQuestionsResponse(BaseModel):
    questions: list[str] = []
