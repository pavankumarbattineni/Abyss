"""Wikidata: the one official image (property P18) of a specific person,
building, place, species, artwork or object -- the exact subject, not a
keyword match. The file itself is on Commons (openly licensed)."""
from __future__ import annotations

import httpx

from abyss_agents.http_retry import get_with_retry
from abyss_agents.image_sources.base import ImageSource
from abyss_agents.image_sources.mediawiki import COMMONS_API, file_details

WIKIDATA_API = "https://www.wikidata.org/w/api.php"


def images_of(entities: dict, order: list[str]) -> list[tuple[str, str]]:
    """(file name, "label -- description") of each entity's P18 image, in search order."""
    out = []
    for qid in order:
        entity = entities.get(qid) or {}
        for claim in (entity.get("claims") or {}).get("P18") or []:
            value = ((claim.get("mainsnak") or {}).get("datavalue") or {}).get("value")
            if isinstance(value, str) and value:
                label = ((entity.get("labels") or {}).get("en") or {}).get("value", "")
                about = ((entity.get("descriptions") or {}).get("en") or {}).get("value", "")
                out.append((value, " -- ".join(filter(None, [label, about]))))
                break
    return out


async def search(client: httpx.AsyncClient, query: str, limit: int) -> list[dict]:
    found = (await get_with_retry(client, WIKIDATA_API, {
        "action": "wbsearchentities", "format": "json", "search": query, "language": "en",
        "uselang": "en", "type": "item", "limit": str(min(2 * limit, 10)),
    })).json().get("search") or []
    ids = [e["id"] for e in found if e.get("id")]
    if not ids:
        return []
    entities = (await get_with_retry(client, WIKIDATA_API, {
        "action": "wbgetentities", "format": "json", "ids": "|".join(ids),
        "props": "claims|labels|descriptions", "languages": "en",
    })).json().get("entities") or {}
    images = images_of(entities, ids)
    results = await file_details(client, COMMONS_API, [f for f, _ in images])
    about = {f.replace("_", " ").rsplit(".", 1)[0].lower(): text for f, text in images}
    for r in results:
        about_it = about.get(r["title"].lower(), "")
        r["description"] = " ".join(filter(None, [about_it, r["description"]]))
        r["subject"] = about_it.split(" -- ", 1)[0]  # the entity's name (see wikipedia.py)
    return results


SOURCE = ImageSource(
    "wikidata",
    "the official photo of one specific person, building, place, species or artwork",
    search,
)
