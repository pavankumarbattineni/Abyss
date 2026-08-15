import calendar
from datetime import datetime, timedelta
from typing import Optional

from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from constants import MAX_SCHEDULES_PER_AGENT
from database.db_enums import ScheduleType
from database.models import AgentSchedule, ScheduleRun, utcnow
from schemas.schedule import ScheduleCreate, ScheduleResponse, ScheduleRunResponse, ScheduleUpdate
from services.agent_service import AgentService


# Pure scheduling math — imported by utils/scheduler.py to advance next_run_at
# with the exact same logic used at schedule creation/update time.


def _normalize_weekdays(weekdays: list[int]) -> str:
    return ",".join(str(d) for d in sorted(set(weekdays)))


def compute_dedup_signature(
    schedule_type: ScheduleType | str,
    interval_minutes: Optional[int],
    time_of_day: Optional[str],
    weekdays: Optional[list[int]],
    day_of_month: Optional[int],
) -> str:
    """Compute a normalized recurrence fingerprint for duplicate detection.

    A Weekly schedule selecting all 7 days is normalized to the Daily
    signature, so it correctly dedupes against an equivalent Daily schedule
    at the same time rather than silently double-firing every day.
    """
    st = schedule_type.value if isinstance(schedule_type, ScheduleType) else schedule_type
    effective_weekdays = weekdays
    if st == ScheduleType.WEEKLY.value and weekdays and sorted(set(weekdays)) == list(range(7)):
        st = ScheduleType.DAILY.value
        effective_weekdays = None

    return ":".join([
        st,
        str(interval_minutes) if interval_minutes is not None else "",
        time_of_day or "",
        _normalize_weekdays(effective_weekdays) if effective_weekdays else "",
        str(day_of_month) if day_of_month is not None else "",
    ])


