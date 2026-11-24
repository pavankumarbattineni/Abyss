"""The `search_images` tool: real images for the `image` visual.

Two sources:
  - Wikimedia Commons ("open"): openly licensed photos, drawings and diagrams,
    each with the author and licence it asks to be credited -- best for
    science, nature, landmarks, history and real people. The frontend loads
    them straight from upload./thumb.wikimedia.org.
  - The web ("web": Brave Search, abyss_agents/web_images.py), when
    configured: posters, stills, characters, products, brands -- what Commons
    doesn't have. Credited to their site, loaded through the signed image proxy.

The agent's model, which already knows what the question is about, says which
source suits each call (`prefer`); no separate classifier. The preferred
source fills the gallery first and the other only tops it up, so a wrong
preference costs a little quality, never all the images. Without a preference
both alternate. Whichever is used, only images whose title, description or
page names the subject are kept (relevant()), and an image both sources found
appears once.

The model never invents image URLs: the frontend accepts only Wikimedia
addresses and tokens this server signed (abyss_frontend/src/lib/visuals/schemas.ts,
abyss_agents/visual_check.py). Only the search words leave the server: no user
or conversation data.
"""
from __future__ import annotations

import asyncio
import html
import json
import logging
import re
import time
from collections.abc import Awaitable, Callable
from urllib.parse import urlsplit, urlunsplit

import httpx
from langchain_core.tools import tool

from abyss_agents import web_images
from abyss_agents.http_retry import describe, get_with_retry
from abyss_agents.tool_display import background_step

logger = logging.getLogger(__name__)

COMMONS_API = "https://commons.wikimedia.org/w/api.php"
# Wikimedia's User-Agent policy asks API clients for "name/version (contact)
# library": requests without contact information get throttled or refused,
# above all from shared cloud servers. The contact is the app's public
# repository -- no user, account or deployment details.
USER_AGENT = "AbyssImageSearch/1.1 (https://github.com/pavankumarbattineni/Abyss) python-httpx"
TIMEOUT_SECONDS = 10.0
THUMB_WIDTH = 800
MAX_QUERIES = 5
MAX_RESULTS = 8
# Searches running at once per source: a burst of many is what gets throttled.
_CONCURRENCY = 3
# Successful searches are reused for a while (the same subjects come up again).
_CACHE_SECONDS = 6 * 3600
_CACHE_MAX = 500
_cache: dict[tuple[str, int], tuple[float, list[dict]]] = {}
_ALLOWED_HOSTS = {"upload.wikimedia.org", "thumb.wikimedia.org"}
_TAGS = re.compile(r"<[^>]+>")


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


def _about(result: dict) -> str:
    """What a result says it shows: its title, description and page address
    (a web page's path often names the film or product: /interstellar-review)."""
    page = urlsplit(result.get("page") or "").path.replace("-", " ").replace("/", " ")
    return f"{result.get('title', '')} {result.get('description', '')} {page}"


def relevant(query: str, results: list[dict], limit: int) -> list[dict]:
    """Only results whose title, description or page names the query's subject
    (one of its distinctive words), most matching words first -- so an image is
    never unrelated to what was searched. Order is kept among equals (the
    source's own ranking)."""
    subject = _words(query) - _GENERIC
    if not subject:
        return results[:limit]
    stem = lambda w: w[:6] if len(w) >= 6 else w  # noqa: E731 -- "mitochondrion" ~ "mitochondria"
    wanted = {stem(w) for w in subject}
    scored = []
    for i, r in enumerate(results):
        hits = len(wanted & {stem(w) for w in _words(_about(r))})
        if hits:
            scored.append((-hits, i, r))
    return [r for _, _, r in sorted(scored)][:limit]


def interleave(first: list[dict], second: list[dict], limit: int) -> list[dict]:
    """first[0], second[0], first[1], second[1], ... -- up to `limit`, the rest of the longer list after."""
    out: list[dict] = []
    for i in range(max(len(first), len(second))):
        out.extend(x[i] for x in (first, second) if i < len(x))
    return out[:limit]


