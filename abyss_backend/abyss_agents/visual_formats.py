"""How the agent gets a visual format's spec (data in abyss_agents/visual_specs.py).

- The user starts a message with `/<format>`: `VisualFormatMiddleware` adds that
  format's spec to the system prompt for the turn -- no extra call.
- The agent decides a visual would help: it calls the `get_visual_format` tool
  for the spec, then answers.
"""
from __future__ import annotations

from collections.abc import Awaitable, Callable

from langchain.agents.middleware import AgentMiddleware
from langchain_core.messages import HumanMessage, SystemMessage
from langchain_core.tools import tool

from abyss_agents.visual_specs import catalog, requested_format, spec_for


@tool("get_visual_format")
def get_visual_format(name: str) -> str:
    """Get the spec for drawing a visual format (flowchart, diagram, blueprint, tree,
    timeline, roadmap, cycle, layers, iceberg, decision-matrix, canvas, infographic,
    handwritten, sketchnotes, exploded-view). Call it before writing a ```visual block."""
    return spec_for(name) or f"Unknown format {name!r}. Formats: {catalog()}."


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
    """A message starting with `/<format>` gets that format's spec for the turn.

    Added to the system prompt of every model call in the turn (the request is
    rebuilt per call, so nothing accumulates), so the model can draw straight
    away instead of looking the spec up.
    """

    def _with_spec(self, request):
        name = requested_format(_last_question(request.messages))
        if not name:
            return request
        base = request.system_message.content if request.system_message else ""
        addition = (
            f"## Requested format\nThe user asked for `/{name}`: answer with it "
            f"(no need to call get_visual_format).\n{spec_for(name)}"
        )
        return request.override(system_message=SystemMessage(content=f"{base}\n\n{addition}".strip()))

    def wrap_model_call(self, request, handler: Callable):
        return handler(self._with_spec(request))

    async def awrap_model_call(self, request, handler: Callable[..., Awaitable]):
        return await handler(self._with_spec(request))
