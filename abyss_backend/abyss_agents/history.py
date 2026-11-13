"""What the main agent sees of the conversation, and when it is summarized.

Two middlewares, both on the main agent only (specialists have no history):

* `PastTurnTrimMiddleware` -- earlier turns reach the model as the user's
  question + the main agent's final answer only. Tool calls, specialist and
  MCP results, intermediate messages and reasoning are left out. The current
  turn is passed untouched (the agent needs its own tool calls and results to
  finish it). It changes only the model's view: the saved history stays whole,
  so refresh-resume, tool approvals and tracing are unaffected.

* `TurnStartSummarization` -- LangChain's SummarizationMiddleware, but it runs
  only at the start of a turn (never mid-turn), measures the history the model
  actually sees (the trimmed view), triggers at the smaller of a cost cap and
  the selected model's context window x a fraction, reads the whole history it
  replaces, and uses a chat-oriented prompt. Each summary is announced with a
  custom event so the chat can save and show it.
"""

from __future__ import annotations

import logging
import re
from collections.abc import Awaitable, Callable
from typing import Any

from langchain.agents.middleware import AgentMiddleware, SummarizationMiddleware
from langchain_core.callbacks.manager import adispatch_custom_event
from langchain_core.language_models import BaseChatModel
from langchain_core.messages import (
    AIMessage,
    AnyMessage,
    HumanMessage,
    ToolMessage,
    filter_messages,
)
from langchain_core.messages.utils import count_tokens_approximately
from langgraph.graph.message import REMOVE_ALL_MESSAGES

import constants

logger = logging.getLogger(__name__)

# Custom event announcing a summary (handled in services/chat_service.py).
SUMMARY_EVENT = "abyss_summary"
SUMMARY_PREFIX = "Here is a summary of the conversation to date:\n\n"

_REASONING_BLOCK = re.compile(r"<reasoning>.*?(?:</reasoning>|$)", re.DOTALL)
# Native thinking/reasoning content blocks (Anthropic, Gemini, OpenAI).
_THINKING_BLOCK_TYPES = {"thinking", "redacted_thinking", "reasoning"}

CHAT_SUMMARY_PROMPT = r"""You are summarizing the earlier part of a conversation between a user and an AI assistant, so the assistant can continue it without the full history.

Write a concise summary that keeps everything needed to continue naturally:

## User's goals
What the user is trying to achieve, and any preferences or constraints they stated.

## Key facts and results
Facts, numbers, formulas, names, decisions and conclusions established so far -- including details from tool or specialist results that later questions may need.

## Answers already given
What the assistant already produced (briefly), so it isn't repeated or contradicted.

## Open questions
Anything unresolved or promised for later. Write "None" if there is nothing.

Write in plain prose and lists. Write maths as \( ... \) inline or \[ ... \] on its own line -- never with $ signs. Do not add anything that is not in the conversation.

<messages>
Messages to summarize:
{messages}
</messages>"""


def is_summary(message: AnyMessage) -> bool:
    """The message SummarizationMiddleware puts in place of older history."""
    return isinstance(message, HumanMessage) and (
        message.additional_kwargs.get("lc_source") == "summarization"
    )


def _is_question(message: AnyMessage) -> bool:
    return isinstance(message, HumanMessage) and not is_summary(message)


def strip_reasoning(message: AIMessage) -> AIMessage | None:
    """The answer without any reasoning; None if nothing else is left."""
    content = message.content
    if isinstance(content, str):
        cleaned: Any = _REASONING_BLOCK.sub("", content).strip()
        empty = not cleaned
    else:
        cleaned = []
        for block in content:
            if isinstance(block, dict):
                if block.get("type") in _THINKING_BLOCK_TYPES:
                    continue
                if block.get("type") == "text":
                    text = _REASONING_BLOCK.sub("", block.get("text", "")).strip()
                    if not text:
                        continue
                    block = {**block, "text": text}
            elif isinstance(block, str):
                block = _REASONING_BLOCK.sub("", block).strip()
                if not block:
                    continue
            cleaned.append(block)
        empty = not cleaned
    if empty:
        return None
    kwargs = {k: v for k, v in message.additional_kwargs.items() if k != "reasoning_content"}
    return message.model_copy(update={"content": cleaned, "additional_kwargs": kwargs})


