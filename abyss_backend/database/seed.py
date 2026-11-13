"""Seed the LLM provider/model catalog (the BYOK model picker).

Runs at startup and only inserts what is missing, so a fresh database (local
or Neon) gets a working catalog while rows an operator changed later
(deactivated, renamed, a different default) are never overwritten. Add a
model by appending it here or with a plain INSERT.
"""
import logging

from sqlalchemy import select
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.ext.asyncio import AsyncSession

from constants import REASONING_MODE_PROMPT
from database.models import Provider, ProviderModel

logger = logging.getLogger(__name__)

# The platform default runs on the platform's own OpenAI key, so it must be
# an OpenAI model. Every model uses the <reasoning> prompt protocol, which
# works on any model; switch one to "native" only after testing it.
PLATFORM_DEFAULT = ("openai", "gpt-5-mini")

CATALOG: dict[str, tuple[str, list[tuple[str, str]]]] = {
    "openai": ("OpenAI", [
        ("gpt-5.5", "GPT-5.5"),
        ("gpt-5.4", "GPT-5.4"),
        ("gpt-5.4-mini", "GPT-5.4 mini"),
        ("gpt-5-mini", "GPT-5 mini"),
    ]),
    "anthropic": ("Anthropic", [
        ("claude-opus-5-5", "Claude Opus 5.5"),
        ("claude-sonnet-5-5", "Claude Sonnet 5.5"),
        ("claude-haiku-5-5", "Claude Haiku 5.5"),
        ("claude-fable-5-2", "Claude Fable 5.2"),
    ]),
    "google": ("Google Gemini", [
        ("gemini-3.5-flash", "Gemini 3.5 Flash"),
        ("gemini-3.5-flash-lite", "Gemini 3.5 Flash-Lite"),
        ("gemini-2.5-pro", "Gemini 2.5 Pro"),
    ]),
}


async def seed_catalog(session: AsyncSession) -> int:
    """Insert missing providers and models; returns how many models were added."""
    for name, (display_name, _) in CATALOG.items():
        await session.execute(
            insert(Provider)
            .values(name=name, display_name=display_name)
            .on_conflict_do_nothing(index_elements=[Provider.name])
        )
    await session.flush()

    provider_ids = dict((await session.execute(select(Provider.name, Provider.id))).all())
    has_default = (
        await session.execute(
            select(ProviderModel.id).where(ProviderModel.is_platform_default == True).limit(1)
        )
    ).scalar_one_or_none() is not None

    added = 0
    for provider, (_, models) in CATALOG.items():
        for model_name, display_name in models:
            is_default = not has_default and (provider, model_name) == PLATFORM_DEFAULT
            result = await session.execute(
                insert(ProviderModel)
                .values(
                    provider_id=provider_ids[provider],
                    model_name=model_name,
                    display_name=display_name,
                    is_platform_default=is_default,
                    reasoning_mode=REASONING_MODE_PROMPT,
                )
                .on_conflict_do_nothing(constraint="uq_provider_models_provider_model")
            )
            added += result.rowcount or 0
    await session.commit()
    if added:
        logger.info("Seeded %d LLM catalog model(s)", added)
    return added
