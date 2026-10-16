"""LangGraph Studio entrypoint for Abyss.

Uses the context-manager graph pattern so Studio receives the *actual* compiled
per-agent `create_agent` graph (model ⇄ tools, with sub-agents as tools) for
each assistant, so the real structure is visible in the Studio UI instead of a
generic wrapper node.

How it works
------------
`langgraph.json` points to `get_graph` (an async context manager).  For each
assistant, LangGraph Platform calls `get_graph(config)` with the assistant's
pre-seeded config (which contains agent_id).  The context manager builds — or
retrieves from cache — the real compiled graph for that agent and yields it.
Studio then visualises and invokes that exact graph.

Usage
-----
    # From Abyss/ directory with venv activated:
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
from langchain.agents import create_agent
from sqlalchemy import select

from config import config
from abyss_agents.factory import PARENT_AGENT_NAME, build_agent
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
# Studio-only graph cache (the API server builds graphs per request):
#   - langgraph dev runs in its own process
#   - Graphs compiled WITHOUT checkpointer — Platform manages persistence

_studio_cache: dict[str, Any] = {}


def _build_skeleton_graph() -> Any:
    """Static skeleton graph for schema-introspection calls (no agent_id in config).

    A real `create_agent` graph with a stub model and no tools, so Studio can
    render the model ⇄ tools topology without a DB agent.
    """
    from langchain_core.language_models.fake_chat_models import FakeListChatModel

    return create_agent(FakeListChatModel(responses=[""]), [], name=PARENT_AGENT_NAME)


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
    """Build and cache the compiled graph for *agent_id*.

    Same construction as the API server (abyss_agents.factory.build_agent) but:
      - Uses _studio_cache — `langgraph dev` runs in its own process
      - Compiles WITHOUT a checkpointer (Platform injects its own)
      - Loads MCP tools directly from the DB before building
    """
    async with async_session_maker() as session:
        result = await session.execute(
            select(Agent).where(Agent.id == agent_id, Agent.is_active == True)
        )
        agent_record = result.scalar_one_or_none()
        if not agent_record:
            raise ValueError(f"Agent {agent_id!r} not found or inactive")

        user_id = agent_record.user_id

        # Load tools for the parent agent and each sub-agent
        await _ensure_tools(agent_id, user_id, session)
        subs_result = await session.execute(
            select(Agent).where(Agent.parent_id == agent_id, Agent.is_active == True)
        )
        for sub in subs_result.scalars().all():
            await _ensure_tools(str(sub.id), user_id, session)

        built = await build_agent(session, agent_record, _get_llm(), None)

    _studio_cache[agent_id] = built.graph
    return built.graph


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
# the real agent / sub-agent-tool topology — not a generic wrapper.

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
