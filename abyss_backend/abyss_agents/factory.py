"""Builds the parent agent (and its sub-agents) from the Agent DB records.

Everything is a LangChain `create_agent` graph:

    parent  = create_agent(model ⇄ tools)
              tools = the agent's MCP tools + one tool per sub-agent
    sub-agent = create_agent(model ⇄ tools), wrapped as a tool of the parent

The graph is built per request: compiling is cheap, and building it fresh means
the resolved (BYOK) model, tool set, permissions and sub-agent list can never be
stale — there is no cache to invalidate.
"""
from __future__ import annotations

import logging
from dataclasses import dataclass, field

from langchain.agents import create_agent
from langchain.agents.middleware import (
    ModelCallLimitMiddleware,
    ModelRetryMiddleware,
    SummarizationMiddleware,
)
from langchain_core.language_models import BaseChatModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from abyss_agents.middleware import (
    TRANSIENT_LLM_EXCEPTIONS,
    SubAgentCallLimitMiddleware,
    ToolApprovalMiddleware,
    ToolResultMiddleware,
    UnattendedToolPolicyMiddleware,
)
from abyss_agents.naming import to_tool_name
from abyss_agents.prompts import build_parent_prompt, build_sub_agent_prompt
from abyss_agents.subagent import build_sub_agent_tool
from constants import (
    LLM_CALL_MAX_RETRIES,
    LLM_CALL_RETRY_BACKOFF_SECONDS,
    MAX_AGENT_ITERATIONS,
    MAX_PARALLEL_TASKS,
    SUB_AGENT_RECURSION_LIMIT,
    SUMMARIZATION_KEEP_MESSAGES,
    SUMMARIZATION_TRIGGER_FRACTION,
    SUMMARIZATION_TRIGGER_TOKENS,
)
from database.models import Agent
from utils.mcp_client import get_tool_permissions_for_agent, get_tools_for_agent

logger = logging.getLogger(__name__)

# Label of the top-level agent in the event stream (`lc_agent_name`) and in
# persisted reasoning steps. Sub-agents are labelled by their tool name.
PARENT_AGENT_NAME = "agent"

# One model call = one loop iteration; the sub-agent bound mirrors the old
# recursion limit (each iteration is a model step + a tools step).
_SUB_AGENT_MODEL_CALL_LIMIT = SUB_AGENT_RECURSION_LIMIT // 2


@dataclass(frozen=True)
class BuiltAgent:
    """A compiled parent agent plus what the stream/approval layers need to know about it."""

    graph: object
    sub_agent_names: frozenset[str] = field(default_factory=frozenset)


def _model_retry() -> ModelRetryMiddleware:
    # Retries only the model call, only for transient network errors. Tools are
    # never retried: some MCP tools are non-idempotent.
    return ModelRetryMiddleware(
        max_retries=LLM_CALL_MAX_RETRIES,
        retry_on=TRANSIENT_LLM_EXCEPTIONS,
        on_failure="error",
        initial_delay=LLM_CALL_RETRY_BACKOFF_SECONDS,
        backoff_factor=1.0,
        jitter=False,
    )


def _tool_policy(label: str, permissions: dict[str, bool], tools: list, is_interactive: bool) -> list:
    """Approval middleware for the tools in `tools` that are flagged in `permissions`.

    On interactive runs the approval node is present even when no tool is
    currently gated. A paused run's checkpoint is waiting on that node, so the
    graph rebuilt to resume it must contain it regardless of any permission
    change (e.g. "Always Allow") made in the meantime; with nothing gated the
    node is a no-op.
    """
    gated = {t.name for t in tools if permissions.get(t.name, False)}
    if not is_interactive:
        return [UnattendedToolPolicyMiddleware(gated)] if gated else []
    return [
        ToolApprovalMiddleware(
            tool_ids={t.name: (t.metadata or {}).get("tool_id") for t in tools if t.name in gated},
            interrupt_on={name: {"allowed_decisions": ["approve", "reject"]} for name in gated},
            description_prefix=f"{label} wants to use a tool that requires your approval",
        )
    ]


