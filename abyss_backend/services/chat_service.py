import asyncio
from uuid import UUID, uuid4
import json
import logging
import os
from dataclasses import dataclass

from langchain_core.language_models import BaseChatModel
from langgraph.types import Command
from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from config import config
from constants import (
    LLM_SOURCE_BYOK,
    LLM_SOURCE_DEFAULT,
    MAX_AGENT_ITERATIONS,
    REASONING_MODE_NATIVE,
    REASONING_MODE_PROMPT,
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
    StreamRecord, Thread, User, utcnow,
)
from schemas.stream import StreamStartResponse, ToolApprovalDecision, ToolApprovalGroup, ToolApprovalRequest
from services.trace_sync import KIND_AGENT_TURN, KIND_THREAD_TITLE, RUN_NAMES, sync_after_run
from utils.platform_llm import build_platform_llm, configured_default
from utils.pricing import compute_cost_usd
from utils.encryption import decrypt_value
from abyss_agents.factory import build_agent
from services.stream_projector import StreamProjector
from utils.llm_providers import PROVIDERS, classify_llm_error
from utils.thread_title import TITLE_SYSTEM_PROMPT, clean_title, fallback_title, title_request
import utils.stream_manager as stream_manager

logger = logging.getLogger(__name__)

_langsmith_cfg = config.get("LANGSMITH", {})


# Initialize LangSmith tracing if configured
if _langsmith_cfg.get("tracing_enabled", False):
    os.environ["LANGCHAIN_TRACING_V2"] = "true"
    if _langsmith_cfg.get("api_key"):
        os.environ["LANGCHAIN_API_KEY"] = _langsmith_cfg["api_key"]
    if _langsmith_cfg.get("project"):
        os.environ["LANGCHAIN_PROJECT"] = _langsmith_cfg["project"]


_title_llm: BaseChatModel | None = None


def _get_llm() -> BaseChatModel:
    """The platform default model (see utils/platform_llm.py), shared for
    short utility calls such as thread titles."""
    global _title_llm
    if _title_llm is None:
        _title_llm = build_platform_llm(*configured_default())
    return _title_llm


@dataclass(frozen=True)
class LlmResolution:
    llm: BaseChatModel
    provider: str
    model: str
    llm_source: str  # LLM_SOURCE_DEFAULT | LLM_SOURCE_BYOK — see constants.py
    # True when the provider's own reasoning output is enabled (the prompt-based
    # <reasoning> protocol is then not used for this run).
    native_reasoning: bool = False


async def resolve_llm_for_agent(
    session: AsyncSession, agent_record: Agent, enable_thinking: bool = True
) -> LlmResolution:
    """Build the LLM this agent should use for the current turn.

    agent_record.llm_model_id NULL means "Default": whichever provider_models
    row is flagged is_platform_default, on the platform's own key for that
    provider (utils/platform_llm.py), fully isolated from whatever credential the
    user may have added for a different, explicitly-configured agent. Any
    other (explicit) selection requires the owning user to have a valid
    LlmCredential for that model's provider; there is no platform fallback
    for non-default selections.

    Returns provider/model/llm_source alongside the built LLM — callers that
    need to attribute token usage/cost (see _run_generation) would otherwise
    have to re-run this exact resolution a second time.

    A model flagged reasoning_mode='native' gets the provider's own reasoning
    output enabled when the user's thinking toggle is on; otherwise (and for
    every 'prompt' model) it is built plain.
    """
    if agent_record.llm_model_id is None:
        result = await session.execute(
            select(Provider.name, ProviderModel.model_name, ProviderModel.reasoning_mode)
            .join(ProviderModel, ProviderModel.provider_id == Provider.id)
            .where(ProviderModel.is_platform_default == True, ProviderModel.is_active == True)
        )
        row = result.first()
        provider, model, mode = row if row else (*configured_default(), REASONING_MODE_PROMPT)
        native = enable_thinking and mode == REASONING_MODE_NATIVE
        llm = build_platform_llm(provider, model, native)
        return LlmResolution(
            llm=llm, provider=provider, model=model, llm_source=LLM_SOURCE_DEFAULT, native_reasoning=native,
        )

    result = await session.execute(
        select(Provider.id, Provider.name, ProviderModel.model_name, ProviderModel.reasoning_mode)
        .join(ProviderModel, ProviderModel.provider_id == Provider.id)
        .where(ProviderModel.id == agent_record.llm_model_id, ProviderModel.is_active == True)
    )
    row = result.first()
    if not row:
        raise ValueError("This agent's selected model is no longer available — please choose another.")
    provider_id, provider, model, mode = row
    native = enable_thinking and mode == REASONING_MODE_NATIVE

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
    llm = PROVIDERS[provider].build(model, api_key, native)
    return LlmResolution(
        llm=llm, provider=provider, model=model, llm_source=LLM_SOURCE_BYOK, native_reasoning=native,
    )


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
    built = await build_agent(session, agent_record, llm_resolution.llm, checkpointer)
    thread_config = {"configurable": {"thread_id": thread.id}}
    state_snapshot = await built.graph.aget_state(thread_config)
    return stream_record, thread, list(state_snapshot.interrupts)


