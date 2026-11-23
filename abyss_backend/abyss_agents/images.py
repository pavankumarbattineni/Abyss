"""The `search_images` tool: real images from Wikimedia Commons for the `image` visual.

The model never invents image URLs: it searches Commons here and puts a result
in an ```visual {"format":"image"} block, which the frontend loads straight
from Wikimedia's servers (only upload./thumb.wikimedia.org are accepted --
abyss_frontend/src/lib/visuals/schemas.ts). Every result carries the author
and licence its open licence asks to be credited.

Only the search words leave the server: no user or conversation data.
"""
from __future__ import annotations

import asyncio
import html
import json
import logging
import re
import time
from urllib.parse import urlsplit, urlunsplit

import httpx
from langchain_core.tools import tool

from abyss_agents import web_images

logger = logging.getLogger(__name__)

COMMONS_API = "https://commons.wikimedia.org/w/api.php"
# Wikimedia's User-Agent policy asks API clients for "name/version (contact)
# library": requests without contact information get throttled or refused,
# above all from shared cloud servers. The contact is the app's public
# repository -- no user, account or deployment details.
USER_AGENT = "AbyssImageSearch/1.1 (https://github.com/pavankumarbattineni/Abyss) python-httpx"
TIMEOUT_SECONDS = 10.0
THUMB_WIDTH = 800
MAX_RESULTS = 8
# Searches running at once: a burst of many is what Wikimedia throttles.
_CONCURRENCY = 3
# Successful searches are reused for a while (the same subjects come up again).
_CACHE_SECONDS = 6 * 3600
_CACHE_MAX = 500
_cache: dict[tuple[str, int], tuple[float, list[dict]]] = {}
_ALLOWED_HOSTS = {"upload.wikimedia.org", "thumb.wikimedia.org"}
_TAGS = re.compile(r"<[^>]+>")


_RETRY_STATUSES = {429, 500, 502, 503, 504}


async def get_with_retry(client: httpx.AsyncClient, url: str, params: dict, tries: int = 3) -> httpx.Response:
    """GET that waits and tries again when Wikimedia throttles a burst (429)
    or has a passing server error; raises after the last try."""
    for attempt in range(tries):
        try:
            response = await client.get(url, params=params)
            if response.status_code not in _RETRY_STATUSES or attempt == tries - 1:
                response.raise_for_status()
                return response
            wait = response.headers.get("retry-after", "")
            delay = min(float(wait), 3.0) if wait.replace(".", "", 1).isdigit() else 0.6 * 2**attempt
        except httpx.TransportError:
            if attempt == tries - 1:
                raise
            delay = 0.6 * 2**attempt
        await asyncio.sleep(delay)
    raise httpx.HTTPError("unreachable")


def _plain(value: object, limit: int) -> str:
    """Wikimedia metadata is HTML: tags stripped, entities decoded, whitespace folded."""
    text = html.unescape(_TAGS.sub(" ", str(value or "")))
    text = re.sub(r"\s+([.,;:)])", r"\1", " ".join(text.split()))
    return text if len(text) <= limit else text[: limit - 1].rstrip() + "…"


def _clean_url(url: str) -> str | None:
    """https on a Wikimedia image host, without tracking parameters; None otherwise."""
    parts = urlsplit(url or "")
    if parts.scheme != "https" or parts.hostname not in _ALLOWED_HOSTS:
        return None
    return urlunsplit((parts.scheme, parts.netloc, parts.path, "", ""))


# Words that describe a picture rather than its subject: they don't make a result relevant.
_GENERIC = {
    "the", "and", "for", "with", "from", "image", "images", "photo", "photos", "picture", "pictures",
    "portrait", "diagram", "illustration", "drawing", "map", "view", "movie", "film", "films", "series",
    "show", "tv", "set", "scene", "scenes", "location", "locations", "filming", "actor", "actress",
    "cast", "character", "characters", "official", "poster", "still", "real", "famous",
}


def _words(text: str) -> set[str]:
    return {w for w in re.findall(r"[a-z0-9]+", text.lower().replace("_", " ")) if len(w) >= 3 or w.isdigit()}


def relevant(query: str, results: list[dict], limit: int) -> list[dict]:
    """Only results whose title or description names the query's subject (one of
    its distinctive words), most matching words first -- so an image is never
    unrelated to what was searched. Order is kept among equals (Commons' own
    ranking)."""
    subject = _words(query) - _GENERIC
    if not subject:
        return results[:limit]
    stem = lambda w: w[:6] if len(w) >= 6 else w  # noqa: E731 -- "mitochondrion" ~ "mitochondria"
    wanted = {stem(w) for w in subject}
    scored = []
    for i, r in enumerate(results):
        hits = len(wanted & {stem(w) for w in _words(f"{r.get('title', '')} {r.get('description', '')}")})
        if hits:
            scored.append((-hits, i, r))
    return [r for _, _, r in sorted(scored)][:limit]


def parse_results(payload: dict) -> list[dict]:
    """The API's pages -> what the `image` visual needs, best match first."""
    pages = (payload.get("query") or {}).get("pages") or []
    pages = sorted(pages, key=lambda p: p.get("index", 0))
    results: list[dict] = []
    for page in pages:
        info = (page.get("imageinfo") or [{}])[0]
        if not str(info.get("mime", "")).startswith("image/"):
            continue
        src = _clean_url(info.get("thumburl") or info.get("url") or "")
        if not src:
            continue
        meta = info.get("extmetadata") or {}
        field = lambda name: (meta.get(name) or {}).get("value")  # noqa: E731
        title = str(page.get("title", "")).removeprefix("File:")
        results.append({
            "src": src,
            "page": info.get("descriptionurl") or "",
            "title": re.sub(r"\.[A-Za-z0-9]+$", "", title),
            "description": _plain(field("ImageDescription") or field("ObjectName"), 240),
            "author": _plain(field("Artist"), 80) or "Unknown author",
            "license": _plain(field("LicenseShortName"), 40) or "See file page",
            "width": info.get("thumbwidth") or info.get("width"),
            "height": info.get("thumbheight") or info.get("height"),
        })
    return results


