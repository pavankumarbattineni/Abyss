"""agent_skills: skills are assigned to agents explicitly

Until now every skill was available to all of a user's agents. Skills stay in
the user's library; an agent uses only the skills linked to it here.

Revision ID: 0008
Revises: 0007
Create Date: 2026-11-17 22:00:00
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = '0008'
down_revision: Union[str, Sequence[str], None] = '0007'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table('agent_skills',
    sa.Column('id', sa.String(length=36), nullable=False),
    sa.Column('is_active', sa.Boolean(), nullable=False),
    sa.Column('created_at', sa.DateTime(), nullable=False),
    sa.Column('updated_at', sa.DateTime(), nullable=False),
    sa.Column('agent_id', sa.String(length=36), nullable=False),
    sa.Column('skill_id', sa.String(length=36), nullable=False),
    sa.ForeignKeyConstraint(['agent_id'], ['agents.id'], ondelete='CASCADE'),
    sa.ForeignKeyConstraint(['skill_id'], ['skills.id'], ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('id'),
    sa.UniqueConstraint('agent_id', 'skill_id', name='uq_agent_skill')
    )
    op.create_index(op.f('ix_agent_skills_agent_id'), 'agent_skills', ['agent_id'], unique=False)
    op.create_index(op.f('ix_agent_skills_skill_id'), 'agent_skills', ['skill_id'], unique=False)


def downgrade() -> None:
    op.drop_index(op.f('ix_agent_skills_skill_id'), table_name='agent_skills')
    op.drop_index(op.f('ix_agent_skills_agent_id'), table_name='agent_skills')
    op.drop_table('agent_skills')
