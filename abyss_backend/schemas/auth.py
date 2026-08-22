"""Pydantic schemas used by authentication and session APIs."""

from datetime import datetime
from typing import Optional

from pydantic import BaseModel, EmailStr, Field


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
    created_at: datetime


class UpdateSettingsRequest(BaseModel):
    """Request body for updating user-level application settings."""

    thinking_enabled: bool


class TokenPairResponse(BaseModel):
    """Application access and refresh token response."""

    access_token: str
    refresh_token: str
    token_type: str = "bearer"
