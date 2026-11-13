"""Clean up leftovers from databases created before Alembic.

Every statement is idempotent: on a database built from 0001 it changes
nothing. On an older database (adopted at 0001 by database/migrations.py) it
removes the scheduling feature's tables, the dropped Firebase UID column, and
the old NOT NULL password column, and adds provider_models.reasoning_mode --
the ad-hoc ALTERs main.py used to run on every startup.

Revision ID: 0002
Revises: 0001
Create Date: 2026-11-13
"""
from typing import Sequence, Union

from alembic import op

revision: str = "0002"
down_revision: Union[str, Sequence[str], None] = "0001"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Scheduling was removed from Abyss (schedule_runs references agent_schedules).
    op.execute("DROP TABLE IF EXISTS schedule_runs")
    op.execute("DROP TABLE IF EXISTS agent_schedules")
    # Passwords are handled by Firebase; Abyss never stores the Firebase UID.
    op.execute("ALTER TABLE users ALTER COLUMN password_hash DROP NOT NULL")
    op.execute("ALTER TABLE users DROP COLUMN IF EXISTS firebase_uid CASCADE")
    op.execute(
        "ALTER TABLE provider_models "
        "ADD COLUMN IF NOT EXISTS reasoning_mode VARCHAR(10) NOT NULL DEFAULT 'prompt'"
    )


def downgrade() -> None:
    # Nothing to restore: these were removals of obsolete schema.
    pass
