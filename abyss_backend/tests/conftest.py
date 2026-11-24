"""Shared test setup."""
import pytest


@pytest.fixture(autouse=True)
def _no_web_image_search(monkeypatch):
    """Tests never reach the real Brave API, whatever key the local config holds;
    the web image tests turn it on themselves with a fake key."""
    from abyss_agents import web_images

    monkeypatch.setattr(web_images, "brave_api_key", lambda: None)


@pytest.fixture(autouse=True)
def _offline_image_checks(monkeypatch):
    """The visual repair never asks Wikimedia whether an image exists in tests:
    every address exists unless a test says otherwise."""
    from abyss_agents import visual_repair

    async def nothing_missing(srcs):
        return set()

    monkeypatch.setattr(visual_repair, "_missing", nothing_missing)
