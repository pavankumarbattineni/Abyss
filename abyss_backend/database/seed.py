"""Seed the LLM provider/model catalog (the BYOK model picker).

Runs at startup and only inserts what is missing, so a fresh database (local
or Neon) gets a working catalog while rows an operator changed later
(deactivated, renamed, a different default) are never overwritten. Add a
model by appending it here or with a plain INSERT.
"""
import logging

from sqlalchemy import select, update
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.ext.asyncio import AsyncSession

from constants import REASONING_MODE_NATIVE, REASONING_MODE_PROMPT
from database.models import Provider, ProviderModel

logger = logging.getLogger(__name__)

# The default for agents without a model of their own, on a fresh database.
# It runs on the platform's key for its provider (ABYSS_CONFIG.LLM.api_keys);
# existing databases were switched by migration 0003. Every model uses the
# <reasoning> prompt protocol, which works on any model; switch one to
# "native" only after testing it.
PLATFORM_DEFAULT = ("google", "gemini-3.5-flash-lite")
# The platform's extra models, offered as "Default - 1" / "Default - 2" on its
# key (provider_models.platform_slot; migrations 0010, 0011). Slot 1 moved
# 2026-11-24 to 3.6 Flash, which Google now routes gemini-3.5-flash to
# (verified: native reasoning shows). Slot 2 stays on 3 Flash (preview): 3.8
# Flash was tried but kept failing with 503/504 (high demand) at the time.
PLATFORM_SLOTS: dict[int, tuple[str, str]] = {
    1: ("google", "gemini-3.6-flash"),
    2: ("google", "gemini-3-flash-preview"),
}

# The BYOK model picker: every current model of the supported families, newest
# first, from each provider's model, pricing and deprecation pages (checked
# 2026-11-24). Left out on purpose:
# - retired or deprecated models (they shut down within months; migration 0011
#   deactivates the ones listed before and moves their users to a replacement):
#   gpt-5, gpt-5-mini, gpt-5-nano, gpt-5-pro, gpt-5.1, gpt-5.4-nano, gpt-5.3-codex,
#   claude-opus-4-5, claude-sonnet-4-5, gemini-3.5-flash and gemini-3.7-flash
#   (now routed by Google to 3.6 / 3.8 Flash);
# - OpenAI Pro models (very slow and costly per answer), and models behind
#   special access (cyber, life-sciences, law configurations; Claude Mythos);
# - Gemini models that aren't chat models (image, audio, live, TTS, embeddings).
# OpenAI models run on the Responses API (utils/llm_providers.py): GPT-6 can
# only call tools there.
CATALOG: dict[str, tuple[str, list[tuple[str, str]]]] = {
    "openai": ("OpenAI", [
        ("gpt-6.2-astra", "GPT-6.2 Astra"),
        ("gpt-6.2-sol", "GPT-6.2 Sol"),
        ("gpt-6-astra", "GPT-6 Astra"),
        ("gpt-6.1-sol", "GPT-6.1 Sol"),
        ("gpt-6.1-terra", "GPT-6.1 Terra"),
        ("gpt-6-sol", "GPT-6 Sol"),
        ("gpt-6-luna", "GPT-6 Luna"),
        ("gpt-5.6-sol", "GPT-5.6 Sol"),
        ("gpt-5.6-terra", "GPT-5.6 Terra"),
        ("gpt-5.6-luna", "GPT-5.6 Luna"),
        ("gpt-5.5", "GPT-5.5"),
        ("gpt-5.4", "GPT-5.4"),
        ("gpt-5.4-mini", "GPT-5.4 mini"),
        ("gpt-5.2", "GPT-5.2"),
    ]),
    "anthropic": ("Anthropic", [
        ("claude-fable-5-2", "Claude Fable 5.2"),
        ("claude-opus-5-5", "Claude Opus 5.5"),
        ("claude-sonnet-5-5", "Claude Sonnet 5.5"),
        ("claude-haiku-5-5", "Claude Haiku 5.5"),
        ("claude-fable-5-1", "Claude Fable 5.1"),
        ("claude-fable-5", "Claude Fable 5"),
        ("claude-opus-5", "Claude Opus 5"),
        ("claude-sonnet-5", "Claude Sonnet 5"),
        ("claude-opus-4-8", "Claude Opus 4.8"),
        ("claude-opus-4-7", "Claude Opus 4.7"),
        ("claude-opus-4-6", "Claude Opus 4.6"),
        ("claude-sonnet-4-6", "Claude Sonnet 4.6"),
        ("claude-haiku-4-5-20251001", "Claude Haiku 4.5"),
    ]),
    "google": ("Google Gemini", [
        ("gemini-4-neon", "Gemini 4 Neon"),
        ("gemini-4-carbon", "Gemini 4 Carbon"),
        ("gemini-4-argon", "Gemini 4 Argon"),
        ("gemini-4-hydrogen", "Gemini 4 Hydrogen"),
        ("gemini-3.8-flash", "Gemini 3.8 Flash"),
        ("gemini-3.6-flash", "Gemini 3.6 Flash"),
        ("gemini-3.5-flash-lite", "Gemini 3.5 Flash-Lite"),
        ("gemini-3.1-pro-preview", "Gemini 3.1 Pro (preview)"),
        ("gemini-3.1-flash-lite", "Gemini 3.1 Flash-Lite"),
        ("gemini-3-flash-preview", "Gemini 3 Flash (preview)"),
    ]),
}


