import asyncio
import logging
from typing import Optional

from constants import STREAM_CLEANUP_DELAY_SECONDS

logger = logging.getLogger(__name__)

# stream_id → ordered list of chunk dicts (append-only during generation)
_chunk_buffers: dict[str, list[dict]] = {}

# stream_id → list of queues, one per live SSE connection
_sse_queues: dict[str, list[asyncio.Queue]] = {}

# stream_id → background asyncio.Task
_running_tasks: dict[str, asyncio.Task] = {}

# stream_id → pending cleanup Task, so a new run for the same stream_id (e.g.
# a resumed tool-approval generation) can cancel a stale timer from a PRIOR
# run instead of racing it — see schedule_cleanup_task.
_cleanup_tasks: dict[str, asyncio.Task] = {}

# Sentinel placed into a queue to signal the SSE generator that the stream ended
_DONE_SENTINEL = None


# Buffer

def get_buffer(stream_id: str) -> list[dict]:
    return _chunk_buffers.get(stream_id, [])


def append_chunk(stream_id: str, chunk: dict) -> None:
    """Append a chunk to the buffer and push it to every live SSE queue."""
    if stream_id not in _chunk_buffers:
        _chunk_buffers[stream_id] = []
    _chunk_buffers[stream_id].append(chunk)
    for q in _sse_queues.get(stream_id, []):
        q.put_nowait(chunk)


def signal_done(stream_id: str) -> None:
    """Push the done sentinel to every live SSE queue."""
    for q in _sse_queues.get(stream_id, []):
        q.put_nowait(_DONE_SENTINEL)


# SSE subscriptions

def subscribe(stream_id: str) -> asyncio.Queue:
    """Register a new SSE client; returns its dedicated queue."""
    q: asyncio.Queue = asyncio.Queue()
    if stream_id not in _sse_queues:
        _sse_queues[stream_id] = []
    _sse_queues[stream_id].append(q)
    return q


def unsubscribe(stream_id: str, q: asyncio.Queue) -> None:
    """Remove an SSE client's queue (called from the generator's finally block)."""
    queues = _sse_queues.get(stream_id, [])
    try:
        queues.remove(q)
    except ValueError:
        pass


# Task registry

def register_task(stream_id: str, task: asyncio.Task) -> None:
    _running_tasks[stream_id] = task


def cancel_task(stream_id: str) -> bool:
    """Cancel the background generation task. Returns True if a running task was found."""
    task = _running_tasks.get(stream_id)
    if task and not task.done():
        task.cancel()
        return True
    return False


def is_task_running(stream_id: str) -> bool:
    task = _running_tasks.get(stream_id)
    return task is not None and not task.done()


# Cleanup

def cleanup_stream(stream_id: str) -> None:
    """Remove all in-memory state for a stream (called ~5 min after completion)."""
    _chunk_buffers.pop(stream_id, None)
    _sse_queues.pop(stream_id, None)
    _running_tasks.pop(stream_id, None)
    logger.debug("Cleaned up in-memory state for stream %s", stream_id)


async def _sleep_then_cleanup(stream_id: str, delay: float) -> None:
    await asyncio.sleep(delay)
    cleanup_stream(stream_id)
    _cleanup_tasks.pop(stream_id, None)


def schedule_cleanup_task(stream_id: str, delay: float = STREAM_CLEANUP_DELAY_SECONDS) -> None:
    """(Re)schedule cleanup of in-memory state for a stream, cancelling any
    previously-scheduled cleanup for the same stream_id first.

    A generation can legitimately run more than once for the same stream_id
    (a tool-approval pause followed by a resumed run reuses it) — each run's
    `finally` block calls this. Without cancelling the prior timer, an early
    pause's 5-minute timer can fire well after a fast resume has already
    produced a fresh buffer/queue/task for that stream_id, wiping live state
    out from under a connected client.
    """
    existing = _cleanup_tasks.get(stream_id)
    if existing and not existing.done():
        existing.cancel()
    _cleanup_tasks[stream_id] = asyncio.create_task(_sleep_then_cleanup(stream_id, delay))


def cancel_scheduled_cleanup(stream_id: str) -> None:
    """Cancel a pending cleanup timer for a stream without scheduling a new one.

    Used when a run is about to reuse the same stream_id (e.g. resuming after
    a tool approval) so the prior run's timer can't fire mid-resume.
    """
    existing = _cleanup_tasks.pop(stream_id, None)
    if existing and not existing.done():
        existing.cancel()
