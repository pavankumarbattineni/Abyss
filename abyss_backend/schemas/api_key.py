from datetime import datetime, timezone
from typing import Literal, Optional

from pydantic import BaseModel, Field, model_validator


class ApiKeyCreate(BaseModel):
    name: str = Field(min_length=1, max_length=100)
    expiry: Literal["7d", "1m", "3m", "6m", "custom", "none"] = "none"
    custom_expires_at: Optional[datetime] = Field(
        default=None,
        description='Required (and only used) when expiry="custom". Must be in the future.',
    )

    @model_validator(mode="after")
    def _validate_custom_expiry(self) -> "ApiKeyCreate":
        if self.expiry == "custom":
            if not self.custom_expires_at:
                raise ValueError('custom_expires_at is required when expiry is "custom"')
            now = datetime.now(timezone.utc) if self.custom_expires_at.tzinfo else datetime.now()
            if self.custom_expires_at <= now:
                raise ValueError("custom_expires_at must be in the future")
        elif self.custom_expires_at is not None:
            raise ValueError('custom_expires_at may only be set when expiry is "custom"')
        return self


class ApiKeyRename(BaseModel):
    name: str = Field(min_length=1, max_length=100)


class ApiKeyCreateResponse(BaseModel):
    id: str
    name: str
    key: str
    key_prefix: str
    expires_at: Optional[datetime] = None
    is_expired: bool = False
    created_at: datetime

    model_config = {"from_attributes": True}


class ApiKeyResponse(BaseModel):
    id: str
    name: str
    key_prefix: str
    is_active: bool
    expires_at: Optional[datetime] = None
    is_expired: bool = False
    created_at: datetime

    model_config = {"from_attributes": True}
