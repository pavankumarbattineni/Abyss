"""Repairs broken ```visual / ```abyss-ui blocks before an answer is saved.

The answer streams to the chat as it is written, so a block the model got
wrong (broken JSON, a missing required field, an unknown format, a made-up
image) would show an error card or nothing. After the parent's final model
call this middleware checks every block (abyss_agents/visual_check.py) and
fixes what it can, cheapest first:

1. No model call: JSON written on the fence line moves onto its own line; a
   block written in the wrong language (an interactive "comparison" or
   "table" inside a ```visual block, or the reverse) is rewritten in the
   right one; an image block whose JSON broke (a search result copied whole
   and cut short) is rebuilt from the search results its addresses point to.
2. Images the model wrote itself instead of taking them from search_images
   (not in the conversation's search results, not signed by this server, or a
   Wikimedia address that doesn't exist) are replaced with real ones: the
   search runs with the image's own description. Without a result the image
   is left out.
3. A hidden call to the same model rewrites each remaining broken block from
   its exact errors and its format's spec. For a format that doesn't exist,
   the model first picks the existing format that fits the content.
4. A ```visual block that still can't be drawn becomes readable text (its
   title and content as bullets) -- never an error card.

Every fix is swapped in in the conversation (the reply message) and, through
REPAIR_EVENT, in the chat (the stream projector replaces the block's text and
tells the client, answer_replace). Hidden calls are tagged INTERNAL_TAG; the
projector never streams those.
"""
from __future__ import annotations

import asyncio
import json
import logging
import re
from typing import Any, Awaitable, Callable

import httpx
from langchain.agents.middleware import AgentMiddleware
from langchain_core.callbacks.manager import adispatch_custom_event
from langchain_core.language_models import BaseChatModel
from langchain_core.messages import AIMessage, HumanMessage, SystemMessage, ToolMessage

from abyss_agents import images
from abyss_agents.middleware import in_open_code_block
from abyss_agents.visual_check import (
    INTERACTIVE_LANGUAGE,
    VISUAL_LANGUAGE,
    WIKIMEDIA_IMAGE,
    as_markdown,
    check_block,
    fence_fixes,
    find_blocks,
    image_fixes,
    image_searches,
    image_src_ok,
    image_srcs,
    language_fixes,
    unknown_format,
)
from abyss_agents.visual_specs import FORMATS, spec_for

logger = logging.getLogger(__name__)

REPAIR_EVENT = "abyss_block_repair"
INTERNAL_TAG = "abyss_internal"
MAX_REPAIRS = 4
# Results fetched per replacement search: enough for a gallery whose images share one description.
_REPLACEMENT_RESULTS = 4

_SYSTEM = (
    "You fix one broken JSON block from a chat answer so the app can draw it. "
    "Keep its content and meaning; change only what the errors require. Reply with "
    "the corrected JSON only -- no code fence, no comments, no other text."
)
_CHOOSE = (
    "A chat answer has a visual block in a format that doesn't exist. Pick the one "
    "format below that best shows the block's content. Reply with the format name only."
)
_SRC = re.compile(r'"src"\s*:\s*"([^"]+)"')


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


def searched_images(messages: list) -> dict[str, dict]:
    """Every image search_images returned in the conversation so far, by address."""
    found: dict[str, dict] = {}
    for m in messages or []:
        if not (isinstance(m, ToolMessage) and m.name == "search_images"):
            continue
        content = m.content if isinstance(m.content, str) else str(m.content)
        try:
            data = json.loads(content)
        except ValueError:  # a plain-text reply ("No images found ...")
            continue
        lists = data.values() if isinstance(data, dict) else [data]
        for results in lists:
            for r in results if isinstance(results, list) else []:
                if isinstance(r, dict) and isinstance(r.get("src"), str):
                    found[r["src"]] = r
    return found


