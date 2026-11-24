"""Shared by the Wikimedia sources (Commons, Wikipedia, Wikidata): file
details -- address, size, author, licence -- from a MediaWiki API, in the
`image` visual's shape. Their images load straight from Wikimedia's image
hosts (only upload./thumb.wikimedia.org are accepted, here and in the chat)."""
from __future__ import annotations

import html
import re
from urllib.parse import urlsplit, urlunsplit

import httpx

from abyss_agents.http_retry import get_with_retry

COMMONS_API = "https://commons.wikimedia.org/w/api.php"
WIKIPEDIA_API = "https://en.wikipedia.org/w/api.php"
THUMB_WIDTH = 800
_ALLOWED_HOSTS = {"upload.wikimedia.org", "thumb.wikimedia.org"}
_TAGS = re.compile(r"<[^>]+>")
_FIELDS = "Artist|LicenseShortName|ImageDescription|ObjectName|NonFree"


def plain(value: object, limit: int) -> str:
    """Wikimedia metadata is HTML: tags stripped, entities decoded, whitespace folded."""
    text = html.unescape(_TAGS.sub(" ", str(value or "")))
    text = re.sub(r"\s+([.,;:)])", r"\1", " ".join(text.split()))
    return text if len(text) <= limit else text[: limit - 1].rstrip() + "…"


def clean_url(url: str) -> str | None:
    """https on a Wikimedia image host, without tracking parameters; None otherwise."""
    parts = urlsplit(url or "")
    if parts.scheme != "https" or parts.hostname not in _ALLOWED_HOSTS:
        return None
    return urlunsplit((parts.scheme, parts.netloc, parts.path, "", ""))


def parse_files(payload: dict, via: str | None = None) -> list[dict]:
    """A MediaWiki API's file pages (prop=imageinfo) -> image candidates, best first.

    A non-free file (a film poster, a book or game cover kept on Wikipedia
    under fair use) is credited to its owner, via `via` (the site), not given
    a free licence it doesn't have."""
    pages = sorted((payload.get("query") or {}).get("pages") or [], key=lambda p: p.get("index", 0))
    results: list[dict] = []
    for page in pages:
        info = (page.get("imageinfo") or [{}])[0]
        if not str(info.get("mime", "")).startswith("image/"):
            continue
        src = clean_url(info.get("thumburl") or info.get("url") or "")
        if not src:
            continue
        meta = info.get("extmetadata") or {}
        field = lambda name: (meta.get(name) or {}).get("value")  # noqa: E731
        non_free = str(field("NonFree") or "").lower() == "true" or "fair use" in str(field("LicenseShortName") or "").lower()
        title = str(page.get("title", "")).removeprefix("File:")
        result = {
            "src": src,
            "page": info.get("descriptionurl") or "",
            "title": re.sub(r"\.[A-Za-z0-9]+$", "", title),
            "description": plain(field("ImageDescription") or field("ObjectName"), 240),
            "author": plain(field("Artist"), 80) or ("" if non_free else "Unknown author"),
            "license": "© its owner" if non_free else (plain(field("LicenseShortName"), 40) or "See file page"),
            "width": info.get("thumbwidth") or info.get("width"),
            "height": info.get("thumbheight") or info.get("height"),
            "key": urlsplit(src).path.rsplit("/", 1)[-1].lower(),
        }
        if non_free and via:
            result["source"] = via
        results.append(result)
    return results


async def file_details(client: httpx.AsyncClient, api: str, files: list[str], via: str | None = None) -> list[dict]:
    """Address, size, author and licence of the named files ("Some photo.jpg"), in that order."""
    if not files:
        return []
    params = {
        "action": "query", "format": "json", "formatversion": "2",
        "titles": "|".join(f"File:{f}" for f in files),
        "prop": "imageinfo", "iiprop": "url|extmetadata|size|mime",
        "iiurlwidth": str(THUMB_WIDTH), "iiextmetadatafilter": _FIELDS,
    }
    found = parse_files((await get_with_retry(client, api, params)).json(), via)
    order = {re.sub(r"\.[A-Za-z0-9]+$", "", f.replace("_", " ")).lower(): i for i, f in enumerate(files)}
    return sorted(found, key=lambda r: order.get(r["title"].lower(), len(order)))
