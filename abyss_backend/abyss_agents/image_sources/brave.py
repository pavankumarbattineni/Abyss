"""Brave image search: any image on the web (stills, scenes, products...).

Not offered to the agent: the coordinator (abyss_agents/images.py) uses it
only to top up a subject the chosen sources came back short on, so agents
don't default to arbitrary web images. Off without ABYSS_CONFIG.IMAGES.brave_api_key."""
from __future__ import annotations

import httpx

from abyss_agents import web_images
from abyss_agents.image_sources.base import ImageSource


async def search(client: httpx.AsyncClient, query: str, limit: int) -> list[dict]:
    return await web_images.web_search(client, query, 2 * limit)


SOURCE = ImageSource(
    "brave",
    "any image on the web (top-up only)",
    search,
    available=lambda: bool(web_images.brave_api_key()),
)
