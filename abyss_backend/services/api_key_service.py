import hashlib
import secrets

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from constants import (
    API_KEY_EXPIRY_PRESETS, API_KEY_PREFIX, API_KEY_PREFIX_LENGTH, API_KEY_TOKEN_BYTES, MAX_KEYS_PER_USER,
)
from database.models import ApiKey, utcnow
from schemas.api_key import ApiKeyCreate, ApiKeyResponse
from utils.datetime_utils import to_storage_naive


def generate_api_key() -> tuple[str, str, str]:
    """Generate a new API key.

    Returns:
        Tuple of (raw_key, key_hash, key_prefix).
        raw_key is returned to the caller once and never stored.
        key_hash (SHA-256 hex) is stored in DB for verification.
        key_prefix (first API_KEY_PREFIX_LENGTH chars) is stored for display.
    """
    token = secrets.token_urlsafe(API_KEY_TOKEN_BYTES)
    raw_key = f"{API_KEY_PREFIX}{token}"
    key_hash = hashlib.sha256(raw_key.encode()).hexdigest()
    key_prefix = raw_key[:API_KEY_PREFIX_LENGTH]
    return raw_key, key_hash, key_prefix


def is_expired(record: ApiKey) -> bool:
    return record.expires_at is not None and record.expires_at <= utcnow()


def _compute_expires_at(data: ApiKeyCreate):
    if data.expiry == "none":
        return None
    if data.expiry == "custom":
        return to_storage_naive(data.custom_expires_at)
    return utcnow() + API_KEY_EXPIRY_PRESETS[data.expiry]


class ApiKeyService:
    async def create(
        self, session: AsyncSession, user_id: str, data: ApiKeyCreate
    ) -> tuple[ApiKey, str]:
        """Create a new API key for a user.

        Args:
            session: Async database session.
            user_id: The owning user's ID.
            data: ApiKeyCreate with the display name and expiry selection.

        Returns:
            Tuple of (ApiKey record, raw_key). The raw_key must be shown to
            the user immediately — it is not stored and cannot be recovered.

        Raises:
            ValueError: If the user already has MAX_KEYS_PER_USER active keys.
        """
        active_count = await session.scalar(
            select(func.count()).select_from(ApiKey).where(
                ApiKey.user_id == user_id,
                ApiKey.is_active == True,
            )
        )
        if active_count >= MAX_KEYS_PER_USER:
            raise ValueError(
                f"Maximum of {MAX_KEYS_PER_USER} active API keys allowed per user"
            )

        raw_key, key_hash, key_prefix = generate_api_key()
        record = ApiKey(
            user_id=user_id,
            name=data.name,
            key_hash=key_hash,
            key_prefix=key_prefix,
            expires_at=_compute_expires_at(data),
        )
        session.add(record)
        await session.commit()
        await session.refresh(record)
        return record, raw_key

    async def list_keys(
        self, session: AsyncSession, user_id: str
    ) -> list[ApiKeyResponse]:
        """List all active API keys for a user, ordered by creation time.

        Args:
            session: Async database session.
            user_id: The owning user's ID.

        Returns:
            List of ApiKeyResponse (raw key is never included). is_active
            reflects revocation only — an expired-but-not-revoked key stays
            is_active=True with is_expired=True, per the "visible until
            explicitly revoked" design.
        """
        result = await session.execute(
            select(ApiKey)
            .where(ApiKey.user_id == user_id, ApiKey.is_active == True)
            .order_by(ApiKey.created_at.asc())
        )
        return [
            ApiKeyResponse.model_validate(record).model_copy(update={"is_expired": is_expired(record)})
            for record in result.scalars().all()
        ]

    async def update_name(
        self, session: AsyncSession, key_id: str, user_id: str, name: str
    ) -> ApiKey:
        """Rename an existing API key.

        Args:
            session: Async database session.
            key_id: The ApiKey record's ID.
            user_id: Must match the key's owner.
            name: New human label for the key.

        Returns:
            The updated ApiKey record.

        Raises:
            ValueError: If key not found or not owned by the user.
        """
        result = await session.execute(
            select(ApiKey).where(
                ApiKey.id == key_id,
                ApiKey.user_id == user_id,
                ApiKey.is_active == True,
            )
        )
        record = result.scalar_one_or_none()
        if not record:
            raise ValueError("API key not found")
        if record.name == name:
            return record
        record.name = name
        await session.commit()
        await session.refresh(record)
        return record

    async def revoke(
        self, session: AsyncSession, key_id: str, user_id: str
    ) -> str:
        """Soft-revoke an API key by setting is_active=False.

        Args:
            session: Async database session.
            key_id: The ApiKey record's ID.
            user_id: Must match the key's owner.

        Returns:
            str: The revoked API key's name.

        Raises:
            ValueError: If key not found or not owned by the user.
        """
        result = await session.execute(
            select(ApiKey).where(
                ApiKey.id == key_id,
                ApiKey.user_id == user_id,
                ApiKey.is_active == True,
            )
        )
        record = result.scalar_one_or_none()
        if not record:
            raise ValueError("API key not found or already revoked")
        key_name = record.name
        record.is_active = False

        await session.commit()

        return key_name