def rebuilt_image_blocks(text: str, known: dict[str, dict]) -> list[tuple[str, str]]:
    """(old, new) for image blocks whose JSON is broken (a model copying search
    results whole and cutting one short): rebuilt from the search results whose
    addresses the block holds -- exact fields, no model call."""
    fixes = []
    for block in find_blocks(text):
        if block.language != VISUAL_LANGUAGE or block.format == "image" or not block.errors:
            continue
        if not re.search(r'"format"\s*:\s*"image"', block.source):
            continue
        records = [known[s] for s in dict.fromkeys(_SRC.findall(block.source)) if s in known]
        if not records:
            continue
        title = re.match(r'\s*\{\s*"format"\s*:\s*"image"\s*,\s*"title"\s*:\s*"((?:[^"\\]|\\.)*)"', block.source)
        head = {"format": "image", **({"title": json.loads(f'"{title.group(1)}"')} if title else {})}
        data = {**head, **records[0]} if len(records) == 1 else {**head, "images": records}
        fixes.append((block.text, f"```{VISUAL_LANGUAGE}\n{json.dumps(data, ensure_ascii=False)}\n```"))
    return fixes


def is_unusable(status_code: int, content_type: str) -> bool:
    """An address that can't be shown as an image: gone (404/410), or found but
    not an image (a file's description page on an image host). Anything else --
    throttled, a server error -- counts as usable: a working image is never
    dropped because Wikimedia was busy."""
    if status_code in (404, 410):
        return True
    return 200 <= status_code < 300 and not content_type.lower().startswith("image/")


async def _missing(srcs: list[str]) -> set[str]:
    """The Wikimedia addresses that can't be shown as images (is_unusable)."""
    if not srcs:
        return set()

    async def gone(client: httpx.AsyncClient, src: str) -> bool:
        try:
            response = await client.head(src)
            return is_unusable(response.status_code, response.headers.get("content-type", ""))
        except httpx.HTTPError:
            return False

    async with httpx.AsyncClient(timeout=5.0, follow_redirects=True, headers={"User-Agent": images.USER_AGENT}) as client:
        results = await asyncio.gather(*(gone(client, s) for s in srcs))
    return {s for s, is_gone in zip(srcs, results) if is_gone}


# The sources to search again for a made-up image, from what its address imitated:
# a Wikimedia file (an openly licensed picture) or a web image (a poster, a still).
_REPLACEMENT_SOURCES = {"open": ["wikidata", "commons", "openverse"], "web": ["wikipedia"]}


async def _search_all(wanted: list[tuple[str, str]]) -> dict[tuple[str, str], list[dict]]:
    """The results of each (query, kind) search, in find_images calls of at most MAX_QUERIES."""
    found: dict[tuple[str, str], list[dict]] = {}
    for start in range(0, len(wanted), images.MAX_QUERIES):
        chunk = wanted[start:start + images.MAX_QUERIES]
        searches = [(query, _REPLACEMENT_SOURCES.get(kind, [])) for query, kind in chunk]
        for want, results in zip(chunk, await images.find_images(searches, _REPLACEMENT_RESULTS)):
            found[want] = results or []
    return found


