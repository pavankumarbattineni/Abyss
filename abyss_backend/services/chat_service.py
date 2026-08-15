import asyncio
import json
import logging
import os
import time
from dataclasses import dataclass

import httpx
from langchain_core.language_models import BaseChatModel
from langchain_openai import ChatOpenAI
from langgraph.types import Command
from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from config import config
from constants import (
    LLM_SOURCE_BYOK,
    LLM_SOURCE_DEFAULT,
    MAX_AGENT_ITERATIONS,
    STREAM_CLEANUP_DELAY_SECONDS,
    STREAM_STATUS_AWAITING_APPROVAL,
    STREAM_STATUS_CANCELLED,
    STREAM_STATUS_COMPLETED,
    STREAM_STATUS_FAILED,
    STREAM_STATUS_PENDING,
    STREAM_STATUS_RUNNING,
    SUB_AGENT_TIMEOUT_SECONDS,
    THREAD_TITLE_INPUT_MAX_CHARS,
    THREAD_TITLE_OUTPUT_MAX_CHARS,
    TOKEN_FLUSH_INTERVAL,
)
from database.checkpointer import get_checkpointer
from database.models import (
    Agent, LlmCredential, Message, MCPTool, Provider, ProviderModel,
    ScheduleRun, StreamRecord, Thread, User, utcnow,
)
from schemas.stream import StreamStartResponse, ToolApprovalGroup, ToolApprovalRequest
from utils.encryption import decrypt_value
from utils.graph_builder import build_agent_graph, invalidate_graph_cache
from utils.llm_providers import PROVIDERS, classify_llm_error
import utils.stream_manager as stream_manager
from utils.reasoning_splitter import ReasoningSplitter
from utils.tool_output import extract_tool_output as _extract_tool_output

logger = logging.getLogger(__name__)

_llm_cfg = config["LLM"]
_langsmith_cfg = config.get("LANGSMITH", {})


# Initialize LangSmith tracing if configured
if _langsmith_cfg.get("tracing_enabled", False):
    os.environ["LANGCHAIN_TRACING_V2"] = "true"
    if _langsmith_cfg.get("api_key"):
        os.environ["LANGCHAIN_API_KEY"] = _langsmith_cfg["api_key"]
    if _langsmith_cfg.get("project"):
        os.environ["LANGCHAIN_PROJECT"] = _langsmith_cfg["project"]

# Must be set before importing litellm — forces pricing lookups to use only
# the local data file bundled with the package, never a network fetch. This
# avoids adding network latency (or a hang, if unreachable) to server startup,
# and keeps cost calculation deterministic for a given litellm version rather
# than silently drifting if the upstream pricing file changes underneath us.
os.environ.setdefault("LITELLM_LOCAL_MODEL_COST_MAP", "True")
import litellm  # noqa: E402

_llm: ChatOpenAI | None = None

# Nodes whose LLM tokens constitute the final user-visible response
_FINAL_RESPONSE_NODES = {"synthesizer", "agent"}

# Nodes whose tokens are internal structured-output JSON — skip entirely
_SKIP_TOKEN_NODES: set[str] = set()



def _get_llm() -> ChatOpenAI:
    """Return the shared ChatOpenAI instance, creating it on first call.

    max_retries lets the OpenAI SDK's own retry logic absorb transient
    connection-establishment failures. keepalive_expiry is kept short so a
    pooled connection that's gone stale/half-open isn't handed out for a new
    request — the more common source of a mid-stream BrokenResourceError.
    """
    global _llm
    if _llm is None:
        _llm = ChatOpenAI(
            model=_llm_cfg["openai_model"],
            api_key=_llm_cfg["openai_api_key"],
            max_retries=2,
            http_async_client=httpx.AsyncClient(
                limits=httpx.Limits(
                    max_keepalive_connections=20,
                    max_connections=100,
                    keepalive_expiry=15.0,
                ),
                timeout=httpx.Timeout(120.0, connect=10.0),
            ),
        )
    return _llm


@dataclass(frozen=True)
class LlmResolution:
    llm: BaseChatModel
    provider: str
    model: str
    llm_source: str  # LLM_SOURCE_DEFAULT | LLM_SOURCE_BYOK — see constants.py


async def resolve_llm_for_agent(session: AsyncSession, agent_record: Agent) -> LlmResolution:
    """Build the LLM this agent should use for the current turn.

    agent_record.llm_model_id NULL means "Default" — always the platform's
    own OpenAI key, paired with whichever provider_models row is currently
    flagged is_platform_default, fully isolated from whatever credential the
    user may have added for a different, explicitly-configured agent. Any
    other (explicit) selection requires the owning user to have a valid
    LlmCredential for that model's provider; there is no platform fallback
    for non-default selections.

    Returns provider/model/llm_source alongside the built LLM — callers that
    need to attribute token usage/cost (see _run_generation) would otherwise
    have to re-run this exact resolution a second time.
    """
    if agent_record.llm_model_id is None:
        result = await session.execute(
            select(Provider.name, ProviderModel.model_name)
            .join(ProviderModel, ProviderModel.provider_id == Provider.id)
            .where(ProviderModel.is_platform_default == True, ProviderModel.is_active == True)
        )
        row = result.first()
        provider, model = row if row else ("openai", _llm_cfg["openai_model"])
        llm = PROVIDERS[provider].build(model, _llm_cfg["openai_api_key"])
        return LlmResolution(llm=llm, provider=provider, model=model, llm_source=LLM_SOURCE_DEFAULT)

    result = await session.execute(
        select(Provider.id, Provider.name, ProviderModel.model_name)
        .join(ProviderModel, ProviderModel.provider_id == Provider.id)
        .where(ProviderModel.id == agent_record.llm_model_id, ProviderModel.is_active == True)
    )
    row = result.first()
    if not row:
        raise ValueError("This agent's selected model is no longer available — please choose another.")
    provider_id, provider, model = row

    cred_result = await session.execute(
        select(LlmCredential).where(
            LlmCredential.user_id == agent_record.user_id,
            LlmCredential.provider_id == provider_id,
            LlmCredential.is_active == True,
        )
    )
    credential = cred_result.scalar_one_or_none()
    if not credential:
        raise ValueError(f"No {provider} API key configured — add one in Settings.")

    api_key = decrypt_value(credential.encrypted_api_key, purpose="llm")
    llm = PROVIDERS[provider].build(model, api_key)
    return LlmResolution(llm=llm, provider=provider, model=model, llm_source=LLM_SOURCE_BYOK)


