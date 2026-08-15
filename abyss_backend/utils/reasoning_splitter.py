from __future__ import annotations

import json
from dataclasses import dataclass

from constants import REASONING_TAG_CLOSE, REASONING_TAG_OPEN, REASONING_FORCE_CLOSE_AFTER_TOKENS


def sanitize_for_reasoning_tags(text: str) -> str:
    """Escape literal reasoning tag strings in untrusted text (tool output, scraped content).

    Apply this to every string that enters the LLM context from an external
    source to prevent injected tags from hijacking the token-stream split.
    """
    return (
        text
        .replace(REASONING_TAG_OPEN, "&lt;reasoning&gt;")
        .replace(REASONING_TAG_CLOSE, "&lt;/reasoning&gt;")
    )


@dataclass
class SplitChunk:
    channel: str            # "reasoning" | "content"
    text: str
    event: str | None = None     # "start" | "end" | None
    truncated: bool = False


class ReasoningSplitter:
    """Stateful token-stream splitter for one LLM call (keyed by run_id).

    Feed raw token strings from on_chat_model_stream events. Returns SplitChunks
    routed to either the reasoning or content channel. Call flush() in the
    finally block / on cancellation / on timeout to force-close any open tag.

    One instance per LLM run_id — never share across runs.
    """

    def __init__(self) -> None:
        self._in_reasoning = False
        self._pending = ""
        self._tokens_in_reasoning = 0
        self._max_lookahead = max(len(REASONING_TAG_OPEN), len(REASONING_TAG_CLOSE)) - 1

    def feed(self, token: str) -> list[SplitChunk]:
        self._pending += token
        out: list[SplitChunk] = []

        while True:
            if not self._in_reasoning:
                idx = self._pending.find(REASONING_TAG_OPEN)
                if idx == -1:
                    safe_len = len(self._pending) - self._max_lookahead
                    if safe_len > 0:
                        out.append(SplitChunk("content", self._pending[:safe_len]))
                        self._pending = self._pending[safe_len:]
                    break
                if idx > 0:
                    out.append(SplitChunk("content", self._pending[:idx]))
                self._pending = self._pending[idx + len(REASONING_TAG_OPEN):]
                self._in_reasoning = True
                self._tokens_in_reasoning = 0
                out.append(SplitChunk("reasoning", "", event="start"))
            else:
                idx = self._pending.find(REASONING_TAG_CLOSE)
                if idx == -1:
                    self._tokens_in_reasoning += 1
                    if self._tokens_in_reasoning > REASONING_FORCE_CLOSE_AFTER_TOKENS:
                        out.append(SplitChunk("reasoning", self._pending, truncated=True))
                        out.append(SplitChunk("reasoning", "", event="end", truncated=True))
                        self._pending = ""
                        self._in_reasoning = False
                        break
                    safe_len = len(self._pending) - self._max_lookahead
                    if safe_len > 0:
                        out.append(SplitChunk("reasoning", self._pending[:safe_len]))
                        self._pending = self._pending[safe_len:]
                    break
                if idx > 0:
                    out.append(SplitChunk("reasoning", self._pending[:idx]))
                self._pending = self._pending[idx + len(REASONING_TAG_CLOSE):]
                self._in_reasoning = False
                out.append(SplitChunk("reasoning", "", event="end"))

        return out

    def flush(self, generation_ended_cleanly: bool = True) -> list[SplitChunk]:
        """Force-emit any buffered state. Must be called in finally/cancel/timeout handlers."""
        chunks: list[SplitChunk] = []
        if self._pending:
            channel = "reasoning" if self._in_reasoning else "content"
            chunks.append(SplitChunk(channel, self._pending))
            self._pending = ""
        if self._in_reasoning:
            chunks.append(SplitChunk("reasoning", "", event="end", truncated=True))
            self._in_reasoning = False
        return chunks


def normalize_reasoning(raw: str | None) -> dict:
    """Parse persisted reasoning JSON, returning a safe dict with a steps list.

    Handles two cases:
    - None / empty / invalid JSON / non-dict → empty structure {"steps": []}
    - Valid dict → passthrough
    """
    if not raw:
        return {"steps": []}
    try:
        data = json.loads(raw)
    except Exception:
        return {"steps": []}

    if not isinstance(data, dict):
        return {"steps": []}

    return data