class VisualRepairMiddleware(AgentMiddleware):
    def __init__(self, llm: BaseChatModel) -> None:
        super().__init__()
        self.llm = llm

    async def _ask(self, system: str, prompt: str, run_name: str) -> str | None:
        try:
            reply = await self.llm.ainvoke(
                [SystemMessage(system), HumanMessage(prompt)],
                config={"tags": [INTERNAL_TAG], "run_name": run_name},
            )
        except Exception as exc:  # the answer stands as it was
            logger.warning("Visual repair call failed: %s", type(exc).__name__)
            return None
        return _text_of(reply)

    async def _choose_format(self, block) -> str | None:
        """The existing format that fits a block written in one that doesn't exist."""
        menu = "\n".join(f"{name}: {fmt.summary}" for name, fmt in FORMATS.items())
        reply = await self._ask(_CHOOSE, f"Formats:\n{menu}\n\nBlock:\n{block.source}", "visual_format_choice")
        name = (reply or "").strip().strip("`\"'. ").lower()
        return name if name in FORMATS else None

    async def _repair(self, block) -> str | None:
        target = None
        if block.language == VISUAL_LANGUAGE and unknown_format(block.source):
            target = await self._choose_format(block)
        guide = spec_for(target or block.format) if (target or block.format) else None
        if block.language == INTERACTIVE_LANGUAGE:
            guide = f'An {INTERACTIVE_LANGUAGE} block: {{"version":1,"components":[{{"type":...}}, ...]}}.'
        prompt = (
            f"Block ({block.language}):\n{block.source}\n\nErrors:\n"
            + "\n".join(f"- {e}" for e in block.errors)
            + (f'\n\nRewrite it as a "{target}" visual ("format":"{target}"), keeping its content.' if target else "")
            + (f"\n\nSpec:\n{guide}" if guide else "")
        )
        reply = await self._ask(_SYSTEM, prompt, "visual_block_repair")
        if reply is None:
            return None
        fixed = _strip_fence(reply)
        errors, _ = check_block(block.language, fixed)
        if errors:
            logger.info("Visual repair still invalid (%s): %s", target or block.format or block.language, errors[:2])
            return None
        return f"```{block.language}\n{fixed}\n```"

    async def _image_fixes(self, text: str, messages: list) -> list[tuple[str, str]]:
        """Made-up images swapped for real ones (or left out). See the module docstring, step 2."""
        srcs = image_srcs(text)
        if not srcs:
            return []
        known = set(searched_images(messages))
        unchecked = [s for s in dict.fromkeys(srcs) if s not in known and WIKIMEDIA_IMAGE.match(s)]
        missing = await _missing(unchecked)

        def ok(image: object) -> bool:
            src = str(image.get("src", "") if isinstance(image, dict) else "").strip()
            return src in known or (image_src_ok(image) and src not in missing)

        wanted = image_searches(text, ok)
        if not wanted:
            return []
        try:
            found = await _search_all(wanted)
        except Exception as exc:  # the images are then left out, as before
            logger.warning("Replacement image search failed: %s", type(exc).__name__)
            found = {}
        logger.info("Replacing %d made-up image(s) with search results", len(wanted))
        return image_fixes(text, ok, found)

    async def awrap_model_call(self, request: Any, handler: Callable[[Any], Awaitable[Any]]) -> Any:
        response = await handler(request)
        index = next((i for i in range(len(response.result) - 1, -1, -1) if isinstance(response.result[i], AIMessage)), None)
        if index is None:
            return response
        message = response.result[index]
        if message.tool_calls:  # not the final answer yet
            return response
        text = original = _text_of(message)

        async def apply(fixes: list[tuple[str, str]]) -> None:
            nonlocal text
            for old, new in fixes:
                if old in text:
                    text = text.replace(old, new, 1)
                    await _tell_chat(old, new)

        # 1-2: no model call. A block the reply never closed (it stopped there,
        # even after being continued) is closed first, so it is checked like any other.
        if in_open_code_block(text):
            tail = text[-200:]
            await apply([(tail, tail.rstrip() + "\n```")])
        messages = getattr(request, "messages", None) or []
        for fixes in (fence_fixes, language_fixes):
            await apply(fixes(text))
        await apply(rebuilt_image_blocks(text, searched_images(messages)))
        await apply(await self._image_fixes(text, messages))
        # 3: a hidden model call per remaining broken block.
        for block in [b for b in find_blocks(text) if b.errors][:MAX_REPAIRS]:
            fixed = await self._repair(block)
            if fixed and block.text in text:
                logger.info("Repaired a %s block", block.format or block.language)
                await apply([(block.text, fixed)])
        # 4: what still can't be drawn is shown as text.
        for block in find_blocks(text):
            if block.errors and block.language == VISUAL_LANGUAGE and block.format != "image":
                readable = as_markdown(block.source)
                if readable:
                    logger.info("Showing a %s block as text", block.format or "visual")
                    await apply([(block.text, readable)])
        if text != original:
            response.result[index] = message.model_copy(update={"content": text})
        return response
