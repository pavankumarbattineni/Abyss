"""Default / Default - 1 / Default - 2: the platform's three models (no database)."""
from datetime import UTC, datetime
from types import SimpleNamespace

from database.seed import NATIVE_REASONING_MODELS, PLATFORM_DEFAULT, PLATFORM_SLOTS
from services.llm_credential_service import DEFAULT_CHOICES, default_choice_label
from services.oauth_service import _user_response


def user(model=None, slot=None):
    return SimpleNamespace(id="u", username=None, email="a@b.co", thinking_enabled=True,
                           llm_model_id=model, llm_default_slot=slot, created_at=datetime.now(UTC))


def test_the_picker_value_names_the_users_choice():
    assert _user_response(user()).llm_model_id is None  # Default
    assert _user_response(user(slot=0)).llm_model_id is None
    assert _user_response(user(slot=2)).llm_model_id == "default-2"
    assert _user_response(user(model="pm-1", slot=None)).llm_model_id == "pm-1"


def test_choices_and_labels():
    assert DEFAULT_CHOICES == {"default": 0, "default-1": 1, "default-2": 2}
    assert [default_choice_label(s) for s in (0, 1, 2)] == ["Default", "Default - 1", "Default - 2"]


def test_all_three_platform_models_are_gemini_with_native_reasoning():
    models = [PLATFORM_DEFAULT, *PLATFORM_SLOTS.values()]
    assert len({m for _, m in models}) == 3 and all(p == "google" for p, _ in models)
    assert all(m in NATIVE_REASONING_MODELS for _, m in models)
