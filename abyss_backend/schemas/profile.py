"""Pydantic schemas for the signed-in user's profile and account deletion."""

from datetime import datetime
from typing import Optional

from pydantic import BaseModel, EmailStr, Field, field_validator

USERNAME_MIN = 2
USERNAME_MAX = 50
# Letters, digits, spaces and . _ - ; no leading/trailing space (stripped).
_USERNAME_CHARS = set("abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789 ._-")


class ProfileStats(BaseModel):
    """What the account owns -- shown on the profile and in the delete flow."""

    agents: int
    threads: int
    mcp_servers: int
    api_keys: int
    provider_keys: int


class ProfileResponse(BaseModel):
    """The signed-in user's profile."""

    id: str
    username: Optional[str] = None
    email: EmailStr
    created_at: datetime
    # Firebase sign-in providers for this email ("google.com", "password"),
    # so the client knows how to ask the user to confirm it's them.
    sign_in_methods: list[str]
    stats: ProfileStats


class UpdateProfileRequest(BaseModel):
    """Editable profile fields."""

    username: str = Field(min_length=USERNAME_MIN, max_length=USERNAME_MAX)

    @field_validator("username")
    @classmethod
    def _clean_username(cls, value: str) -> str:
        value = " ".join(value.split())
        if len(value) < USERNAME_MIN:
            raise ValueError(f"Use at least {USERNAME_MIN} characters")
        if not set(value) <= _USERNAME_CHARS:
            raise ValueError("Use letters, numbers, spaces, dots, dashes or underscores")
        return value


class DeleteAccountRequest(BaseModel):
    """Proof the account owner is deleting the account on purpose: the account's
    email typed out, and a Firebase ID token from a sign-in made just now."""

    confirm_email: str = Field(min_length=3, max_length=255)
    id_token: str = Field(min_length=1)
