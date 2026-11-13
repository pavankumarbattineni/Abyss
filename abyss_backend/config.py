"""Centralized configuration for the Abyss backend.

All application credentials, secrets, API keys, and environment-specific
settings are loaded here. No other module should access environment variables
or secrets directly — import ``config`` from this module instead.

Usage::

    from config import config

    # Database
    db_username = config["DB"]["username"]

    # LLM
    api_key = config["LLM"]["openai_api_key"]
"""
import json

from pydantic_settings import BaseSettings, SettingsConfigDict


DEFAULT_ALLOWED_ORIGINS = "http://localhost:3100,http://127.0.0.1:3100"


class Settings(BaseSettings):
    envi: str = "dev"
    config: str = ""
    # Comma-separated browser origins allowed to call the API (the frontend's
    # URL). Never "*": the API accepts credentials.
    allowed_origins: str = DEFAULT_ALLOWED_ORIGINS

    model_config = SettingsConfigDict(
        env_prefix="ABYSS_", env_file=".env", env_file_encoding="utf-8", extra="allow",
    )


settings = Settings()

assert settings.config, (
    "ABYSS_CONFIG environment variable is missing. "
    "Set ABYSS_CONFIG='{...}' in your .env file. "
    "See .env.example for the required structure."
)

config: dict = json.loads(settings.config)


def parse_origins(raw: str) -> list[str]:
    """``"https://a.app, https://b.app/"`` -> ``["https://a.app", "https://b.app"]``.

    A wildcard is refused: browsers reject ``*`` together with credentials,
    and it would let any website call the API from a signed-in browser.
    """
    origins = [origin.strip().rstrip("/") for origin in raw.split(",") if origin.strip()]
    if "*" in origins:
        raise ValueError("ABYSS_ALLOWED_ORIGINS must list explicit origins, not '*'")
    return origins


ALLOWED_ORIGINS: list[str] = parse_origins(settings.allowed_origins)
