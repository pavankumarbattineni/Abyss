"""Per-run LLM cost from a bundled price table (utils/model_prices.json).

Replaces a runtime litellm import (~130 MB, ~15 s) that was only used for
this lookup. Refresh the table with scripts/update_model_prices.py.
"""
import json
from functools import lru_cache
from pathlib import Path

_PRICES_FILE = Path(__file__).with_name("model_prices.json")


@lru_cache(maxsize=1)
def _prices() -> dict[str, dict[str, list[float | None]]]:
    data = json.loads(_PRICES_FILE.read_text(encoding="utf-8"))
    return {provider: models for provider, models in data.items() if not provider.startswith("_")}


def _lookup(provider: str, model: str) -> list[float | None] | None:
    """The provider's own entry first; then any provider (a model string is
    usually unique, and the platform default may not name its provider the
    way the table does)."""
    name = model.split("/", 1)[1] if "/" in model else model
    tables = _prices()
    if provider in tables and name in tables[provider]:
        return tables[provider][name]
    for models in tables.values():
        if name in models:
            return models[name]
    return None


def compute_cost_usd(
    provider: str | None,
    model: str | None,
    input_tokens: int,
    cache_read_tokens: int,
    output_tokens: int,
) -> float | None:
    """USD cost of a run, or None (never a misleading 0) when it can't be
    known: no provider/model resolved, no tokens, or a model the table
    doesn't list. ``input_tokens`` includes ``cache_read_tokens`` (LangChain's
    usage_metadata convention), which are billed at the cache-read price."""
    if not provider or not model or (input_tokens == 0 and output_tokens == 0):
        return None
    price = _lookup(provider, model)
    if price is None:
        return None
    input_price, output_price, cache_price = price
    cached = max(0, min(cache_read_tokens, input_tokens))
    cost = (
        (input_tokens - cached) * input_price
        + cached * (cache_price if cache_price is not None else input_price)
        + output_tokens * output_price
    )
    return round(cost, 6)
