"""Map verified Firebase identities to Abyss users."""

import logging
import re
import uuid

from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from constants import (
    STARTER_AGENT_NAME,
    STARTER_AGENT_SUB_AGENTS,
    STARTER_AGENT_SYSTEM_PROMPT,
)
from database.models import User

logger = logging.getLogger(__name__)


def _username(email: str, display_name: str | None) -> str:
    source = display_name or email.split("@", 1)[0]
    value = re.sub(r"[^a-zA-Z0-9_]", "", source)[:50] or f"user_{uuid.uuid4().hex[:8]}"
    return value


async def authenticate_firebase_user(
    session: AsyncSession, decoded_token: dict
) -> User:
    email = decoded_token.get("email")
    if not email:
        raise ValueError("Firebase token must contain an email")

    result = await session.execute(select(User).where(User.email == email))
    user = result.scalar_one_or_none()
    if user:
        user.password_hash = None
        await session.commit()
        await session.refresh(user)
        return user

    user = User(
        username=_username(email, decoded_token.get("name")),
        email=email,
        password_hash=None,
    )
    session.add(user)
    try:
        await session.commit()
    except IntegrityError:
        # A concurrent first login may have created the same email. Reuse it
        # instead of surfacing a duplicate-user failure to the client.
        await session.rollback()
        result = await session.execute(select(User).where(User.email == email))
        existing_user = result.scalar_one_or_none()
        if existing_user:
            return existing_user
        raise
    await session.refresh(user)
    await _provision_starter_agent(session, user.id)
    return user


async def _provision_starter_agent(session: AsyncSession, user_id: str) -> None:
    """Give every new user the ready-to-use Abyss Guide (and its specialists)
    on first sign-in, so they land in a working app rather than an empty
    agent list. No tools and the platform-default model, so it works before
    any MCP connection or API key exists.

    Best-effort: a failure is logged and never breaks sign-in -- the user can
    always create an agent themselves. (This was lost when sign-in moved to
    Firebase; restored here, on the one path that creates users.)
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
    except Exception as exc:  # noqa: BLE001 -- must never fail sign-in
        logger.warning("Failed to provision starter agent for user %s: %s", user_id, exc)
        await session.rollback()
