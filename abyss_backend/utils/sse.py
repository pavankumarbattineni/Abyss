import asyncio
import json
import logging
from typing import AsyncIterator, Optional

from fastapi import HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from constants import (
    SSE_HEARTBEAT_TIMEOUT_SECONDS,
    SSE_REPLAY_PACING_SECONDS,
    STREAM_STATUS_AWAITING_APPROVAL,
    STREAM_STATUS_CANCELLED,
    STREAM_STATUS_COMPLETED,
    STREAM_STATUS_FAILED,
)
from database.models import Message, StreamRecord, Thread
from database.session import async_session_maker
import utils.stream_manager as stream_manager
from utils.reasoning_splitter import normalize_reasoning

logger = logging.getLogger(__name__)


def fmt_sse(chunk: dict) -> str:
    """Format a buffered chunk dict as an SSE frame with an id field."""
    return f"id: {chunk['index']}\nevent: {chunk['event_type']}\ndata: {json.dumps(chunk['data'])}\n\n"


def fmt_sse_raw(event_type: str, data: dict) -> str:
    """Format an ad-hoc event as an SSE frame (no id field)."""
    return f"event: {event_type}\ndata: {json.dumps(data)}\n\n"


async def get_verified_stream_record(
    session: AsyncSession,
    stream_id: str,
    user_id: str,
) -> StreamRecord:
    """Fetch a StreamRecord and verify the caller owns the enclosing thread.

    Derives the thread from the stream record itself — callers do not need
    to supply thread_id.

    Raises:
        HTTPException 422: If the stream_id does not exist.
        HTTPException 403: If the thread does not belong to the user.
    """
    result = await session.execute(
        select(StreamRecord).where(StreamRecord.id == stream_id)
    )
    record = result.scalar_one_or_none()
    if not record:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail="Stream not found",
        )

    thread_result = await session.execute(
        select(Thread).where(
            Thread.id == record.thread_id,
            Thread.user_id == user_id,
            Thread.is_active == True,
        )
    )
    if not thread_result.scalar_one_or_none():
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Access denied")

    return record


def _iter_db_reconstruction(full_content: str, reasoning: Optional[str]) -> list[str]:
    """Build a best-effort SSE frame sequence from a persisted DB trace.

    Shared by the COMPLETED-with-no-local-buffer case and by the RUNNING
    heartbeat fallback (a different gunicorn worker finished the stream, so
    this worker's local buffer/queue never received the real chunks).
    """
    frames: list[str] = []
    reasoning_data: dict = {}
    if reasoning:
        try:
            reasoning_data = json.loads(reasoning)
        except Exception:
            pass
    frames.append(fmt_sse_raw("reasoning", {"reasoning": reasoning_data}))

    normalized = normalize_reasoning(reasoning)
    steps = normalized.get("steps", [])

    for step in steps:
        if step.get("step") == "thought":
            agent = step.get("agent", "")
            frames.append(fmt_sse_raw("reasoning_start", {"agent": agent}))
            if step.get("content"):
                frames.append(fmt_sse_raw("reasoning_token", {"content": step["content"], "agent": agent}))
            frames.append(fmt_sse_raw("reasoning_end", {
                "agent": agent,
                "truncated": step.get("truncated", False) or step.get("partial", False),
            }))
        elif step.get("step") == "dispatch_decision":
            frames.append(fmt_sse_raw("dispatch_decision", {
                "target": step.get("target", ""),
                "reason": step.get("reason", ""),
            }))
        elif step.get("step") == "tool_call":
            agent_name = step.get("agent", "")
            tool_name = step.get("tool_name", "")
            frames.append(fmt_sse_raw("tool_start", {"tool_name": tool_name, "agent_name": agent_name}))
            frames.append(fmt_sse_raw("tool_end", {"tool_name": tool_name, "agent_name": agent_name, "output": step.get("output")}))

    frames.append(fmt_sse_raw("token", {"content": full_content}))
    frames.append(fmt_sse_raw("done", {"total_chunks": 1}))
    return frames


async def _recheck_stream_status(stream_id: str) -> Optional[tuple[str, Optional[str], Optional[str]]]:
    """Re-check a stream's DB state with a fresh session (used mid-generator,
    after the router's request-scoped session has already been closed).

    Returns (status, full_content, reasoning) if the stream has reached a
    terminal state (COMPLETED/FAILED/CANCELLED), or None if it's still
    PENDING/RUNNING there too (a genuinely slow generation, not a cross-worker
    gap — caller should keep waiting).
    """
    async with async_session_maker() as session:
        result = await session.execute(select(StreamRecord).where(StreamRecord.id == stream_id))
        record = result.scalar_one_or_none()
        if record is None or record.status not in (
            STREAM_STATUS_COMPLETED, STREAM_STATUS_FAILED, STREAM_STATUS_CANCELLED,
        ):
            return None

        if record.status != STREAM_STATUS_COMPLETED:
            return record.status, None, None

        if record.assistant_message_id:
            msg_result = await session.execute(
                select(Message).where(Message.id == record.assistant_message_id)
            )
            msg = msg_result.scalar_one_or_none()
            full_content = msg.content if msg else (record.partial_content or "")
        else:
            full_content = record.partial_content or ""
        return record.status, full_content, record.reasoning


