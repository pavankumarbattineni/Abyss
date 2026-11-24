"""Repairs broken ```visual / ```trench-ui blocks before an answer is saved.

The answer streams to the chat as it is written, so a block the model got
wrong (broken JSON, a missing required field, an unknown format) would show
an error card. After the parent's final model call this middleware checks
every block (abyss_agents/visual_check.py); for a broken one it asks the same
model, in a hidden call, to rewrite just that block from the exact errors and
the format's spec, checks the result, and swaps it in: in the conversation
(the reply message) and, through REPAIR_EVENT, in the chat (the stream
projector replaces the block's text and tells the client, answer_replace).

Hidden calls are tagged INTERNAL_TAG; the projector never streams those.
A block that still fails after one try is left as it was.
"""
from __future__ import annotations

import logging
from typing import Any, Awaitable, Callable

from langchain.agents.middleware import AgentMiddleware
from langchain_core.callbacks.manager import adispatch_custom_event
from langchain_core.language_models import BaseChatModel
from langchain_core.messages import AIMessage, HumanMessage, SystemMessage

from abyss_agents.visual_check import INTERACTIVE_LANGUAGE, check_block, fence_fixes, find_blocks, image_fixes
from abyss_agents.visual_specs import spec_for

logger = logging.getLogger(__name__)

REPAIR_EVENT = "abyss_block_repair"
INTERNAL_TAG = "abyss_internal"
MAX_REPAIRS = 4

_SYSTEM = (
    "You fix one broken JSON block from a chat answer so the app can draw it. "
    "Keep its content and meaning; change only what the errors require. Reply with "
    "the corrected JSON only -- no code fence, no comments, no other text."
)


def _text_of(message: AIMessage) -> str:
    text = message.text
    return text if isinstance(text, str) else str(text)


def _strip_fence(text: str) -> str:
    text = text.strip()
    if text.startswith("```"):
        text = text.split("\n", 1)[1] if "\n" in text else ""
        text = text.rsplit("```", 1)[0]
    return text.strip()


async def _tell_chat(old: str, new: str) -> None:
    """Swap the text in the chat too (stream projector -> answer_replace)."""
    try:
        await adispatch_custom_event(REPAIR_EVENT, {"old": old, "new": new})
    except RuntimeError:  # no run to tell (direct call, tests)
        pass


class VisualRepairMiddleware(AgentMiddleware):
    def __init__(self, llm: BaseChatModel) -> None:
        super().__init__()
        self.llm = llm

    async def _repair(self, block) -> str | None:
        guide = spec_for(block.format) if block.format else None
        if block.language == INTERACTIVE_LANGUAGE:
            guide = 'A trench-ui block: {"version":1,"components":[{"type":...}, ...]}.'
        prompt = (
            f"Block ({block.language}):\n{block.source}\n\nErrors:\n"
            + "\n".join(f"- {e}" for e in block.errors)
            + (f"\n\nSpec:\n{guide}" if guide else "")
        )
        try:
            reply = await self.llm.ainvoke(
                [SystemMessage(_SYSTEM), HumanMessage(prompt)],
                config={"tags": [INTERNAL_TAG], "run_name": "visual_block_repair"},
            )
        except Exception as exc:  # the answer stands as it was
            logger.warning("Visual repair call failed: %s", type(exc).__name__)
            return None
        fixed = _strip_fence(_text_of(reply))
        errors, _ = check_block(block.language, fixed)
        if errors:
            logger.info("Visual repair still invalid (%s): %s", block.format or block.language, errors[:2])
            return None
        return f"```{block.language}\n{fixed}\n```"

    async def awrap_model_call(self, request: Any, handler: Callable[[Any], Awaitable[Any]]) -> Any:
        response = await handler(request)
        index = next((i for i in range(len(response.result) - 1, -1, -1) if isinstance(response.result[i], AIMessage)), None)
        if index is None:
            return response
        message = response.result[index]
        if message.tool_calls:  # not the final answer yet
            return response
        text = original = _text_of(message)
        # No model call: JSON written on the fence line moves onto its own line,
        # and images that didn't come from search_images are left out.
        for fixes in (fence_fixes, image_fixes):
            for old, new in fixes(text):
                if old in text:
                    text = text.replace(old, new, 1)
                    await _tell_chat(old, new)
        broken = [b for b in find_blocks(text) if b.errors][:MAX_REPAIRS]
        for block in broken:
            fixed = await self._repair(block)
            if not fixed or block.text not in text:
                continue
            text = text.replace(block.text, fixed, 1)
            logger.info("Repaired a %s block", block.format or block.language)
            await _tell_chat(block.text, fixed)
        if text != original:
            response.result[index] = message.model_copy(update={"content": text})
        return response
