"""The `find_places` tool: real coordinates for the `map` visual, from Wikipedia.

A model asked to draw a journey or a set of places would otherwise guess
latitudes and longitudes. This looks each name up on English Wikipedia (the
best-matching article that has coordinates) and returns its position and a
one-line description. Historical names work ("Constantinople", "Merv").
Only the place names leave the server: no user or conversation data.
"""
from __future__ import annotations

import asyncio
import json
import logging

import httpx
from langchain_core.tools import tool

from abyss_agents.http_retry import get_with_retry
from abyss_agents.images import TIMEOUT_SECONDS, USER_AGENT
from abyss_agents.tool_display import background_step

logger = logging.getLogger(__name__)

WIKIPEDIA_API = "https://en.wikipedia.org/w/api.php"
MAX_PLACES = 25
_CONCURRENCY = 3


def parse_place(name: str, payload: dict) -> dict | None:
    """The first search hit that has coordinates -> {name, lat, lon, article, description}."""
    pages = sorted((payload.get("query") or {}).get("pages") or [], key=lambda p: p.get("index", 0))
    return next((place for page in pages if (place := _found(name, page))), None)


def _found(name: str, page: dict) -> dict | None:
    coords = page.get("coordinates") or []
    if coords and coords[0].get("globe", "earth") == "earth":
        return {
            "name": name,
            "lat": round(float(coords[0]["lat"]), 4),
            "lon": round(float(coords[0]["lon"]), 4),
            "article": page.get("title", ""),
            "description": page.get("description", ""),
        }
    return None


def parse_titles(names: list[str], payload: dict) -> dict[str, dict]:
    """A batched exact-title lookup -> {name: place} for the names whose article has coordinates."""
    query = payload.get("query") or {}
    # Follow the title normalisation and redirects ("Constantinople" -> its article).
    target = {n: n for n in names}
    for step in ("normalized", "redirects"):
        moves = {m["from"]: m["to"] for m in query.get(step) or []}
        target = {n: moves.get(t, t) for n, t in target.items()}
    pages = {p.get("title"): p for p in query.get("pages") or []}
    out = {}
    for name, title in target.items():
        place = _found(name, pages.get(title) or {})
        if place:
            out[name] = place
    return out


async def _by_titles(client: httpx.AsyncClient, names: list[str]) -> dict[str, dict]:
    params = {
        "action": "query", "format": "json", "formatversion": "2", "redirects": "1",
        "titles": "|".join(names), "prop": "coordinates|description",
    }
    try:
        return parse_titles(names, (await get_with_retry(client, WIKIPEDIA_API, params)).json())
    except (httpx.HTTPError, ValueError) as exc:
        logger.warning("find_places title lookup failed: %s", type(exc).__name__)
        return {}


async def _by_search(client: httpx.AsyncClient, gate: asyncio.Semaphore, name: str) -> dict | None:
    params = {
        "action": "query", "format": "json", "formatversion": "2",
        "generator": "search", "gsrsearch": name, "gsrlimit": "3",
        "prop": "coordinates|description",
    }
    async with gate:
        try:
            return parse_place(name, (await get_with_retry(client, WIKIPEDIA_API, params)).json())
        except (httpx.HTTPError, ValueError) as exc:
            logger.warning("find_places search failed: %s", type(exc).__name__)
            return None


@tool("find_places")
async def find_places(names: list[str]) -> str:
    """Look up real coordinates for places, for a ```visual {"format":"map"} block.

    `names`: up to 25 place names, each specific enough to identify it
    (e.g. ["Samarkand", "Merv", "Constantinople", "Mount Everest"]; add the
    country when a name is ambiguous). Historical names work. Returns each
    place's lat, lon, matched article and a short description -- use these
    numbers in the map instead of guessing coordinates.
    """
    if isinstance(names, str):
        names = [names]
    cleaned = list(dict.fromkeys(" ".join(str(n or "").split())[:120] for n in names or []))
    cleaned = [n for n in cleaned if n][:MAX_PLACES]
    if not cleaned:
        return "Give one or more place names."
    # One request for every exact title (most names), then a search for each miss --
    # few requests, so Wikipedia doesn't throttle a burst.
    gate = asyncio.Semaphore(_CONCURRENCY)
    async with httpx.AsyncClient(timeout=TIMEOUT_SECONDS, headers={"User-Agent": USER_AGENT}) as client:
        exact = await _by_titles(client, cleaned)
        misses = [n for n in cleaned if n not in exact]
        searched = dict(zip(misses, await asyncio.gather(*(_by_search(client, gate, n) for n in misses))))
    found = [exact.get(n) or searched.get(n) for n in cleaned]
    if all(f is None for f in found):
        return "No coordinates found (or the lookup is unavailable). Leave unknown places off the map."
    return json.dumps(
        [f if f else {"name": n, "error": "not found -- try a more specific name or leave it off the map"} for n, f in zip(cleaned, found)],
        ensure_ascii=False,
    )


# Only prepares what the answer shows: the chat lists no step for it (tool_display.py).
background_step(find_places, "Finding places…")
