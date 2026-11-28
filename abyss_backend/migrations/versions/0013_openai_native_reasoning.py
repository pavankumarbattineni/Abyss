"""OpenAI models with native reasoning (2026-11-28)

Each OpenAI catalog model was called once through the Responses API with
reasoning on (medium effort, summaries requested) on a multi-step question.
All 14 reason natively. 12 also return reasoning summaries -- what the chat
shows as the agent's thinking -- so they switch to native reasoning here.

GPT-6.2 Astra and GPT-6.2 Sol stay on prompt reasoning: they reason, but
returned no summary at all (not even a "detailed" one), so with native
reasoning the chat would show no thinking for them.

New databases get the same from database/seed.py (NATIVE_REASONING_MODELS).

Revision ID: 0013
Revises: 0012
Create Date: 2026-11-28 12:00:00
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = '0013'
down_revision: Union[str, Sequence[str], None] = '0012'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

NATIVE_OPENAI = (
    "gpt-6-astra", "gpt-6-sol", "gpt-6-luna",
    "gpt-6.1-sol", "gpt-6.1-terra",
    "gpt-5.6-sol", "gpt-5.6-terra", "gpt-5.6-luna",
    "gpt-5.5", "gpt-5.4", "gpt-5.4-mini", "gpt-5.2",
)


def _set(mode: str) -> None:
    op.execute(sa.text(
        "UPDATE provider_models SET reasoning_mode = :mode, updated_at = now() "
        "WHERE model_name IN :models AND provider_id = (SELECT id FROM providers WHERE name = 'openai')"
    ).bindparams(sa.bindparam('models', value=list(NATIVE_OPENAI), expanding=True), mode=mode))


def upgrade() -> None:
    _set('native')


def downgrade() -> None:
    _set('prompt')
