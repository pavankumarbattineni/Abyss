import asyncio
import logging
from datetime import datetime, timedelta
from typing import Optional

from apscheduler.jobstores.base import JobLookupError
from apscheduler.schedulers.asyncio import AsyncIOScheduler
from apscheduler.triggers.cron import CronTrigger
from apscheduler.triggers.date import DateTrigger
from apscheduler.triggers.interval import IntervalTrigger
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
from database.db_enums import ScheduleRunStatus, ScheduleType
from database.models import AgentSchedule, ScheduleRun, StreamRecord, utcnow
from database.session import async_session_maker
from schemas.thread import ThreadCreate
from services.chat_service import ChatService
from services.schedule_service import compute_next_run_at
from services.thread_service import ThreadService

logger = logging.getLogger(__name__)

_thread_service = ThreadService()
_chat_service = ChatService()

# Terminal StreamRecord states the reconciliation pass watches for.
_STREAM_TERMINAL_SUCCESS = {STREAM_STATUS_COMPLETED}
_STREAM_TERMINAL_FAILURE = {STREAM_STATUS_FAILED, STREAM_STATUS_CANCELLED}

_WEEKDAY_NAMES = ("mon", "tue", "wed", "thu", "fri", "sat", "sun")  # 0=Mon..6=Sun, matches this codebase's convention

_scheduler: Optional[AsyncIOScheduler] = None


def _job_id(schedule_id: str) -> str:
    return f"schedule:{schedule_id}"


def _retry_job_id(schedule_id: str) -> str:
    return f"schedule:{schedule_id}:retry"


def build_trigger(
    schedule_type: ScheduleType | str,
    interval_minutes: Optional[int],
    time_of_day: Optional[str],
    weekdays: Optional[list[int]],
    day_of_month: Optional[int],
):
    """Translate a schedule's recurrence fields into an APScheduler trigger.

    One-way translation only (fields -> trigger) — there is no cron string in
    the data model; CronTrigger/IntervalTrigger are just how the existing
    INTERVAL/DAILY/WEEKLY/MONTHLY recurrence rules get *fired* now, in place
    of the old fixed-interval poll.
    """
    st = schedule_type.value if isinstance(schedule_type, ScheduleType) else schedule_type
    if st == ScheduleType.INTERVAL.value:
        # IntervalTrigger fires every N minutes from start_date onward. Seeding
        # start_date with the next midnight-aligned slot (the same grid
        # compute_next_run_at anchors to) keeps every subsequent occurrence on
        # that same clean grid forever — the grid, not the anchor moment,
        # is what matters, since 1440 / interval_minutes is always a whole
        # number for every allowed interval (15/30/45/60).
        first_run = compute_next_run_at(st, interval_minutes, None, None, None, utcnow())
        # No explicit timezone: utcnow() (despite the name) returns naive
        # *local* wall-clock time everywhere in this codebase — see its
        # definition in database/models.py — so triggers must use
        # APScheduler's default local-timezone interpretation of naive
        # datetimes (via tzlocal) to stay on the same clock as next_run_at.
        return IntervalTrigger(minutes=interval_minutes, start_date=first_run)

    hour, minute = (int(p) for p in time_of_day.split(":"))
    if st == ScheduleType.DAILY.value:
        return CronTrigger(hour=hour, minute=minute)
    if st == ScheduleType.WEEKLY.value:
        dow = ",".join(_WEEKDAY_NAMES[d] for d in sorted(set(weekdays)))
        return CronTrigger(day_of_week=dow, hour=hour, minute=minute)
    if st == ScheduleType.MONTHLY.value:
        return CronTrigger(day=day_of_month, hour=hour, minute=minute)
    raise ValueError(f"Unknown schedule_type: {st}")


