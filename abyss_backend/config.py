"""Centralized configuration for the Thinkloop backend.

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

from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    envi: str = "dev"
    config: str = ""

    class Config:
        env_prefix = "THINKLOOP_"
        env_file = ".env"
        env_file_encoding = "utf-8"
        extra = "allow"


settings = Settings()

assert settings.config, (
    "THINKLOOP_CONFIG environment variable is missing. "
    "Set THINKLOOP_CONFIG='{...}' in your .env file. "
    "See .env.example for the required structure."
)

config: dict = json.loads(settings.config)
