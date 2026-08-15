import json
import logging
from typing import Optional

from fastapi import APIRouter, Depends, Header, status
from fastapi.responses import StreamingResponse
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from constants import STREAM_STATUS_AWAITING_APPROVAL, STREAM_STATUS_COMPLETED, STREAM_STATUS_PENDING, STREAM_STATUS_RUNNING
from database.models import Message
from database.session import get_async_session
from schemas.stream import StreamCancelResponse, StreamStartResponse, StreamStatusResponse, ToolApprovalRequest
from services.chat_service import ChatService
import utils.stream_manager as stream_manager
from utils.auth import get_current_user, get_current_user_flexible, get_current_user_sse
from utils.reasoning_splitter import normalize_reasoning
from utils.sse import get_verified_stream_record, sse_generator

chat_service = ChatService()

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/streams", tags=["streams"])


@router.get("/{stream_id}")
async def get_stream(
    stream_id: str,
    last_event_id: Optional[str] = Header(None, alias="last-event-id"),
    user_id: str = Depends(get_current_user_sse),
    session: AsyncSession = Depends(get_async_session),
):
    """SSE endpoint — stream tokens for a generation in progress or replay a completed one.

    On reconnect the browser's EventSource sends ``Last-Event-ID`` automatically.
    The endpoint replays missed chunks from the in-memory buffer and then
    continues streaming live. For completed streams whose buffer has been
    cleaned up the full response is fetched from the DB and sent as one event.

    Accepts authentication via Authorization header (fetch+ReadableStream) or
    via ``?token=<jwt>`` query param (native EventSource).

    Args:
        stream_id: The stream returned by POST /threads/{thread_id}/messages.
        last_event_id: Last chunk index received by the client (auto header).
        user_id: Authenticated user.
        session: Async database session.

    Returns:
        text/event-stream SSE response.

    Raises:
        HTTPException: 422 if stream not found, 403 if access denied.
    """
    record = await get_verified_stream_record(session, stream_id, user_id)

    resume_from = 0
    if last_event_id is not None:
        try:
            resume_from = int(last_event_id) + 1
        except (ValueError, TypeError):
            resume_from = 0

    # For COMPLETED streams, always load full content and reasoning from DB while
    # the session is still open (StreamingResponse closes it). The generator uses
    # these values to reconstruct the SSE sequence, ensuring a consistent streaming
    # response regardless of when the client connects.
    full_content: Optional[str] = None
    db_reasoning: Optional[str] = None
    if record.status == STREAM_STATUS_COMPLETED:
        db_reasoning = record.reasoning
        if record.assistant_message_id:
            msg_result = await session.execute(
                select(Message).where(Message.id == record.assistant_message_id)
            )
            msg = msg_result.scalar_one_or_none()
            full_content = msg.content if msg else (record.partial_content or "")
        else:
            full_content = record.partial_content or ""

    # For AWAITING_APPROVAL, fetch the pending interrupt payload fresh from the
    # graph's checkpoint (durable) while the session is still open, so a client
    # reconnecting after the in-memory buffer was cleaned up (or a long wait)
    # still learns what's pending instead of heartbeating forever.
    pending_approval: Optional[dict] = None
    if record.status == STREAM_STATUS_AWAITING_APPROVAL:
        pending_approval = await chat_service.get_pending_approval(session, stream_id, user_id)

    return StreamingResponse(
        sse_generator(
            stream_id, record.status, full_content, resume_from,
            reasoning=db_reasoning, pending_approval=pending_approval,
        ),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",
            "Connection": "keep-alive",
        },
    )


@router.delete("/{stream_id}", response_model=StreamCancelResponse)
async def cancel_stream(
    stream_id: str,
    user_id: str = Depends(get_current_user),
    session: AsyncSession = Depends(get_async_session),
):
    """Cancel an in-progress generation, or abandon a pending tool approval.

    If the stream is already in a terminal state the call is a no-op and the
    current status is returned unchanged. If it's AWAITING_APPROVAL, every
    pending gated tool call is denied so the underlying interrupt resolves
    cleanly (required — leaving it dangling would silently break the next
    message sent on this thread), and the agent's resulting follow-up
    generation runs in the background; the client should reconnect to
    GET /streams/{stream_id} to see it, and can cancel that normally too.

    Args:
        stream_id: The stream to cancel.
        user_id: The authenticated user's ID.
        session: Async database session.

    Returns:
        StreamCancelResponse with status "interrupted" if the stream was
        actively cancelled or a pending approval was denied, or the existing
        terminal status otherwise.

    Raises:
        HTTPException: 422 if stream not found, 403 if access denied.
    """
    record = await get_verified_stream_record(session, stream_id, user_id)

    if record.status == STREAM_STATUS_AWAITING_APPROVAL:
        await chat_service.deny_all_pending_approvals(session, stream_id, user_id)
        return StreamCancelResponse(stream_id=stream_id, status="interrupted")

    if record.status not in (STREAM_STATUS_PENDING, STREAM_STATUS_RUNNING):
        return StreamCancelResponse(stream_id=stream_id, status=record.status.lower())

    stream_manager.cancel_task(stream_id)
    return StreamCancelResponse(stream_id=stream_id, status="interrupted")


@router.post("/{stream_id}/tool-approvals", response_model=StreamStartResponse)
async def resolve_tool_approvals(
    stream_id: str,
    request: ToolApprovalRequest,
    user_id: str = Depends(get_current_user),
    session: AsyncSession = Depends(get_async_session),
):
    """Resolve a paused generation's pending tool-approval interrupt(s) and resume it.

    The client echoes back interrupt_id/tool_call_id pairs exactly as received
    in the tool_approval_required SSE event; the server re-validates them
    against the graph's own checkpoint before resuming, so a stale or forged
    request can't approve something that isn't actually pending.

    Args:
        stream_id: The stream currently AWAITING_APPROVAL.
        request: Per-interrupt decision groups (allow_once/always_allow/deny).
        user_id: The authenticated user's ID.
        session: Async database session.

    Returns:
        StreamStartResponse for the resumed generation (same stream_id) — the
        client reconnects to GET /streams/{stream_id} to keep receiving tokens.

    Raises:
        HTTPException: 422 if the stream/thread/interrupt is not found or not
            awaiting approval.
    """
    return await chat_service.resolve_tool_approvals(session, stream_id, user_id, request)


@router.get("/{stream_id}/status", response_model=StreamStatusResponse)
async def get_stream_status(
    stream_id: str,
    user_id: str = Depends(get_current_user_flexible),
    session: AsyncSession = Depends(get_async_session),
):
    """Poll the current state of a stream without opening an SSE connection.

    Useful on page load to decide whether to reconnect to a running stream
    or just render the already-completed message.

    Args:
        stream_id: The stream to query.
        user_id: The authenticated user's ID.
        session: Async database session.

    Returns:
        StreamStatusResponse with status, total_chunks, and optional partial_content.

    Raises:
        HTTPException: 422 if stream not found, 403 if access denied.
    """
    record = await get_verified_stream_record(session, stream_id, user_id)

    reasoning = normalize_reasoning(record.reasoning) if record.reasoning else None

    pending_approval: Optional[dict] = None
    if record.status == STREAM_STATUS_AWAITING_APPROVAL:
        pending_approval = await chat_service.get_pending_approval(session, stream_id, user_id)

    return StreamStatusResponse(
        stream_id=stream_id,
        status=record.status,
        total_chunks=record.total_chunks,
        partial_content=record.partial_content,
        reasoning=reasoning,
        pending_approval=pending_approval,
    )