def trim_past_turns(messages: list[AnyMessage]) -> list[AnyMessage]:
    """Earlier turns as question + final answer; the current turn untouched.

    The current turn starts at the last user question. Before it, tool calls
    and their results are removed together (no orphans either way), each turn
    keeps only its last answer with reasoning stripped, and a summary message
    is kept as is.
    """
    start = next((i for i in range(len(messages) - 1, -1, -1) if _is_question(messages[i])), None)
    if not start:  # first turn (or no question at all): nothing earlier to trim
        return list(messages)

    past = filter_messages(messages[:start], exclude_tool_calls=True)
    trimmed: list[AnyMessage] = []
    answer: AIMessage | None = None
    for message in past:
        if isinstance(message, HumanMessage):
            if answer is not None:
                trimmed.append(answer)
                answer = None
            trimmed.append(message)
        elif isinstance(message, AIMessage):
            answer = strip_reasoning(message) or answer  # keep the turn's last real answer
        elif isinstance(message, ToolMessage):
            continue  # a result whose call was already gone
        else:
            trimmed.append(message)
    if answer is not None:
        trimmed.append(answer)
    return trimmed + list(messages[start:])


def _view(messages: list[AnyMessage]) -> list[AnyMessage]:
    return trim_past_turns(messages) if constants.TRIM_PAST_TURNS else list(messages)


def context_window(llm: BaseChatModel) -> int:
    """Input context window of the selected model, in tokens."""
    from database.seed import KNOWN_CONTEXT_WINDOWS

    profile = getattr(llm, "profile", None) or {}
    if isinstance(profile.get("max_input_tokens"), int):
        return profile["max_input_tokens"]
    name = str(getattr(llm, "model", None) or getattr(llm, "model_name", "") or "")
    name = name.removeprefix("models/")
    return KNOWN_CONTEXT_WINDOWS.get(name, constants.DEFAULT_CONTEXT_WINDOW)


def summary_threshold(llm: BaseChatModel) -> int:
    """Tokens of (trimmed) history at which a conversation is summarized."""
    window = int(context_window(llm) * constants.SUMMARIZATION_TRIGGER_FRACTION)
    return max(1, min(constants.SUMMARY_TOKEN_CAP, window))


def _count_view(messages: list[AnyMessage]) -> int:
    return count_tokens_approximately(_view(messages))


class PastTurnTrimMiddleware(AgentMiddleware):
    """Sends earlier turns to the model as question + final answer only."""

    def wrap_model_call(self, request: Any, handler: Callable[[Any], Any]) -> Any:
        return handler(request.override(messages=trim_past_turns(request.messages)))

    async def awrap_model_call(
        self, request: Any, handler: Callable[[Any], Awaitable[Any]]
    ) -> Any:
        return await handler(request.override(messages=trim_past_turns(request.messages)))


class TurnStartSummarization(SummarizationMiddleware):
    """Summarizes older history at the start of a turn, sized to the model."""

    def __init__(self, llm: BaseChatModel) -> None:
        self.threshold = summary_threshold(llm)
        super().__init__(
            model=llm,
            trigger=("tokens", self.threshold),
            keep=("messages", constants.SUMMARIZATION_KEEP_MESSAGES),
            token_counter=_count_view,
            summary_prompt=CHAT_SUMMARY_PROMPT,
            trim_tokens_to_summarize=constants.SUMMARY_INPUT_TOKEN_LIMIT,
        )

    def before_model(self, state: Any, runtime: Any) -> dict[str, Any] | None:
        messages = state["messages"]
        if not messages or not _is_question(messages[-1]):
            return None  # mid-turn: never summarize
        return super().before_model(state, runtime)

    async def abefore_model(self, state: Any, runtime: Any) -> dict[str, Any] | None:
        messages = state["messages"]
        if not messages or not _is_question(messages[-1]):
            return None  # mid-turn (tool results, approvals): never summarize
        update = await super().abefore_model(state, runtime)
        if update:
            new_messages = [m for m in update["messages"] if getattr(m, "id", None) != REMOVE_ALL_MESSAGES]
            summary = next((m for m in new_messages if is_summary(m)), None)
            if summary is not None:
                kept = len(new_messages) - 1
                try:
                    await adispatch_custom_event(SUMMARY_EVENT, {
                        "content": str(summary.content).removeprefix(SUMMARY_PREFIX).strip(),
                        "messages_summarized": len(messages) - kept,
                        "tokens_before": _count_view(messages),
                        "tokens_after": _count_view(new_messages),
                    })
                except Exception:  # noqa: BLE001 -- showing it is best-effort
                    logger.warning("Couldn't announce the conversation summary", exc_info=True)
        return update
