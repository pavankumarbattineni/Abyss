"""The BYOK / platform model catalog (database/seed.py) stays consistent as models change."""
import json
from pathlib import Path

from langchain_anthropic import ChatAnthropic
from langchain_google_genai import ChatGoogleGenerativeAI
from langchain_openai import ChatOpenAI

from database.seed import CATALOG, KNOWN_CONTEXT_WINDOWS, NATIVE_REASONING_MODELS, PLATFORM_DEFAULT, PLATFORM_SLOTS
from utils.llm_providers import _build_openai

RETIRED = {"gpt-5", "gpt-5-mini", "gpt-5-nano", "gpt-5-pro", "gpt-5.1", "gpt-5.4-nano", "gpt-5.3-codex",
           "claude-opus-4-5-20251101", "claude-sonnet-4-5-20250929", "gemini-3.5-flash", "gemini-3.7-flash", "gemini-2.5-pro"}
CLIENTS = {
    "openai": lambda m: ChatOpenAI(model=m, api_key="test"),
    "anthropic": lambda m: ChatAnthropic(model=m, api_key="test"),
    "google": lambda m: ChatGoogleGenerativeAI(model=m, google_api_key="test"),
}


def _all():
    return [(provider, model) for provider, (_, models) in CATALOG.items() for model, _ in models]


def test_no_duplicates_and_no_retired_models():
    ids = [m for _, m in _all()]
    assert len(ids) == len(set(ids))
    assert not RETIRED & set(ids)


def test_platform_models_are_in_the_catalog_and_use_native_reasoning():
    listed = set(_all())
    for provider, model in [PLATFORM_DEFAULT, *PLATFORM_SLOTS.values()]:
        assert (provider, model) in listed
        assert model in NATIVE_REASONING_MODELS
    assert NATIVE_REASONING_MODELS <= {m for _, m in listed}


def test_every_model_has_a_price_so_usage_cost_is_known():
    prices = json.loads((Path(__file__).parent.parent / "utils" / "model_prices.json").read_text(encoding="utf-8"))
    missing = [m for p, m in _all() if m not in prices[p]]
    assert missing == [], missing


def test_every_model_has_a_context_window():
    # From the client library's profile, or from the providers' docs when the library doesn't know the model yet.
    unknown = [m for p, m in _all() if not (CLIENTS[p](m).profile or {}).get("max_input_tokens") and m not in KNOWN_CONTEXT_WINDOWS]
    assert unknown == [], unknown


def test_openai_models_always_use_the_responses_api():
    # GPT-6 can only call tools there; Abyss's agents need tools.
    assert _build_openai("gpt-6.1-sol", "test", False).use_responses_api
    assert _build_openai("gpt-6.1-sol", "test", True).use_responses_api
