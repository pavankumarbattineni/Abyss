"""Tool calls a model wrote as text instead of making them.

Some models (seen with Gemini 3.5 Flash-Lite and the `<reasoning>` prompt
protocol) occasionally write a call as text -- `<call>default_api:tool{...}</call>`
-- or stop right after their reasoning without acting at all. Nothing runs in
either case. `abyss_agents/middleware.py` (ActOrAnswerGuard) asks the model
again; `CallTextFilter` keeps the written call out of the answer the user sees.
"""

from __future__ import annotations

import re

CALL_OPEN = "<call>"
CALL_CLOSE = "</call>"
_CALL_BLOCK = re.compile(re.escape(CALL_OPEN) + r".*?(?:" + re.escape(CALL_CLOSE) + r"|$)", re.DOTALL)
# Other forms the same mistake takes: "default_api:tool_name{" or "print(default_api.tool(...))".
_CALL_MARKERS = re.compile(r"default_api[:.]\w+\s*[{(]")


def has_written_call(text: str) -> bool:
    """Whether `text` contains a tool call written out instead of made."""
    return CALL_OPEN in text or bool(_CALL_MARKERS.search(text))


def strip_written_calls(text: str) -> str:
    return _CALL_BLOCK.sub("", text)


class CallTextFilter:
    """Streaming filter that drops `<call>...</call>` text, even when the tags
    arrive split across chunks. Feed answer text in order; `flush()` at the end."""

    def __init__(self) -> None:
        self._pending = ""
        self._inside = False
        self._lookahead = max(len(CALL_OPEN), len(CALL_CLOSE)) - 1

    def feed(self, text: str) -> str:
        self._pending += text
        out: list[str] = []
        while self._pending:
            if self._inside:
                idx = self._pending.find(CALL_CLOSE)
                if idx == -1:
                    # Keep only what could still be the start of "</call>".
                    self._pending = self._pending[-self._lookahead:] if len(self._pending) > self._lookahead else self._pending
                    break
                self._pending = self._pending[idx + len(CALL_CLOSE):]
                self._inside = False
            else:
                idx = self._pending.find(CALL_OPEN)
                if idx == -1:
                    safe = len(self._pending) - self._partial_open_suffix()
                    out.append(self._pending[:safe])
                    self._pending = self._pending[safe:]
                    break
                out.append(self._pending[:idx])
                self._pending = self._pending[idx + len(CALL_OPEN):]
                self._inside = True
        return "".join(out)

    def flush(self) -> str:
        tail = "" if self._inside else self._pending
        self._pending = ""
        self._inside = False
        return tail

    def _partial_open_suffix(self) -> int:
        """Length of a trailing prefix of "<call>" that must wait for more text."""
        for size in range(min(len(CALL_OPEN) - 1, len(self._pending)), 0, -1):
            if CALL_OPEN.startswith(self._pending[-size:]):
                return size
        return 0
