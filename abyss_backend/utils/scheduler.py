import asyncio
import logging
from datetime import datetime, timedelta
from typing import Optional

from sqlalchemy import func, select, update
from sqlalchemy.exc import IntegrityError

from constants import (
    MAX_SCHEDULE_RETRY_ATTEMPTS,
    SCHEDULE_RETRY_BACKOFF_SECONDS,
    SCHEDULE_RUN_STALE_SECONDS,
    SCHEDULE_TRIGGER_MESSAGE,
    SCHEDULER_DISPATCH_BATCH_SIZE,
    SCHEDULER_TICK_INTERVAL_SECONDS,
    STREAM_STATUS_CANCELLED,
    STREAM_STATUS_COMPLETED,
    STREAM_STATUS_FAILED,
)
from database.db_enums import ScheduleRunStatus
from database.models import AgentSchedule, ScheduleRun, StreamRecord, utcnow
from database.session import async_session_maker
from schemas.thread import ThreadCreate
from services.chat_service import ChatService
from services.schedule_service import compute_next_run_at
from services.thread_service import ThreadService

logger = logging.getLogger(__name__)

_thread_service = ThreadService()
_chat_service = ChatService()

_scheduler_task: Optional[asyncio.Task] = None

# Terminal StreamRecord states the reconciliation pass watches for.
_STREAM_TERMINAL_SUCCESS = {STREAM_STATUS_COMPLETED}
_STREAM_TERMINAL_FAILURE = {STREAM_STATUS_FAILED, STREAM_STATUS_CANCELLED}


def start_scheduler() -> None:
    """Start the background scheduler tick loop. Call once from app startup."""
    global _scheduler_task
    _scheduler_task = asyncio.create_task(_scheduler_tick_loop())


async def stop_scheduler() -> None:
    """Cancel the background scheduler tick loop. Call once from app shutdown."""
    global _scheduler_task
    if _scheduler_task is not None:
        _scheduler_task.cancel()
        try:
            await _scheduler_task
        except asyncio.CancelledError:
            pass
        _scheduler_task = None


async def _scheduler_tick_loop() -> None:
    while True:
        await asyncio.sleep(SCHEDULER_TICK_INTERVAL_SECONDS)
        try:
            async with async_session_maker() as session:
                await _tick(session)
        except Exception:
            # Never let one bad tick kill the loop — next tick just tries again.
            logger.exception("Scheduler tick failed")


async def _tick(session) -> None:
    await _reconcile_running_runs(session)
    await _reclaim_stale_runs(session)
    await _run_due_schedules(session)


async def _reconcile_running_runs(session) -> None:
    """Sync ScheduleRun.status against the StreamRecord it's watching.

    A ScheduleRun is created with status=RUNNING when a scheduled trigger is
    claimed, then generation proceeds as a normal fire-and-forget background
    task (same as a manual message). This pass is what actually observes
    completion/failure and clears the concurrency slot for that schedule.
    """
    result = await session.execute(
        select(ScheduleRun).where(ScheduleRun.status == ScheduleRunStatus.RUNNING)
    )
    running_runs = result.scalars().all()
    if not running_runs:
        return

    changed = False
    for run in running_runs:
        if not run.stream_id:
            continue
        stream_result = await session.execute(
            select(StreamRecord.status, StreamRecord.error_message)
            .where(StreamRecord.id == run.stream_id)
        )
        row = stream_result.first()
        if row is None:
            continue
        stream_status, error_message = row
        if stream_status in _STREAM_TERMINAL_SUCCESS:
            run.status = ScheduleRunStatus.COMPLETED
            changed = True
        elif stream_status in _STREAM_TERMINAL_FAILURE:
            run.status = ScheduleRunStatus.FAILED
            run.error_message = error_message
            changed = True
        # else still PENDING/RUNNING — leave as-is, checked again next tick

    if changed:
        await session.commit()


async def _reclaim_stale_runs(session) -> None:
    """Reclaim any RUNNING ScheduleRun whose generation has gone silent.

    Unlike main.py's one-time boot sweep (which only catches runs already
    stuck before the current process started), this runs on every tick — it
    closes the gap where a run gets orphaned mid-session (a crash, a hung
    LLM call, a mid-generation server restart) and would otherwise block
    that schedule forever, since the boot sweep never runs again until the
    next restart. SCHEDULE_RUN_STALE_SECONDS is generous enough to exceed
    the LLM http client's own request timeout, so a run this stale has
    almost certainly already died at a lower layer.
    """
    cutoff = utcnow() - timedelta(seconds=SCHEDULE_RUN_STALE_SECONDS)
    result = await session.execute(
        update(ScheduleRun)
        .where(
            ScheduleRun.status == ScheduleRunStatus.RUNNING,
            func.coalesce(ScheduleRun.heartbeat_at, ScheduleRun.created_at) < cutoff,
        )
        .values(
            status=ScheduleRunStatus.FAILED,
            error_message="Reclaimed after heartbeat timeout",
            updated_at=utcnow(),
        )
    )
    if result.rowcount:
        logger.warning(
            "Reclaimed %d stale scheduled run(s) past the heartbeat grace period", result.rowcount
        )
        await session.commit()


def _compute_advanced_next_run_at(
    schedule: AgentSchedule, scheduled_for: datetime, now: datetime
) -> Optional[datetime]:
    """Advance from scheduled_for to the first occurrence >= now.

    Loops compute_next_run_at forward instead of stopping after one step, so
    a schedule that fell behind (e.g. the server was down) jumps straight to
    its current due slot in one pass rather than replaying every missed
    occurrence one tick at a time.
    """
    weekdays_list = [int(d) for d in schedule.weekdays.split(",")] if schedule.weekdays else None
    candidate = scheduled_for
    while True:
        candidate = compute_next_run_at(
            schedule.schedule_type, schedule.interval_minutes, schedule.time_of_day,
            weekdays_list, schedule.day_of_month, candidate,
        )
        if candidate is None:
            logger.warning(
                "compute_next_run_at returned no future occurrence for schedule %s — "
                "it will not fire again until updated",
                schedule.id,
            )
            return None
        if candidate >= now:
            return candidate