def _compute_cost_usd(
    provider: str | None, model: str | None,
    input_tokens: int, cache_read_tokens: int, output_tokens: int,
) -> float | None:
    """A run's cost from the bundled price table (utils/pricing.py); None when
    it can't be determined. Tokens are recorded either way."""
    cost = compute_cost_usd(provider, model, input_tokens, cache_read_tokens, output_tokens)
    if cost is None and provider and model and (input_tokens or output_tokens):
        logger.warning("No price listed for %s/%s; cost left empty", provider, model)
    return cost


async def _generate_thread_title(
    user_message: str, trace_meta: dict | None = None, trace_ids: list[str] | None = None
) -> str | None:
    """A short, specific thread title for the opening message.

    The candidate is validated (see utils.thread_title): a reply or refusal is
    retried once, then replaced by a title from the message's key words. Only
    an LLM failure returns None, so the caller continues without a title.
    """
    try:
        for retry in (False, True):
            run_id = uuid4()
            if trace_ids is not None:
                trace_ids.append(str(run_id))
            response = await _get_llm().ainvoke([
                {"role": "system", "content": TITLE_SYSTEM_PROMPT},
                {
                    "role": "user",
                    "content": title_request(
                        user_message, retry=retry, max_chars=THREAD_TITLE_INPUT_MAX_CHARS
                    ),
                },
            ], config=_trace_config(run_id, KIND_THREAD_TITLE, trace_meta))
            title = clean_title(getattr(response, "text", None) or str(response.content))
            if title:
                return title[:THREAD_TITLE_OUTPUT_MAX_CHARS]
        return fallback_title(user_message)[:THREAD_TITLE_OUTPUT_MAX_CHARS]
    except Exception as exc:
        logger.warning("Thread title generation failed: %s", exc)
        return None


def _approval_payload(interrupts) -> dict:
    """SSE / status payload for pending approvals, in HumanInTheLoopMiddleware's native shape.

    Each interrupt value is {"action_requests": [{name, args, description}, ...],
    "review_configs": [{action_name, allowed_decisions}, ...]}. A decision for
    action_requests[i] goes at decisions[i] when resuming.
    """
    return {"interrupts": [{"interrupt_id": i.id, **i.value} for i in interrupts]}



# Background trace syncs, kept referenced until done (asyncio holds only weak
# references to tasks).
_trace_tasks: set[asyncio.Task] = set()


def _trace_config(run_id: UUID, kind: str, meta: dict | None) -> dict:
    """LangSmith run settings for one traced call: a pre-assigned run id (so
    the trace can be fetched exactly) and the metadata Tracing filters on."""
    return {
        "run_id": run_id,
        "run_name": RUN_NAMES[kind],
        "tags": ["abyss", kind],
        "metadata": {**(meta or {}), "abyss_kind": kind},
    }


def _schedule_trace_sync(trace_ids: list[str], user_id: str | None) -> None:
    if not trace_ids or not user_id:
        return
    task = asyncio.create_task(sync_after_run(list(trace_ids), user_id))
    _trace_tasks.add(task)
    task.add_done_callback(_trace_tasks.discard)


