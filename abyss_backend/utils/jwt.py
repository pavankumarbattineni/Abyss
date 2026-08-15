"""Stateless JWT helpers for authentication tokens.

All tokens are signed with the application ``SECRET_KEY`` (HS256 by default) and
carry a ``type`` claim so an access token can never be used where a refresh or
reset token is expected. No token state is persisted — validity is derived
entirely from the signature and ``exp`` claim.
"""
from datetime import datetime, timedelta, timezone
from typing import Optional

import jwt

from config import config

_jwt = config["JWT"]

SECRET_KEY: str = _jwt["secret_key"]
JWT_ALGORITHM: str = _jwt.get("algorithm", "HS256")
ACCESS_TOKEN_EXPIRE_MINUTES = 30
REFRESH_TOKEN_EXPIRE_DAYS = 30

ACCESS = "access"
REFRESH = "refresh"


def _create_token(subject: str, token_type: str, expires_delta: timedelta) -> str:
    now = datetime.now(timezone.utc)
    payload = {
        "sub": subject,
        "type": token_type,
        "iat": now,
        "exp": now + expires_delta,
    }
    return jwt.encode(payload, SECRET_KEY, algorithm=JWT_ALGORITHM)


def create_access_token(user_id: str, expires_minutes: Optional[int] = None) -> str:
    minutes = expires_minutes or ACCESS_TOKEN_EXPIRE_MINUTES
    return _create_token(user_id, ACCESS, timedelta(minutes=minutes))


def create_refresh_token(user_id: str, expires_days: Optional[int] = None) -> str:
    days = expires_days or REFRESH_TOKEN_EXPIRE_DAYS
    return _create_token(user_id, REFRESH, timedelta(days=days))


def decode_token(token: str, expected_type: str) -> str:
    """Decode and validate a token, returning its subject (user_id).

    Raises:
        ValueError: If the token is malformed, expired, or of the wrong type.
    """
    try:
        payload = jwt.decode(
            token, SECRET_KEY, algorithms=[JWT_ALGORITHM]
        )
    except jwt.PyJWTError:
        raise ValueError("Invalid or expired token")

    if payload.get("type") != expected_type:
        raise ValueError("Invalid token type")

    subject = payload.get("sub")
    if not subject:
        raise ValueError("Invalid token")

    return subject
