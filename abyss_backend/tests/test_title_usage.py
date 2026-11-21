"""The thread-title call is counted in Usage, priced on the platform default (no LLM, no database)."""
from types import SimpleNamespace

from services.chat_service import TitleUsage, _add_costs
from utils.platform_llm import configured_default
from utils.pricing import compute_cost_usd


def _response(input_tokens, output_tokens, cache_read=0):
    return SimpleNamespace(usage_metadata={
        "input_tokens": input_tokens,
        "output_tokens": output_tokens,
        "input_token_details": {"cache_read": cache_read},
    })


def test_title_tokens_add_up_over_a_retry():
    usage = TitleUsage()
    usage.add(_response(160, 4))
    usage.add(_response(175, 8, cache_read=100))  # the retry
    usage.add(SimpleNamespace())  # a response without usage counts nothing
    assert (usage.input_tokens, usage.cache_read_tokens, usage.output_tokens) == (335, 100, 12)


def test_title_cost_uses_the_platform_default_price():
    usage = TitleUsage(input_tokens=175, output_tokens=8)
    provider, model = configured_default()
    assert usage.cost_usd() == compute_cost_usd(provider, model, 175, 0, 8)


def test_run_cost_includes_the_title_and_never_hides_an_unknown_as_zero():
    assert _add_costs(0.006902, 0.000073) == 0.006975  # the 11-21 06:08 run: Usage = both traces
    assert _add_costs(None, 0.000073) == 0.000073
    assert _add_costs(0.0069, None) == 0.0069
    assert _add_costs(None, None) is None
