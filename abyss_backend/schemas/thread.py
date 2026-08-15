from datetime import datetime
from typing import Optional

from pydantic import BaseModel, Field


class ThreadCreate(BaseModel):
    agent_id: str = Field(min_length=1)


class ThreadResponse(BaseModel):
    id: str
    user_id: str
    agent_id: str
    title: Optional[str] = None
    created_at: datetime

    model_config = {"from_attributes": True}


class ThreadCreateResponse(BaseModel):
    thread_id: str


class ThreadUpdate(BaseModel):
    title: str = Field(min_length=1, max_length=255)
