"""Web image search (Brave Search API), the second source of search_images.

Wikimedia Commons only has openly licensed photos -- no film or TV stills,
posters, characters, products or brands. With a key configured,
search_images (abyss_agents/images.py) searches here at the same time as
Commons for every subject and alternates the two; results are credited to
the site they come from.

A web image is never loaded by the reader's browser from its own site: its
address is wrapped in a token signed with the server's secret
("abyss-image:<url>.<signature>"), and the chat loads it through our image
proxy (routers/image_proxy.py), which only fetches signed addresses. That
keeps readers' IPs away from third-party sites, survives sites that block
hotlinking, and lets the model show only images the search actually returned.

Off unless ABYSS_CONFIG.IMAGES.brave_api_key is set. Only the search words
leave the server.
"""
from __future__ import annotations

import base64
import hashlib
import hmac
import logging
from urllib.parse import urlsplit

import httpx

from abyss_agents.http_retry import get_with_retry
from config import config

logger = logging.getLogger(__name__)

BRAVE_IMAGES_API = "https://api.search.brave.com/res/v1/images/search"
TOKEN_PREFIX = "abyss-image:"
# Stock-photo libraries: their previews are watermarked and the images are
# sold, not shared -- never shown.
STOCK_SITES = (
    "adobe.com", "ftcdn.net", "istockphoto.com", "gettyimages.", "shutterstock.com", "alamy.com",
    "dreamstime.com", "depositphotos.com", "123rf.com", "freepik.com", "vecteezy.com", "bigstockphoto.com",
    "canstockphoto.", "pond5.com", "agefotostock.com", "superstock.com", "stocksy.com", "pixta.jp",
)


def _is_stock(*hosts: str) -> bool:
    return any(h and any(s in h for s in STOCK_SITES) for h in hosts)


def brave_api_key() -> str | None:
    return ((config.get("IMAGES") or {}).get("brave_api_key") or "").strip() or None


def _signing_key() -> bytes:
    secret = str((config.get("JWT") or {}).get("secret_key") or "")
    # A key of its own, derived from the app secret: an image token is never a valid JWT signature.
    return hmac.new(secret.encode(), b"abyss-image-proxy", hashlib.sha256).digest()


def _b64(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).rstrip(b"=").decode()


def _unb64(text: str) -> bytes:
    return base64.urlsafe_b64decode(text + "=" * (-len(text) % 4))


def sign_image_url(url: str) -> str:
    """abyss-image:<base64 url>.<signature> -- what the chat loads through the proxy."""
    body = _b64(url.encode())
    signature = _b64(hmac.new(_signing_key(), body.encode(), hashlib.sha256).digest()[:16])
    return f"{TOKEN_PREFIX}{body}.{signature}"


def verify_image_token(token: str) -> str | None:
    """The image URL a token stands for, or None when it wasn't signed by this server."""
    if token.startswith(TOKEN_PREFIX):
        token = token[len(TOKEN_PREFIX):]
    body, _, signature = token.partition(".")
    if not body or not signature:
        return None
    expected = _b64(hmac.new(_signing_key(), body.encode(), hashlib.sha256).digest()[:16])
    if not hmac.compare_digest(signature, expected):
        return None
    try:
        url = _unb64(body).decode()
    except (ValueError, UnicodeDecodeError):
        return None
    return url if urlsplit(url).scheme in ("http", "https") else None


def parse_brave(payload: dict) -> list[dict]:
    """Brave image results -> the `image` visual's fields (src is a signed token)."""
    out = []
    for r in payload.get("results") or []:
        image_url = (r.get("properties") or {}).get("url") or (r.get("thumbnail") or {}).get("src")
        if not image_url or urlsplit(image_url).scheme not in ("http", "https"):
            continue
        site = (r.get("meta_url") or {}).get("hostname") or r.get("source") or urlsplit(r.get("url") or image_url).hostname or ""
        site = site.removeprefix("www.")
        if _is_stock(site, urlsplit(image_url).hostname or "", urlsplit(r.get("url") or "").hostname or ""):
            continue
        out.append({
            "src": sign_image_url(image_url),
            "page": r.get("url") or "",
            "title": str(r.get("title") or "")[:160],
            "description": "",
            "author": "",  # credited as "© its owner, via <site>"
            "license": "© its owner",
            "source": site,
            "width": (r.get("properties") or {}).get("width"),
            "height": (r.get("properties") or {}).get("height"),
        })
    return out


async def web_search(client: httpx.AsyncClient, query: str, count: int) -> list[dict]:
    """Up to `count` web images for `query` (strict safe search), retried when throttled; [] when not configured."""
    key = brave_api_key()
    if not key:
        return []
    response = await get_with_retry(
        client,
        BRAVE_IMAGES_API,
        params={"q": query, "count": str(min(max(count, 1), 20)), "safesearch": "strict"},
        headers={"X-Subscription-Token": key, "Accept": "application/json"},
    )
    return parse_brave(response.json())
