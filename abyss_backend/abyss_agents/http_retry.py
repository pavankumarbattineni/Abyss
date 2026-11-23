"""GET with retries, shared by the tools that call public APIs (Wikimedia
Commons, Wikipedia, Brave): a burst gets throttled (429) and servers have
passing errors, so a request waits and tries again before giving up."""
from __future__ import annotations

import asyncio

import httpx

RETRY_STATUSES = {429, 500, 502, 503, 504}


async def get_with_retry(
    client: httpx.AsyncClient, url: str, params: dict, headers: dict | None = None, tries: int = 3
) -> httpx.Response:
    """GET that waits and tries again on 429/5xx or a network error (honouring
    a short Retry-After); raises after the last try."""
    for attempt in range(tries):
        try:
            response = await client.get(url, params=params, headers=headers)
            if response.status_code not in RETRY_STATUSES or attempt == tries - 1:
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


def describe(exc: Exception) -> str:
    """What went wrong, for the log: the HTTP status (429 throttled, 403 refused...) or the error type."""
    if isinstance(exc, httpx.HTTPStatusError):
        return f"HTTP {exc.response.status_code}"
    return type(exc).__name__
