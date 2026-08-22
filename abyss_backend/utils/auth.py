import hashlib
from typing import Optional

from fastapi import Depends, Header, HTTPException, Query, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from constants import API_KEY_PREFIX
from database.models import ApiKey, utcnow
from database.session import get_async_session
from utils.jwt import ACCESS, decode_token

_bearer_optional = HTTPBearer(auto_error=False)

_UNAUTHORIZED = HTTPException(
    status_code=status.HTTP_401_UNAUTHORIZED,
    detail="Invalid or expired token",
)


def _resolve_jwt(token: str) -> str:
    """Resolve a JWT access token to a user_id, or raise 401."""
    try:
        return decode_token(token, ACCESS)
    except ValueError:
        raise _UNAUTHORIZED


async def _resolve_api_key(token: str, session: AsyncSession) -> str:
    """Resolve an ``sk-tl-`` API key to a user_id via its SHA-256 hash."""
    key_hash = hashlib.sha256(token.encode()).hexdigest()
    result = await session.execute(
        select(ApiKey).where(
            ApiKey.key_hash == key_hash,
            ApiKey.is_active == True,
        )
    )
    record = result.scalar_one_or_none()
    # Deliberately the same message for "not found/revoked" and "expired" —
    # an expired key stays is_active=True (visible to its owner as expired)
    # but must not leak that distinction to whoever is presenting the token.
    if not record or (record.expires_at is not None and record.expires_at <= utcnow()):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid or revoked API key",
        )
    return record.user_id


async def _resolve_any(token: str, session: AsyncSession) -> str:
    """Resolve a token that may be either an API key or a JWT access token."""
    if token.startswith(API_KEY_PREFIX):
        return await _resolve_api_key(token, session)
    return _resolve_jwt(token)


async def get_current_user(
    credentials: Optional[HTTPAuthorizationCredentials] = Depends(_bearer_optional),
) -> str:
    """Authenticate protected APIs with an Abyss access token only."""
    if not credentials:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Missing authentication — provide Authorization: Bearer <token>",
        )
    return _resolve_jwt(credentials.credentials)


async def get_current_user_flexible(
    credentials: Optional[HTTPAuthorizationCredentials] = Depends(_bearer_optional),
    x_api_key: Optional[str] = Header(None, alias="x-api-key"),
    session: AsyncSession = Depends(get_async_session),
) -> str:
    """Authenticate via a JWT access token (Bearer) OR an ``X-Api-Key`` header.

    Applied to the specific endpoints that permit API-key access. Both methods
    are accepted; Bearer takes priority if both are supplied.
    """
    if credentials:
        return await _resolve_any(credentials.credentials, session)
    if x_api_key:
        return await _resolve_any(x_api_key, session)
    raise HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Missing authentication — provide Authorization: Bearer <token> or X-Api-Key: <token>",
    )


async def get_current_user_sse(
    token: Optional[str] = Query(None),
    credentials: Optional[HTTPAuthorizationCredentials] = Depends(_bearer_optional),
    x_api_key: Optional[str] = Header(None, alias="x-api-key"),
    session: AsyncSession = Depends(get_async_session),
) -> str:
    """Authenticate an SSE request — accepts a JWT access token or API key.

    Priority: Authorization header → X-Api-Key header → ?token query param.
    Native EventSource cannot set headers, so it passes the token via ?token=.
    """
    raw: Optional[str] = None
    if credentials:
        raw = credentials.credentials
    elif x_api_key:
        raw = x_api_key
    elif token:
        raw = token

    if not raw:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Missing token",
        )
    return await _resolve_any(raw, session)
