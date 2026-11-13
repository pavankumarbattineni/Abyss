"""Gemini 3.5 Flash-Lite uses native reasoning

With the <reasoning> prompt protocol, Gemini 3.5 Flash-Lite (the platform
default) sometimes wrote tool calls as text or stopped after its reasoning, so
specialists were skipped and turns ended without an answer. With the model's
own reasoning (plus a thinking budget) it delegated correctly every time.

Revision ID: 0006
Revises: 0005
Create Date: 2026-11-13 21:00:00
"""
from typing import Sequence, Union

from alembic import op


revision: str = '0006'
down_revision: Union[str, Sequence[str], None] = '0005'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute("UPDATE provider_models SET reasoning_mode = 'native' WHERE model_name = 'gemini-3.5-flash-lite'")


def downgrade() -> None:
    op.execute("UPDATE provider_models SET reasoning_mode = 'prompt' WHERE model_name = 'gemini-3.5-flash-lite'")
