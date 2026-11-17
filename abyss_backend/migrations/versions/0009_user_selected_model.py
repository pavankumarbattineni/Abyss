"""The selected model belongs to the user, not to each agent

Users pick one model (in the chat box) for all of their agents and chats:
users.llm_model_id replaces agents.llm_model_id. NULL means "Default" (the
platform default model). The foreign key keeps the reference valid: if a model
row were ever deleted, the user falls back to Default.

Existing choices carry over: each user gets the model of their most recently
used agent that had one, if that model is still active and the user still has
a key for its provider (otherwise Default).

Revision ID: 0009
Revises: 0008
Create Date: 2026-11-17 23:30:00
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = '0009'
down_revision: Union[str, Sequence[str], None] = '0008'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

FK_USERS_MODEL = 'fk_users_llm_model_id_provider_models'


def upgrade() -> None:
    op.add_column('users', sa.Column('llm_model_id', sa.String(length=36), nullable=True))
    op.create_foreign_key(
        FK_USERS_MODEL, 'users', 'provider_models', ['llm_model_id'], ['id'], ondelete='SET NULL'
    )
    op.execute("""
        UPDATE users AS u
        SET llm_model_id = chosen.llm_model_id
        FROM (
            SELECT DISTINCT ON (a.user_id) a.user_id, a.llm_model_id
            FROM agents AS a
            JOIN provider_models AS pm ON pm.id = a.llm_model_id AND pm.is_active
            JOIN llm_credentials AS c
              ON c.user_id = a.user_id AND c.provider_id = pm.provider_id AND c.is_active
            WHERE a.llm_model_id IS NOT NULL AND a.is_active
            ORDER BY a.user_id, a.updated_at DESC
        ) AS chosen
        WHERE u.id = chosen.user_id
    """)
    # Dropping the column also drops its (unnamed) foreign key.
    op.drop_column('agents', 'llm_model_id')


def downgrade() -> None:
    op.add_column('agents', sa.Column('llm_model_id', sa.String(length=36), nullable=True))
    op.create_foreign_key(None, 'agents', 'provider_models', ['llm_model_id'], ['id'])
    op.execute("""
        UPDATE agents AS a
        SET llm_model_id = u.llm_model_id
        FROM users AS u
        WHERE a.user_id = u.id AND u.llm_model_id IS NOT NULL
    """)
    op.drop_constraint(FK_USERS_MODEL, 'users', type_='foreignkey')
    op.drop_column('users', 'llm_model_id')