async def _load_pending_interrupts(
    session: AsyncSession, stream_id: str, user_id: str
) -> tuple[StreamRecord, Thread, list]:
    """Load a stream's owning thread/agent, build its graph, and return the
    current list of pending Interrupt objects straight from the checkpoint.

    Shared by ChatService.resolve_tool_approvals (which also resumes) and
    ChatService.get_pending_approval (read-only, for reconnect/status-poll
    recovery) — both need the identical ownership-checked lookup.

    Args:
        session: Active async database session.
        stream_id: The StreamRecord.id to look up.
        user_id: The authenticated user's ID (ownership check via thread).

    Returns:
        (stream_record, thread, interrupts) — interrupts may be empty if the
        graph has nothing pending (e.g. already resolved).

    Raises:
        ValueError: If the stream/thread/agent isn't found or not owned by user_id.
    """
    stream_result = await session.execute(select(StreamRecord).where(StreamRecord.id == stream_id))
    stream_record = stream_result.scalar_one_or_none()
    if not stream_record:
        raise ValueError("Stream not found")

    thread_result = await session.execute(
        select(Thread).where(
            Thread.id == stream_record.thread_id,
            Thread.user_id == user_id,
            Thread.is_active == True,
        )
    )
    thread = thread_result.scalar_one_or_none()
    if not thread:
        raise ValueError("Thread not found")

    agent_result = await session.execute(
        select(Agent).where(Agent.id == thread.agent_id, Agent.is_active == True)
    )
    agent_record = agent_result.scalar_one_or_none()
    if not agent_record:
        raise ValueError("Agent not found or was deleted")

    llm_resolution = await resolve_llm_for_agent(session, agent_record)
    checkpointer = get_checkpointer()
    graph = await build_agent_graph(session, agent_record, llm_resolution.llm, checkpointer)
    thread_config = {"configurable": {"thread_id": thread.id}}
    state_snapshot = await graph.aget_state(thread_config)
    return stream_record, thread, list(state_snapshot.interrupts)


def _compute_cost_usd(
    provider: str | None, model: str | None,
    input_tokens: int, cache_read_tokens: int, output_tokens: int,
) -> float | None:
    """Compute a run's cost via LiteLLM's standardized per-model pricing.

    Returns None (never a misleading 0) whenever cost genuinely can't be
    determined: no provider/model resolved at all (e.g. the run failed
    before resolving an agent), or LiteLLM doesn't recognize this exact
    model string. Tokens are still recorded either way — this only affects
    the derived dollar figure.
    """
    if not provider or not model or (input_tokens == 0 and output_tokens == 0):
        return None
    try:
        prompt_cost, completion_cost = litellm.cost_per_token(
            model=model,
            prompt_tokens=input_tokens,
            completion_tokens=output_tokens,
            cache_read_input_tokens=cache_read_tokens,
        )
        return round(prompt_cost + completion_cost, 6)
    except Exception as exc:
        logger.warning("Cost calculation unavailable for %s/%s: %s", provider, model, exc)
        return None


async def _generate_thread_title(user_message: str) -> str | None:
    """Call the LLM once to produce a short, specific thread title from the opening message.

    Returns None on any failure so the caller can continue without a title.
    """
    try:
        response = await _get_llm().ainvoke([
            {
                "role": "system",
                "content": (
                    "You are a conversation-title writer. "
                    "Your only job is to produce a short, specific title that captures "
                    "the exact intent of the user's message.\n\n"
                    "Rules:\n"
                    "- 3 to 6 words, title case\n"
                    "- Be specific to the actual topic — never generic\n"
                    "- Lead with the key subject or action (e.g. 'Debug Payment Webhook Timeout', "
                    "'Summarize Q3 Sales Report', 'Draft Apology Email to Client')\n"
                    "- Prefer noun phrases or action + object; avoid starting with 'How', 'What', 'Can', 'Please'\n"
                    "- No filler words: 'Help', 'Question', 'Chat', 'Conversation', 'Assistance', 'Info'\n"
                    "- No quotes, no punctuation at the end, no markdown\n"
                    "- Output ONLY the title — nothing else"
                ),
            },
            {
                "role": "user",
                "content": user_message[:THREAD_TITLE_INPUT_MAX_CHARS],
            },
        ])
        title = response.content.strip().strip('"').strip("'")[:THREAD_TITLE_OUTPUT_MAX_CHARS]
        return title or None
    except Exception as exc:
        logger.warning("Thread title generation failed: %s", exc)
        return None


def _tool_agent_label(node: str, checkpoint_ns: str) -> str:
    """Resolve the display label for a tool_start/tool_end/tool_call event.

    checkpoint_ns's leading segment (before the first ':') identifies which
    node's execution produced this tool invocation. For a sub-agent it's the
    sub-agent's own node name (e.g. "child_agent:...|tools:..." → "child_agent"
    — nesting is pipe-separated, so split(":")[0] on the first segment is
    unaffected by inner segments). At the top level it's literally "tools" —
    the parent agent's own internal tool-execution node, not a real agent name
    — since tool execution moved out of the "agent" node into a dedicated
    "tools" node. Map that back to the stable "agent" label used everywhere
    else for the top-level agent, so persisted reasoning and live SSE events
    don't leak this internal node name.
    """
    raw = checkpoint_ns.split(":")[0] if checkpoint_ns else node
    return "agent" if raw == "tools" else raw


def _process_event(event: dict, chunk_index: int) -> list[dict]:
    """Convert one astream_events event into zero or more SSE chunk dicts.

    synthesis_start is NOT emitted here — it is emitted inline in
    _run_generation so it can reference the accumulated reasoning_tokens keys.
    """
    kind: str = event["event"]
    metadata: dict = event.get("metadata", {})
    node: str = metadata.get("langgraph_node", "")
    # Non-empty checkpoint_ns means the event comes from a nested subgraph
    # (e.g. the internal "agent" node inside a sub-agent's create_react_agent).
    checkpoint_ns: str = metadata.get("langgraph_checkpoint_ns", "")
    chunks: list[dict] = []

    if kind == "on_chain_start":
        _internal = _SKIP_TOKEN_NODES | _FINAL_RESPONSE_NODES | {"__start__", "LangGraph", ""}
        # Only emit for top-level nodes (checkpoint_ns == ""). Each sub-agent fires
        # two on_chain_start events: one from the parent graph (checkpoint_ns="") and
        # one from its own internal create_react_agent graph (checkpoint_ns non-empty).
        # Filtering to checkpoint_ns=="" ensures exactly one agent_start per sub-agent.
        if node and node not in _internal and checkpoint_ns == "":
            chunks.append({"index": chunk_index, "event_type": "agent_start", "data": {"agent_name": node}})

    elif kind == "on_chain_end":
        _internal = _SKIP_TOKEN_NODES | _FINAL_RESPONSE_NODES | {"__start__", "LangGraph", ""}
        if node and node not in _internal and checkpoint_ns == "":
            chunks.append({"index": chunk_index, "event_type": "agent_end", "data": {"agent_name": node}})

    elif kind == "on_tool_start":
        if node:
            agent_label = _tool_agent_label(node, checkpoint_ns)
            chunks.append({"index": chunk_index, "event_type": "tool_start", "data": {"tool_name": event.get("name", ""), "agent_name": agent_label}})

    elif kind == "on_tool_end":
        if node:
            agent_label = _tool_agent_label(node, checkpoint_ns)
            output_str = _extract_tool_output(event.get("data", {}).get("output"))
            chunks.append({"index": chunk_index, "event_type": "tool_end", "data": {"tool_name": event.get("name", ""), "agent_name": agent_label, "output": output_str}})

    return chunks


