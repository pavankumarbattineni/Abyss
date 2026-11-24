"""Web image search (Brave Search API), the second source of search_images.

Wikimedia Commons only has openly licensed photos -- no film or TV stills,
posters, characters, products or brands. With a key configured,
search_images (abyss_agents/images.py) uses this source as the agent asks:
first for "web" subjects, alternating with Commons when there's no
preference, and only to top up a short result for "open" ones. Results are
credited to the site they come from.

A web image is never loaded by the reader's browser from its own site: its
address is encrypted into a token signed with the server's secret
("abyss-image:<encrypted url>.<signature>"), and the chat loads it through our image
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
import os
from urllib.parse import urlsplit

import httpx
from cryptography.exceptions import InvalidTag
from cryptography.hazmat.primitives.ciphers.aead import AESGCM

from abyss_agents.http_retry import get_with_retry
from config import config

logger = logging.getLogger(__name__)

BRAVE_IMAGES_API = "https://api.search.brave.com/res/v1/images/search"
TOKEN_PREFIX = "abyss-image:"
# Smaller images are icons or thumbnails, unreadable in a gallery.
MIN_WIDTH = 300
MIN_HEIGHT = 200
# Stock-photo libraries: their previews are watermarked and the images are
# sold, not shared -- never shown.
STOCK_SITES = (
    "adobe.com", "ftcdn.net", "istockphoto.com", "gettyimages.", "shutterstock.com", "alamy.com",
    "dreamstime.com", "depositphotos.com", "123rf.com", "freepik.com", "vecteezy.com", "bigstockphoto.com",
    "canstockphoto.", "pond5.com", "agefotostock.com", "superstock.com", "stocksy.com", "pixta.jp",
)


# Stock photos re-hosted elsewhere keep the library's name in the file name.
_STOCK_FILES = ("adobestock", "istock", "shutterstock", "gettyimages", "dreamstime", "depositphotos", "alamy", "123rf")


def _is_stock(*hosts: str, image_url: str = "") -> bool:
    name = urlsplit(image_url).path.rsplit("/", 1)[-1].lower()
    return any(h and any(s in h for s in STOCK_SITES) for h in hosts) or any(s in name for s in _STOCK_FILES)


def brave_api_key() -> str | None:
    return ((config.get("IMAGES") or {}).get("brave_api_key") or "").strip() or None


def _key(purpose: bytes) -> bytes:
    """A key of its own per use, derived from the app secret: an image token
    is never a valid JWT signature, and signing and encrypting never share a key."""
    secret = str((config.get("JWT") or {}).get("secret_key") or "")
    return hmac.new(secret.encode(), purpose, hashlib.sha256).digest()


def _signing_key() -> bytes:
    return _key(b"abyss-image-proxy")


def _b64(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).rstrip(b"=").decode()


def _unb64(text: str) -> bytes:
    return base64.urlsafe_b64decode(text + "=" * (-len(text) % 4))


# Token bodies start with this mark when the address inside is encrypted.
# (A model can read a base64 address back out of a token and write it into the
# answer, where the chat can't show it; an encrypted one it can only copy.)
_SEALED = "e1"


def _seal(url: str) -> str:
    nonce = os.urandom(12)
    return _SEALED + _b64(nonce + AESGCM(_key(b"abyss-image-seal")).encrypt(nonce, url.encode(), None))


def _unseal(body: str) -> str | None:
    try:
        data = _unb64(body[len(_SEALED):])
        return AESGCM(_key(b"abyss-image-seal")).decrypt(data[:12], data[12:], None).decode()
    except (ValueError, UnicodeDecodeError, InvalidTag):
        return None


def sign_image_url(url: str) -> str:
    """abyss-image:<encrypted url>.<signature> -- what the chat loads through the proxy."""
    body = _seal(url)
    signature = _b64(hmac.new(_signing_key(), body.encode(), hashlib.sha256).digest()[:16])
    return f"{TOKEN_PREFIX}{body}.{signature}"


def verify_image_token(token: str) -> str | None:
    """The image URL a token stands for, or None when it wasn't signed by this server.
    Tokens from before encryption (a plain base64 address) still work, so images
    in chats saved earlier keep loading."""
    if token.startswith(TOKEN_PREFIX):
        token = token[len(TOKEN_PREFIX):]
    body, _, signature = token.partition(".")
    if not body or not signature:
        return None
    expected = _b64(hmac.new(_signing_key(), body.encode(), hashlib.sha256).digest()[:16])
    if not hmac.compare_digest(signature, expected):
        return None
    if body.startswith(_SEALED):
        url = _unseal(body)
    else:
        try:
            url = _unb64(body).decode()
        except (ValueError, UnicodeDecodeError):
            return None
    return url if url and urlsplit(url).scheme in ("http", "https") else None


def _too_small(width: object, height: object) -> bool:
    """Icons, avatars and tiny thumbnails: unreadable in a gallery. Unknown sizes pass."""
    try:
        return int(width) < MIN_WIDTH or int(height) < MIN_HEIGHT
    except (TypeError, ValueError):
        return False


def _copy_key(image_url: str, width: object, height: object) -> tuple:
    """The same picture re-hosted by several sites usually keeps its file name
    and size: one key for all those copies."""
    name = urlsplit(image_url).path.rsplit("/", 1)[-1].lower()
    return (name, width, height) if name and width and height else (image_url.split("?", 1)[0],)


def parse_brave(payload: dict) -> list[dict]:
    """Brave image results -> the `image` visual's fields (src is a signed token).

    Dropped: stock-photo sites, images too small to read, copies of an image
    already in the list, and Wikimedia's own files (the Commons search finds
    those, with their author and licence)."""
    out = []
    seen: set[tuple] = set()
    for r in payload.get("results") or []:
        props = r.get("properties") or {}
        image_url = props.get("url") or (r.get("thumbnail") or {}).get("src")
        if not image_url or urlsplit(image_url).scheme not in ("http", "https"):
            continue
        image_host = urlsplit(image_url).hostname or ""
        site = (r.get("meta_url") or {}).get("hostname") or r.get("source") or urlsplit(r.get("url") or image_url).hostname or ""
        site = site.removeprefix("www.")
        if _is_stock(site, image_host, urlsplit(r.get("url") or "").hostname or "", image_url=image_url):
            continue
        if image_host.endswith("wikimedia.org") or _too_small(props.get("width"), props.get("height")):
            continue
        key = _copy_key(image_url, props.get("width"), props.get("height"))
        if key in seen:
            continue
        seen.add(key)
        out.append({
            "src": sign_image_url(image_url),
            "page": r.get("url") or "",
            "title": str(r.get("title") or "")[:160],
            "description": "",
            "author": "",  # credited as "© its owner, via <site>"
            "license": "© its owner",
            "source": site,
            "width": props.get("width"),
            "height": props.get("height"),
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
