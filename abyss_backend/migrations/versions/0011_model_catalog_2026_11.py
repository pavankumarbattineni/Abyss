"""Model catalog update (2026-11-24): retire deprecated models, new defaults

From the providers' model, pricing and deprecation pages:
- Deprecated models leave the BYOK list (is_active false, so their rows and
  history stay). A user who had picked one is moved to its replacement on the
  same provider, so their chats keep working instead of failing with "your
  selected model is no longer available".
- "Default - 1" moves to Gemini 3.6 Flash (Google now routes gemini-3.5-flash
  to it), with native reasoning. "Default - 2" stays on Gemini 3 Flash
  (preview): 3.8 Flash was tried for it but kept failing with 503/504 (high
  demand); 3.8 Flash is in the BYOK list, with native reasoning.

New models (GPT-6, Gemini 4 Neon...) are added by database/seed.py at startup;
the ones this migration needs (replacements, new slots) are added here if missing.

Revision ID: 0011
Revises: 0010
Create Date: 2026-11-24 12:00:00
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = '0011'
down_revision: Union[str, Sequence[str], None] = '0010'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

# (provider, retired model) -> its replacement (model, display name), per the provider's deprecation page.
RETIRED = {
    ('openai', 'gpt-5-mini'): ('gpt-6.1-terra', 'GPT-6.1 Terra'),
    ('anthropic', 'claude-opus-4-5-20251101'): ('claude-opus-5-5', 'Claude Opus 5.5'),
    ('anthropic', 'claude-sonnet-4-5-20250929'): ('claude-sonnet-5-5', 'Claude Sonnet 5.5'),
    ('google', 'gemini-3.5-flash'): ('gemini-3.6-flash', 'Gemini 3.6 Flash'),
    ('google', 'gemini-3.7-flash'): ('gemini-3.8-flash', 'Gemini 3.8 Flash'),
    # Older than the supported families; Google routes it to 3.8 Flash from Dec 1, 2026.
    ('google', 'gemini-2.5-pro'): ('gemini-3.8-flash', 'Gemini 3.8 Flash'),
}
SLOTS = {1: ('gemini-3.6-flash', 'Gemini 3.6 Flash')}
OLD_SLOTS = {1: 'gemini-3.5-flash'}
NATIVE = ('gemini-3.6-flash', 'gemini-3.8-flash')


def _ensure(provider: str, model: str, display: str, mode: str = 'prompt') -> None:
    """The model's row, added if the database doesn't have it (only where the provider exists)."""
    op.execute(sa.text("""
        INSERT INTO provider_models
            (id, provider_id, model_name, display_name, is_platform_default, reasoning_mode,
             is_active, created_at, updated_at)
        SELECT gen_random_uuid()::text, p.id, :model, :display, false, :mode, true, now(), now()
        FROM providers p
        WHERE p.name = :provider
          AND NOT EXISTS (SELECT 1 FROM provider_models pm WHERE pm.provider_id = p.id AND pm.model_name = :model)
    """).bindparams(provider=provider, model=model, display=display, mode=mode))


def _row(provider: str, model: str) -> str:
    return ("(SELECT pm.id FROM provider_models pm JOIN providers p ON p.id = pm.provider_id "
            f"WHERE p.name = '{provider}' AND pm.model_name = '{model}')")


def upgrade() -> None:
    for (provider, old), (new, display) in RETIRED.items():
        _ensure(provider, new, display, 'native' if new in NATIVE else 'prompt')
        # Users who picked the retired model move to its replacement.
        op.execute(sa.text(
            f"UPDATE users SET llm_model_id = {_row(provider, new)} WHERE llm_model_id = {_row(provider, old)}"
        ))
        op.execute(sa.text(
            f"UPDATE provider_models SET is_active = false, platform_slot = NULL, updated_at = now() "
            f"WHERE id = {_row(provider, old)}"
        ))
    for slot, (model, display) in SLOTS.items():
        _ensure('google', model, display, 'native')
        op.execute(sa.text("UPDATE provider_models SET platform_slot = NULL WHERE platform_slot = :slot").bindparams(slot=slot))
        op.execute(sa.text(
            f"UPDATE provider_models SET platform_slot = :slot, is_active = true, updated_at = now() WHERE id = {_row('google', model)}"
        ).bindparams(slot=slot))
    op.execute(sa.text(
        "UPDATE provider_models SET reasoning_mode = 'native' WHERE model_name IN :models"
    ).bindparams(sa.bindparam('models', value=list(NATIVE), expanding=True)))


def downgrade() -> None:
    for slot, model in OLD_SLOTS.items():
        op.execute(sa.text("UPDATE provider_models SET platform_slot = NULL WHERE platform_slot = :slot").bindparams(slot=slot))
        op.execute(sa.text(
            f"UPDATE provider_models SET platform_slot = :slot, is_active = true WHERE id = {_row('google', model)}"
        ).bindparams(slot=slot))
    # The retired models come back to the list; users stay on their replacement.
    for provider, old in RETIRED:
        if old in OLD_SLOTS.values():
            continue
        op.execute(sa.text(f"UPDATE provider_models SET is_active = true WHERE id = {_row(provider, old)}"))
