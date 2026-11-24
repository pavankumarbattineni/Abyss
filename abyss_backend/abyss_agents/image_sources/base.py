"""What every image source is: a name the agent can choose, a one-line summary
(shown to the agent in search_images' description), and a search.

A search returns candidates in one shape -- the `image` visual's fields plus
what the coordinator needs (abyss_agents/images.py):
    src, page, title, description, author, license, source, width, height,
    key: the image's own address, so the same picture found by several
         sources is shown once (stripped before the model sees results).
More candidates than asked for is fine: the coordinator filters them for
relevance, merges sources and keeps the best.
"""
from __future__ import annotations

from collections.abc import Awaitable, Callable
from dataclasses import dataclass

import httpx

Search = Callable[[httpx.AsyncClient, str, int], Awaitable[list[dict]]]


@dataclass(frozen=True)
class ImageSource:
    name: str
    summary: str
    search: Search
    # Searches of this source running at once (a burst is what gets throttled).
    concurrency: int = 3
    # False when the source can't run here (e.g. no key configured).
    available: Callable[[], bool] = lambda: True
