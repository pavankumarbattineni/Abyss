"""LangGraph Studio entrypoint for Thinkloop.

Uses the context-manager graph pattern so Studio receives the *actual* compiled
per-agent graph (agent → sub-agents → synthesizer) for each assistant,
making the real node structure visible in the Studio UI instead of a generic
wrapper node.

How it works
------------
`langgraph.json` points to `get_graph` (an async context manager).  For each
assistant, LangGraph Platform calls `get_graph(config)` with the assistant's
pre-seeded config (which contains agent_id).  The context manager builds — or
retrieves from cache — the real compiled graph for that agent and yields it.
Studio then visualises and invokes that exact graph.

Usage
-----
    # From Thinkloop/ directory with venv activated:
    source .venv/bin/activate
    langgraph dev --tunnel        # --tunnel required for Chrome / HTTPS Studio

    # Seed one named assistant per DB agent (run once after dev server starts):
    python -m studio.seed_assistants --user-id <USER_ID>
"""
from __future__ import annotations

import logging
from contextlib import asynccontextmanager
from typing import Any

from langchain_core.runnables import RunnableConfig
from langchain_openai import ChatOpenAI
from langgraph.graph import END, START, StateGraph
from sqlalchemy import select

from config import config
from database.models import Agent, AgentTool, MCPTool
from database.session import async_session_maker

logger = logging.getLogger(__name__)

# ── Shared LLM ───────────────────────────────────────────────────────────

_llm: ChatOpenAI | None = None

_llm_cfg = config["LLM"]


def _get_llm() -> ChatOpenAI:
    global _llm
    if _llm is None:
        _llm = ChatOpenAI(
            model=_llm_cfg["openai_model"],
            api_key=_llm_cfg["openai_api_key"],
        )
    return _llm


# ── Studio-specific graph cache ───────────────────────────────────────────
# Separate from graph_builder._graph_cache:
#   - langgraph dev runs in its own process; no cache pollution of the API server
#   - Inner graphs compiled WITHOUT checkpointer — Platform manages persistence

_studio_cache: dict[str, Any] = {}


def _build_skeleton_graph() -> Any:
    """Static skeleton graph for schema-introspection calls (no agent_id in config).

    Matches the unified topology: agent → [sub-agents] → synthesizer → END,
    or agent → END directly. Uses lambda stubs so it compiles without a real LLM.
    """
    from utils.graph_builder import AgentState, route_from_agent

    workflow = StateGraph(AgentState)
    workflow.add_node("agent", lambda state: {"messages": [], "pending_tasks": []})
    workflow.add_node("tools", lambda state: {"messages": []})
    workflow.add_node("synthesizer", lambda state: {"messages": []})
    workflow.add_edge(START, "agent")
    workflow.add_conditional_edges("agent", route_from_agent, ["tools", END])
    workflow.add_edge("tools", "agent")
    workflow.add_edge("synthesizer", END)
    return workflow.compile()


# Built at module import — zero cost at request time for schema-introspection calls
_skeleton_graph: Any = _build_skeleton_graph()


async def _ensure_tools(agent_id: str, user_id: str, session: Any) -> None:
    """Load tool names from DB and register in the in-process tool registry.

    Best-effort: if the MCP server is unreachable Studio still starts, just
    without live tools.
    """
    from utils.mcp_client import register_tools_for_id

    result = await session.execute(
        select(MCPTool.name)
        .join(AgentTool, AgentTool.tool_id == MCPTool.id)
        .where(
            AgentTool.agent_id == agent_id,
            AgentTool.is_active == True,
            MCPTool.is_active == True,
        )
    )
    tool_names = list(result.scalars().all())
    if tool_names:
        try:
            await register_tools_for_id(agent_id, user_id, tool_names, session)
        except Exception as exc:
            logger.warning(
                "MCP tools unavailable for %s (agent runs without tools): %s",
                agent_id, exc,
            )


