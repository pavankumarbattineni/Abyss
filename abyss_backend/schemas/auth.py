"""Pydantic schemas used by authentication and session APIs."""

from datetime import datetime
from typing import Optional

from pydantic import BaseModel, EmailStr, Field, model_validator


class FirebaseTokenRequest(BaseModel):
    """Request body containing a Firebase ID token for token exchange."""

    id_token: str = Field(min_length=1)


class RefreshRequest(BaseModel):
    """Request body used to exchange a refresh token."""

    refresh_token: str = Field(min_length=1)


class UserResponse(BaseModel):
    """Public application user representation."""

    id: str
    username: Optional[str] = None
    email: EmailStr
    thinking_enabled: bool
    # The model used by all of the user's agents and chats; None = Default.
    llm_model_id: Optional[str] = None
    created_at: datetime


class UpdateSettingsRequest(BaseModel):
    """Partial update of the user's application settings: only fields sent change."""

    thinking_enabled: Optional[bool] = None
    # The model for all of the user's agents and chats: a provider_models.id,
    # or "default" for the platform default.
    llm_model_id: Optional[str] = Field(default=None, min_length=1, max_length=36)

    @model_validator(mode="after")
    def _not_empty(self) -> "UpdateSettingsRequest":
        if self.thinking_enabled is None and self.llm_model_id is None:
            raise ValueError("Send thinking_enabled and/or llm_model_id")
        return self


class TokenPairResponse(BaseModel):
    """Application access and refresh token response."""

    access_token: str
    refresh_token: str
    token_type: str = "bearer"
