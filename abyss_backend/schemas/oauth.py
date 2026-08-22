"""Shared non-authentication response schemas."""

from pydantic import BaseModel


class MessageResponse(BaseModel):
    """Simple message response returned by non-authentication endpoints."""

    message: str


class ErrorResponse(BaseModel):
    """Standardized API error response."""

    status_code: int
    status: str
    message: str
