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

from abyss_agents.images import TIMEOUT_SECONDS, USER_AGENT

logger = logging.getLogger(__name__)

WIKIPEDIA_API = "https://en.wikipedia.org/w/api.php"
MAX_PLACES = 25
_CONCURRENCY = 5


def parse_place(name: str, payload: dict) -> dict | None:
    """The first search hit that has coordinates -> {name, lat, lon, article, description}."""
    pages = sorted((payload.get("query") or {}).get("pages") or [], key=lambda p: p.get("index", 0))
    for page in pages:
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


async def _lookup(client: httpx.AsyncClient, gate: asyncio.Semaphore, name: str) -> dict | None:
    params = {
        "action": "query", "format": "json", "formatversion": "2",
        "generator": "search", "gsrsearch": name, "gsrlimit": "3",
        "prop": "coordinates|description",
    }
    async with gate:
        try:
            response = await client.get(WIKIPEDIA_API, params=params)
            response.raise_for_status()
            return parse_place(name, response.json())
        except (httpx.HTTPError, ValueError) as exc:
            logger.warning("find_places lookup failed: %s", type(exc).__name__)
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
    gate = asyncio.Semaphore(_CONCURRENCY)
    async with httpx.AsyncClient(timeout=TIMEOUT_SECONDS, headers={"User-Agent": USER_AGENT}) as client:
        found = await asyncio.gather(*(_lookup(client, gate, n) for n in cleaned))
    if all(f is None for f in found):
        return "No coordinates found (or the lookup is unavailable). Leave unknown places off the map."
    return json.dumps(
        [f if f else {"name": n, "error": "not found -- try a more specific name or leave it off the map"} for n, f in zip(cleaned, found)],
        ensure_ascii=False,
    )