async def _build_studio_graph(agent_id: str) -> Any:
    """Build and cache the inner compiled graph for *agent_id*.

    Mirrors graph_builder.build_agent_graph but:
      - Uses _studio_cache so the API server's _graph_cache is untouched
      - Compiles WITHOUT a checkpointer (Platform injects its own)
      - Always builds as StateGraph with the unified agent node topology
      - Loads MCP tools directly from the DB before building
    """
    from utils.graph_builder import (
        AgentState,
        make_agent_node,
        make_sub_agent_node,
        make_synthesizer_node,
        make_tools_node,
        route_from_agent,
        to_tool_name,
    )
    from utils.mcp_client import get_tool_permissions_for_agent, get_tools_for_agent

    async with async_session_maker() as session:
        result = await session.execute(
            select(Agent).where(Agent.id == agent_id, Agent.is_active == True)
        )
        agent_record = result.scalar_one_or_none()
        if not agent_record:
            raise ValueError(f"Agent {agent_id!r} not found or inactive")

        llm = _get_llm()
        user_id = agent_record.user_id

        # Load tools for parent agent
        await _ensure_tools(agent_id, user_id, session)

        # Load sub-agents
        subs_result = await session.execute(
            select(Agent).where(Agent.parent_id == agent_id, Agent.is_active == True)
        )
        sub_agents = subs_result.scalars().all()

        # Load tools for each sub-agent
        for sub in sub_agents:
            await _ensure_tools(str(sub.id), user_id, session)

    sub_agent_options = [
        {
            "sub_id": str(sub.id),
            "tool_name": to_tool_name(sub.name),
            "tool_description": sub.description or sub.name,
            "system_prompt": sub.system_prompt,
        }
        for sub in sub_agents
    ]
    sub_agent_names = [opt["tool_name"] for opt in sub_agent_options]
    parent_tools = get_tools_for_agent(agent_id)
    parent_permissions = get_tool_permissions_for_agent(agent_id)

    workflow = StateGraph(AgentState)
    workflow.add_node(
        "agent",
        make_agent_node(llm, agent_record.system_prompt, parent_tools, sub_agent_options),
    )
    workflow.add_node("tools", make_tools_node(parent_tools, parent_permissions, agent_id))
    workflow.add_node(
        "synthesizer",
        make_synthesizer_node(llm, agent_record.system_prompt),
    )
    for opt in sub_agent_options:
        child_tools = get_tools_for_agent(opt["sub_id"])
        child_permissions = get_tool_permissions_for_agent(opt["sub_id"])
        workflow.add_node(
            opt["tool_name"],
            make_sub_agent_node(
                llm, opt["system_prompt"], child_tools, opt["tool_name"], opt["sub_id"],
                child_permissions, None,
            ),
        )

    workflow.add_edge(START, "agent")
    workflow.add_conditional_edges("agent", route_from_agent, sub_agent_names + ["tools", END])
    workflow.add_edge("tools", "agent")
    for name in sub_agent_names:
        workflow.add_edge(name, "synthesizer")
    workflow.add_edge("synthesizer", END)

    # No checkpointer — LangGraph Platform injects its own. Passing None as
    # make_sub_agent_node's checkpointer means a gated tool inside a
    # dispatched sub-agent will still pause via interrupt(), but Platform (not
    # our AsyncPostgresSaver) owns whatever persistence resuming it needs.
    compiled = workflow.compile()
    _studio_cache[agent_id] = compiled
    return compiled


# ── Startup lifespan ──────────────────────────────────────────────────────
# LangGraph Platform calls lifespan() once when the dev server starts.
# Pre-building every agent graph here means get_graph() is always a fast
# cache lookup — no DB queries or MCP tool loading on the hot path.

@asynccontextmanager
async def lifespan(app: Any):
    """Pre-warm _studio_cache for all active top-level agents at server startup."""
    logger.info("Studio lifespan: pre-warming agent graph cache …")
    try:
        async with async_session_maker() as session:
            result = await session.execute(
                select(Agent).where(Agent.is_active == True, Agent.parent_id.is_(None))
            )
            agents = result.scalars().all()

        built, failed = 0, 0
        for agent in agents:
            try:
                await _build_studio_graph(str(agent.id))
                logger.info("  ✓ pre-built graph for %r (%s)", agent.name, agent.id)
                built += 1
            except Exception as exc:
                logger.warning("  ✗ failed to pre-build graph for %s: %s", agent.id, exc)
                failed += 1

        logger.info(
            "Studio graph cache ready — %d built, %d failed, skeleton already loaded",
            built, failed,
        )
    except Exception as exc:
        logger.warning("Studio lifespan pre-warm failed (server still starts): %s", exc)

    yield  # server runs here


# ── Context-manager graph factory ─────────────────────────────────────────
# LangGraph Platform calls get_graph(config) for each assistant.
# Yielding the actual compiled per-agent graph means Studio sees and visualises
# the real supervisor / sub-agent / synthesizer topology — not a generic wrapper.

@asynccontextmanager
async def get_graph(config: RunnableConfig):
    agent_id: str | None = (config.get("configurable") or {}).get("agent_id")

    if not agent_id:
        # Schema-introspection call — no specific agent configured yet.
        # Yield the static skeleton so Studio can render the graph topology
        # without a real DB agent.  Actual conversations always carry agent_id
        # (set when seeding assistants via seed_assistants.py).
        logger.debug("get_graph called without agent_id — yielding skeleton graph")
        yield _skeleton_graph
        return

    if agent_id not in _studio_cache:
        await _build_studio_graph(agent_id)

    yield _studio_cache[agent_id]
