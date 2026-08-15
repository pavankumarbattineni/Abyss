from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession

from database.session import get_async_session
from schemas.api_key import ApiKeyCreate, ApiKeyCreateResponse, ApiKeyRename, ApiKeyResponse
from schemas.oauth import MessageResponse
from services.api_key_service import ApiKeyService, is_expired
from utils.auth import get_current_user

router = APIRouter(prefix="/api-keys", tags=["api-keys"])
api_key_service = ApiKeyService()


@router.post("", response_model=ApiKeyCreateResponse, status_code=status.HTTP_201_CREATED)
async def create_api_key(
    request: ApiKeyCreate,
    user_id: str = Depends(get_current_user),
    session: AsyncSession = Depends(get_async_session),
):
    """Generate a new API key for the authenticated user.

    The raw key is returned exactly once and cannot be retrieved later.
    Store it securely immediately after creation.

    Args:
        request: ApiKeyCreate body with a human-readable name and an expiry
            selection ("7d" | "1m" | "3m" | "6m" | "custom" | "none").
        user_id: JWT-authenticated user ID.
        session: Async database session.

    Returns:
        ApiKeyCreateResponse with the raw key and metadata.

    Raises:
        HTTPException 422: If the per-user key limit is reached, or
            custom_expires_at is missing/not in the future for expiry="custom".
    """
    record, raw_key = await api_key_service.create(session, user_id, request)
    return ApiKeyCreateResponse(
        id=record.id,
        name=record.name,
        key=raw_key,
        key_prefix=record.key_prefix,
        expires_at=record.expires_at,
        is_expired=is_expired(record),
        created_at=record.created_at,
    )


@router.patch("/{key_id}", response_model=MessageResponse)
async def rename_api_key(
    key_id: str,
    request: ApiKeyRename,
    user_id: str = Depends(get_current_user),
    session: AsyncSession = Depends(get_async_session),
):
    """Rename an existing API key.

    Only the display name is updated; the key value itself is unchanged.

    Args:
        key_id: The API key's unique ID.
        request: ApiKeyRename body with the new name.
        user_id: JWT-authenticated user ID.
        session: Async database session.

    Returns:
        MessageResponse confirming the new name.

    Raises:
        HTTPException 422: If key not found or not owned by the user.
    """
    record = await api_key_service.update_name(session, key_id, user_id, request.name)
    return MessageResponse(message=f"API key renamed to '{record.name}' successfully")


@router.get("", response_model=list[ApiKeyResponse])
async def list_api_keys(
    user_id: str = Depends(get_current_user),
    session: AsyncSession = Depends(get_async_session),
):
    """List all active API keys for the authenticated user.

    Raw key values are never returned. Only the prefix and metadata are shown.

    Args:
        user_id: JWT-authenticated user ID.
        session: Async database session.

    Returns:
        List of ApiKeyResponse objects ordered by creation time.
    """
    return await api_key_service.list_keys(session, user_id)


@router.delete("/{key_id}")
async def revoke_api_key(
    key_id: str,
    user_id: str = Depends(get_current_user),
    session: AsyncSession = Depends(get_async_session),
):
    """Revoke an API key. Immediately invalidates all requests using this key.

    Args:
        key_id: The API key's unique ID.
        user_id: JWT-authenticated user ID.
        session: Async database session.

    Raises:
        HTTPException 422: If key not found or not owned by the user.
    """
    key_name = await api_key_service.revoke(session, key_id, user_id)

    return {
        "message": f"API key '{key_name}' deleted successfully"
    }