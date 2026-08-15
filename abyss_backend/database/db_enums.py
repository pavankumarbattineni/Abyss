"""Enums for DB status/type columns.

schedule_type and status are backed by native Postgres ENUM types
(schedule_type_enum, schedule_run_status_enum — see database/models.py).
This project has no Alembic, so adding a new value to either enum later
requires manually running ALTER TYPE ... ADD VALUE against the DB — see the
raw SQL that accompanied the switch to native enums for the exact syntax.
"""

from enum import Enum


class ScheduleType(str, Enum):
    INTERVAL = "INTERVAL"
    DAILY = "DAILY"
    WEEKLY = "WEEKLY"
    MONTHLY = "MONTHLY"


class ScheduleRunStatus(str, Enum):
    PENDING = "PENDING"
    RUNNING = "RUNNING"
    COMPLETED = "COMPLETED"
    FAILED = "FAILED"
    SKIPPED = "SKIPPED"
