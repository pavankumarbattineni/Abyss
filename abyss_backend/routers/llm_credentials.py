from fastapi import APIRouter, Depends, status
from sqlalchemy.ext.asyncio import AsyncSession

from database.session import get_async_session
from schemas.llm_credential import (
    LlmCredentialResponse,
    LlmCredentialUpsertRequest,
    ProviderCatalogEntry,
    ProviderInfo,
)
from schemas.oauth import MessageResponse
from services.llm_credential_service import LlmCredentialService
from utils.auth import get_current_user

router = APIRouter(prefix="/llm-credentials", tags=["llm-credentials"])
llm_credential_service = LlmCredentialService()


@router.get("/providers", response_model=list[ProviderInfo])
async def list_providers(session: AsyncSession = Depends(get_async_session)):
    """List every active provider's id, name, and display name.

    Public — no auth required. Lighter-weight than GET /llm-credentials/catalog
    for callers that only need the provider list itself (e.g. to resolve a
    provider_id for PUT/DELETE /llm-credentials/{provider_id}) without also
    fetching every provider's full model list.

    Args:
        session: Async database session for database operations.

    Returns:
        list[ProviderInfo]: One entry per active provider.
    """
    return await llm_credential_service.list_providers(session)


@router.get("/catalog", response_model=list[ProviderCatalogEntry])
async def get_catalog(session: AsyncSession = Depends(get_async_session)):
    """Return the database-driven provider/model catalog used to populate model pickers.

    Public — no auth required, since a user needs to see the model list
    before deciding whether to add a credential for a given provider.

    Args:
        session: Async database session for database operations.

    Returns:
        list[ProviderCatalogEntry]: One entry per active provider with active models.
    """
    return await llm_credential_service.list_catalog(session)


@router.get("", response_model=list[LlmCredentialResponse])
async def list_credentials(
    user_id: str = Depends(get_current_user),
    session: AsyncSession = Depends(get_async_session),
):
    """List the authenticated user's saved LLM provider credentials.

    Raw API keys are never returned — only a masked preview.

    Args:
        user_id: JWT-authenticated user ID (injected by dependency).
        session: Async database session for database operations.

    Returns:
        list[LlmCredentialResponse]: One entry per provider the user has configured.
    """
    return await llm_credential_service.list_credentials(session, user_id)


@router.put("/{provider_id}", response_model=LlmCredentialResponse)
async def upsert_credential(
    provider_id: str,
    request: LlmCredentialUpsertRequest,
    user_id: str = Depends(get_current_user),
    session: AsyncSession = Depends(get_async_session),
):
    """Add or replace the authenticated user's API key for a provider.

    The key is validated with a real call to the provider before being
    encrypted and stored. Any agent already configured on this provider has
    its compiled graph cache invalidated so the next message uses the new key.

    Args:
        provider_id: The provider's database ID (from GET /llm-credentials/catalog).
        request: Body containing the raw API key.
        user_id: JWT-authenticated user ID (injected by dependency).
        session: Async database session for database operations.

    Returns:
        LlmCredentialResponse: The stored credential, with a masked key preview.

    Raises:
        HTTPException: 422 if the provider is unknown/inactive or the key fails validation.
    """
    return await llm_credential_service.upsert_credential(session, user_id, provider_id, request)


@router.delete("/{provider_id}", response_model=MessageResponse)
async def delete_credential(
    provider_id: str,
    user_id: str = Depends(get_current_user),
    session: AsyncSession = Depends(get_async_session),
):
    """Remove the authenticated user's saved credential for a provider.

    Agents pointed at this provider fall back to the platform default (OpenAI
    only) or fail with a clear error at chat time (Anthropic/Google).

    Args:
        provider_id: The provider's database ID (from GET /llm-credentials/catalog).
        user_id: JWT-authenticated user ID (injected by dependency).
        session: Async database session for database operations.

    Returns:
        MessageResponse: Confirmation message.

    Raises:
        HTTPException: 422 if the provider is unknown/inactive or no credential exists.
    """
    await llm_credential_service.delete_credential(session, user_id, provider_id)
    return MessageResponse(message="Credential removed")
