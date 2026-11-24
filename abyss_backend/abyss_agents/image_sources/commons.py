"""Wikimedia Commons: openly licensed photos, drawings and diagrams, by keyword."""
from __future__ import annotations

import httpx

from abyss_agents.http_retry import get_with_retry
from abyss_agents.image_sources.base import ImageSource
from abyss_agents.image_sources.mediawiki import _FIELDS, COMMONS_API, THUMB_WIDTH, parse_files


async def search(client: httpx.AsyncClient, query: str, limit: int) -> list[dict]:
    params = {
        "action": "query", "format": "json", "formatversion": "2",
        "generator": "search",
        # Photos, drawings and diagrams only (no PDFs, audio or video).
        "gsrsearch": f"{query} filetype:bitmap|drawing", "gsrnamespace": "6",
        "gsrlimit": str(min(2 * limit, 20)),
        "prop": "imageinfo", "iiprop": "url|extmetadata|size|mime",
        "iiurlwidth": str(THUMB_WIDTH), "iiextmetadatafilter": _FIELDS,
    }
    return parse_files((await get_with_retry(client, COMMONS_API, params)).json())


SOURCE = ImageSource(
    "commons",
    "openly licensed photos, diagrams and drawings by keyword: science, anatomy, nature, landmarks, history",
    search,
)