def parse_results(payload: dict) -> list[dict]:
    """The Commons API's pages -> what the `image` visual needs, best match first."""
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


async def _commons(client: httpx.AsyncClient, query: str, limit: int) -> list[dict]:
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


async def _web(client: httpx.AsyncClient, query: str, limit: int) -> list[dict]:
    return relevant(query, await web_images.web_search(client, query, 2 * limit), limit)


def _remember(key: tuple[str, int], results: list[dict]) -> None:
    """Cache a search, keeping at most _CACHE_MAX: expired entries go first, then the oldest."""
    if len(_cache) >= _CACHE_MAX:
        now = time.monotonic()
        for stale in [k for k, (expires, _) in _cache.items() if expires <= now]:
            del _cache[stale]
        while len(_cache) >= _CACHE_MAX:
            del _cache[next(iter(_cache))]
    _cache[key] = (time.monotonic() + _CACHE_SECONDS, results)


Search = Callable[[httpx.AsyncClient, str, int], Awaitable[list[dict]]]


async def _cached(source: str, search: Search, client: httpx.AsyncClient, gate: asyncio.Semaphore,
                  query: str, limit: int) -> list[dict] | None:
    """One source's results for one query: from the cache, or searched under the
    source's concurrency gate. None when the source failed (logged, never raised)."""
    key = (f"{source}:{query.lower()}", limit)
    hit = _cache.get(key)
    if hit and hit[0] > time.monotonic():
        return hit[1]
    async with gate:
        try:
            results = await search(client, query, limit)
        except (httpx.HTTPError, ValueError) as exc:
            logger.warning("%s image search failed (%s) for a %d-word query", source, describe(exc), len(query.split()))
            return None
    _remember(key, results)
    return results


async def _all(source: str, search: Search, client: httpx.AsyncClient, queries: list[str], limit: int) -> list:
    gate = asyncio.Semaphore(_CONCURRENCY)  # each source has its own: one never waits for the other
    return await asyncio.gather(*(_cached(source, search, client, gate, q, limit) for q in queries))




PREFER_WEB = "web"  # posters, stills, characters, products, brands, games
PREFER_OPEN = "open"  # openly licensed: science, nature, landmarks, history, real people
# Below this many images for a query, the preferred source gets topped up.
_TOP_UP_BELOW = 2


def preference(value: object) -> str | None:
    """The source asked for: PREFER_WEB, PREFER_OPEN, or None (balanced) for anything else."""
    text = str(value or "").strip().lower()
    return text if text in (PREFER_WEB, PREFER_OPEN) else None


def combine(prefer: str | None, commons: list[dict] | None, web: list[dict] | None, limit: int) -> list[dict] | None:
    """One query's gallery from both sources' results: the preferred source
    first and the other filling what's left, or both alternating without a
    preference. None only when every source searched failed."""
    if commons is None and web is None:
        return None
    commons, web = commons or [], web or []
    if prefer == PREFER_WEB:
        return (web + commons)[:limit]
    if prefer == PREFER_OPEN:
        return (commons + web)[:limit]
    return interleave(commons, web, limit)


async def _gather_sources(client: httpx.AsyncClient, queries: list[str], limit: int, prefer: str | None) -> tuple[list, list]:
    """(Commons results, web results) per query.

    - Web off: Commons only.
    - "open": Commons first; the web only for queries Commons came back short
      on -- most "open" searches never use the web quota.
    - "web" or balanced: both at once (Commons costs nothing, and the top-up
      is then ready without a second wait).
    """
    none = [None] * len(queries)
    if not web_images.brave_api_key():
        return await _all("commons", _commons, client, queries, limit), none
    if prefer == PREFER_OPEN:
        commons = await _all("commons", _commons, client, queries, limit)
        short = [q for q, found in zip(queries, commons) if len(found or []) < min(limit, _TOP_UP_BELOW)]
        if not short:
            return commons, none
        extra = dict(zip(short, await _all("web", _web, client, short, limit)))
        return commons, [extra.get(q) for q in queries]
    commons, web = await asyncio.gather(
        _all("commons", _commons, client, queries, limit),
        _all("web", _web, client, queries, limit),
    )
    return commons, web