def _summarization(llm: BaseChatModel) -> SummarizationMiddleware:
    trigger: list = [("tokens", SUMMARIZATION_TRIGGER_TOKENS)]
    if (getattr(llm, "profile", None) or {}).get("max_input_tokens"):
        trigger.insert(0, ("fraction", SUMMARIZATION_TRIGGER_FRACTION))
    return SummarizationMiddleware(
        model=llm,
        trigger=trigger,
        keep=("messages", SUMMARIZATION_KEEP_MESSAGES),
    )


async def build_agent(
    session: AsyncSession,
    agent_record: Agent,
    llm: BaseChatModel,
    checkpointer,
    *,
    enable_thinking: bool = True,
    native_reasoning: bool = False,
    is_interactive: bool = True,
) -> BuiltAgent:
    """Build and compile the parent agent graph for `agent_record`.

    Args:
        session: Active async database session (to load the active sub-agents).
        agent_record: The parent Agent ORM instance.
        llm: The resolved chat model, used by the parent and every sub-agent.
        checkpointer: LangGraph checkpointer for conversation persistence. Sub-
            agents inherit it from the parent run, so an approval pause inside
            a sub-agent checkpoints and resumes on the same thread.
        enable_thinking: The user's thinking toggle.
        native_reasoning: The model already emits the provider's own reasoning
            blocks, so the prompt-based `<reasoning>` protocol is not used.
        is_interactive: False for unattended runs (e.g. scheduled): gated tools
            are skipped instead of pausing for an approval nobody can give.

    Returns:
        BuiltAgent with the compiled graph and the sub-agent tool names.
    """
    prompt_reasoning = enable_thinking and not native_reasoning
    result = await session.execute(
        select(Agent).where(Agent.parent_id == agent_record.id, Agent.is_active == True)
    )
    sub_agents = result.scalars().all()

    parent_tools = list(get_tools_for_agent(str(agent_record.id)))
    parent_permissions = get_tool_permissions_for_agent(str(agent_record.id))

    sub_options: list[dict] = []
    sub_tools = []
    for sub in sub_agents:
        tool_name = to_tool_name(sub.name)
        child_tools = list(get_tools_for_agent(str(sub.id)))
        if not child_tools:
            logger.warning(
                "Sub-agent '%s' (id=%s) has no tools registered — it will run without MCP tools",
                tool_name, sub.id,
            )
        child_agent = create_agent(
            llm,
            child_tools,
            system_prompt=build_sub_agent_prompt(sub.system_prompt, include_reasoning=prompt_reasoning),
            middleware=[
                ToolResultMiddleware(),
                *_tool_policy(tool_name, get_tool_permissions_for_agent(str(sub.id)), child_tools, is_interactive),
                _model_retry(),
                ModelCallLimitMiddleware(run_limit=_SUB_AGENT_MODEL_CALL_LIMIT),
            ],
            name=tool_name,
        )
        description = sub.description or sub.name
        sub_tools.append(build_sub_agent_tool(tool_name, description, child_agent))
        sub_options.append({"tool_name": tool_name, "tool_description": description})

    sub_names = {opt["tool_name"] for opt in sub_options}

    middleware = [
        ToolResultMiddleware(),
        *_tool_policy(PARENT_AGENT_NAME, parent_permissions, parent_tools, is_interactive),
    ]
    if sub_names:
        middleware.append(SubAgentCallLimitMiddleware(sub_names, MAX_PARALLEL_TASKS))
    middleware += [
        _model_retry(),
        ModelCallLimitMiddleware(run_limit=MAX_AGENT_ITERATIONS),
        _summarization(llm),
    ]

    graph = create_agent(
        llm,
        parent_tools + sub_tools,
        system_prompt=build_parent_prompt(
            agent_record.system_prompt, sub_options, include_reasoning=prompt_reasoning
        ),
        middleware=middleware,
        checkpointer=checkpointer,
        name=PARENT_AGENT_NAME,
    )
    return BuiltAgent(
        graph=graph,
        sub_agent_names=frozenset(sub_names),
    )
