"""image_sites: sites whose images keep failing to load are skipped for a while

Revision ID: 0012
Revises: 0011
Create Date: 2026-11-24 15:00:00
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = '0012'
down_revision: Union[str, Sequence[str], None] = '0011'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        'image_sites',
        sa.Column('host', sa.String(length=255), primary_key=True),
        sa.Column('failures', sa.Integer(), nullable=False, server_default='0'),
        sa.Column('skip_until', sa.DateTime(), nullable=True),
        sa.Column('updated_at', sa.DateTime(), nullable=False, server_default=sa.text('now()')),
    )


def downgrade() -> None:
    op.drop_table('image_sites')
