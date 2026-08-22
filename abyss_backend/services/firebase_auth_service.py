"""Map verified Firebase identities to Abyss users."""

import re
import uuid

from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from database.models import User


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
    return user
