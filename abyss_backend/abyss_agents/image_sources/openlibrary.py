"""Open Library (Internet Archive): book covers, by title or author. No key.
Covers are copyrighted: credited to their owner, via Open Library. They load
through the signed image proxy (the medium-size cover is the fallback copy)."""
from __future__ import annotations

import httpx

from abyss_agents.http_retry import get_with_retry
from abyss_agents.image_sources.base import ImageSource
from abyss_agents.web_images import sign_image_url

SEARCH_API = "https://openlibrary.org/search.json"
COVERS = "https://covers.openlibrary.org/b/id/{id}-{size}.jpg"


def parse(payload: dict) -> list[dict]:
    out = []
    for doc in payload.get("docs") or []:
        cover = doc.get("cover_i")
        if not isinstance(cover, int):
            continue
        authors = ", ".join((doc.get("author_name") or [])[:2])
        out.append({
            "src": sign_image_url(COVERS.format(id=cover, size="L"), COVERS.format(id=cover, size="M")),
            "page": f"https://openlibrary.org{doc.get('key') or ''}",
            "title": f"{doc.get('title') or ''} (book cover)".strip(),
            "description": f"{doc.get('title') or ''} by {authors}" if authors else str(doc.get("title") or ""),
            "author": "",
            "license": "© its owner",
            "source": "openlibrary.org",
            "width": None,
            "height": None,
            "key": f"openlibrary-cover-{cover}",
        })
    return out


async def search(client: httpx.AsyncClient, query: str, limit: int) -> list[dict]:
    params = {"q": query, "limit": str(min(2 * limit, 10)), "fields": "title,author_name,cover_i,key"}
    return parse((await get_with_retry(client, SEARCH_API, params)).json())


SOURCE = ImageSource(
    "openlibrary",
    "book covers, by a book's title (and author)",
    search,
    concurrency=2,
)
