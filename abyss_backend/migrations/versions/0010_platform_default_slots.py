"""Two more platform models: "Default - 1" and "Default - 2"

provider_models.platform_slot (1, 2; at most one model per slot) marks extra
models that run on the platform's key like the default; users.llm_default_slot
records which one a user picked (with llm_model_id NULL). The same models stay
in the BYOK list under their own names.

Slot 1 = Gemini 3.5 Flash, slot 2 = Gemini 3 Flash (preview); the default and
both slots use native reasoning. The catalog rows are added here if missing
(database/seed.py adds the rest of the catalog at startup).

Revision ID: 0010
Revises: 0009
Create Date: 2026-11-23 18:00:00
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = '0010'
down_revision: Union[str, Sequence[str], None] = '0009'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

SLOTS = {1: ('gemini-3.5-flash', 'Gemini 3.5 Flash'), 2: ('gemini-3-flash-preview', 'Gemini 3 Flash (preview)')}
NATIVE = ('gemini-3.5-flash-lite', 'gemini-3.5-flash', 'gemini-3-flash-preview')


def upgrade() -> None:
    op.add_column('provider_models', sa.Column('platform_slot', sa.Integer(), nullable=True))
    op.create_index(
        'uq_provider_models_platform_slot', 'provider_models', ['platform_slot'],
        unique=True, postgresql_where=sa.text('platform_slot IS NOT NULL'),
    )
    op.add_column('users', sa.Column('llm_default_slot', sa.Integer(), nullable=True))
    for slot, (model, display) in SLOTS.items():
        # Only where the google provider exists (a fresh database gets its
        # catalog -- and these slots -- from the seed at startup).
        op.execute(sa.text("""
            INSERT INTO provider_models
                (id, provider_id, model_name, display_name, is_platform_default, reasoning_mode,
                 is_active, created_at, updated_at)
            SELECT gen_random_uuid()::text, p.id, :model, :display, false, 'native', true, now(), now()
            FROM providers p
            WHERE p.name = 'google'
              AND NOT EXISTS (SELECT 1 FROM provider_models pm WHERE pm.provider_id = p.id AND pm.model_name = :model)
        """).bindparams(model=model, display=display))
        op.execute(sa.text("""
            UPDATE provider_models SET platform_slot = :slot
            WHERE model_name = :model
              AND provider_id = (SELECT id FROM providers WHERE name = 'google')
              AND NOT EXISTS (SELECT 1 FROM provider_models WHERE platform_slot = :slot)
        """).bindparams(slot=slot, model=model))
    op.execute(sa.text(
        "UPDATE provider_models SET reasoning_mode = 'native' WHERE model_name IN :models"
    ).bindparams(sa.bindparam('models', value=list(NATIVE), expanding=True)))


def downgrade() -> None:
    op.execute(sa.text(
        "UPDATE provider_models SET reasoning_mode = 'prompt' WHERE model_name IN ('gemini-3.5-flash', 'gemini-3-flash-preview')"
    ))
    op.drop_column('users', 'llm_default_slot')
    op.drop_index('uq_provider_models_platform_slot', table_name='provider_models')
    op.drop_column('provider_models', 'platform_slot')
