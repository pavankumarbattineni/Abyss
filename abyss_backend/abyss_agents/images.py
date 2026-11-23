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
from urllib.parse import urlsplit, urlunsplit

import httpx
from langchain_core.tools import tool

logger = logging.getLogger(__name__)

COMMONS_API = "https://commons.wikimedia.org/w/api.php"
# Wikimedia asks API clients for a descriptive User-Agent; this one names the
# client only (no user, account or deployment details).
USER_AGENT = "EducationalChatImageSearch/1.0 (python-httpx; image lookups for chat answers)"
TIMEOUT_SECONDS = 10.0
THUMB_WIDTH = 800
MAX_RESULTS = 6
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


async def _search(query: str, limit: int) -> list[dict]:
    params = {
        "action": "query",
        "format": "json",
        "formatversion": "2",
        "generator": "search",
        # Photos, drawings and diagrams only (no PDFs, audio or video).
        "gsrsearch": f"{query} filetype:bitmap|drawing",
        "gsrnamespace": "6",
        "gsrlimit": str(limit),
        "prop": "imageinfo",
        "iiprop": "url|extmetadata|size|mime",
        "iiurlwidth": str(THUMB_WIDTH),
        "iiextmetadatafilter": "Artist|LicenseShortName|ImageDescription|ObjectName",
    }
    async with httpx.AsyncClient(timeout=TIMEOUT_SECONDS, headers={"User-Agent": USER_AGENT}) as client:
        response = await client.get(COMMONS_API, params=params)
        response.raise_for_status()
        return parse_results(response.json())


MAX_QUERIES = 5


async def _search_safely(query: str, limit: int) -> list[dict] | None:
    try:
        return await _search(query, limit)
    except (httpx.HTTPError, ValueError) as exc:
        logger.warning("search_images failed: %s", type(exc).__name__)
        return None


@tool("search_images")
async def search_images(queries: list[str], limit: int = 3) -> str:
    """Find real images (photos, diagrams, illustrations) on Wikimedia Commons.

    Use it when seeing the real thing helps: an organism, a place, a landmark,
    an artwork, an instrument, a historical photo, a labelled anatomical or
    scientific diagram. `queries`: one to five searches at once, each a few
    English keywords naming one subject (e.g. ["mitochondrion diagram",
    "Taj Mahal"]) -- one per section that needs an image. Returns up to `limit`
    (1-6) images per query, best match first, each with src, page, author and
    license: show them with ```visual {"format":"image"} blocks, copying those
    fields exactly.
    """
    if isinstance(queries, str):
        queries = [queries]
    cleaned = list(dict.fromkeys(" ".join(str(q or "").split())[:200] for q in queries or []))
    cleaned = [q for q in cleaned if q][:MAX_QUERIES]
    if not cleaned:
        return "Give one or more searches, each a few keywords describing an image."
    limit = max(1, min(MAX_RESULTS, int(limit or 3)))
    found = await asyncio.gather(*(_search_safely(q, limit) for q in cleaned))
    if all(r is None for r in found):
        return "Image search is unavailable right now. Answer without images."
    if len(cleaned) == 1:
        if not found[0]:
            return f'No images found on Wikimedia Commons for "{cleaned[0]}". Try other keywords, or answer without an image.'
        return json.dumps(found[0], ensure_ascii=False)
    out = {q: (r or "no images found -- try other keywords or skip this image") for q, r in zip(cleaned, found)}
    return json.dumps(out, ensure_ascii=False)