async def sse_generator(
    stream_id: str,
    stream_status: str,
    full_content: Optional[str],
    resume_from: int,
    reasoning: Optional[str] = None,
    pending_approval: Optional[dict] = None,
) -> AsyncIterator[str]:
    """Async generator that yields SSE-formatted strings.

    Handles these cases:
    - FAILED / CANCELLED with no in-memory buffer: emit a single error event.
    - COMPLETED with the original buffer still in this worker's memory: replay
      those exact chunks (same shape/granularity a live client would have
      received), paced so they can't arrive in one unreadable burst.
    - COMPLETED with no local buffer (different gunicorn worker ran the
      generation, or the buffer was already cleaned up): reconstruct a
      best-effort event sequence from the persisted DB trace instead.
    - AWAITING_APPROVAL with the original buffer still in memory: replay it,
      same as COMPLETED. With no local buffer, re-emit `pending_approval`
      (the router fetches it fresh from the graph's checkpoint — durable,
      unlike the in-memory buffer this event originally rode in on) so a
      client reconnecting after the buffer was cleaned up (or a long wait)
      still learns what's pending, instead of heartbeating forever.
    - RUNNING with buffer: replay from resume_from, then live-stream new chunks
      until the done sentinel arrives. If a heartbeat timeout elapses with
      nothing on the local queue, re-check the DB directly — a different
      worker may have already finished (or failed) this stream, in which case
      we reconstruct/error from the DB instead of heartbeating forever.

    Known gap: the heartbeat-timeout cross-worker re-check below only
    recognizes COMPLETED/FAILED/CANCELLED as terminal, not AWAITING_APPROVAL —
    a client that connects live and then a DIFFERENT worker's generation pauses
    for approval will still heartbeat until it reconnects. Rare in practice
    (needs multi-worker + that exact timing) but real; the initial-connect
    path here is the one that matters for the common case.
    """
    if stream_status in (STREAM_STATUS_FAILED, STREAM_STATUS_CANCELLED) and not stream_manager.get_buffer(stream_id):
        yield fmt_sse_raw("error", {"message": f"Stream {stream_status.lower()}", "code": stream_status.lower()})
        return

    if stream_status == STREAM_STATUS_AWAITING_APPROVAL:
        buffer = stream_manager.get_buffer(stream_id)
        if buffer and buffer[-1]["event_type"] == "tool_approval_required":
            for chunk in buffer[resume_from:]:
                yield fmt_sse(chunk)
                await asyncio.sleep(SSE_REPLAY_PACING_SECONDS)
            return
        if pending_approval is not None:
            yield fmt_sse_raw("tool_approval_required", pending_approval)
            return
        # No buffer and nothing pending anymore (resolved between the
        # router's prefetch and here) — fall through to the live-subscribe
        # path below, which will pick up whatever's actually happening now.

    if stream_status == STREAM_STATUS_COMPLETED:
        buffer = stream_manager.get_buffer(stream_id)
        if buffer and buffer[-1]["event_type"] in ("done", "error"):
            # This worker still holds the original fine-grained chunks (within
            # the post-completion cleanup window) — replay them as-is instead
            # of the coarser DB reconstruction below. Paced with a tiny delay
            # per chunk so the client's stream reader gets them as separate
            # reads rather than one instantaneous burst.
            for chunk in buffer[resume_from:]:
                yield fmt_sse(chunk)
                await asyncio.sleep(SSE_REPLAY_PACING_SECONDS)
            return

    if stream_status == STREAM_STATUS_COMPLETED and full_content is not None:
        # Fallback: no local buffer for this stream (different worker handled
        # the generation, or it was already cleaned up) — reconstruct a
        # best-effort event sequence from the persisted DB trace instead.
        for frame in _iter_db_reconstruction(full_content, reasoning):
            yield frame
        return

    # Subscribe BEFORE replaying the buffer to avoid the race where a new chunk
    # arrives after replay ends but before we start listening on the queue.
    q = stream_manager.subscribe(stream_id)
    last_replayed = resume_from - 1

    try:
        buffer = stream_manager.get_buffer(stream_id)
        for chunk in buffer[resume_from:]:
            yield fmt_sse(chunk)
            last_replayed = chunk["index"]

        if buffer and buffer[-1]["event_type"] in ("done", "error"):
            return

        while True:
            try:
                chunk = await asyncio.wait_for(q.get(), timeout=SSE_HEARTBEAT_TIMEOUT_SECONDS)
            except asyncio.TimeoutError:
                # Our local queue never received anything — possibly because a
                # DIFFERENT gunicorn worker ran (and already finished) this
                # generation, so this worker's in-memory buffer/queue was never
                # populated and never will be. Re-check the DB directly; if the
                # stream actually finished elsewhere, reconstruct from there
                # instead of heartbeating forever.
                db_result = await _recheck_stream_status(stream_id)
                if db_result is not None:
                    db_status, db_full_content, db_reasoning = db_result
                    if db_status == STREAM_STATUS_COMPLETED:
                        for frame in _iter_db_reconstruction(db_full_content, db_reasoning):
                            yield frame
                    else:
                        yield fmt_sse_raw("error", {"message": f"Stream {db_status.lower()}", "code": db_status.lower()})
                    return
                yield ": heartbeat\n\n"
                continue

            if chunk is None:
                break

            if chunk["index"] <= last_replayed:
                continue

            yield fmt_sse(chunk)
            last_replayed = chunk["index"]

            if chunk["event_type"] in ("done", "error"):
                break

    finally:
        stream_manager.unsubscribe(stream_id, q)
