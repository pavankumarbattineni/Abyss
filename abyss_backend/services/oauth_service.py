"""Application session operations used by the authentication router."""

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from database.models import User
from schemas.auth import TokenPairResponse, UpdateSettingsRequest, UserResponse
from utils.jwt import REFRESH, create_access_token, create_refresh_token, decode_token


class OAuthService:
    """Manage Abyss users and stateless application token pairs."""

    def _issue_token_pair(self, user_id: str) -> TokenPairResponse:
        """Create an access token and refresh token for an application user.

        Args:
            user_id: Abyss user identifier to place in both token subjects.

        Returns:
            A signed application token pair.
        """
        return TokenPairResponse(
            access_token=create_access_token(user_id),
            refresh_token=create_refresh_token(user_id),
        )

    async def _get_active_user(self, session: AsyncSession, user_id: str) -> User:
        """Load an active user or raise a validation error.

        Args:
            session: Database session used for the lookup.
            user_id: Abyss user identifier.

        Returns:
            The active user record.

        Raises:
            ValueError: If the user does not exist or is inactive.
        """
        result = await session.execute(
            select(User).where(User.id == user_id, User.is_active == True)
        )
        user = result.scalar_one_or_none()
        if not user:
            raise ValueError("User not found")
        return user

    async def me(self, session: AsyncSession, user_id: str) -> UserResponse:
        """Return the public profile for an active user.

        Args:
            session: Database session used to load the profile.
            user_id: Abyss user identifier.

        Returns:
            Public user profile data.
        """
        user = await self._get_active_user(session, user_id)
        return UserResponse(
            id=user.id,
            username=user.username,
            email=user.email,
            thinking_enabled=user.thinking_enabled,
            created_at=user.created_at,
        )

    async def update_settings(
        self, session: AsyncSession, user_id: str, request: UpdateSettingsRequest
    ) -> UserResponse:
        """Update settings for an active application user.

        Args:
            session: Database session used for the update.
            user_id: Abyss user identifier.
            request: New application setting values.

        Returns:
            The updated public user profile.
        """
        user = await self._get_active_user(session, user_id)
        user.thinking_enabled = request.thinking_enabled
        await session.commit()
        await session.refresh(user)
        return UserResponse(
            id=user.id,
            username=user.username,
            email=user.email,
            thinking_enabled=user.thinking_enabled,
            created_at=user.created_at,
        )

    async def refresh(self, session: AsyncSession, refresh_token: str) -> TokenPairResponse:
        """Validate a refresh token and issue a replacement token pair.

        Args:
            session: Database session used to verify the user is active.
            refresh_token: Existing signed Abyss refresh token.

        Returns:
            A replacement access-token and refresh-token pair.

        Raises:
            ValueError: If the token is invalid or its user is inactive.
        """
        user_id = decode_token(refresh_token, REFRESH)
        await self._get_active_user(session, user_id)
        return self._issue_token_pair(user_id)
