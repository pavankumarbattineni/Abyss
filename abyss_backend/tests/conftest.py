"""Shared test setup."""
import pytest


@pytest.fixture(autouse=True)
def _no_web_image_search(monkeypatch):
    """Tests never reach the real Brave API, whatever key the local config holds;
    the web image tests turn it on themselves with a fake key."""
    from abyss_agents import web_images

    monkeypatch.setattr(web_images, "brave_api_key", lambda: None)
