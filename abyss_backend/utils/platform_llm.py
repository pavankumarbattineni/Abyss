"""The platform's own LLM: the default model agents use when they have no
model of their own (and for thread titles), paid for with the platform's keys.

ABYSS_CONFIG.LLM::

    {"default_provider": "google",
     "default_model": "gemini-3.5-flash-lite",
     "api_keys": {"google": "...", "openai": "..."}}

The older shape ({"openai_api_key", "openai_model"}) still works: it means an
OpenAI default with that key. Which catalog model is the default is stored in
the database (provider_models.is_platform_default); the config's default is
the fallback when no row is flagged, and what thread titles use.
"""
from langchain_core.language_models import BaseChatModel

from config import config
from utils.llm_providers import PROVIDERS

_llm_cfg: dict = config.get("LLM", {})


def platform_api_key(provider: str) -> str | None:
    """The platform's key for a provider, or None if it has none."""
    key = (_llm_cfg.get("api_keys") or {}).get(provider)
    if not key and provider == "openai":
        key = _llm_cfg.get("openai_api_key")
    return key or None


def configured_default() -> tuple[str, str]:
    """(provider, model) the config names as the platform default."""
    if _llm_cfg.get("default_provider") and _llm_cfg.get("default_model"):
        return _llm_cfg["default_provider"], _llm_cfg["default_model"]
    return "openai", _llm_cfg.get("openai_model", "gpt-5-mini")


def build_platform_llm(provider: str, model: str, native_reasoning: bool = False) -> BaseChatModel:
    """A chat model on the platform's own key for ``provider``."""
    key = platform_api_key(provider)
    if not key:
        raise ValueError(
            f"The platform has no {provider} key configured (ABYSS_CONFIG.LLM.api_keys.{provider})."
        )
    return PROVIDERS[provider].build(model, key, native_reasoning)
