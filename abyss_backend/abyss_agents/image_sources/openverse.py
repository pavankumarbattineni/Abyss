"""Openverse (by WordPress): openly licensed photos from Flickr, museums and
other collections, with each image's author and licence. Anonymous access
(rate-limited, no key). The images live on their own hosts (Flickr...), so
they load through the signed image proxy, with Openverse's thumbnail as the
fallback copy."""
from __future__ import annotations

from urllib.parse import urlsplit

import httpx

from abyss_agents.http_retry import get_with_retry
from abyss_agents.image_sources.base import ImageSource
from abyss_agents.web_images import sign_image_url

OPENVERSE_API = "https://api.openverse.org/v1/images/"


def _license(r: dict) -> str:
    kind = str(r.get("license") or "").strip()
    if not kind:
        return "See source page"
    if kind in ("cc0", "pdm"):
        return "CC0" if kind == "cc0" else "Public domain"
    return f"CC {kind.upper()} {r.get('license_version') or ''}".strip()


def parse(payload: dict) -> list[dict]:
    out = []
    for r in payload.get("results") or []:
        url = r.get("url") or ""
        if urlsplit(url).scheme not in ("http", "https"):
            continue
        out.append({
            "src": sign_image_url(url, r.get("thumbnail") or None),
            "page": r.get("foreign_landing_url") or "",
            "title": str(r.get("title") or "")[:160],
            "description": " ".join(str(t.get("name", "")) for t in (r.get("tags") or [])[:8] if isinstance(t, dict)),
            "author": str(r.get("creator") or "")[:80],
            "license": _license(r),
            "source": str(r.get("source") or r.get("provider") or "openverse.org"),
            "width": r.get("width"),
            "height": r.get("height"),
            "key": url,
        })
    return out


async def search(client: httpx.AsyncClient, query: str, limit: int) -> list[dict]:
    params = {"q": query, "page_size": str(min(2 * limit, 20)), "mature": "false"}
    return parse((await get_with_retry(client, OPENVERSE_API, params)).json())


SOURCE = ImageSource(
    "openverse",
    "openly licensed photos from Flickr, museums and collections: animals, plants, places, objects, events",
    search,
    concurrency=2,
)