def _next_interval(interval_minutes: int, from_time: datetime) -> datetime:
    """Anchored to midnight; 15/30/45/60 all divide 1440 evenly, so this
    always lands on a clean boundary with no cross-day remainder."""
    midnight = from_time.replace(hour=0, minute=0, second=0, microsecond=0)
    minutes_since_midnight = (from_time - midnight).total_seconds() / 60
    next_slot_count = int(minutes_since_midnight // interval_minutes) + 1
    return midnight + timedelta(minutes=next_slot_count * interval_minutes)


def _next_daily(hour: int, minute: int, from_time: datetime) -> datetime:
    candidate = from_time.replace(hour=hour, minute=minute, second=0, microsecond=0)
    if candidate <= from_time:
        candidate += timedelta(days=1)
    return candidate


def _next_weekly(weekdays: list[int], hour: int, minute: int, from_time: datetime) -> datetime:
    for offset in range(8):
        day = from_time + timedelta(days=offset)
        if day.weekday() in weekdays:
            candidate = day.replace(hour=hour, minute=minute, second=0, microsecond=0)
            if candidate > from_time:
                return candidate
    raise ValueError("No valid weekday found in the next 8 days — weekdays list is likely empty")


def _next_monthly(day_of_month: int, hour: int, minute: int, from_time: datetime) -> Optional[datetime]:
    """Skips (does not fall back within) any month that doesn't contain
    day_of_month, per the chosen 'skip that month' policy."""
    year, month = from_time.year, from_time.month
    for _ in range(24):  # safety cap — 24 months always contains at least one valid hit
        days_in_month = calendar.monthrange(year, month)[1]
        if day_of_month <= days_in_month:
            candidate = datetime(year, month, day_of_month, hour, minute)
            if candidate > from_time:
                return candidate
        month += 1
        if month > 12:
            month = 1
            year += 1
    return None


def compute_next_run_at(
    schedule_type: ScheduleType | str,
    interval_minutes: Optional[int],
    time_of_day: Optional[str],
    weekdays: Optional[list[int]],
    day_of_month: Optional[int],
    from_time: datetime,
) -> Optional[datetime]:
    st = schedule_type.value if isinstance(schedule_type, ScheduleType) else schedule_type
    if st == ScheduleType.INTERVAL.value:
        return _next_interval(interval_minutes, from_time)

    hour, minute = (int(p) for p in time_of_day.split(":"))
    if st == ScheduleType.DAILY.value:
        return _next_daily(hour, minute, from_time)
    if st == ScheduleType.WEEKLY.value:
        return _next_weekly(sorted(set(weekdays)), hour, minute, from_time)
    if st == ScheduleType.MONTHLY.value:
        return _next_monthly(day_of_month, hour, minute, from_time)
    raise ValueError(f"Unknown schedule_type: {st}")


def _ordinal(n: int) -> str:
    if 11 <= n % 100 <= 13:
        suffix = "th"
    else:
        suffix = {1: "st", 2: "nd", 3: "rd"}.get(n % 10, "th")
    return f"{n}{suffix}"


def _month_end_warning(schedule_type: str, day_of_month: Optional[int]) -> Optional[str]:
    if schedule_type == ScheduleType.MONTHLY.value and day_of_month and day_of_month >= 29:
        ordinal = _ordinal(day_of_month)
        return (
            f"Day {day_of_month} was selected. The schedule will run only in months "
            f"that contain a {ordinal} day; it is skipped in shorter months."
        )
    return None


class ScheduleService:

    def __init__(self) -> None:
        self._agent_service = AgentService()

    def _to_response(self, schedule: AgentSchedule) -> ScheduleResponse:
        weekdays_list = (
            [int(d) for d in schedule.weekdays.split(",")] if schedule.weekdays else None
        )
        return ScheduleResponse(
            id=schedule.id,
            agent_id=schedule.agent_id,
            schedule_type=schedule.schedule_type,
            interval_minutes=schedule.interval_minutes,
            time_of_day=schedule.time_of_day,
            weekdays=weekdays_list,
            day_of_month=schedule.day_of_month,
            input_query=schedule.input_query,
            is_active=schedule.is_active,
            next_run_at=schedule.next_run_at,
            last_run_at=schedule.last_run_at,
            warning=_month_end_warning(schedule.schedule_type, schedule.day_of_month),
        )

    async def _get_schedule_orm(
        self, session: AsyncSession, agent_id: str, schedule_id: str
    ) -> AgentSchedule:
        result = await session.execute(
            select(AgentSchedule).where(
                AgentSchedule.id == schedule_id,
                AgentSchedule.agent_id == agent_id,
                AgentSchedule.is_active == True,
            )
        )
        schedule = result.scalar_one_or_none()
        if not schedule:
            raise ValueError("Schedule not found")
        return schedule

    async def _check_duplicate(
        self,
        session: AsyncSession,
        agent_id: str,
        signature: str,
        exclude_schedule_id: Optional[str] = None,
    ) -> None:
        query = select(AgentSchedule.id).where(
            AgentSchedule.agent_id == agent_id,
            AgentSchedule.dedup_signature == signature,
            AgentSchedule.is_active == True,
        )
        if exclude_schedule_id:
            query = query.where(AgentSchedule.id != exclude_schedule_id)
        result = await session.execute(query)
        if result.scalar_one_or_none():
            raise ValueError(
                "An identical active schedule already exists for this agent"
            )

    async def create(
        self, session: AsyncSession, agent_id: str, user_id: str, data: ScheduleCreate
    ) -> ScheduleResponse:
        """Create a new schedule rule for an agent.

        Rejects (ValueError) exact-duplicate active schedules and enforces
        MAX_SCHEDULES_PER_AGENT. next_run_at is computed immediately so the
        scheduler tick loop can pick it up without any extra initialization step.
        """
        await self._agent_service.verify_agent_ownership(session, agent_id, user_id)

        count_result = await session.execute(
            select(func.count()).select_from(AgentSchedule).where(
                AgentSchedule.agent_id == agent_id,
                AgentSchedule.is_active == True,
            )
        )
        if count_result.scalar_one() >= MAX_SCHEDULES_PER_AGENT:
            raise ValueError(
                f"Agent already has the maximum of {MAX_SCHEDULES_PER_AGENT} active schedules"
            )

        signature = compute_dedup_signature(
            data.schedule_type, data.interval_minutes, data.time_of_day, data.weekdays, data.day_of_month
        )
        await self._check_duplicate(session, agent_id, signature)

        next_run = compute_next_run_at(
            data.schedule_type, data.interval_minutes, data.time_of_day,
            data.weekdays, data.day_of_month, utcnow(),
        )

        schedule = AgentSchedule(
            agent_id=agent_id,
            user_id=user_id,
            schedule_type=data.schedule_type,
            interval_minutes=data.interval_minutes,
            time_of_day=data.time_of_day,
            weekdays=_normalize_weekdays(data.weekdays) if data.weekdays else None,
            day_of_month=data.day_of_month,
            input_query=data.input_query,
            dedup_signature=signature,
            next_run_at=next_run,
        )
        session.add(schedule)
        try:
            await session.commit()
        except IntegrityError:
            await session.rollback()
            raise ValueError("An identical active schedule already exists for this agent")
        await session.refresh(schedule)
        return self._to_response(schedule)

    async def list_for_agent(
        self, session: AsyncSession, agent_id: str, user_id: str
    ) -> list[ScheduleResponse]:
        await self._agent_service.verify_agent_ownership(session, agent_id, user_id)
        result = await session.execute(
            select(AgentSchedule).where(
                AgentSchedule.agent_id == agent_id,
                AgentSchedule.is_active == True,
            ).order_by(AgentSchedule.created_at.asc())
        )
        return [self._to_response(s) for s in result.scalars().all()]

    async def update(
        self, session: AsyncSession, agent_id: str, schedule_id: str, user_id: str, data: ScheduleUpdate
    ) -> ScheduleResponse:
        await self._agent_service.verify_agent_ownership(session, agent_id, user_id)
        schedule = await self._get_schedule_orm(session, agent_id, schedule_id)

        if data.input_query is not None:
            schedule.input_query = data.input_query

        recurrence_changed = any(
            v is not None for v in (data.interval_minutes, data.time_of_day, data.weekdays, data.day_of_month)
        )
        if recurrence_changed:
            existing_weekdays = (
                [int(d) for d in schedule.weekdays.split(",")] if schedule.weekdays else None
            )
            new_interval = data.interval_minutes if data.interval_minutes is not None else schedule.interval_minutes
            new_time = data.time_of_day if data.time_of_day is not None else schedule.time_of_day
            new_weekdays = data.weekdays if data.weekdays is not None else existing_weekdays
            new_day = data.day_of_month if data.day_of_month is not None else schedule.day_of_month

            # Re-validate the full combination for this schedule's fixed type —
            # raises ValueError (via pydantic) on an invalid resulting combination.
            ScheduleCreate(
                schedule_type=ScheduleType(schedule.schedule_type),
                interval_minutes=new_interval,
                time_of_day=new_time,
                weekdays=new_weekdays,
                day_of_month=new_day,
            )

            new_signature = compute_dedup_signature(
                schedule.schedule_type, new_interval, new_time, new_weekdays, new_day
            )
            if new_signature != schedule.dedup_signature:
                await self._check_duplicate(session, agent_id, new_signature, exclude_schedule_id=schedule_id)

            schedule.interval_minutes = new_interval
            schedule.time_of_day = new_time
            schedule.weekdays = _normalize_weekdays(new_weekdays) if new_weekdays else None
            schedule.day_of_month = new_day
            schedule.dedup_signature = new_signature
            schedule.next_run_at = compute_next_run_at(
                schedule.schedule_type, new_interval, new_time, new_weekdays, new_day, utcnow()
            )

        try:
            await session.commit()
        except IntegrityError:
            await session.rollback()
            raise ValueError("An identical active schedule already exists for this agent")
        await session.refresh(schedule)
        return self._to_response(schedule)

    async def delete(
        self, session: AsyncSession, agent_id: str, schedule_id: str, user_id: str
    ) -> None:
        await self._agent_service.verify_agent_ownership(session, agent_id, user_id)
        schedule = await self._get_schedule_orm(session, agent_id, schedule_id)
        schedule.is_active = False
        await session.commit()

    async def get_runs(
        self, session: AsyncSession, agent_id: str, schedule_id: str, user_id: str
    ) -> list[ScheduleRunResponse]:
        await self._agent_service.verify_agent_ownership(session, agent_id, user_id)
        await self._get_schedule_orm(session, agent_id, schedule_id)
        result = await session.execute(
            select(ScheduleRun).where(ScheduleRun.schedule_id == schedule_id)
            .order_by(ScheduleRun.created_at.desc())
        )
        return [ScheduleRunResponse.model_validate(r) for r in result.scalars().all()]
