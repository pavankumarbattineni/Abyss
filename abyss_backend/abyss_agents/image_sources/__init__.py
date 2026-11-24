"""The sources search_images (abyss_agents/images.py) finds images in.

Each is its own module with the same small interface (base.ImageSource). The
agent chooses among CHOOSABLE for every subject it searches; the tool's
description lists them from here, so adding a source is one module and one
line below -- no prompt edits. FALLBACK (the open web) is never chosen by the
agent: it only tops up a subject the chosen sources came back short on.
"""
from __future__ import annotations

from abyss_agents.image_sources import brave, commons, openlibrary, openverse, wikidata, wikipedia
from abyss_agents.image_sources.base import ImageSource

CHOOSABLE: dict[str, ImageSource] = {
    s.name: s for s in (wikipedia.SOURCE, wikidata.SOURCE, commons.SOURCE, openverse.SOURCE, openlibrary.SOURCE)
}
# A subject searched without naming sources: the exact-subject ones, then the openly licensed ones.
DEFAULT: tuple[str, ...] = ("wikipedia", "wikidata", "commons", "openverse")
FALLBACK: ImageSource = brave.SOURCE


def chosen(names: list[str] | None) -> list[ImageSource]:
    """The agent's sources for one subject, in its order (unknown names left out), or the default."""
    picked = [CHOOSABLE[n] for n in dict.fromkeys((n or "").strip().lower() for n in names or []) if n in CHOOSABLE]
    return picked or [CHOOSABLE[n] for n in DEFAULT]


def describe() -> str:
    """One line per source, for search_images' description."""
    return "\n".join(f'      "{name}": {s.summary}' for name, s in CHOOSABLE.items())


__all__ = ["CHOOSABLE", "DEFAULT", "FALLBACK", "ImageSource", "chosen", "describe"]
