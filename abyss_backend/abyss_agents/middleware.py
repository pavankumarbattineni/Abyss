"""Custom middleware for Abyss agents.

Everything generic — human approval, model retries, call limits, summarization —
uses LangChain's built-in middleware (see abyss_agents/factory.py). Only the pieces
that are specific to Abyss live here.
"""
from __future__ import annotations

import logging
from collections.abc import Awaitable, Callable
from typing import Any

import anyio
import httpx
from langchain.agents.middleware import AgentMiddleware, HumanInTheLoopMiddleware
from langchain_core.messages import AIMessage, ToolMessage
from langgraph.errors import GraphBubbleUp
from langgraph.prebuilt.tool_node import ToolCallRequest
from langgraph.types import Command

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

UNATTENDED_SKIP_TEMPLATE = (
    "Skipped {name}: it requires approval and this agent ran unattended "
    "(e.g. on a schedule), so no one was available to approve it."
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


class UnattendedToolPolicyMiddleware(AgentMiddleware):
    """Auto-skips approval-gated tools on unattended runs (e.g. scheduled).

    Nobody is present to approve, so a gated tool must never run and the run
    must never pause on an approval nobody can give. Used *instead of*
    HumanInTheLoopMiddleware when the run is not interactive.
    """

    def __init__(self, gated_tools: set[str]) -> None:
        super().__init__()
        self._gated = gated_tools

    async def awrap_tool_call(
        self,
        request: ToolCallRequest,
        handler: Callable[[ToolCallRequest], Awaitable[ToolMessage | Command[Any]]],
    ) -> ToolMessage | Command[Any]:
        name = request.tool_call["name"]
        if name in self._gated:
            return ToolMessage(
                content=UNATTENDED_SKIP_TEMPLATE.format(name=name),
                tool_call_id=request.tool_call["id"],
                name=name,
            )
        return await handler(request)


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
