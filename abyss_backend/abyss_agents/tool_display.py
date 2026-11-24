"""How the chat shows a tool's calls -- declared by the tool itself.

A tool that only prepares what the answer shows (a visual's format, images,
places for a map) marks itself as a background step, with the short status the
chat says while it runs ("Finding images…"). The mark travels with the tool's
stream events (tool metadata is part of every event LangChain emits for it):
the stream projector passes it on, live and in the saved steps, and the chat
lists no step for such a call (abyss_frontend/src/lib/reasoning.ts). The call
itself runs exactly as any other and stays in the saved steps and in Tracing.

Any tool -- a built-in one or a future one -- becomes a background step by
calling background_step(); nothing else needs to know its name.
"""
from __future__ import annotations

from langchain_core.tools import BaseTool

BACKGROUND = "abyss_background"


def background_step(tool: BaseTool, status: str) -> BaseTool:
    """Marks `tool` as a background step whose running status is `status`."""
    tool.metadata = {**(tool.metadata or {}), BACKGROUND: status}
    return tool


def background_status(metadata: dict | None) -> str | None:
    """The running status of a background step, from a stream event's metadata; None for any other tool."""
    status = (metadata or {}).get(BACKGROUND)
    return status if isinstance(status, str) and status.strip() else None