def register_schedule(
    schedule_id: str,
    schedule_type: ScheduleType | str,
    interval_minutes: Optional[int],
    time_of_day: Optional[str],
    weekdays: Optional[list[int]],
    day_of_month: Optional[int],
) -> None:
    """(Re)register one schedule's recurring job. Call after create/update.

    Best-effort: the DB row (via the startup catch-up pass + the next
    restart's full re-registration) is always the source of truth, so a
    failure here is logged, never raised — it must not fail the API request
    that triggered it.
    """
    if _scheduler is None:
        return
    try:
        trigger = build_trigger(schedule_type, interval_minutes, time_of_day, weekdays, day_of_month)
        _scheduler.add_job(
            _fire_schedule,
            trigger=trigger,
            id=_job_id(schedule_id),
            args=[schedule_id],
            replace_existing=True,
            max_instances=1,
            coalesce=True,
            misfire_grace_time=None,
        )
    except Exception:
        logger.exception("Could not register scheduler job for schedule %s", schedule_id)


def unregister_schedule(schedule_id: str) -> None:
    """Remove a schedule's recurring job and any pending retry job."""
    if _scheduler is None:
        return
    for job_id in (_job_id(schedule_id), _retry_job_id(schedule_id)):
        try:
            _scheduler.remove_job(job_id)
        except JobLookupError:
            pass


def _schedule_retry(schedule_id: str, run_at: datetime) -> None:
    """Register a one-off job for a backoff retry (see _execute_or_skip).

    Independent of the schedule's normal recurring job — whichever of the
    two fires first wins the atomic claim in _claim_and_execute, the other
    safely no-ops, so the two can never cause a double execution.
    """
    if _scheduler is None:
        return
    try:
        _scheduler.add_job(
            _fire_schedule,
            trigger=DateTrigger(run_date=run_at),  # naive local time — see build_trigger's note
            id=_retry_job_id(schedule_id),
            args=[schedule_id],
            replace_existing=True,
            misfire_grace_time=None,
        )
    except Exception:
        logger.exception("Could not schedule retry for schedule %s", schedule_id)


async def _fire_schedule(schedule_id: str) -> None:
    try:
        await _claim_and_execute(schedule_id, utcnow())
    except Exception:
        logger.exception("Scheduled job fire failed for schedule %s", schedule_id)


async def _maintenance_tick() -> None:
    try:
        async with async_session_maker() as session:
            await _reconcile_running_runs(session)
            await _reclaim_stale_runs(session)
    except Exception:
        logger.exception("Scheduled maintenance tick failed")


async def start_scheduler() -> None:
    """Start the APScheduler instance. Call once from app startup.

    Order matters: the catch-up pass must run before any recurring jobs are
    registered, so a schedule that was already overdue at boot fires once
    (via the same claim/execute path as always) instead of the fresh
    CronTrigger/IntervalTrigger silently computing a future-only next fire
    time and skipping the backlog.
    """
    global _scheduler

    async with async_session_maker() as session:
        await _run_catch_up(session)

    # No explicit timezone: APScheduler defaults to the system's local
    # timezone (via tzlocal), matching utcnow()'s naive-local convention.
    scheduler = AsyncIOScheduler()
    scheduler.add_job(
        _maintenance_tick,
        trigger=IntervalTrigger(seconds=SCHEDULER_TICK_INTERVAL_SECONDS),
        id="schedule-maintenance",
        replace_existing=True,
        max_instances=1,
        coalesce=True,
        misfire_grace_time=None,
    )

    async with async_session_maker() as session:
        result = await session.execute(
            select(AgentSchedule).where(AgentSchedule.is_active == True)
        )
        for schedule in result.scalars().all():
            weekdays_list = (
                [int(d) for d in schedule.weekdays.split(",")] if schedule.weekdays else None
            )
            try:
                trigger = build_trigger(
                    schedule.schedule_type, schedule.interval_minutes, schedule.time_of_day,
                    weekdays_list, schedule.day_of_month,
                )
            except Exception:
                logger.exception(
                    "Could not build startup trigger for schedule %s — it will not fire "
                    "until updated", schedule.id,
                )
                continue
            scheduler.add_job(
                _fire_schedule, trigger=trigger, id=_job_id(schedule.id), args=[schedule.id],
                replace_existing=True, max_instances=1, coalesce=True, misfire_grace_time=None,
            )

    _scheduler = scheduler
    _scheduler.start()


async def stop_scheduler() -> None:
    """Shut down the APScheduler instance. Call once from app shutdown."""
    global _scheduler
    if _scheduler is not None:
        _scheduler.shutdown(wait=False)
        _scheduler = None


