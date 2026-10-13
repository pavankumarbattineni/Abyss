"""Scripted chat model for offline agent tests (no provider calls)."""
import asyncio
import json

from langchain_core.language_models import BaseChatModel
from langchain_core.messages import AIMessage, AIMessageChunk
from langchain_core.outputs import ChatGeneration, ChatGenerationChunk, ChatResult


class ScriptedChatModel(BaseChatModel):
    """Returns scripted AIMessages in order; tool calls and text are streamed.

    `scripts` maps a marker string to that agent's message list. The marker is
    looked up in the call's system prompt, so a parent and its sub-agents can
    share one model instance (as they do in production) and still each follow
    their own script, even when they run in parallel.

    Text is streamed in 4-character pieces so reasoning tags get split across
    chunks the way real providers do. Every message carries usage_metadata.
    """

    scripts: dict = {}
    positions: dict = {}
    delay: float = 0.0  # seconds to wait before each streamed message

    @property
    def _llm_type(self) -> str:
        return "scripted"

    def bind_tools(self, tools, **kwargs):
        return self

    def _next(self, messages) -> AIMessage:
        system = next((str(m.content) for m in messages if m.type == "system"), "")
        marker = next((k for k in self.scripts if k in system), None)
        if marker is None:
            raise AssertionError(f"No script matches system prompt: {system[:80]!r}")
        position = self.positions.get(marker, 0)
        self.positions[marker] = position + 1
        return self.scripts[marker][position]

    def _generate(self, messages, stop=None, run_manager=None, **kwargs):
        return ChatResult(generations=[ChatGeneration(message=self._next(messages))])

    async def _astream(self, messages, stop=None, run_manager=None, **kwargs):
        message = self._next(messages)
        if self.delay:
            await asyncio.sleep(self.delay)
        text = message.content if isinstance(message.content, str) else ""
        pieces = [text[i:i + 4] for i in range(0, len(text), 4)] or [""]
        for piece in pieces:
            yield ChatGenerationChunk(message=AIMessageChunk(content=piece))
        yield ChatGenerationChunk(
            message=AIMessageChunk(
                content="",
                tool_call_chunks=[
                    {"name": tc["name"], "args": json.dumps(tc["args"]), "id": tc["id"], "index": i}
                    for i, tc in enumerate(message.tool_calls)
                ],
                usage_metadata={"input_tokens": 10, "output_tokens": 5, "total_tokens": 15},
            )
        )


def call(name: str, args: dict, call_id: str) -> dict:
    return {"name": name, "args": args, "id": call_id, "type": "tool_call"}


def ai(content: str = "", *calls: dict) -> AIMessage:
    return AIMessage(content=content, tool_calls=list(calls))
