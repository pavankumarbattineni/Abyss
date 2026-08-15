import logging

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from constants import STARTER_AGENT_NAME, STARTER_AGENT_SUB_AGENTS, STARTER_AGENT_SYSTEM_PROMPT
from database.models import User
from schemas.oauth import (
    SigninRequest,
    SignupRequest,
    TokenPairResponse,
    UpdateSettingsRequest,
    UserResponse,
)
from utils.jwt import (
    REFRESH,
    create_access_token,
    create_refresh_token,
    decode_token,
)
from utils.security import hash_password, verify_password

logger = logging.getLogger(__name__)


class OAuthService:

    def _issue_token_pair(self, user_id: str) -> TokenPairResponse:
        return TokenPairResponse(
            access_token=create_access_token(user_id),
            refresh_token=create_refresh_token(user_id),
        )

    async def _get_active_user(self, session: AsyncSession, user_id: str) -> User:
        result = await session.execute(
            select(User).where(User.id == user_id, User.is_active == True)
        )
        user = result.scalar_one_or_none()
        if not user:
            raise ValueError("User not found")
        return user

    async def signup(self, session: AsyncSession, request: SignupRequest) -> UserResponse:
        result = await session.execute(
            select(User).where(User.email == request.email, User.is_active == True)
        )
        if result.scalar_one_or_none():
            raise ValueError("User with this email already exists")

        user = User(
            username=request.username,
            email=request.email,
            password_hash=hash_password(request.password),
        )
        session.add(user)
        await session.commit()
        await session.refresh(user)

        await self._provision_starter_agent(session, user.id)

        return UserResponse(
            id=user.id,
            username=user.username,
            email=user.email,
            thinking_enabled=user.thinking_enabled,
            created_at=user.created_at,
        )

    async def _provision_starter_agent(self, session: AsyncSession, user_id: str) -> None:
        """Give every new user a ready-to-use, ThinkLoop-platform-expert agent
        immediately after signup, so they land in a working app instead of an
        empty agent list — a "ThinkLoop Guide" with four specialist sub-agents
        (agents/conversations, tools/integrations/permissions, scheduling,
        account/credentials) it delegates to for in-depth questions.

        Zero tools anywhere, platform-default model — works with no MCP
        connections or LLM credentials configured, which a brand-new user
        never has yet.

        Best-effort: a failure here must never break signup itself. The
        exception is swallowed and logged; the user can always create an
        agent manually if this doesn't succeed.
        """
        from schemas.agent import AgentCreate, SubAgentCreate
        from services.agent_service import AgentService

        try:
            await AgentService().create(
                session,
                user_id,
                AgentCreate(
                    name=STARTER_AGENT_NAME,
                    system_prompt=STARTER_AGENT_SYSTEM_PROMPT,
                    sub_agents=[SubAgentCreate(**sub) for sub in STARTER_AGENT_SUB_AGENTS],
                ),
            )
        except Exception as exc:
            logger.warning("Failed to provision starter agent for user %s: %s", user_id, exc)

    async def signin(self, session: AsyncSession, request: SigninRequest) -> TokenPairResponse:
        result = await session.execute(
            select(User).where(User.email == request.email, User.is_active == True)
        )
        user = result.scalar_one_or_none()

        if not user or not verify_password(request.password, user.password_hash):
            raise ValueError("Invalid email or password")

        return self._issue_token_pair(user.id)

    async def me(self, session: AsyncSession, user_id: str) -> UserResponse:
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
        try:
            user_id = decode_token(refresh_token, REFRESH)
        except ValueError:
            raise ValueError("Invalid or expired refresh token")

        # Ensure the user still exists / is active before issuing new tokens.
        await self._get_active_user(session, user_id)
        return self._issue_token_pair(user_id)


    async def forgot_password(
        self, session: AsyncSession, email: str, new_password: str
    ) -> None:
        """Reset a user's password in a single step, keyed on their email.

        Note: this performs no proof-of-ownership check — the caller only needs
        to know a registered email address to set a new password.
        """
        result = await session.execute(
            select(User).where(User.email == email, User.is_active == True)
        )
        user = result.scalar_one_or_none()
        if not user:
            raise ValueError("User with this email does not exist")

        user.password_hash = hash_password(new_password)
        await session.commit()

    async def reset_password(
        self, session: AsyncSession, email: str, old_password: str, new_password: str
    ) -> None:
        """Change a user's password after verifying their current password."""
        result = await session.execute(
            select(User).where(User.email == email, User.is_active == True)
        )
        user = result.scalar_one_or_none()
        if not user or not verify_password(old_password, user.password_hash):
            raise ValueError("Invalid email or password")

        user.password_hash = hash_password(new_password)
        await session.commit()
