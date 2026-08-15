import logging

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession

from database.session import get_async_session
from schemas.message import MessageCreate, MessageResponse
from schemas.stream import StreamStartResponse
from schemas.thread import ThreadCreate, ThreadCreateResponse, ThreadResponse, ThreadUpdate
from services.chat_service import ChatService
from services.thread_service import ThreadService
from utils.auth import get_current_user, get_current_user_flexible

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/threads", tags=["threads"])
thread_service = ThreadService()
chat_service = ChatService()


# Thread CRUD

@router.post("", response_model=ThreadCreateResponse, status_code=status.HTTP_201_CREATED)
async def create_thread(
    request: ThreadCreate,
    user_id: str = Depends(get_current_user_flexible),
    session: AsyncSession = Depends(get_async_session),
):
    """Create a new conversation thread.

    Args:
        request: Thread creation payload with agent_id.
        user_id: The authenticated user's ID.
        session: Async database session.

    Returns:
        ThreadCreateResponse with the new thread's ID.

    Raises:
        HTTPException: 422 if the agent is not found or not owned by the user.
    """
    thread = await thread_service.create(session, user_id, request)
    return ThreadCreateResponse(thread_id=thread.id)


@router.get("/{thread_id}", response_model=ThreadResponse)
async def get_thread(
    thread_id: str,
    user_id: str = Depends(get_current_user_flexible),
    session: AsyncSession = Depends(get_async_session),
):
    """Retrieve a specific thread by ID.

    Args:
        thread_id: The thread's ID.
        user_id: The authenticated user's ID.
        session: Async database session.

    Returns:
        ThreadResponse with thread details.

    Raises:
        HTTPException: 422 if thread not found or not owned by user.
    """
    return await thread_service.get_by_id(session, thread_id, user_id)


@router.patch("/{thread_id}", response_model=ThreadResponse)
async def update_thread_title(
    thread_id: str,
    request: ThreadUpdate,
    user_id: str = Depends(get_current_user),
    session: AsyncSession = Depends(get_async_session),
):
    """Update the title of a thread.

    Args:
        thread_id: The thread's ID.
        request: ThreadUpdate body with new title string.
        user_id: The authenticated user's ID.
        session: Async database session.

    Returns:
        ThreadResponse with updated thread details.

    Raises:
        HTTPException: 422 if thread not found or not owned by user.
    """
    thread = await thread_service.update_title(session, thread_id, user_id, request.title)
    return thread


@router.delete("/{thread_id}")
async def delete_thread(
    thread_id: str,
    user_id: str = Depends(get_current_user_flexible),
    session: AsyncSession = Depends(get_async_session),
):
    """Soft-delete a thread and clean up checkpointer state.

    Args:
        thread_id: The thread's ID.
        user_id: The authenticated user's ID.
        session: Async database session.

    Raises:
        HTTPException: 422 if thread not found or not owned by user.
    """
    thread_name = await thread_service.delete(session, thread_id, user_id)

    return {
        "message": f"Conversation '{thread_name}' deleted successfully"
    }


# Messaging

@router.post(
    "/{thread_id}/messages",
    response_model=StreamStartResponse,
    status_code=status.HTTP_202_ACCEPTED,
)
async def send_message(
    thread_id: str,
    request: MessageCreate,
    user_id: str = Depends(get_current_user_flexible),
    session: AsyncSession = Depends(get_async_session),
):
    """Send a user message and start background generation.

    Returns immediately (202 Accepted) with a stream_id. Connect to
    GET /api/v1/streams/{stream_id} to receive tokens via SSE.

    Args:
        thread_id: The thread to post to.
        request: MessageCreate body with a ``message`` string.
        user_id: The authenticated user's ID.
        session: Async database session.

    Returns:
        StreamStartResponse with message_id, stream_id, status="PENDING".

    Raises:
        HTTPException: 422 if message is empty or thread/agent not found.
    """
    if not request.message.strip():
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail="message cannot be empty",
        )
    return await chat_service.send_message(session, thread_id, user_id, request.message.strip())


@router.get("/{thread_id}/messages", response_model=list[MessageResponse])
async def get_messages(
    thread_id: str,
    user_id: str = Depends(get_current_user),
    session: AsyncSession = Depends(get_async_session),
):
    """Retrieve all messages in a thread ordered by creation time.

    Args:
        thread_id: The thread to query.
        user_id: The authenticated user's ID.
        session: Async database session.

    Returns:
        List of MessageResponse objects.

    Raises:
        HTTPException: 422 if thread not found or not owned by user.
    """
    return await chat_service.get_messages(session, thread_id, user_id)
