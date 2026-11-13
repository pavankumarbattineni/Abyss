"""Run costs from the bundled price table (replaced litellm)."""
import json

import pytest

from database.seed import CATALOG
from utils.pricing import _PRICES_FILE, compute_cost_usd


@pytest.mark.parametrize(
    ("provider", "model", "tokens", "expected"),
    [
        # Reference values computed with litellm.cost_per_token before removal.
        ("openai", "gpt-5-mini", (9200, 1900, 8600), 0.019072),
        ("anthropic", "claude-sonnet-4-5", (12000, 3000, 900), 0.0414),
        ("google", "gemini-2.5-flash", (5000, 0, 2000), 0.0065),
    ],
)
def test_matches_litellm(provider, model, tokens, expected):
    assert compute_cost_usd(provider, model, *tokens) == expected


def test_unknown_cost_is_none_not_zero():
    assert compute_cost_usd("openai", "no-such-model", 10, 0, 10) is None
    assert compute_cost_usd(None, "gpt-5-mini", 10, 0, 10) is None
    assert compute_cost_usd("openai", "gpt-5-mini", 0, 0, 0) is None


def test_provider_prefix_and_cross_provider_lookup():
    assert compute_cost_usd("google", "gemini/gemini-2.5-flash", 5000, 0, 2000) == 0.0065
    assert compute_cost_usd("other", "gpt-5-mini", 9200, 1900, 8600) == 0.019072


def test_every_seeded_model_has_a_price():
    prices = json.loads(_PRICES_FILE.read_text(encoding="utf-8"))
    for provider, (_, models) in CATALOG.items():
        for model_name, _ in models:
            assert model_name in prices[provider], f"{provider}/{model_name} has no price"