async def _run_generation(
    stream_id: str,
    thread_id: str,
    agent_id: str,
    user_message: str,
    enable_thinking: bool = True,
    is_interactive: bool = True,
    resume_map: dict[str, dict[str, str]] | None = None,
    starting_chunk_index: int = 0,
) -> None:
    """Background coroutine that drives LangGraph execution and streams chunks.

    Runs independently of any HTTP request. Creates its own DB session.
    Handles CancelledError (user cancel), ValueError (logic errors), and
    generic exceptions, always marking the StreamRecord terminal and signalling
    all waiting SSE clients before exiting.

    resume_map: when set, this call continues a previously-paused generation
    (see the tool_approval_required handling below) instead of starting a new
    turn — user_message is ignored in that case. Keyed by Interrupt.id so
    multiple simultaneous interrupts (e.g. parallel sub-agent branches each
    gated on a different tool) can be resumed in one call.
    """
    from database.session import async_session_maker

    async with async_session_maker() as session:
        chunk_index = starting_chunk_index
        # Set just before the tool-approval pause return below. Checked in the
        # `finally` block so pausing (not terminal) skips scheduling the
        # completion-oriented in-memory cleanup timer — see stream_manager
        # .schedule_cleanup_task's docstring for why that timer is unsafe here.
        paused_for_approval = False
        content_tokens: list[str] = []
        # Keyed by agent name; used for synthesis_start agents_completed list.
        reasoning_tokens: dict[str, list[str]] = {}
        # Splitter state — one instance per LLM run_id, keyed by run_id.
        splitters: dict[str, ReasoningSplitter] = {}
        splitter_agent_labels: dict[str, str] = {}    # run_id → display label
        splitter_is_final: dict[str, bool] = {}        # run_id → emits to final content channel
        reasoning_buffers: dict[str, list[str]] = {}   # run_id → current open reasoning block
        reasoning_start_times: dict[str, float] = {}   # run_id → monotonic start time of block
        reasoning_agents: dict[str, str] = {}           # run_id → agent label for in-progress block
        reasoning_steps: list[dict] = []               # v2 structured reasoning for DB storage
        reasoning_token_count: int = 0                  # monotonic count of reasoning tokens emitted
        tool_start_times: dict[str, float] = {}         # run_id → monotonic start time of tool call
        tool_inputs: dict[str, str | None] = {}         # run_id → serialized tool input args
        last_flush_count = 0  # combined content + reasoning token count at last flush
        run_input_tokens = 0     # accumulated across every LLM call this run (see on_chat_model_end)
        run_cache_read_tokens = 0
        run_output_tokens = 0
        llm_provider_value: str | None = None  # set once resolved below; visible in except blocks too
        llm_model_value: str | None = None
        llm_source_value: str | None = None

        try:
            await session.execute(
                update(StreamRecord)
                .where(StreamRecord.id == stream_id)
                .values(status=STREAM_STATUS_RUNNING, updated_at=utcnow())
            )
            await session.commit()

            if resume_map is not None:
                # A resumed run starts these accumulators empty by default, but
                # they must continue the SAME message's history across the pause
                # boundary — the final persist below overwrites the whole
                # Message.content / StreamRecord.reasoning, so anything from
                # before the pause has to be seeded back in here or it's lost
                # (confirmed: a message with a tool call before AND after a
                # gate previously ended up with only the post-approval tool
                # call in `reasoning`).
                prior_result = await session.execute(
                    select(
                        StreamRecord.partial_content, StreamRecord.reasoning,
                        StreamRecord.input_tokens, StreamRecord.cache_read_tokens, StreamRecord.output_tokens,
                    )
                    .where(StreamRecord.id == stream_id)
                )
                prior_partial, prior_reasoning_json, prior_input, prior_cache_read, prior_output = prior_result.first()
                if prior_partial:
                    content_tokens.append(prior_partial)
                if prior_reasoning_json:
                    try:
                        reasoning_steps = json.loads(prior_reasoning_json).get("steps", [])
                    except Exception:
                        logger.warning("Stream %s: failed to parse prior reasoning JSON on resume", stream_id)
                # Same reasoning as content_tokens/reasoning_steps above — token
                # usage is a true accumulator across the pause boundary too, not
                # something a resumed invocation can freshly re-derive.
                run_input_tokens = prior_input or 0
                run_cache_read_tokens = prior_cache_read or 0
                run_output_tokens = prior_output or 0

            agent_result = await session.execute(
                select(Agent).where(Agent.id == agent_id, Agent.is_active == True)
            )
            agent_record = agent_result.scalar_one_or_none()
            if not agent_record:
                raise ValueError("Agent not found or was deleted")

            llm_resolution = await resolve_llm_for_agent(session, agent_record)
            llm = llm_resolution.llm
            # Unlike tokens/reasoning, provider/model/source don't need
            # resume-seeding — agent_record.llm_model_id can't change mid-run,
            # so every invocation (initial or resumed) re-derives the identical
            # value independently; nothing to carry across the pause boundary.
            llm_provider_value = llm_resolution.provider
            llm_model_value = llm_resolution.model
            llm_source_value = llm_resolution.llm_source
            checkpointer = get_checkpointer()
            graph = await build_agent_graph(session, agent_record, llm, checkpointer)

            # Capture the latest checkpoint before this turn starts so that on
            # cancellation we can delete only the new (partial) checkpoints and
            # restore the thread to its last clean state — preserving all prior
            # conversation turns in the checkpoint history.
            thread_config = {"configurable": {"thread_id": thread_id}}
            pre_turn_tuple = await checkpointer.aget_tuple(thread_config)
            last_good_checkpoint_id: str | None = (
                pre_turn_tuple.checkpoint["id"] if pre_turn_tuple else None
            )

            graph_input = (
                Command(resume=resume_map) if resume_map is not None
                else {
                    "messages": [{"role": "user", "content": user_message}],
                    "enable_thinking": enable_thinking,
                    "is_interactive": is_interactive,
                }
            )
            # Each ReAct iteration is now two graph steps (agent + tools), so the
            # recursion limit needs headroom for that vs. the old single-node loop.
            run_config = {
                "configurable": {"thread_id": thread_id},
                "recursion_limit": MAX_AGENT_ITERATIONS * 2 + 10,
            }

            async for event in graph.astream_events(
                graph_input,
                run_config,
                version="v2",
            ):
                e_kind = event["event"]
                e_metadata = event.get("metadata", {})
                e_node = e_metadata.get("langgraph_node", "")

                # ── synthesis_start ───────────────────────────────────────────
                if e_kind == "on_chain_start" and e_node == "synthesizer":
                    stream_manager.append_chunk(stream_id, {
                        "index": chunk_index,
                        "event_type": "synthesis_start",
                        "data": {"agents_completed": list(reasoning_tokens.keys())},
                    })
                    chunk_index += 1

                # ── on_chat_model_stream: reasoning splitter ──────────────────
                if e_kind == "on_chat_model_stream":
                    run_id: str = event.get("run_id", "")
                    token_content: str = event["data"]["chunk"].content
                    if token_content and run_id:
                        if run_id not in splitters:
                            splitters[run_id] = ReasoningSplitter()
                            reasoning_buffers[run_id] = []
                            ns = e_metadata.get("langgraph_checkpoint_ns", "")
                            ns_root = ns.split(":")[0] if ns else ""
                            is_top = e_node == "agent" and (ns == "" or ns_root == "agent")
                            splitter_is_final[run_id] = (
                                (e_node in _FINAL_RESPONSE_NODES and e_node != "agent") or is_top
                            )
                            splitter_agent_labels[run_id] = ns_root or e_node

                        agent_lbl = splitter_agent_labels[run_id]
                        for sc in splitters[run_id].feed(token_content):
                            if sc.channel == "reasoning":
                                if sc.event == "start":
                                    reasoning_start_times[run_id] = time.monotonic()
                                    reasoning_agents[run_id] = agent_lbl
                                    stream_manager.append_chunk(stream_id, {
                                        "index": chunk_index,
                                        "event_type": "reasoning_start",
                                        "data": {"agent": agent_lbl},
                                    })
                                    chunk_index += 1
                                elif sc.event == "end":
                                    start_ts = reasoning_start_times.pop(run_id, None)
                                    reasoning_agents.pop(run_id, None)
                                    duration_ms = int((time.monotonic() - start_ts) * 1000) if start_ts else 0
                                    step_content = "".join(reasoning_buffers[run_id])
                                    reasoning_buffers[run_id] = []
                                    reasoning_steps.append({
                                        "agent": agent_lbl,
                                        "step": "thought",
                                        "content": step_content,
                                        "duration_ms": duration_ms,
                                        "truncated": sc.truncated,
                                    })
                                    stream_manager.append_chunk(stream_id, {
                                        "index": chunk_index,
                                        "event_type": "reasoning_end",
                                        "data": {"agent": agent_lbl, "truncated": sc.truncated},
                                    })
                                    chunk_index += 1
                                elif sc.text:
                                    reasoning_buffers[run_id].append(sc.text)
                                    reasoning_token_count += 1
                                    stream_manager.append_chunk(stream_id, {
                                        "index": chunk_index,
                                        "event_type": "reasoning_token",
                                        "data": {"content": sc.text, "agent": agent_lbl},
                                    })
                                    chunk_index += 1
                            else:
                                if sc.text:
                                    if splitter_is_final[run_id]:
                                        content_tokens.append(sc.text)
                                        stream_manager.append_chunk(stream_id, {
                                            "index": chunk_index,
                                            "event_type": "token",
                                            "data": {"content": sc.text},
                                        })
                                        chunk_index += 1
                                    elif e_node not in _SKIP_TOKEN_NODES:
                                        # Accumulate for agents_completed tracking only;
                                        # reasoning trace replaces raw sub-agent token streaming.
                                        reasoning_tokens.setdefault(agent_lbl, []).append(sc.text)

                else:
                    # ── dispatch_decision from top-level agent on_chain_end ───
                    if (
                        e_kind == "on_chain_end"
                        and e_node == "agent"
                        and e_metadata.get("langgraph_checkpoint_ns", "") == ""
                    ):
                        output = event.get("data", {}).get("output", {})
                        if output.get("pending_tasks"):
                            if content_tokens:
                                logger.info(
                                    "Stream %s: discarding %d leaked agent-node token(s) "
                                    "ahead of a dispatch_to_subagents synthesis",
                                    stream_id, len(content_tokens),
                                )
                            content_tokens.clear()

                        for decision in (output.get("dispatch_decisions") or []):
                            reasoning_steps.append({
                                "agent": "agent",
                                "step": "dispatch_decision",
                                "target": decision.get("tool_name", ""),
                                "reason": decision.get("reason", ""),
                                "duration_ms": 0,
                                "truncated": False,
                            })
                            stream_manager.append_chunk(stream_id, {
                                "index": chunk_index,
                                "event_type": "dispatch_decision",
                                "data": {
                                    "target": decision.get("tool_name", ""),
                                    "reason": decision.get("reason", ""),
                                },
                            })
                            chunk_index += 1

                    # ── denied/skipped tool calls from tools_node on_chain_end ─
                    # on_tool_start/on_tool_end never fire for these (the tool
                    # itself never runs), so they're surfaced explicitly via the
                    # node's own output instead — see graph_builder.make_tools_node.
                    # Checked for every "tools" node regardless of nesting depth,
                    # so a sub-agent's own denials are captured identically to the
                    # parent agent's.
                    if e_kind == "on_chain_end" and e_node == "tools":
                        output = event.get("data", {}).get("output", {})
                        _tools_ns = e_metadata.get("langgraph_checkpoint_ns", "")
                        _tools_agent_lbl = _tool_agent_label(e_node, _tools_ns)
                        for denied in (output.get("denied_tool_calls") or []):
                            stream_manager.append_chunk(stream_id, {
                                "index": chunk_index,
                                "event_type": "tool_start",
                                "data": {"tool_name": denied.get("tool_name", ""), "agent_name": _tools_agent_lbl},
                            })
                            chunk_index += 1
                            stream_manager.append_chunk(stream_id, {
                                "index": chunk_index,
                                "event_type": "tool_end",
                                "data": {
                                    "tool_name": denied.get("tool_name", ""),
                                    "agent_name": _tools_agent_lbl,
                                    "output": denied.get("reason", ""),
                                },
                            })
                            chunk_index += 1
                            reasoning_steps.append({
                                "agent": _tools_agent_lbl,
                                "step": "tool_call",
                                "tool_name": denied.get("tool_name", ""),
                                "input": denied.get("input"),
                                "output": denied.get("reason", ""),
                                "duration_ms": 0,
                                "truncated": False,
                            })

                    # ── tool_call steps for DB storage ────────────────────────
                    if e_kind == "on_tool_start":
                        _run_id = event.get("run_id", "")
                        tool_start_times[_run_id] = time.monotonic()
                        raw_in = event.get("data", {}).get("input")
                        if raw_in is None:
                            tool_inputs[_run_id] = None
                        elif isinstance(raw_in, str):
                            tool_inputs[_run_id] = raw_in
                        else:
                            try:
                                tool_inputs[_run_id] = json.dumps(raw_in)
                            except Exception:
                                tool_inputs[_run_id] = str(raw_in)

                    elif e_kind == "on_tool_end":
                        _run_id = event.get("run_id", "")
                        _start_ts = tool_start_times.pop(_run_id, None)
                        _duration_ms = int((time.monotonic() - _start_ts) * 1000) if _start_ts else 0
                        _output_str = _extract_tool_output(event.get("data", {}).get("output"))
                        _ns = e_metadata.get("langgraph_checkpoint_ns", "")
                        _agent_lbl = _tool_agent_label(e_node, _ns)
                        reasoning_steps.append({
                            "agent": _agent_lbl,
                            "step": "tool_call",
                            "tool_name": event.get("name", ""),
                            "input": tool_inputs.pop(_run_id, None),
                            "output": _output_str,
                            "duration_ms": _duration_ms,
                            "truncated": False,
                        })

                    # ── token usage for this LLM call ─────────────────────────
                    # Fires once per actual model invocation regardless of which
                    # graph node made it (parent agent, any sub-agent, or the
                    # synthesizer) — usage_metadata is LangChain's own
                    # standardized field, populated identically across OpenAI/
                    # Anthropic/Gemini integrations, so no per-provider handling
                    # is needed here. The separate thread-title-generation call
                    # never appears in this stream at all (it's a plain
                    # .ainvoke() outside the graph), so it's excluded for free.
                    elif e_kind == "on_chat_model_end":
                        ai_message = event.get("data", {}).get("output")
                        usage = getattr(ai_message, "usage_metadata", None) if ai_message else None
                        if usage:
                            run_input_tokens += usage.get("input_tokens") or 0
                            run_output_tokens += usage.get("output_tokens") or 0
                            run_cache_read_tokens += (usage.get("input_token_details") or {}).get("cache_read") or 0

                    # ── standard events (agent_start/end, tool_start/end) ─────
                    for chunk in _process_event(event, chunk_index):
                        stream_manager.append_chunk(stream_id, chunk)
                        chunk_index += 1

                # Periodic crash-recovery flush every TOKEN_FLUSH_INTERVAL tokens.
                # All four components are monotonically increasing so the diff
                # never goes negative and the flush fires reliably every ~50 tokens.
                total_tokens = (
                    len(content_tokens)
                    + sum(len(v) for v in reasoning_tokens.values())
                    + len(reasoning_steps)
                    + reasoning_token_count
                )
                if total_tokens - last_flush_count >= TOKEN_FLUSH_INTERVAL:
                    # Include any in-progress (open) reasoning block as a partial step
                    # so reconnecting clients can see live reasoning before </reasoning> arrives.
                    steps_to_persist = reasoning_steps.copy()
                    for rid, buf in reasoning_buffers.items():
                        if buf:
                            steps_to_persist.append({
                                "agent": reasoning_agents.get(rid, ""),
                                "step": "thought",
                                "content": "".join(buf),
                                "partial": True,
                            })
                    await session.execute(
                        update(StreamRecord)
                        .where(StreamRecord.id == stream_id)
                        .values(
                            partial_content="".join(content_tokens) if content_tokens else None,
                            reasoning=json.dumps({"steps": steps_to_persist}) if steps_to_persist else None,
                            total_chunks=chunk_index,
                            input_tokens=run_input_tokens,
                            cache_read_tokens=run_cache_read_tokens,
                            output_tokens=run_output_tokens,
                            llm_source=llm_source_value,
                            llm_provider=llm_provider_value,
                            llm_model=llm_model_value,
                            updated_at=utcnow(),
                        )
                    )
                    # Best-effort heartbeat for the scheduler's stale-run sweep
                    # (utils/scheduler.py._reclaim_stale_runs) — a no-op for
                    # manual (non-scheduled) chat, since no ScheduleRun row
                    # references this stream_id in that case.
                    await session.execute(
                        update(ScheduleRun)
                        .where(ScheduleRun.stream_id == stream_id)
                        .values(heartbeat_at=utcnow())
                    )
                    await session.commit()
                    last_flush_count = total_tokens

            # Flush any splitters still open after the event stream ends. The
            # splitter always holds back up to _max_lookahead trailing chars in
            # case they're the start of a reasoning tag, so this final flush's
            # output must be emitted as SSE chunks too — not just accumulated
            # into content_tokens/reasoning_steps — or the last few characters
            # of the response never reach a live client before "done" fires.
            for run_id, splitter in splitters.items():
                agent_lbl = splitter_agent_labels.get(run_id, "unknown")
                for sc in splitter.flush(generation_ended_cleanly=True):
                    if sc.channel == "reasoning":
                        if sc.text:
                            reasoning_buffers.setdefault(run_id, []).append(sc.text)
                            reasoning_token_count += 1
                            stream_manager.append_chunk(stream_id, {
                                "index": chunk_index,
                                "event_type": "reasoning_token",
                                "data": {"content": sc.text, "agent": agent_lbl},
                            })
                            chunk_index += 1
                        if sc.event == "end":
                            start_ts = reasoning_start_times.pop(run_id, None)
                            duration_ms = int((time.monotonic() - start_ts) * 1000) if start_ts else 0
                            step_content = "".join(reasoning_buffers.get(run_id, []))
                            reasoning_steps.append({
                                "agent": agent_lbl,
                                "step": "thought",
                                "content": step_content,
                                "duration_ms": duration_ms,
                                "truncated": sc.truncated,
                            })
                            stream_manager.append_chunk(stream_id, {
                                "index": chunk_index,
                                "event_type": "reasoning_end",
                                "data": {"agent": agent_lbl, "truncated": sc.truncated},
                            })
                            chunk_index += 1
                    elif sc.text and splitter_is_final.get(run_id, False):
                        content_tokens.append(sc.text)
                        stream_manager.append_chunk(stream_id, {
                            "index": chunk_index,
                            "event_type": "token",
                            "data": {"content": sc.text},
                        })
                        chunk_index += 1

            # ── Paused for tool approval? ──────────────────────────────────
            # A gated tool call raised interrupt() inside the graph — astream_events
            # simply stops yielding at that point rather than raising, so this is
            # detected after the loop by checking the checkpoint for pending
            # interrupts, not via an exception.
            state_snapshot = await graph.aget_state(thread_config)
            if state_snapshot.interrupts:
                approval_payload = {
                    "interrupts": [
                        {"interrupt_id": i.id, **i.value} for i in state_snapshot.interrupts
                    ]
                }
                stream_manager.append_chunk(stream_id, {
                    "index": chunk_index,
                    "event_type": "tool_approval_required",
                    "data": approval_payload,
                })
                chunk_index += 1
                await session.execute(
                    update(StreamRecord)
                    .where(StreamRecord.id == stream_id)
                    .values(
                        status=STREAM_STATUS_AWAITING_APPROVAL,
                        partial_content="".join(content_tokens) if content_tokens else None,
                        reasoning=json.dumps({"steps": reasoning_steps}) if reasoning_steps else None,
                        total_chunks=chunk_index,
                        input_tokens=run_input_tokens,
                        cache_read_tokens=run_cache_read_tokens,
                        output_tokens=run_output_tokens,
                        llm_source=llm_source_value,
                        llm_provider=llm_provider_value,
                        llm_model=llm_model_value,
                        updated_at=utcnow(),
                    )
                )
                await session.commit()
                stream_manager.signal_done(stream_id)
                paused_for_approval = True
                logger.info("Stream %s paused for tool approval (%d chunks)", stream_id, chunk_index)
                return

            full_content = "".join(content_tokens)
            if not full_content:
                raise ValueError("Agent returned no response")

            assistant_msg = Message(thread_id=thread_id, role="assistant", content=full_content)
            session.add(assistant_msg)
            await session.flush()

            # ── Auto-generate thread title on first completed exchange ────────
            # Only triggered when the thread has no title yet; best-effort (any
            # LLM failure is swallowed so the stream still completes normally).
            generated_title: str | None = None
            title_check = await session.execute(
                select(Thread.title).where(Thread.id == thread_id)
            )
            if title_check.scalar_one_or_none() is None:
                opening_message = await session.execute(
                    select(Message.content)
                    .where(Message.thread_id == thread_id, Message.role == "user")
                    .order_by(Message.created_at.asc())
                    .limit(1)
                )
                title_source = opening_message.scalar_one_or_none() or user_message
                generated_title = await _generate_thread_title(title_source)
                if generated_title:
                    await session.execute(
                        update(Thread)
                        .where(Thread.id == thread_id)
                        .values(title=generated_title)
                    )

            # thread_title must be emitted BEFORE done — SSE consumers stop on done
            if generated_title:
                stream_manager.append_chunk(stream_id, {
                    "index": chunk_index,
                    "event_type": "thread_title",
                    "data": {"title": generated_title},
                })
                chunk_index += 1

            done_chunk = {
                "index": chunk_index,
                "event_type": "done",
                "data": {"message_id": assistant_msg.id, "total_chunks": chunk_index},
            }
            stream_manager.append_chunk(stream_id, done_chunk)

            cost_usd = _compute_cost_usd(
                llm_provider_value, llm_model_value, run_input_tokens, run_cache_read_tokens, run_output_tokens,
            )
            await session.execute(
                update(StreamRecord)
                .where(StreamRecord.id == stream_id)
                .values(
                    status=STREAM_STATUS_COMPLETED,
                    assistant_message_id=assistant_msg.id,
                    partial_content=None,
                    reasoning=json.dumps({"steps": reasoning_steps}) if reasoning_steps else None,
                    total_chunks=chunk_index,
                    input_tokens=run_input_tokens,
                    cache_read_tokens=run_cache_read_tokens,
                    output_tokens=run_output_tokens,
                    cost_usd=cost_usd,
                    llm_source=llm_source_value,
                    llm_provider=llm_provider_value,
                    llm_model=llm_model_value,
                    completed_at=utcnow(),
                    updated_at=utcnow(),
                )
            )
            await session.commit()  # title update + StreamRecord COMPLETED in one transaction
            stream_manager.signal_done(stream_id)
            logger.info("Stream %s completed (%d chunks)", stream_id, chunk_index)

        except asyncio.CancelledError:
            logger.info("Stream %s cancelled", stream_id)
            try:
                await session.rollback()
                # Flush open splitters to close any pending reasoning blocks
                for run_id, splitter in splitters.items():
                    agent_lbl = splitter_agent_labels.get(run_id, "unknown")
                    for sc in splitter.flush(generation_ended_cleanly=False):
                        if sc.channel == "reasoning":
                            if sc.text:
                                reasoning_buffers.setdefault(run_id, []).append(sc.text)
                            if sc.event == "end":
                                start_ts = reasoning_start_times.pop(run_id, None)
                                duration_ms = int((time.monotonic() - start_ts) * 1000) if start_ts else 0
                                step_content = "".join(reasoning_buffers.get(run_id, []))
                                reasoning_steps.append({
                                    "agent": agent_lbl,
                                    "step": "thought",
                                    "content": step_content,
                                    "duration_ms": duration_ms,
                                    "truncated": True,
                                })
                partial_text = "".join(content_tokens)
                stream_values: dict = {"status": STREAM_STATUS_CANCELLED, "updated_at": utcnow()}

                if partial_text or reasoning_steps:
                    # Create an assistant message so get_messages can attach reasoning.
                    # content may be empty string when cancelled before synthesizer started.
                    partial_msg = Message(
                        thread_id=thread_id,
                        role="assistant",
                        content=partial_text,
                        is_partial=True,
                    )
                    session.add(partial_msg)
                    await session.flush()
                    stream_values["assistant_message_id"] = partial_msg.id
                    stream_values["partial_content"] = None

                if reasoning_steps:
                    stream_values["reasoning"] = json.dumps({"steps": reasoning_steps})

                # A cancelled run still consumed real tokens up to the point of
                # cancellation — record and cost them, don't discard.
                stream_values["input_tokens"] = run_input_tokens
                stream_values["cache_read_tokens"] = run_cache_read_tokens
                stream_values["output_tokens"] = run_output_tokens
                stream_values["llm_source"] = llm_source_value
                stream_values["llm_provider"] = llm_provider_value
                stream_values["llm_model"] = llm_model_value
                stream_values["cost_usd"] = _compute_cost_usd(
                    llm_provider_value, llm_model_value, run_input_tokens, run_cache_read_tokens, run_output_tokens,
                )

                await session.execute(
                    update(StreamRecord)
                    .where(StreamRecord.id == stream_id)
                    .values(**stream_values)
                )
                await session.commit()

                # Remove only the partial checkpoints written during this cancelled
                # turn. All prior turns' checkpoints are preserved so the next
                # message resumes with full conversation context.
                from database.checkpointer import delete_checkpoints_after
                await delete_checkpoints_after(thread_id, last_good_checkpoint_id)
            except Exception:
                pass
            stream_manager.append_chunk(stream_id, {
                "index": chunk_index, "event_type": "error",
                "data": {"message": "Stream cancelled", "code": "cancelled"},
            })
            stream_manager.signal_done(stream_id)
            raise

        except (Exception, BaseExceptionGroup) as exc:
            real_exc = exc
            while isinstance(real_exc, BaseExceptionGroup) and real_exc.exceptions:
                real_exc = real_exc.exceptions[0]

            # asyncio.TimeoutError / TimeoutError both have an empty __str__ on Python 3.11+;
            # use a meaningful message instead of repr() to avoid confusing users.
            if isinstance(real_exc, (asyncio.TimeoutError, TimeoutError)):
                error_msg = f"Sub-agent timed out (exceeded {SUB_AGENT_TIMEOUT_SECONDS}s)"
                error_code = "sub_agent_timeout"
            else:
                classified_code, classified_msg = classify_llm_error(real_exc)
                if classified_code:
                    error_msg = classified_msg
                    error_code = classified_code
                else:
                    error_msg = repr(real_exc) if not str(real_exc) else str(real_exc)
                    error_code = "generation_failed"
            logger.exception("Stream %s failed: %s", stream_id, exc)
            try:
                await session.rollback()
                # A failed run still consumed real tokens up to the point of
                # failure (e.g. the model answered but content assembly or
                # title generation errored afterward) — record and cost them.
                await session.execute(
                    update(StreamRecord)
                    .where(StreamRecord.id == stream_id)
                    .values(
                        status=STREAM_STATUS_FAILED,
                        error_message=error_msg,
                        input_tokens=run_input_tokens,
                        cache_read_tokens=run_cache_read_tokens,
                        output_tokens=run_output_tokens,
                        llm_source=llm_source_value,
                        llm_provider=llm_provider_value,
                        llm_model=llm_model_value,
                        cost_usd=_compute_cost_usd(
                            llm_provider_value, llm_model_value,
                            run_input_tokens, run_cache_read_tokens, run_output_tokens,
                        ),
                        updated_at=utcnow(),
                    )
                )
                await session.commit()
            except Exception:
                pass
            stream_manager.append_chunk(stream_id, {
                "index": chunk_index, "event_type": "error",
                "data": {"message": error_msg, "code": error_code},
            })
            stream_manager.signal_done(stream_id)

        finally:
            # Keep in-memory buffer alive for 5 minutes so reconnecting clients
            # can replay; then clean up all state for this stream. Skipped when
            # pausing for tool approval — that's not a terminal state, and the
            # wait for a decision can easily exceed 5 minutes; wiping the live
            # buffer/queue/task registration while a resumed run is (or will
            # soon be) using the same stream_id would tear down live state out
            # from under a connected client. schedule_cleanup_task also
            # self-cancels any stale timer from a prior run of this stream_id.
            if not paused_for_approval:
                stream_manager.schedule_cleanup_task(stream_id, delay=STREAM_CLEANUP_DELAY_SECONDS)