async def _run_generation(
    stream_id: str,
    thread_id: str,
    agent_id: str,
    user_message: str,
    enable_thinking: bool = True,
    resume_map: dict[str, dict] | None = None,
    starting_chunk_index: int = 0,
) -> None:
    """Background coroutine that drives LangGraph execution and streams chunks.

    Runs independently of any HTTP request. Creates its own DB session.
    Handles CancelledError (user cancel), ValueError (logic errors), and
    generic exceptions, always marking the StreamRecord terminal and signalling
    all waiting SSE clients before exiting.

    resume_map: when set, this call continues a previously-paused generation
    (see the tool_approval_required handling below) instead of starting a new
    turn — user_message is ignored in that case. Keyed by Interrupt.id, each
    value is a HumanInTheLoopMiddleware response ({"decisions": [...]}), so
    multiple simultaneous interrupts (e.g. parallel sub-agents each gated on a
    different tool) can be resumed in one call.
    """
    from database.session import async_session_maker

    async with async_session_maker() as session:
        # Set just before the tool-approval pause return below. Checked in the
        # `finally` block so pausing (not terminal) skips scheduling the
        # completion-oriented in-memory cleanup timer — see stream_manager
        # .schedule_cleanup_task's docstring for why that timer is unsafe here.
        paused_for_approval = False
        # Projects LangGraph events into SSE chunks and accumulates what is
        # persisted (answer text, reasoning steps, token usage). Seeded from the
        # StreamRecord below when resuming a paused run.
        projector = StreamProjector(
            lambda chunk: stream_manager.append_chunk(stream_id, chunk),
            starting_chunk_index=starting_chunk_index,
        )
        last_flush_count = 0  # projector.total_tokens at the last periodic flush
        # LangSmith traces this invocation produces (agent turn, title), synced
        # into Tracing when it ends -- whatever the outcome.
        trace_ids: list[str] = []
        trace_meta: dict | None = None
        llm_provider_value: str | None = None  # set once resolved below; visible in except blocks too
        llm_model_value: str | None = None
        llm_source_value: str | None = None

        def usage_values() -> dict:
            return dict(
                input_tokens=projector.input_tokens,
                cache_read_tokens=projector.cache_read_tokens,
                output_tokens=projector.output_tokens,
                llm_source=llm_source_value,
                llm_provider=llm_provider_value,
                llm_model=llm_model_value,
            )

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
                # before the pause has to be seeded back in here or it's lost.
                prior_result = await session.execute(
                    select(
                        StreamRecord.partial_content, StreamRecord.reasoning,
                        StreamRecord.input_tokens, StreamRecord.cache_read_tokens, StreamRecord.output_tokens,
                    )
                    .where(StreamRecord.id == stream_id)
                )
                prior_partial, prior_reasoning_json, prior_input, prior_cache_read, prior_output = prior_result.first()
                if prior_partial:
                    projector.content_tokens.append(prior_partial)
                if prior_reasoning_json:
                    try:
                        projector.reasoning_steps = json.loads(prior_reasoning_json).get("steps", [])
                    except Exception:
                        logger.warning("Stream %s: failed to parse prior reasoning JSON on resume", stream_id)
                # Token usage is a true accumulator across the pause boundary too.
                projector.input_tokens = prior_input or 0
                projector.cache_read_tokens = prior_cache_read or 0
                projector.output_tokens = prior_output or 0

            agent_result = await session.execute(
                select(Agent).where(Agent.id == agent_id, Agent.is_active == True)
            )
            agent_record = agent_result.scalar_one_or_none()
            if not agent_record:
                raise ValueError("Agent not found or was deleted")
            trace_meta = {
                "user_id": agent_record.user_id,
                "thread_id": thread_id,
                "agent_id": agent_id,
                "agent_name": agent_record.name,
                "stream_id": stream_id,
            }

            llm_resolution = await resolve_llm_for_agent(session, agent_record, enable_thinking)
            # Unlike tokens/reasoning, provider/model/source don't need
            # resume-seeding — agent_record.llm_model_id can't change mid-run,
            # so every invocation (initial or resumed) re-derives the identical
            # value independently; nothing to carry across the pause boundary.
            llm_provider_value = llm_resolution.provider
            llm_model_value = llm_resolution.model
            llm_source_value = llm_resolution.llm_source
            checkpointer = get_checkpointer()
            built = await build_agent(
                session, agent_record, llm_resolution.llm, checkpointer,
                enable_thinking=enable_thinking, native_reasoning=llm_resolution.native_reasoning,
            )
            graph = built.graph
            projector.sub_agent_names = built.sub_agent_names

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
                else {"messages": [{"role": "user", "content": user_message}]}
            )
            # Each ReAct iteration is two graph steps (model + tools); the
            # ModelCallLimitMiddleware is the real cap, this is a backstop.
            turn_run_id = uuid4()
            trace_ids.append(str(turn_run_id))
            run_config = {
                "configurable": {"thread_id": thread_id},
                "recursion_limit": MAX_AGENT_ITERATIONS * 2 + 10,
                **_trace_config(turn_run_id, KIND_AGENT_TURN, trace_meta),
            }

            async for event in graph.astream_events(graph_input, run_config, version="v2"):
                projector.handle(event)

                # Periodic crash-recovery flush every TOKEN_FLUSH_INTERVAL tokens.
                # total_tokens is monotonically increasing so the diff never goes
                # negative and the flush fires reliably every ~50 tokens.
                if projector.total_tokens - last_flush_count >= TOKEN_FLUSH_INTERVAL:
                    steps_to_persist = projector.steps_for_flush()
                    await session.execute(
                        update(StreamRecord)
                        .where(StreamRecord.id == stream_id)
                        .values(
                            partial_content="".join(projector.content_tokens) if projector.content_tokens else None,
                            reasoning=json.dumps({"steps": steps_to_persist}) if steps_to_persist else None,
                            total_chunks=projector.chunk_index,
                            updated_at=utcnow(),
                            **usage_values(),
                        )
                    )
                    await session.commit()
                    last_flush_count = projector.total_tokens

            # The splitter always holds back up to _max_lookahead trailing chars
            # in case they're the start of a reasoning tag, so this final flush's
            # output must be emitted as SSE chunks too, or the last few
            # characters never reach a live client before "done" fires.
            projector.finish()

            # ── Paused for tool approval? ──────────────────────────────────
            # A gated tool call raised an interrupt inside the graph — astream_events
            # simply stops yielding at that point rather than raising, so this is
            # detected after the loop by checking the checkpoint for pending
            # interrupts, not via an exception.
            state_snapshot = await graph.aget_state(thread_config)
            if state_snapshot.interrupts:
                projector._emit("tool_approval_required", _approval_payload(state_snapshot.interrupts))
                await session.execute(
                    update(StreamRecord)
                    .where(StreamRecord.id == stream_id)
                    .values(
                        status=STREAM_STATUS_AWAITING_APPROVAL,
                        partial_content="".join(projector.content_tokens) if projector.content_tokens else None,
                        reasoning=json.dumps({"steps": projector.reasoning_steps}) if projector.reasoning_steps else None,
                        total_chunks=projector.chunk_index,
                        updated_at=utcnow(),
                        **usage_values(),
                    )
                )
                await session.commit()
                stream_manager.signal_done(stream_id)
                paused_for_approval = True
                logger.info("Stream %s paused for tool approval (%d chunks)", stream_id, projector.chunk_index)
                return

            full_content = "".join(projector.content_tokens)
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
                generated_title = await _generate_thread_title(title_source, trace_meta, trace_ids)
                if generated_title:
                    await session.execute(
                        update(Thread)
                        .where(Thread.id == thread_id)
                        .values(title=generated_title)
                    )

            # thread_title must be emitted BEFORE done — SSE consumers stop on done
            if generated_title:
                projector._emit("thread_title", {"title": generated_title})

            projector._emit("done", {"message_id": assistant_msg.id, "total_chunks": projector.chunk_index})

            cost_usd = _compute_cost_usd(
                llm_provider_value, llm_model_value,
                projector.input_tokens, projector.cache_read_tokens, projector.output_tokens,
            )
            await session.execute(
                update(StreamRecord)
                .where(StreamRecord.id == stream_id)
                .values(
                    status=STREAM_STATUS_COMPLETED,
                    assistant_message_id=assistant_msg.id,
                    partial_content=None,
                    reasoning=json.dumps({"steps": projector.reasoning_steps}) if projector.reasoning_steps else None,
                    total_chunks=projector.chunk_index,
                    cost_usd=cost_usd,
                    completed_at=utcnow(),
                    updated_at=utcnow(),
                    **usage_values(),
                )
            )
            await session.commit()  # title update + StreamRecord COMPLETED in one transaction
            stream_manager.signal_done(stream_id)
            logger.info("Stream %s completed (%d chunks)", stream_id, projector.chunk_index)

        except asyncio.CancelledError:
            logger.info("Stream %s cancelled", stream_id)
            try:
                await session.rollback()
                # Close any pending reasoning blocks
                projector.abort()
                partial_text = "".join(projector.content_tokens)
                stream_values: dict = {"status": STREAM_STATUS_CANCELLED, "updated_at": utcnow()}

                if partial_text or projector.reasoning_steps:
                    # Create an assistant message so get_messages can attach reasoning.
                    # content may be empty string when cancelled before the final answer started.
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

                if projector.reasoning_steps:
                    stream_values["reasoning"] = json.dumps({"steps": projector.reasoning_steps})

                # A cancelled run still consumed real tokens up to the point of
                # cancellation — record and cost them, don't discard.
                stream_values.update(usage_values())
                stream_values["cost_usd"] = _compute_cost_usd(
                    llm_provider_value, llm_model_value,
                    projector.input_tokens, projector.cache_read_tokens, projector.output_tokens,
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
            projector._emit("error", {"message": "Stream cancelled", "code": "cancelled"})
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
                        cost_usd=_compute_cost_usd(
                            llm_provider_value, llm_model_value,
                            projector.input_tokens, projector.cache_read_tokens, projector.output_tokens,
                        ),
                        updated_at=utcnow(),
                        **usage_values(),
                    )
                )
                await session.commit()
            except Exception:
                pass
            projector._emit("error", {"message": error_msg, "code": error_code})
            stream_manager.signal_done(stream_id)

        finally:
            _schedule_trace_sync(trace_ids, (trace_meta or {}).get("user_id"))
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
    ) -> StreamStartResponse:
        """Validate, persist user message, create StreamRecord, start generation.

        Returns immediately (202) with a stream_id. The client connects to
        GET /threads/{thread_id}/stream/{stream_id} to receive tokens via SSE.

        Args:
            session: Active async database session.
            thread_id: The thread to send the message to.
            user_id: The authenticated user's ID.
            user_message: The raw user message text.

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
        change, since permission is per-tool, not per-agent — taking effect from
        the next turn for every agent that uses the tool.

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

            resume_map: dict[str, dict] = {}
            always_allow_tool_ids: set[str] = set()

            for group in request.approvals:
                interrupt_value = pending_by_id.get(group.interrupt_id)
                if interrupt_value is None:
                    raise ValueError(f"Interrupt '{group.interrupt_id}' is not pending")

                actions = interrupt_value["action_requests"]
                if len(group.decisions) != len(actions):
                    raise ValueError(
                        f"Interrupt '{group.interrupt_id}' needs {len(actions)} decision(s), "
                        f"got {len(group.decisions)}"
                    )

                resolved: list[dict] = []
                for action, decision in zip(actions, group.decisions):
                    if decision.type == "approve":
                        resolved.append({"type": "approve"})
                        if decision.always_allow and action.get("tool_id"):
                            always_allow_tool_ids.add(action["tool_id"])
                    else:
                        reject: dict = {"type": "reject"}
                        if decision.message:
                            reject["message"] = decision.message
                        resolved.append(reject)
                resume_map[group.interrupt_id] = {"decisions": resolved}

            if always_allow_tool_ids:
                from utils.mcp_client import set_tool_permission_in_registry

                await session.execute(
                    update(MCPTool)
                    .where(MCPTool.id.in_(always_allow_tool_ids))
                    .values(permission_state="allowed", updated_at=utcnow())
                )
                await session.commit()
                # Permission is per-tool, not per-agent, so it applies from the
                # next turn to every agent that uses the tool; graphs are built
                # per request, so there is nothing to invalidate.
                for tool_id in always_allow_tool_ids:
                    set_tool_permission_in_registry(tool_id, "allowed")
            else:
                await session.commit()

            thinking_result = await session.execute(
                select(User.thinking_enabled).where(User.id == user_id, User.is_active == True)
            )
            enable_thinking = thinking_result.scalar_one_or_none()
            if enable_thinking is None:
                enable_thinking = True
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
                enable_thinking=enable_thinking,
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
        return _approval_payload(interrupts)

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
            approvals=[
                ToolApprovalGroup(
                    interrupt_id=i.id,
                    decisions=[ToolApprovalDecision(type="reject") for _ in i.value["action_requests"]],
                )
                for i in interrupts
            ]
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
