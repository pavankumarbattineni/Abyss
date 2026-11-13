"""Custom middleware for Abyss agents.

Everything generic — human approval, model retries, call limits, summarization —
uses LangChain's built-in middleware (see abyss_agents/factory.py). Only the pieces
that are specific to Abyss live here.
"""
from __future__ import annotations

import logging
import re
from collections.abc import Awaitable, Callable
from typing import Any

import anyio
import httpx
from langchain.agents.middleware import AgentMiddleware, HumanInTheLoopMiddleware
from langchain_core.messages import AIMessage, HumanMessage, ToolMessage
from langgraph.errors import GraphBubbleUp
from langgraph.prebuilt.tool_node import ToolCallRequest
from langgraph.types import Command

from utils.fake_tool_call import has_written_call, strip_written_calls
from utils.reasoning_splitter import sanitize_for_reasoning_tags
from utils.tool_output import extract_tool_output

logger = logging.getLogger(__name__)

# Transient network errors talking to the LLM provider (dropped connection,
# reset mid-stream). Not specific to request content, so a bare retry of the
# model call is safe — nothing with side effects has run yet in that call.
TRANSIENT_LLM_EXCEPTIONS = (
    anyio.BrokenResourceError,
    anyio.ClosedResourceError,
    httpx.RemoteProtocolError,
    httpx.ReadError,
    httpx.WriteError,
    httpx.ConnectError,
    ConnectionError,
)


class ToolResultMiddleware(AgentMiddleware):
    """Normalizes every tool result before it reaches the model.

    - Flattens MCP content blocks to plain text and escapes literal reasoning
      tags in the (untrusted) output so injected tags can't hijack the
      reasoning/answer split of the token stream.
    - Converts a raised tool exception into an error ToolMessage so the agent
      can adapt instead of the whole run failing. Graph control-flow signals
      (interrupts) are never swallowed.
    """

    async def awrap_tool_call(
        self,
        request: ToolCallRequest,
        handler: Callable[[ToolCallRequest], Awaitable[ToolMessage | Command[Any]]],
    ) -> ToolMessage | Command[Any]:
        try:
            result = await handler(request)
        except GraphBubbleUp:
            raise
        except Exception as exc:
            logger.warning("Tool %s raised: %r", request.tool_call["name"], exc)
            return ToolMessage(
                content=sanitize_for_reasoning_tags(f"Tool error: {exc}"),
                tool_call_id=request.tool_call["id"],
                name=request.tool_call["name"],
                status="error",
            )
        if isinstance(result, ToolMessage):
            result.content = sanitize_for_reasoning_tags(extract_tool_output(result) or "")
        return result


class SubAgentCallLimitMiddleware(AgentMiddleware):
    """Caps how many sub-agent calls a single parent turn may make.

    The parent can emit several tool calls in one model turn. Calls beyond
    `limit` (counted in order among the sub-agent tools of that turn) are
    rejected with an explanatory ToolMessage so the model can re-plan, instead
    of silently fanning out without bound.
    """

    def __init__(self, sub_agent_tool_names: set[str], limit: int) -> None:
        super().__init__()
        self._names = sub_agent_tool_names
        self._limit = limit

    async def awrap_tool_call(
        self,
        request: ToolCallRequest,
        handler: Callable[[ToolCallRequest], Awaitable[ToolMessage | Command[Any]]],
    ) -> ToolMessage | Command[Any]:
        call = request.tool_call
        if call["name"] in self._names:
            last = next(
                (m for m in reversed(request.state["messages"]) if isinstance(m, AIMessage)),
                None,
            )
            turn_calls = [tc for tc in (last.tool_calls if last else []) if tc["name"] in self._names]
            position = next((i for i, tc in enumerate(turn_calls) if tc["id"] == call["id"]), 0)
            if position >= self._limit:
                return ToolMessage(
                    content=(
                        f"Not run: at most {self._limit} specialist calls are allowed per turn. "
                        "Call this specialist again in a later turn if the result is still needed."
                    ),
                    tool_call_id=call["id"],
                    name=call["name"],
                    status="error",
                )
        return await handler(request)


class ToolApprovalMiddleware(HumanInTheLoopMiddleware):
    """HumanInTheLoopMiddleware that also puts each tool's MCPTool.id on its approval request.

    The approval payload is the stock HITL shape plus one extra key per action
    request, `tool_id`. "Always Allow" resolves the tool by that primary key —
    MCPTool.name is only unique per connection, not globally.
    """

    def __init__(self, tool_ids: dict[str, str | None], **kwargs: Any) -> None:
        super().__init__(**kwargs)
        self._tool_ids = tool_ids

    def _create_action_and_config(self, tool_call, config, state, runtime):
        action_request, review_config = super()._create_action_and_config(tool_call, config, state, runtime)
        tool_id = self._tool_ids.get(tool_call["name"])
        if tool_id:
            action_request["tool_id"] = tool_id
        return action_request, review_config


_REASONING_BLOCKS = re.compile(r"<reasoning>.*?(?:</reasoning>|$)", re.DOTALL)
ACT_OR_ANSWER_NUDGE = (
    "[Note from the system, not the user] Your last reply ended without acting: it "
    "either stopped after the reasoning or wrote a tool call as text, so nothing ran. "
    "Now make the tool call you described through the function-calling interface "
    "(never as text), or write the final answer."
)


def _needs_another_try(message: AIMessage) -> bool:
    """A reply that did nothing: no real tool call, and either only reasoning
    (no answer) or a tool call written out as text."""
    if message.tool_calls:
        return False
    text = message.text if isinstance(message.text, str) else str(message.text)
    if has_written_call(text):
        return True
    return not strip_written_calls(_REASONING_BLOCKS.sub("", text)).strip()


class ActOrAnswerGuard(AgentMiddleware):
    """Asks the model once more when a reply neither acts nor answers.

    Some models occasionally end a turn with only their `<reasoning>` block, or
    write a tool call as text instead of making it, so nothing runs (and the
    main agent's turn ends with no answer). One retry, with a short note that
    names the mistake; a second miss is returned as is.
    """

    async def awrap_model_call(self, request: Any, handler: Callable[[Any], Awaitable[Any]]) -> Any:
        response = await handler(request)
        message = next((m for m in reversed(response.result) if isinstance(m, AIMessage)), None)
        if message is None or not _needs_another_try(message):
            return response
        logger.warning("Model reply neither acted nor answered; asking once more")
        return await handler(
            request.override(messages=[*request.messages, HumanMessage(ACT_OR_ANSWER_NUDGE)])
        )
