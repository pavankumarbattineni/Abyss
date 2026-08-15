import re
from datetime import datetime
from typing import Optional

from pydantic import BaseModel, Field, model_validator

from constants import SCHEDULE_ALLOWED_INTERVAL_MINUTES
from database.db_enums import ScheduleType

_TIME_RE = re.compile(r"^([01]\d|2[0-3]):[0-5]\d$")


class ScheduleCreate(BaseModel):
    schedule_type: ScheduleType
    interval_minutes: Optional[int] = Field(default=None, description="Required for INTERVAL: 15, 30, 45, or 60")
    time_of_day: Optional[str] = Field(default=None, description='Required for DAILY/WEEKLY/MONTHLY, "HH:MM" 24h')
    weekdays: Optional[list[int]] = Field(default=None, description="Required for WEEKLY: 0=Mon..6=Sun, at least one")
    day_of_month: Optional[int] = Field(default=None, ge=1, le=31, description="Required for MONTHLY")
    input_query: Optional[str] = Field(
        default=None,
        max_length=8000,
        description=(
            "Optional message sent to the agent on each scheduled trigger, in place of the "
            "generic default trigger message. Omit when the agent's system_prompt already "
            "contains everything it needs to run unattended."
        ),
    )

    @model_validator(mode="after")
    def _validate_combination(self) -> "ScheduleCreate":
        if self.schedule_type == ScheduleType.INTERVAL:
            if self.interval_minutes not in SCHEDULE_ALLOWED_INTERVAL_MINUTES:
                raise ValueError(
                    f"interval_minutes must be one of {SCHEDULE_ALLOWED_INTERVAL_MINUTES} for INTERVAL schedules"
                )
        elif self.schedule_type == ScheduleType.DAILY:
            self._require_time_of_day()
        elif self.schedule_type == ScheduleType.WEEKLY:
            self._require_time_of_day()
            if not self.weekdays:
                raise ValueError("weekdays must contain at least one day (0=Mon..6=Sun) for WEEKLY schedules")
            if any(d < 0 or d > 6 for d in self.weekdays):
                raise ValueError("weekdays entries must be between 0 (Mon) and 6 (Sun)")
            if len(set(self.weekdays)) != len(self.weekdays):
                raise ValueError("weekdays must not contain duplicates")
        elif self.schedule_type == ScheduleType.MONTHLY:
            self._require_time_of_day()
            if self.day_of_month is None:
                raise ValueError("day_of_month is required for MONTHLY schedules")
        return self

    def _require_time_of_day(self) -> None:
        if not self.time_of_day or not _TIME_RE.match(self.time_of_day):
            raise ValueError('time_of_day is required and must be "HH:MM" (24h) for this schedule_type')


class ScheduleUpdate(BaseModel):
    interval_minutes: Optional[int] = None
    time_of_day: Optional[str] = None
    weekdays: Optional[list[int]] = None
    day_of_month: Optional[int] = Field(default=None, ge=1, le=31)
    input_query: Optional[str] = Field(default=None, max_length=8000)


class ScheduleResponse(BaseModel):
    id: str
    agent_id: str
    schedule_type: ScheduleType
    interval_minutes: Optional[int] = None
    time_of_day: Optional[str] = None
    weekdays: Optional[list[int]] = None
    day_of_month: Optional[int] = None
    input_query: Optional[str] = None
    is_active: bool
    next_run_at: Optional[datetime] = None
    last_run_at: Optional[datetime] = None
    warning: Optional[str] = None

    model_config = {"from_attributes": True}


class ScheduleRunResponse(BaseModel):
    id: str
    schedule_id: str
    scheduled_for: datetime
    thread_id: Optional[str] = None
    status: str
    error_message: Optional[str] = None
    created_at: datetime

    model_config = {"from_attributes": True}
