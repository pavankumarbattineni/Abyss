"""drop traces.langsmith_url

Traces no longer link out to LangSmith; the Tracing pages show everything
from Abyss's own copy.

Revision ID: 0005
Revises: 0004
Create Date: 2026-11-13 14:00:00
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = '0005'
down_revision: Union[str, Sequence[str], None] = '0004'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.drop_column('traces', 'langsmith_url')


def downgrade() -> None:
    op.add_column('traces', sa.Column('langsmith_url', sa.String(length=500), nullable=True))
