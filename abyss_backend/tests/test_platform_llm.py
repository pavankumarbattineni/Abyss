"""Platform keys and default model (utils/platform_llm.py)."""
import pytest

from utils import platform_llm


def test_new_config_shape(monkeypatch):
    monkeypatch.setattr(platform_llm, "_llm_cfg", {
        "default_provider": "google", "default_model": "gemini-3.5-flash-lite",
        "api_keys": {"google": "g-key", "openai": "o-key"},
    })
    assert platform_llm.configured_default() == ("google", "gemini-3.5-flash-lite")
    assert platform_llm.platform_api_key("google") == "g-key"
    assert platform_llm.platform_api_key("anthropic") is None


def test_legacy_openai_config_still_works(monkeypatch):
    monkeypatch.setattr(platform_llm, "_llm_cfg", {"openai_api_key": "o-key", "openai_model": "gpt-5-mini"})
    assert platform_llm.configured_default() == ("openai", "gpt-5-mini")
    assert platform_llm.platform_api_key("openai") == "o-key"


def test_missing_platform_key_is_a_clear_error(monkeypatch):
    monkeypatch.setattr(platform_llm, "_llm_cfg", {"api_keys": {}})
    with pytest.raises(ValueError, match="no google key"):
        platform_llm.build_platform_llm("google", "gemini-3.5-flash-lite")


def test_gemini_native_thinking_follows_each_models_profile():
    """A fixed token budget makes Gemini 3+ return no thoughts at all: models with
    thinking levels get a level (their own default, at least the floor), older
    ones keep the budget. Nothing is keyed on model names."""
    from constants import GEMINI_MIN_THINKING_LEVEL, GEMINI_THINKING_BUDGET
    from utils.llm_providers import _build_google, _gemini_thinking

    class Fake:
        def __init__(self, profile):
            self.profile = profile

    levels = ["minimal", "low", "medium", "high"]
    lifted = _gemini_thinking(Fake({"reasoning_effort_levels": levels, "reasoning_effort_default": "minimal"}))
    assert lifted == {"include_thoughts": True, "thinking_level": GEMINI_MIN_THINKING_LEVEL}
    kept = _gemini_thinking(Fake({"reasoning_effort_levels": levels, "reasoning_effort_default": "high"}))
    assert kept == {"include_thoughts": True, "thinking_level": "high"}
    older = _gemini_thinking(Fake({"reasoning_output": True}))
    assert older == {"include_thoughts": True, "thinking_budget": GEMINI_THINKING_BUDGET}

    native = _build_google("gemini-3.5-flash", "test-key", True)
    assert native.include_thoughts and native.thinking_budget is None and native.reasoning_effort
    plain = _build_google("gemini-3.5-flash", "test-key", False)
    assert plain.include_thoughts is None and plain.reasoning_effort is None and plain.thinking_budget is None
