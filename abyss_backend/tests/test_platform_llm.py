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