# Models tested with the provider's own (native) reasoning. With the <reasoning>
# prompt protocol, Gemini 3.5 Flash-Lite sometimes wrote tool calls as text or
# stopped after its reasoning, so specialists were skipped (migration 0006).
# All three platform models (Default, Default - 1, Default - 2) use it.
NATIVE_REASONING_MODELS = {"gemini-3.5-flash-lite", "gemini-3.6-flash", "gemini-3.8-flash", "gemini-3-flash-preview"}

# Input context windows (tokens) for catalog models LangChain has no profile
# for -- the selected model's window sets when a conversation is summarized
# (abyss_agents/history.py). From the providers' model docs (GPT-6: 1.05M
# window, of which at most 922K input).
KNOWN_CONTEXT_WINDOWS: dict[str, int] = {
    "gpt-6.2-astra": 922_000,
    "gpt-6.2-sol": 922_000,
    "gpt-6-astra": 922_000,
    "gpt-6.1-sol": 922_000,
    "gpt-6.1-terra": 922_000,
    "gpt-6-sol": 922_000,
    "gpt-6-luna": 922_000,
    "claude-fable-5-2": 1_000_000,
    "claude-opus-5-5": 1_000_000,
    "claude-sonnet-5-5": 1_000_000,
    "claude-haiku-5-5": 1_000_000,
    "claude-fable-5-1": 1_000_000,
    "claude-fable-5": 1_000_000,
    "claude-opus-5": 1_000_000,
    "claude-sonnet-5": 1_000_000,
    "claude-opus-4-8": 1_000_000,
    "claude-opus-4-7": 1_000_000,
    "claude-opus-4-6": 1_000_000,
    "claude-sonnet-4-6": 1_000_000,
    "claude-haiku-4-5-20251001": 200_000,
    "gemini-4-neon": 1_048_576,
    "gemini-4-carbon": 1_048_576,
    "gemini-4-argon": 1_048_576,
    "gemini-4-hydrogen": 1_048_576,
    "gemini-3.8-flash": 1_048_576,
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
                    reasoning_mode=REASONING_MODE_NATIVE if model_name in NATIVE_REASONING_MODELS else REASONING_MODE_PROMPT,
                )
                .on_conflict_do_nothing(constraint="uq_provider_models_provider_model")
            )
            added += result.rowcount or 0
    # Fill an empty "Default - n" slot (an operator's own choice is kept).
    for slot, (provider, model_name) in PLATFORM_SLOTS.items():
        taken = await session.scalar(select(ProviderModel.id).where(ProviderModel.platform_slot == slot))
        if taken is None:
            await session.execute(
                update(ProviderModel)
                .where(
                    ProviderModel.provider_id == provider_ids[provider],
                    ProviderModel.model_name == model_name,
                    ProviderModel.platform_slot.is_(None),
                )
                .values(platform_slot=slot)
            )
    await session.commit()
    if added:
        logger.info("Seeded %d LLM catalog model(s)", added)
    return added
