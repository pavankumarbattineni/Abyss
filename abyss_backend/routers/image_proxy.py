"""GET /images/proxy -- loads a web image found by search_images for the chat.

Only addresses signed by this server (abyss_agents/web_images.py) are fetched,
so it is not an open proxy and the model can't make up images. Safeguards:
no private/loopback/link-local addresses (checked again on every redirect),
raster images only (no SVG, which can carry script), at most 8 MB, a short
timeout. Public (an <img> can't send auth headers); cached by browsers.
"""
from __future__ import annotations

import asyncio
import ipaddress
import logging
import socket
from urllib.parse import urljoin, urlsplit

import httpx
from fastapi import APIRouter, HTTPException, Query
from fastapi.responses import Response

from abyss_agents.web_images import verify_image_token

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/images", tags=["images"])

MAX_BYTES = 8 * 1024 * 1024
MAX_REDIRECTS = 3
TIMEOUT_SECONDS = 10.0
# A generic browser-like client: image hosts often refuse unknown agents.
USER_AGENT = "Mozilla/5.0 (compatible; AbyssImageProxy/1.0)"


async def _public_host(url: str) -> bool:
    """True when the URL is http(s) and its host resolves only to public addresses."""
    parts = urlsplit(url)
    if parts.scheme not in ("http", "https") or not parts.hostname:
        return False
    try:
        infos = await asyncio.get_running_loop().getaddrinfo(parts.hostname, parts.port or 443, type=socket.SOCK_STREAM)
    except OSError:
        return False
    for info in infos:
        ip = ipaddress.ip_address(info[4][0])
        if not ip.is_global or ip.is_multicast:
            return False
    return bool(infos)


async def fetch_image(url: str) -> tuple[bytes, str]:
    """(bytes, content type) of a public raster image, or HTTPException."""
    async with httpx.AsyncClient(timeout=TIMEOUT_SECONDS, follow_redirects=False, headers={"User-Agent": USER_AGENT}) as client:
        for _ in range(MAX_REDIRECTS + 1):
            if not await _public_host(url):
                raise HTTPException(status_code=400, detail="Image address not allowed")
            async with client.stream("GET", url) as response:
                if response.is_redirect:
                    url = urljoin(url, response.headers.get("location", ""))
                    continue
                if response.status_code != 200:
                    raise HTTPException(status_code=502, detail=f"The image's site answered {response.status_code}")
                kind = response.headers.get("content-type", "").split(";")[0].strip().lower()
                if not kind.startswith("image/") or kind == "image/svg+xml":
                    raise HTTPException(status_code=415, detail="Not a raster image")
                body = bytearray()
                async for chunk in response.aiter_bytes():
                    body.extend(chunk)
                    if len(body) > MAX_BYTES:
                        raise HTTPException(status_code=413, detail="Image too large")
                return bytes(body), kind
    raise HTTPException(status_code=508, detail="Too many redirects")


@router.get("/proxy")
async def image_proxy(t: str = Query(min_length=10, max_length=4096)) -> Response:
    url = verify_image_token(t)
    if not url:
        raise HTTPException(status_code=403, detail="Unknown image")
    try:
        data, kind = await fetch_image(url)
    except httpx.HTTPError as exc:
        logger.warning("image proxy fetch failed: %s", type(exc).__name__)
        raise HTTPException(status_code=502, detail="The image couldn't be fetched") from exc
    return Response(
        content=data,
        media_type=kind,
        headers={
            "Cache-Control": "public, max-age=86400, immutable",
            # The chat (another origin) draws it, also into exported PNGs.
            "Access-Control-Allow-Origin": "*",
            "Cross-Origin-Resource-Policy": "cross-origin",
            "X-Content-Type-Options": "nosniff",
            "Content-Security-Policy": "default-src 'none'; sandbox",
        },
    )