async def _search(client: httpx.AsyncClient, query: str, limit: int) -> list[dict]:
    # More candidates than needed: unrelated ones are dropped (relevant()).
    params = {
        "action": "query",
        "format": "json",
        "formatversion": "2",
        "generator": "search",
        # Photos, drawings and diagrams only (no PDFs, audio or video).
        "gsrsearch": f"{query} filetype:bitmap|drawing",
        "gsrnamespace": "6",
        "gsrlimit": str(min(2 * limit, 20)),
        "prop": "imageinfo",
        "iiprop": "url|extmetadata|size|mime",
        "iiurlwidth": str(THUMB_WIDTH),
        "iiextmetadatafilter": "Artist|LicenseShortName|ImageDescription|ObjectName",
    }
    response = await get_with_retry(client, COMMONS_API, params)
    return relevant(query, parse_results(response.json()), limit)


MAX_QUERIES = 5
def interleave(first: list[dict], second: list[dict], limit: int) -> list[dict]:
    """first[0], second[0], first[1], second[1], ... -- up to `limit`, the rest of the longer list after."""
    out: list[dict] = []
    for i in range(max(len(first), len(second))):
        out.extend(x[i] for x in (first, second) if i < len(x))
    return out[:limit]


async def _web_safely(client: httpx.AsyncClient, gate: asyncio.Semaphore, query: str, limit: int) -> list[dict] | None:
    key = ("web:" + query.lower(), limit)
    hit = _cache.get(key)
    if hit and hit[0] > time.monotonic():
        return hit[1]
    async with gate:
        try:
            results = relevant(query, await web_images.web_search(client, query, 2 * limit), limit)
        except (httpx.HTTPError, ValueError) as exc:
            logger.warning("web image search failed (%s)", _describe(exc))
            return None
    _cache[key] = (time.monotonic() + _CACHE_SECONDS, results)
    return results


def _describe(exc: Exception) -> str:
    """What went wrong, for the log: the HTTP status (429 throttled, 403 refused...) or the error type."""
    if isinstance(exc, httpx.HTTPStatusError):
        return f"HTTP {exc.response.status_code}"
    return type(exc).__name__


async def _search_safely(client: httpx.AsyncClient, gate: asyncio.Semaphore, query: str, limit: int) -> list[dict] | None:
    key = (query.lower(), limit)
    hit = _cache.get(key)
    if hit and hit[0] > time.monotonic():
        return hit[1]
    async with gate:
        try:
            results = await _search(client, query, limit)
        except (httpx.HTTPError, ValueError) as exc:
            logger.warning("search_images failed (%s) for a %d-word query", _describe(exc), len(query.split()))
            return None
    if len(_cache) >= _CACHE_MAX:
        _cache.clear()
    _cache[key] = (time.monotonic() + _CACHE_SECONDS, results)
    return results


@tool("search_images")
async def search_images(queries: list[str], limit: int = 3) -> str:
    """Find real images (photos, diagrams, illustrations) on Wikimedia Commons.

    Use it when seeing the real thing helps: a place, landmark, person,
    organism, artwork, object, historical photo, or a labelled diagram.
    `queries`: one to five searches at once, each a few English keywords
    naming one subject (e.g. ["mitochondrion diagram", "Taj Mahal"]) -- one
    per subject. Commons has openly licensed photos, not film or TV stills or
    posters: for a film, series, book or game search what has real photos --
    its lead actors, filming locations and sets, premieres or conventions, its
    author (e.g. ["Daniel Radcliffe", "Alnwick Castle", "Hobbiton movie set"]).
    Returns up to `limit` (1-8) images per query, best match first, each with
    src, page, author and license (and `source`, the site, for web images):
    show them with ```visual {"format":"image"} blocks, copying those fields
    exactly.
    """
    if isinstance(queries, str):
        queries = [queries]
    cleaned = list(dict.fromkeys(" ".join(str(q or "").split())[:200] for q in queries or []))
    cleaned = [q for q in cleaned if q][:MAX_QUERIES]
    if not cleaned:
        return "Give one or more searches, each a few keywords describing an image."
    limit = max(1, min(MAX_RESULTS, int(limit or 3)))
    gate = asyncio.Semaphore(_CONCURRENCY)
    async with httpx.AsyncClient(timeout=TIMEOUT_SECONDS, headers={"User-Agent": USER_AGENT}) as client:
        found = await asyncio.gather(*(_search_safely(client, gate, q, limit) for q in cleaned))
        # With the web image search configured, every subject gets both sources,
        # alternating: Wikimedia's openly licensed photos (a film's actors,
        # sets, making-of) and the web's (its posters, stills, characters) --
        # Wikimedia alone often has only things around a subject, not it.
        if web_images.brave_api_key():
            extra = await asyncio.gather(*(_web_safely(client, gate, q, limit) for q in cleaned))
            for i, more in enumerate(extra):
                if more:
                    found[i] = interleave(found[i] or [], more, limit)
    if all(r is None for r in found):
        return "Image search is unavailable right now. Answer without images."
    if len(cleaned) == 1:
        if not found[0]:
            return f'No images found on Wikimedia Commons for "{cleaned[0]}". Try other keywords, or answer without an image.'
        return json.dumps(found[0], ensure_ascii=False)
    out = {q: (r or "no images found -- try other keywords or skip this image") for q, r in zip(cleaned, found)}
    return json.dumps(out, ensure_ascii=False)
