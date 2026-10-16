"""Sub-agents exposed to the parent agent as ordinary tools."""
from __future__ import annotations

import asyncio
import logging

from langchain_core.messages import HumanMessage
from langchain_core.tools import StructuredTool
from pydantic import BaseModel, Field

from abyss_agents.middleware import TRANSIENT_LLM_EXCEPTIONS
from constants import SUB_AGENT_RECURSION_LIMIT, SUB_AGENT_TIMEOUT_SECONDS
from utils.reasoning_splitter import sanitize_for_reasoning_tags, strip_reasoning_block

logger = logging.getLogger(__name__)


class SubAgentInput(BaseModel):
    task: str = Field(description="Complete, self-contained task description with all needed context")
    context: str = Field(default="", description="Additional conversation context this specialist needs")


def build_sub_agent_tool(name: str, description: str, sub_agent) -> StructuredTool:
    """Wrap a compiled sub-agent graph as a tool the parent can call.

    The sub-agent is stateless per call (a fresh message list per task). It
    inherits the parent's checkpointer and run config from the ambient
    context, so an approval interrupt raised inside it surfaces on the parent
    thread and resumes in place. Only the sub-agent's final message is
    returned to the parent — with any `<reasoning>` block stripped — which is
    why the sub-agent prompt asks for results in the final message.

    Args:
        name: Tool name; also the sub-agent's `lc_agent_name` label.
        description: What the specialist does — the parent's main routing signal.
        sub_agent: The compiled `create_agent` graph for this sub-agent.
    """

    async def run(task: str, context: str = "") -> str:
        prompt = f"{task}\n\nContext: {context}" if context else task
        try:
            result = await asyncio.wait_for(
                sub_agent.ainvoke(
                    {"messages": [HumanMessage(content=prompt)]},
                    config={"recursion_limit": SUB_AGENT_RECURSION_LIMIT},
                ),
                timeout=SUB_AGENT_TIMEOUT_SECONDS,
            )
            messages = result.get("messages", [])
            final = strip_reasoning_block(str(messages[-1].text)) if messages else ""
        except TRANSIENT_LLM_EXCEPTIONS as exc:
            # Deliberately NOT retried: the sub-agent's loop may already have
            # executed non-idempotent MCP tools before this failure. Report it
            # and let the parent decide whether to call the specialist again.
            logger.warning("Sub-agent %s hit a transient connection error: %r", name, exc)
            final = (
                f"[{name} encountered a temporary connection error and could not "
                "complete this task. Retry it if the result is still needed.]"
            )
        if not final.strip():
            # e.g. the sub-agent ended its turn with only a reasoning block. Say so
            # explicitly — a blank tool result gives the parent nothing to act on.
            logger.warning("Sub-agent %s returned an empty result", name)
            final = (
                f"[{name} finished without returning a result. Treat this task as not done: "
                "retry it with a narrower, more specific task, or tell the user what could not be determined.]"
            )
        return sanitize_for_reasoning_tags(final)

    return StructuredTool.from_function(
        coroutine=run,
        name=name,
        description=description,
        args_schema=SubAgentInput,
    )