def clean_queries(queries: object) -> list[str]:
    """Searches as the tool takes them: one string or a list, trimmed, deduplicated, at most MAX_QUERIES."""
    if isinstance(queries, str):
        queries = [queries]
    cleaned = dict.fromkeys(" ".join(str(q or "").split())[:200] for q in queries or [])
    return [q for q in cleaned if q][:MAX_QUERIES]


async def find_images(queries: list[str], limit: int = 3, prefer: object = None) -> list[list[dict] | None]:
    """Per query, its images (best first), [] when none match, None when every
    source failed. What search_images returns, for callers that aren't the
    model -- the visual repair finding real images for ones the model wrote
    itself (visual_repair.py)."""
    limit = max(1, min(MAX_RESULTS, int(limit or 3)))
    prefer = preference(prefer)
    async with httpx.AsyncClient(timeout=TIMEOUT_SECONDS, headers={"User-Agent": USER_AGENT}) as client:
        commons, web = await _gather_sources(client, queries, limit, prefer)
    return [combine(prefer, c, w, limit) for c, w in zip(commons, web)]


@tool("search_images")
async def search_images(queries: list[str], limit: int = 3, prefer: str | None = None) -> str:
    """Find real images: openly licensed photos and diagrams, and -- where web
    image search is on -- posters, stills and product images from the web.

    Use it when seeing the real thing helps: a place, landmark, person,
    organism, artwork, object, historical photo, or a labelled diagram.
    `queries`: one to five searches at once, each a few English keywords
    naming one subject (e.g. ["mitochondrion diagram", "Taj Mahal"]) -- one
    per subject. For a film, series, book or game, search the work itself
    (e.g. ["Interstellar film"]); its people or places are subjects of their own.
    `prefer`: set it whenever the subjects clearly suit one source --
      "web" for films, series, games and their characters or scenes, products,
      brands, album or book covers;
      "open" for science, anatomy, nature, landmarks, history and real people;
      omit only when unsure or mixed. The other source only tops up a short result.
    Subjects needing different sources go in separate calls, made together.
    Returns up to `limit` (1-8) images per query, best match first, each with
    src, page, author and license (and `source`, the site, for web images):
    show them with ```visual {"format":"image"} blocks, copying those fields
    exactly.
    """
    cleaned = clean_queries(queries)
    if not cleaned:
        return "Give one or more searches, each a few keywords describing an image."
    found = await find_images(cleaned, limit, prefer)
    if all(r is None for r in found):
        return "Image search is unavailable right now. Answer without images."
    found = [[for_model(r) for r in results] if results else results for results in found]
    if len(cleaned) == 1:
        if not found[0]:
            return f'No images found for "{cleaned[0]}". Try other keywords, or answer without an image.'
        return json.dumps(found[0], ensure_ascii=False)
    out = {q: (r or "no images found -- try other keywords or skip this image") for q, r in zip(cleaned, found)}
    return json.dumps(out, ensure_ascii=False)


# What the model copies into an image block (and the title, to know what each image shows).
# The description and size only serve relevance and filtering here: a long description
# is what models cut short mid-JSON when copying a result whole.
_FOR_MODEL = ("src", "page", "title", "author", "license", "source")


def for_model(result: dict) -> dict:
    return {k: result[k] for k in _FOR_MODEL if result.get(k) not in (None, "") or k in ("author", "license")}


# Only prepares what the answer shows: the chat lists no step for it (tool_display.py).
background_step(search_images, "Finding images…")