class ChatService:

    async def send_message(
        self,
        session: AsyncSession,
        thread_id: str,
        user_id: str,
        user_message: str,
        is_interactive: bool = True,
    ) -> StreamStartResponse:
        """Validate, persist user message, create StreamRecord, start generation.

        Returns immediately (202) with a stream_id. The client connects to
        GET /threads/{thread_id}/stream/{stream_id} to receive tokens via SSE.

        Args:
            session: Active async database session.
            thread_id: The thread to send the message to.
            user_id: The authenticated user's ID.
            user_message: The raw user message text.
            is_interactive: False for unattended runs (e.g. scheduled triggers)
                — a gated tool call auto-denies instead of pausing for an
                approval nobody is present to give. True for normal chat.

        Returns:
            StreamStartResponse with message_id, stream_id, and status="PENDING".

        Raises:
            ValueError: If the thread or agent is not found, or a stream is already active.
        """
        thread_result = await session.execute(
            select(Thread).where(
                Thread.id == thread_id,
                Thread.user_id == user_id,
                Thread.is_active == True,
            )
        )
        thread = thread_result.scalar_one_or_none()
        if not thread:
            raise ValueError("Thread not found")

        agent_result = await session.execute(
            select(Agent).where(Agent.id == thread.agent_id, Agent.is_active == True)
        )
        if not agent_result.scalar_one_or_none():
            raise ValueError("Agent not found")

        # Block concurrent messages — one active stream per thread at a time
        active = await session.execute(
            select(StreamRecord).where(
                StreamRecord.thread_id == thread_id,
                StreamRecord.status.in_([
                    STREAM_STATUS_PENDING, STREAM_STATUS_RUNNING, STREAM_STATUS_AWAITING_APPROVAL,
                ]),
            )
        )
        if active.scalar_one_or_none():
            raise ValueError(
                "A generation is already in progress for this thread "
                "(it may be waiting on a tool approval decision)"
            )

        user_result = await session.execute(
            select(User.thinking_enabled).where(User.id == user_id, User.is_active == True)
        )
        enable_thinking = user_result.scalar_one_or_none()
        if enable_thinking is None:
            enable_thinking = True

        user_msg = Message(thread_id=thread_id, role="user", content=user_message)
        session.add(user_msg)
        await session.flush()

        stream_record = StreamRecord(
            thread_id=thread_id,
            user_message_id=user_msg.id,
            status=STREAM_STATUS_PENDING,
        )
        session.add(stream_record)
        await session.commit()

        task = asyncio.create_task(
            _run_generation(
                stream_id=stream_record.id,
                thread_id=thread_id,
                agent_id=thread.agent_id,
                user_message=user_message,
                enable_thinking=enable_thinking,
                is_interactive=is_interactive,
            )
        )
        stream_manager.register_task(stream_record.id, task)

        return StreamStartResponse(
            message_id=user_msg.id,
            stream_id=stream_record.id,
            status=STREAM_STATUS_PENDING,
        )

    async def resolve_tool_approvals(
        self,
        session: AsyncSession,
        stream_id: str,
        user_id: str,
        request: ToolApprovalRequest,
    ) -> StreamStartResponse:
        """Resolve a paused generation's pending tool-approval interrupt(s) and resume it.

        Reads the actual pending interrupt values from the graph's checkpoint
        rather than trusting the client's tool_call_id/tool_name pairing, so a
        forged or stale request can't approve a call that isn't really pending.
        "Always Allow" flips MCPTool.permission_state to 'allowed' — a global
        change, since permission is per-tool, not per-agent — and invalidates
        the compiled-graph cache for every agent (and sub-agent's parent) that
        uses this tool, not just the one that triggered the prompt.

        Args:
            session: Active async database session.
            stream_id: The StreamRecord.id currently AWAITING_APPROVAL.
            user_id: The authenticated user's ID.
            request: Per-interrupt decision groups from the approval UI.

        Returns:
            StreamStartResponse for the resumed generation (same stream_id).

        Raises:
            ValueError: If the stream/thread isn't found, isn't awaiting
                approval, or references an interrupt that is no longer pending.
        """
        # Atomically claim this stream before doing anything else: WHERE
        # status=AWAITING_APPROVAL matches at most once, so a concurrent
        # duplicate submission (double-click, retry) can't also proceed and
        # race a second Command(resume=...) against the same thread.
        claim = await session.execute(
            update(StreamRecord)
            .where(StreamRecord.id == stream_id, StreamRecord.status == STREAM_STATUS_AWAITING_APPROVAL)
            .values(status=STREAM_STATUS_RUNNING, updated_at=utcnow())
        )
        if claim.rowcount == 0:
            await session.rollback()
            raise ValueError("This stream has no pending tool approval")
        await session.commit()

        try:
            stream_record, thread, interrupts = await _load_pending_interrupts(session, stream_id, user_id)
            pending_by_id = {i.id: i.value for i in interrupts}
            if not pending_by_id:
                raise ValueError("No pending tool approval — it may have already been resolved")

            resume_map: dict[str, dict[str, str]] = {}
            always_allow_tool_ids: set[str] = set()

            for group in request.approvals:
                interrupt_value = pending_by_id.get(group.interrupt_id)
                if interrupt_value is None:
                    raise ValueError(f"Interrupt '{group.interrupt_id}' is not pending")

                gated_calls = {tc["tool_call_id"]: tc["tool_id"] for tc in interrupt_value["tool_calls"]}
                decision_by_call_id = {d.tool_call_id: d.decision for d in group.decisions}

                resolved: dict[str, str] = {}
                for tool_call_id, tool_id in gated_calls.items():
                    decision = decision_by_call_id.get(tool_call_id, "deny")
                    resolved[tool_call_id] = "deny" if decision == "deny" else "allow"
                    if decision == "always_allow" and tool_id:
                        always_allow_tool_ids.add(tool_id)
                resume_map[group.interrupt_id] = resolved

            if always_allow_tool_ids:
                from utils.mcp_client import set_tool_permission_in_registry

                await session.execute(
                    update(MCPTool)
                    .where(MCPTool.id.in_(always_allow_tool_ids))
                    .values(permission_state="allowed", updated_at=utcnow())
                )
                await session.commit()

                affected_agent_ids: set[str] = set()
                for tool_id in always_allow_tool_ids:
                    affected_agent_ids.update(set_tool_permission_in_registry(tool_id, "allowed"))

                if affected_agent_ids:
                    parent_result = await session.execute(
                        select(Agent.id, Agent.parent_id).where(Agent.id.in_(affected_agent_ids))
                    )
                    for aid, parent_id in parent_result.all():
                        invalidate_graph_cache(parent_id or aid)
            else:
                await session.commit()
        except Exception:
            # Nothing has resumed the graph yet at this point (that only
            # happens inside the _run_generation task created below) — safe
            # to hand the stream back to AWAITING_APPROVAL so the user (or a
            # corrected retry) can still resolve it, rather than stranding it
            # in RUNNING with nothing actually running.
            await session.rollback()
            await session.execute(
                update(StreamRecord)
                .where(StreamRecord.id == stream_id)
                .values(status=STREAM_STATUS_AWAITING_APPROVAL, updated_at=utcnow())
            )
            await session.commit()
            raise

        task = asyncio.create_task(
            _run_generation(
                stream_id=stream_record.id,
                thread_id=thread.id,
                agent_id=thread.agent_id,
                user_message="",
                resume_map=resume_map,
                starting_chunk_index=stream_record.total_chunks,
            )
        )
        stream_manager.register_task(stream_record.id, task)

        return StreamStartResponse(
            message_id=stream_record.user_message_id,
            stream_id=stream_record.id,
            status=STREAM_STATUS_PENDING,
        )

    async def get_pending_approval(
        self, session: AsyncSession, stream_id: str, user_id: str
    ) -> dict | None:
        """Fetch the current pending tool-approval payload straight from the
        graph's checkpoint — durable, independent of the ephemeral in-memory
        SSE buffer that originally carried the tool_approval_required event.

        Used to recover the payload when a client reconnects after that
        buffer has been cleaned up (or the server restarted) while a decision
        is still outstanding — the checkpoint itself never expires.

        Args:
            session: Active async database session.
            stream_id: The stream to check.
            user_id: The authenticated user's ID (ownership check via thread).

        Returns:
            {"interrupts": [...]} in the same shape as the SSE event's data,
            or None if the stream isn't AWAITING_APPROVAL, isn't found/owned,
            or has no pending interrupts (already resolved).
        """
        status_result = await session.execute(
            select(StreamRecord.status).where(StreamRecord.id == stream_id)
        )
        if status_result.scalar_one_or_none() != STREAM_STATUS_AWAITING_APPROVAL:
            return None
        try:
            _, _, interrupts = await _load_pending_interrupts(session, stream_id, user_id)
        except ValueError:
            return None
        if not interrupts:
            return None
        return {"interrupts": [{"interrupt_id": i.id, **i.value} for i in interrupts]}

    async def deny_all_pending_approvals(
        self, session: AsyncSession, stream_id: str, user_id: str
    ) -> StreamStartResponse:
        """Used by DELETE /streams/{stream_id} when a stream is AWAITING_APPROVAL.

        Denies every pending gated tool call so the underlying LangGraph
        interrupt resolves cleanly, then lets the agent's natural follow-up
        run in the background — reuses resolve_tool_approvals rather than
        duplicating its atomic-claim/resume logic.

        Leaving the interrupt dangling instead (e.g. just marking the
        StreamRecord CANCELLED without resolving it) was verified empirically
        to break the thread going forward: a fresh message sent afterward on
        the same thread doesn't get processed — the graph silently replays
        the stale pending tool call instead of seeing the new message.

        This intentionally does not force-abort the follow-up generation the
        way cancelling a live RUNNING stream does — safely racing a resume
        against an immediate cancel isn't possible without risking that same
        dangling-interrupt bug, so "cancel" here means "stop waiting for my
        decision," not "abort everything immediately." The resulting
        follow-up generation can still be cancelled normally once it's
        RUNNING, the same as any other message.

        Args:
            session: Active async database session.
            stream_id: The stream currently AWAITING_APPROVAL.
            user_id: The authenticated user's ID.

        Returns:
            StreamStartResponse for the resumed (denial) generation.

        Raises:
            ValueError: If the stream has no pending tool approval.
        """
        _, _, interrupts = await _load_pending_interrupts(session, stream_id, user_id)
        if not interrupts:
            raise ValueError("This stream has no pending tool approval")
        deny_all = ToolApprovalRequest(
            approvals=[ToolApprovalGroup(interrupt_id=i.id, decisions=[]) for i in interrupts]
        )
        return await self.resolve_tool_approvals(session, stream_id, user_id, deny_all)

    async def get_messages(
        self, session: AsyncSession, thread_id: str, user_id: str
    ) -> list[dict]:
        """Return all messages in a thread ordered by creation time.

        Assistant messages include the reasoning dict from the associated
        StreamRecord so the UI can show query → reasoning → final response
        in one API call.
        """
        thread_result = await session.execute(
            select(Thread).where(
                Thread.id == thread_id,
                Thread.user_id == user_id,
                Thread.is_active == True,
            )
        )
        if not thread_result.scalar_one_or_none():
            raise ValueError("Thread not found")

        msg_result = await session.execute(
            select(Message)
            .where(Message.thread_id == thread_id)
            .order_by(Message.created_at.asc())
        )
        messages = msg_result.scalars().all()

        # Build a map of assistant_message_id → reasoning for all stream records
        # in this thread that have reasoning stored.
        stream_result = await session.execute(
            select(StreamRecord.assistant_message_id, StreamRecord.reasoning)
            .where(
                StreamRecord.thread_id == thread_id,
                StreamRecord.reasoning.isnot(None),
            )
        )
        reasoning_map: dict[str, dict] = {}
        for msg_id, raw in stream_result:
            if msg_id:
                from utils.reasoning_splitter import normalize_reasoning
                reasoning_map[msg_id] = normalize_reasoning(raw)

        result = []
        for msg in messages:
            entry = {
                "id": msg.id,
                "thread_id": msg.thread_id,
                "role": msg.role,
                "content": msg.content,
                "is_partial": msg.is_partial,
                "reasoning": reasoning_map.get(msg.id) if msg.role == "assistant" else None,
                "created_at": msg.created_at,
            }
            result.append(entry)

        return result