async def _run_catch_up(session) -> None:
    """Drain any backlog of overdue schedules once at startup (bounded).

    Mirrors what the old tick loop's very first tick would have done.
    _run_due_schedules dispatches at most SCHEDULER_DISPATCH_BATCH_SIZE per
    call, so this loops until a pass finds nothing left due — in practice at
    most one or two iterations even after extended downtime, since each
    claimed schedule jumps straight to its current due slot rather than
    replaying every missed occurrence.
    """
    for _ in range(50):  # safety cap against an unexpected runaway backlog
        had_due = await _run_due_schedules(session)
        if not had_due:
            break


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
    stuck before the current process started), this runs on every
    maintenance tick — it closes the gap where a run gets orphaned
    mid-session (a crash, a hung LLM call, a mid-generation server restart)
    and would otherwise block that schedule forever. SCHEDULE_RUN_STALE_SECONDS
    is generous enough to exceed the LLM http client's own request timeout,
    so a run this stale has almost certainly already died at a lower layer.
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


async def _run_due_schedules(session) -> bool:
    """Claim+dispatch any schedules already due. Returns whether any were found.

    Only still used for the startup catch-up pass (see _run_catch_up) — once
    the scheduler is running, each schedule's own CronTrigger/IntervalTrigger
    job calls _claim_and_execute directly as soon as it's due, instead of
    this being discovered by a poll.
    """
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
        return False

    # Each concurrent claim gets its own session — an AsyncSession must not
    # be shared across concurrently-running coroutines.
    await asyncio.gather(
        *(_claim_and_execute(schedule_id, now) for schedule_id in due_schedule_ids)
    )
    return True


async def _claim_and_execute(schedule_id: str, now: datetime) -> None:
    """Atomically claim one schedule's due occurrence, then execute or skip it.

    The claim is a compare-and-swap on AgentSchedule.next_run_at: only the
    caller whose UPDATE actually matches the row (next_run_at still equals
    the value we read) wins it. This is what makes it safe to invoke this
    concurrently — from the schedule's own recurring trigger, a pending
    retry's one-off trigger, the startup catch-up pass, and across any
    number of separate worker processes/instances — without two callers
    ever processing the same due occurrence.
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
                return  # already handled by another caller, deactivated, or not actually due

            scheduled_for = schedule.next_run_at
            new_next_run_at = _compute_advanced_next_run_at(schedule, scheduled_for, now)

            claim_result = await session.execute(
                update(AgentSchedule)
                .where(AgentSchedule.id == schedule_id, AgentSchedule.next_run_at == scheduled_for)
                .values(next_run_at=new_next_run_at)
            )
            if claim_result.rowcount == 0:
                await session.rollback()
                return  # another caller won the claim for this occurrence first
            await session.commit()
        except Exception:
            logger.exception("Failed to claim due occurrence for schedule %s", schedule_id)
            await session.rollback()
            return

        await _execute_or_skip(session, schedule, scheduled_for, now)


async def _execute_or_skip(
    session, schedule: AgentSchedule, scheduled_for: datetime, now: datetime
) -> None:
    """Start (or skip) the scheduled run this caller just claimed.

    Skip policy: if this schedule's previous run is still active, drop this
    trigger rather than queue it. The partial unique index on
    schedule_runs(schedule_id) WHERE status='RUNNING' is the real mutex here
    — the flush() below either claims the run slot or fails with
    IntegrityError if another run for this schedule is still active, safely
    across any number of concurrent callers (not just within one process).
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
        retry_at: Optional[datetime] = None
        if not is_terminal and schedule.retry_count < MAX_SCHEDULE_RETRY_ATTEMPTS:
            schedule.retry_count += 1
            backoff_seconds = SCHEDULE_RETRY_BACKOFF_SECONDS[
                min(schedule.retry_count, len(SCHEDULE_RETRY_BACKOFF_SECONDS)) - 1
            ]
            retry_at = now + timedelta(seconds=backoff_seconds)
            schedule.next_run_at = retry_at
        else:
            schedule.retry_count = 0
        await session.commit()

        # A retry's due time falls outside the schedule's normal recurring
        # trigger's cadence — without a dedicated one-off job for it, nothing
        # would ever fire at that moment.
        if retry_at is not None:
            _schedule_retry(schedule.id, retry_at)
