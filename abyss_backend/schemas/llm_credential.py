from datetime import datetime

from pydantic import BaseModel, Field


class LlmCredentialUpsertRequest(BaseModel):
    api_key: str = Field(min_length=1, max_length=512)


class ProviderInfo(BaseModel):
    id: str
    name: str
    display_name: str


class LlmCredentialResponse(BaseModel):
    provider_id: str
    provider: str
    display_name: str
    masked_key: str
    created_at: datetime
    updated_at: datetime


class CatalogModelEntry(BaseModel):
    id: str
    model_name: str
    display_name: str


class ProviderCatalogEntry(BaseModel):
    provider_id: str
    provider: str
    display_name: str
    models: list[CatalogModelEntry]
