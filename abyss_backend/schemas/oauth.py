from datetime import datetime
from typing import Optional

from pydantic import BaseModel, EmailStr, Field, model_validator


class SignupRequest(BaseModel):
    username: Optional[str] = Field(default=None, max_length=255)
    email: EmailStr
    password: str = Field(min_length=8)
    confirm_password: str = Field(min_length=8)

    @model_validator(mode="after")
    def passwords_match(self) -> "SignupRequest":
        if self.password != self.confirm_password:
            raise ValueError("Passwords do not match")
        return self


class SigninRequest(BaseModel):
    email: EmailStr
    password: str = Field(min_length=1)


class RefreshRequest(BaseModel):
    refresh_token: str = Field(min_length=1)


class ForgotPasswordRequest(BaseModel):
    email: EmailStr
    new_password: str = Field(min_length=8)
    confirm_new_password: str = Field(min_length=8)

    @model_validator(mode="after")
    def passwords_match(self) -> "ForgotPasswordRequest":
        if self.new_password != self.confirm_new_password:
            raise ValueError("Passwords do not match")
        return self


class ResetPasswordRequest(BaseModel):
    email: EmailStr
    old_password: str = Field(min_length=1)
    new_password: str = Field(min_length=8)
    confirm_new_password: str = Field(min_length=8)

    @model_validator(mode="after")
    def passwords_match(self) -> "ResetPasswordRequest":
        if self.new_password != self.confirm_new_password:
            raise ValueError("Passwords do not match")
        elif self.old_password == self.new_password:
            raise ValueError("New password cannot be the same as old password")
        return self


class UserResponse(BaseModel):
    id: str
    username: Optional[str] = None
    email: EmailStr
    thinking_enabled: bool
    created_at: datetime


class UpdateSettingsRequest(BaseModel):
    thinking_enabled: bool


class TokenPairResponse(BaseModel):
    access_token: str
    refresh_token: str
    token_type: str = "bearer"


class MessageResponse(BaseModel):
    message: str


class ErrorResponse(BaseModel):
    status_code: int
    status: str
    message: str
