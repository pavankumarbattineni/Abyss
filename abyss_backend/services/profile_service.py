"""The signed-in user's profile, and permanent account deletion."""

import asyncio
import logging
import time

from firebase_admin import auth as firebase_auth
from sqlalchemy import delete, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from constants import (
    STREAM_STATUS_AWAITING_APPROVAL,
    STREAM_STATUS_PENDING,
    STREAM_STATUS_RUNNING,
)
from database.checkpointer import delete_thread_checkpoints
from database.models import (
    Agent,
    ApiKey,
    LlmCredential,
    MCPConnection,
    StreamRecord,
    Thread,
    User,
)
from schemas.profile import (
    DeleteAccountRequest,
    ProfileResponse,
    ProfileStats,
    UpdateProfileRequest,
)
from utils.firebase import initialize_firebase, verify_firebase_token

logger = logging.getLogger(__name__)

# How recent the confirming sign-in must be for a deletion to go ahead.
RECENT_SIGN_IN_SECONDS = 5 * 60
_ACTIVE_STREAM_STATUSES = (
    STREAM_STATUS_PENDING,
    STREAM_STATUS_RUNNING,
    STREAM_STATUS_AWAITING_APPROVAL,
)


class ProfileError(Exception):
    """A request the API answers with `status_code` and `message`."""

    def __init__(self, status_code: int, message: str) -> None:
        super().__init__(message)
        self.status_code = status_code
        self.message = message


def _firebase_sign_in_methods(email: str) -> list[str]:
    """Firebase providers linked to this email; [] when Firebase can't say."""
    try:
        initialize_firebase()
        record = firebase_auth.get_user_by_email(email)
    except Exception:  # noqa: BLE001 -- the profile still loads without it
        logger.warning("Couldn't read Firebase sign-in methods for a profile")
        return []
    return sorted({info.provider_id for info in record.provider_data})


def _delete_firebase_user(email: str) -> None:
    initialize_firebase()
    try:
        firebase_auth.delete_user(firebase_auth.get_user_by_email(email).uid)
    except firebase_auth.UserNotFoundError:
        pass


class ProfileService:
    async def _get_user(self, session: AsyncSession, user_id: str) -> User:
        user = (
            await session.execute(select(User).where(User.id == user_id, User.is_active.is_(True)))
        ).scalar_one_or_none()
        if user is None:
            raise ProfileError(401, "User not found")
        return user

    async def _stats(self, session: AsyncSession, user_id: str) -> ProfileStats:
        async def count(model, *where) -> int:
            query = select(func.count()).select_from(model).where(
                model.user_id == user_id, model.is_active.is_(True), *where
            )
            return (await session.execute(query)).scalar_one()

        return ProfileStats(
            # Specialists are agents too (parent_id set); count the user's own agents.
            agents=await count(Agent, Agent.parent_id.is_(None)),
            threads=await count(Thread),
            mcp_servers=await count(MCPConnection),
            api_keys=await count(ApiKey),
            provider_keys=await count(LlmCredential),
        )

    async def _response(self, session: AsyncSession, user: User) -> ProfileResponse:
        methods = await asyncio.to_thread(_firebase_sign_in_methods, user.email)
        return ProfileResponse(
            id=user.id,
            username=user.username,
            email=user.email,
            created_at=user.created_at,
            sign_in_methods=methods,
            stats=await self._stats(session, user.id),
        )

    async def get(self, session: AsyncSession, user_id: str) -> ProfileResponse:
        return await self._response(session, await self._get_user(session, user_id))

    async def update(
        self, session: AsyncSession, user_id: str, request: UpdateProfileRequest
    ) -> ProfileResponse:
        user = await self._get_user(session, user_id)
        user.username = request.username
        await session.commit()
        await session.refresh(user)
        return await self._response(session, user)

    async def delete_account(
        self, session: AsyncSession, user_id: str, request: DeleteAccountRequest
    ) -> None:
        """Permanently delete the account and everything it owns.

        Checks, in order: the typed email matches the account; the Firebase ID
        token is valid, belongs to this account and comes from a sign-in made
        in the last few minutes; no answer is still being generated. Then the
        user row is deleted (agents, specialists, threads, messages, runs, MCP
        servers and tools, API keys and provider keys all cascade), followed by
        each thread's LangGraph memory and the Firebase sign-in.
        """
        # Failed identity checks are 403, not 401: a 401 means "session
        # expired" to the client, which would refresh and retry pointlessly.
        user = await self._get_user(session, user_id)
        email = user.email.lower()

        if request.confirm_email.strip().lower() != email:
            raise ProfileError(400, "The email you typed doesn't match this account.")

        try:
            claims = await verify_firebase_token(request.id_token)
        except (ValueError, RuntimeError) as exc:
            raise ProfileError(403, "Confirm it's you again, then retry.") from exc
        if (claims.get("email") or "").lower() != email:
            raise ProfileError(403, "Confirm with the account you're signed in to.")
        signed_in_at = claims.get("auth_time") or 0
        if time.time() - signed_in_at > RECENT_SIGN_IN_SECONDS:
            raise ProfileError(403, "Confirm it's you again, then retry.")

        thread_ids = (
            (await session.execute(select(Thread.id).where(Thread.user_id == user.id)))
            .scalars()
            .all()
        )
        if thread_ids:
            busy = (
                await session.execute(
                    select(func.count())
                    .select_from(StreamRecord)
                    .where(
                        StreamRecord.thread_id.in_(thread_ids),
                        StreamRecord.status.in_(_ACTIVE_STREAM_STATUSES),
                    )
                )
            ).scalar_one()
            if busy:
                raise ProfileError(
                    409,
                    "An answer is still being written. Stop it or let it finish, then try again.",
                )

        await session.execute(delete(User).where(User.id == user.id))
        await session.commit()
        logger.info("Account deleted | user_id=%s threads=%d", user.id, len(thread_ids))

        # The account is gone; the rest is cleanup. A failure here can't bring
        # it back, so it's logged rather than reported to the user.
        for thread_id in thread_ids:
            try:
                await delete_thread_checkpoints(thread_id)
            except Exception:  # noqa: BLE001
                logger.exception("Checkpoint cleanup failed | thread_id=%s", thread_id)
        try:
            await asyncio.to_thread(_delete_firebase_user, user.email)
        except Exception:  # noqa: BLE001
            logger.exception("Firebase user cleanup failed | user_id=%s", user.id)
