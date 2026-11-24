"""Wikipedia: the main image of the articles about a subject -- a film's or
series' poster, a book's or game's cover, an album's art, a person's or
place's photo. Exactly the subject, from Wikimedia's own image hosts (which
never block loading). Posters and covers are copyrighted (kept on Wikipedia
under fair use) and are credited to their owner, via Wikipedia."""
from __future__ import annotations

import httpx

from abyss_agents.http_retry import get_with_retry
from abyss_agents.image_sources.base import ImageSource
from abyss_agents.image_sources.mediawiki import WIKIPEDIA_API, file_details

SITE = "en.wikipedia.org"


async def search(client: httpx.AsyncClient, query: str, limit: int) -> list[dict]:
    params = {
        "action": "query", "format": "json", "formatversion": "2",
        "generator": "search", "gsrsearch": query, "gsrlimit": str(min(2 * limit, 10)),
        # pilicense=any: also the non-free main images (posters, covers), which
        # are what a film, book or game article shows.
        "prop": "pageimages", "piprop": "name", "pilicense": "any",
    }
    pages = sorted(
        ((await get_with_retry(client, WIKIPEDIA_API, params)).json().get("query") or {}).get("pages") or [],
        key=lambda p: p.get("index", 0),
    )
    files = list(dict.fromkeys(p["pageimage"] for p in pages if p.get("pageimage")))
    found = await file_details(client, WIKIPEDIA_API, files, via=SITE)
    # The article's title names the subject better than the file's own name.
    article = {p["pageimage"].replace("_", " ").rsplit(".", 1)[0].lower(): p.get("title", "") for p in pages if p.get("pageimage")}
    for r in found:
        subject = article.get(r["title"].lower(), "")
        r["description"] = " ".join(filter(None, [subject, r["description"]]))
        # The subject's real name ("Grand Theft Auto V" for "GTA V"): the coordinator
        # accepts it from every source, so abbreviations and nicknames still match.
        r["subject"] = subject
    return found


SOURCE = ImageSource(
    "wikipedia",
    "the main image of a subject's Wikipedia article: posters of films and series, covers of books, "
    "games and albums, photos of well-known people and places",
    search,
)