async def _run_due_schedules(session) -> None:
    now = utcnow()
    result = await session.execute(
        select(AgentSchedule.id)
        .where(
            AgentSchedule.is_active == True,
            AgentSchedule.next_run_at.isnot(None),
            AgentSchedule.next_run_at <= now,
        )
        .limit(SCHEDULER_DISPATCH_BATCH_SIZE)
    )
    due_schedule_ids = result.scalars().all()
    if not due_schedule_ids:
        return

    # Each concurrent claim gets its own session — an AsyncSession must not
    # be shared across concurrently-running coroutines. Dispatched in
    # parallel (bounded by the batch size above) instead of one at a time,
    # so a large batch of simultaneously-due schedules (e.g. many hourly
    # schedules all landing on the same :00 boundary) doesn't serialize
    # behind each other within a single tick.
    await asyncio.gather(
        *(_claim_and_execute(schedule_id, now) for schedule_id in due_schedule_ids)
    )


async def _claim_and_execute(schedule_id: str, now: datetime) -> None:
    """Atomically claim one schedule's due occurrence, then execute or skip it.

    The claim is a compare-and-swap on AgentSchedule.next_run_at: only the
    worker whose UPDATE actually matches the row (next_run_at still equals
    the value we read) wins it. This is what makes it safe to run this
    function concurrently — within one tick's batch, and across any number
    of separate worker processes/instances — without two workers ever
    processing the same due occurrence.
    """
    async with async_session_maker() as session:
        try:
            schedule_result = await session.execute(
                select(AgentSchedule).where(AgentSchedule.id == schedule_id)
            )
            schedule = schedule_result.scalar_one_or_none()
            if (
                schedule is None
                or not schedule.is_active
                or schedule.next_run_at is None
                or schedule.next_run_at > now
            ):
                return  # already handled by another worker, deactivated, or not actually due

            scheduled_for = schedule.next_run_at
            new_next_run_at = _compute_advanced_next_run_at(schedule, scheduled_for, now)

            claim_result = await session.execute(
                update(AgentSchedule)
                .where(AgentSchedule.id == schedule_id, AgentSchedule.next_run_at == scheduled_for)
                .values(next_run_at=new_next_run_at)
            )
            if claim_result.rowcount == 0:
                await session.rollback()
                return  # another worker won the claim for this occurrence first
            await session.commit()
        except Exception:
            logger.exception("Failed to claim due occurrence for schedule %s", schedule_id)
            await session.rollback()
            return

        await _execute_or_skip(session, schedule, scheduled_for, now)


async def _execute_or_skip(
    session, schedule: AgentSchedule, scheduled_for: datetime, now: datetime
) -> None:
    """Start (or skip) the scheduled run this worker just claimed.

    Skip policy: if this schedule's previous run is still active, drop this
    trigger rather than queue it. The partial unique index on
    schedule_runs(schedule_id) WHERE status='RUNNING' is the real mutex here
    — the flush() below either claims the run slot or fails with
    IntegrityError if another run for this schedule is still active, safely
    across any number of concurrent workers (not just within one process).
    """
    run = ScheduleRun(
        schedule_id=schedule.id,
        agent_id=schedule.agent_id,
        scheduled_for=scheduled_for,
        status=ScheduleRunStatus.RUNNING,
        heartbeat_at=now,
        attempt=schedule.retry_count + 1,
    )
    session.add(run)
    try:
        await session.flush()
    except IntegrityError:
        await session.rollback()
        session.add(ScheduleRun(
            schedule_id=schedule.id,
            agent_id=schedule.agent_id,
            scheduled_for=scheduled_for,
            status=ScheduleRunStatus.SKIPPED,
        ))
        try:
            await session.commit()
        except IntegrityError:
            await session.rollback()
        return

    try:
        # New thread per scheduled run — no shared conversation memory across runs.
        thread = await _thread_service.create(
            session, schedule.user_id, ThreadCreate(agent_id=schedule.agent_id)
        )
        run.thread_id = thread.id

        trigger_message = schedule.input_query or SCHEDULE_TRIGGER_MESSAGE
        stream_response = await _chat_service.send_message(
            session, thread.id, schedule.user_id, trigger_message, is_interactive=False
        )
        run.stream_id = stream_response.stream_id
        schedule.last_run_at = scheduled_for
        schedule.retry_count = 0
        await session.commit()
    except Exception as exc:
        logger.exception("Failed to start scheduled run for schedule %s", schedule.id)
        run.status = ScheduleRunStatus.FAILED
        run.error_message = str(exc)

        # ValueError is how this codebase signals a terminal, user-actionable
        # problem (agent deleted, no credential configured, model no longer
        # available — see resolve_llm_for_agent/send_message) — never worth
        # retrying. Anything else (network blip, transient LLM error) gets a
        # bounded number of backoff retries before giving up.
        is_terminal = isinstance(exc, ValueError)
        if not is_terminal and schedule.retry_count < MAX_SCHEDULE_RETRY_ATTEMPTS:
            schedule.retry_count += 1
            backoff_seconds = SCHEDULE_RETRY_BACKOFF_SECONDS[
                min(schedule.retry_count, len(SCHEDULE_RETRY_BACKOFF_SECONDS)) - 1
            ]
            schedule.next_run_at = now + timedelta(seconds=backoff_seconds)
        else:
            schedule.retry_count = 0
        await session.commit()
