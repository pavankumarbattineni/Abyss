"""Refresh utils/model_prices.json from LiteLLM's public price list.

Abyss only needs per-token prices for the providers it supports, so it ships
this small table instead of importing litellm at runtime (~130 MB, ~15 s
import). Run occasionally, review the diff, commit:

    uv run python scripts/update_model_prices.py            # download
    uv run python scripts/update_model_prices.py path.json  # from a local copy
"""
import json
import sys
from pathlib import Path

import httpx

SOURCE = "https://raw.githubusercontent.com/BerriAI/litellm/main/model_prices_and_context_window.json"
OUT = Path(__file__).resolve().parent.parent / "utils" / "model_prices.json"
# litellm_provider -> the Abyss provider whose models it prices.
PROVIDERS = {"openai": "openai", "anthropic": "anthropic", "gemini": "google"}


def main() -> None:
    if len(sys.argv) > 1:
        data = json.loads(Path(sys.argv[1]).read_text(encoding="utf-8"))
    else:
        data = httpx.get(SOURCE, timeout=60).raise_for_status().json()

    prices: dict[str, dict[str, list[float | None]]] = {p: {} for p in PROVIDERS.values()}
    for name, entry in data.items():
        if not isinstance(entry, dict) or entry.get("mode") != "chat":
            continue
        provider = PROVIDERS.get(entry.get("litellm_provider", ""))
        inp, out = entry.get("input_cost_per_token"), entry.get("output_cost_per_token")
        if not provider or inp is None or out is None:
            continue
        model = name.split("/", 1)[1] if "/" in name else name  # "gemini/gemini-2.5-flash"
        prices[provider][model] = [inp, out, entry.get("cache_read_input_token_cost")]

    for models in prices.values():
        models_sorted = dict(sorted(models.items()))
        models.clear()
        models.update(models_sorted)
    OUT.write_text(
        json.dumps(
            {"_source": SOURCE, "_format": "model: [input, output, cache_read] USD per token", **prices},
            indent=1,
        )
        + "\n",
        encoding="utf-8",
    )
    print(f"wrote {OUT} ({sum(len(m) for m in prices.values())} models)")


if __name__ == "__main__":
    main()
