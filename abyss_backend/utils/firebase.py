"""Firebase Admin initialization and ID-token verification."""

import asyncio
import json
import os

import firebase_admin
from firebase_admin import auth, credentials
from dotenv import load_dotenv

from config import config as application_config

load_dotenv()


def initialize_firebase() -> None:
    if firebase_admin._apps:
        return

    raw_config = os.getenv("ABYSS_FIREBASE_ADMIN_CONFIG")
    if not raw_config:
        raw_config = application_config.get("ABYSS_FIREBASE_ADMIN_CONFIG")
    if raw_config:
        try:
            certificate_config = (
                json.loads(raw_config) if isinstance(raw_config, str) else raw_config
            )
            firebase_admin.initialize_app(credentials.Certificate(certificate_config))
            return
        except (ValueError, TypeError, json.JSONDecodeError) as exc:
            raise RuntimeError("ABYSS_FIREBASE_ADMIN_CONFIG is invalid") from exc

    # Supports GOOGLE_APPLICATION_CREDENTIALS in local/deployed environments.
    firebase_admin.initialize_app()


async def verify_firebase_token(id_token: str) -> dict:
    initialize_firebase()
    try:
        return await asyncio.to_thread(auth.verify_id_token, id_token)
    except (auth.ExpiredIdTokenError, auth.InvalidIdTokenError, auth.RevokedIdTokenError) as exc:
        raise ValueError("Invalid or expired Firebase token") from exc
