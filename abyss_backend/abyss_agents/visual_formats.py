"""How the agent gets a visual format's spec (data in abyss_agents/visual_specs.py).

- The user starts a message with one or more `/<format>` commands:
  `VisualFormatMiddleware` adds their specs to the system prompt for the turn
  -- no extra call.
- The agent decides a visual would help: it calls the `get_visual_format` tool
  for the spec, then answers.
"""
from __future__ import annotations

from collections.abc import Awaitable, Callable

from langchain.agents.middleware import AgentMiddleware
from langchain_core.messages import HumanMessage, SystemMessage
from langchain_core.tools import tool

from abyss_agents.visual_specs import catalog, requested_formats, spec_for


@tool("get_visual_format")
def get_visual_format(name: str) -> str:
    """Get the spec for drawing a visual format. Call it before writing a ```visual block."""
    return spec_for(name) or f"Unknown format {name!r}. Formats: {catalog()}."


# The formats named in the tool's description come from the one catalog.
get_visual_format.description = (
    f"Get the spec for drawing a visual format ({catalog()}). "
    "Call it before writing a ```visual block."
)


def _text_of(message: HumanMessage) -> str:
    content = message.content
    if isinstance(content, str):
        return content
    return " ".join(
        part.get("text", "") for part in content if isinstance(part, dict) and part.get("type") == "text"
    )


def _last_question(messages: list) -> str:
    for message in reversed(messages):
        if isinstance(message, HumanMessage) and not message.additional_kwargs.get("lc_source"):
            return _text_of(message)
    return ""


class VisualFormatMiddleware(AgentMiddleware):
    """A message starting with `/<format>` commands gets those formats' specs for the turn.

    Added to the system prompt of every model call in the turn (the request is
    rebuilt per call, so nothing accumulates), so the model can draw straight
    away instead of looking the spec up.
    """

    def _with_spec(self, request):
        names = requested_formats(_last_question(request.messages))
        if not names:
            return request
        base = request.system_message.content if request.system_message else ""
        specs = "\n\n".join(spec_for(name) for name in names)
        if len(names) == 1:
            addition = (
                f"## Requested format\nThe user asked for `/{names[0]}`: answer with it -- "
                f"at most 2 short sentences of context, then ONE ```visual block "
                f"(no need to call get_visual_format).\n{specs}"
            )
        else:
            asked = ", ".join(f"`/{name}`" for name in names)
            addition = (
                f"## Requested formats\nThe user asked for {asked}: answer with one "
                f"```visual block per format, in that order, each covering the question "
                f"(no need to call get_visual_format).\n{specs}"
            )
        return request.override(system_message=SystemMessage(content=f"{base}\n\n{addition}".strip()))

    def wrap_model_call(self, request, handler: Callable):
        return handler(self._with_spec(request))

    async def awrap_model_call(self, request, handler: Callable[..., Awaitable]):
        return await handler(self._with_spec(request))
