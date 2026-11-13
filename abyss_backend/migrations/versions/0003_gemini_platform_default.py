"""Make Gemini 3.5 Flash-Lite the platform default model.

Agents without a model of their own ("Default") now run on Gemini 3.5
Flash-Lite with the platform's Google key. The seed only inserts, so existing
databases need this: it makes sure the Google provider and the model row
exist, then moves the single is_platform_default flag to it. Agents that
picked a specific model are untouched.

Revision ID: 0003
Revises: 0002
Create Date: 2026-11-13
"""
from typing import Sequence, Union

from alembic import op

revision: str = "0003"
down_revision: Union[str, Sequence[str], None] = "0002"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

_PROVIDER = ("google", "Google Gemini")
_MODEL = ("gemini-3.5-flash-lite", "Gemini 3.5 Flash-Lite")


def _set_default(provider: str, model: str) -> None:
    # Clear first: a partial unique index allows only one default row.
    op.execute("UPDATE provider_models SET is_platform_default = false WHERE is_platform_default")
    op.execute(f"""
        UPDATE provider_models SET is_platform_default = true
        WHERE model_name = '{model}'
          AND provider_id = (SELECT id FROM providers WHERE name = '{provider}')
    """)


def upgrade() -> None:
    op.execute(f"""
        INSERT INTO providers (id, name, display_name, is_active, created_at, updated_at)
        VALUES (gen_random_uuid()::text, '{_PROVIDER[0]}', '{_PROVIDER[1]}', true, now(), now())
        ON CONFLICT (name) DO NOTHING
    """)
    op.execute(f"""
        INSERT INTO provider_models
            (id, provider_id, model_name, display_name, is_platform_default, reasoning_mode,
             is_active, created_at, updated_at)
        SELECT gen_random_uuid()::text, p.id, '{_MODEL[0]}', '{_MODEL[1]}', false, 'prompt',
               true, now(), now()
        FROM providers p WHERE p.name = '{_PROVIDER[0]}'
        ON CONFLICT ON CONSTRAINT uq_provider_models_provider_model DO NOTHING
    """)
    _set_default(_PROVIDER[0], _MODEL[0])


def downgrade() -> None:
    _set_default("openai", "gpt-5-mini")
