from datetime import datetime
from typing import Any, Optional

from pydantic import BaseModel, Field


class MessageCreate(BaseModel):
    message: str = Field(min_length=1)


class MessageResponse(BaseModel):
    id: str
    thread_id: str
    role: str
    content: str
    is_partial: bool = False
    reasoning: Optional[dict[str, Any]] = None
    created_at: datetime

    model_config = {"from_attributes": True}
