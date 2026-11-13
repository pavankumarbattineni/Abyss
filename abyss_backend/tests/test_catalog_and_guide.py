"""The seeded model catalog and the Guide's suggested questions."""
import pytest

from constants import STARTER_AGENT_NAME
from database.seed import CATALOG, PLATFORM_DEFAULT
from services.agent_service import AgentService
from tests._fakes import FakeSession
from utils.llm_providers import PROVIDERS


def test_catalog_providers_are_supported():
    assert set(CATALOG) <= set(PROVIDERS)


def test_platform_default_is_an_openai_catalog_model():
    provider, model = PLATFORM_DEFAULT
    # It runs on the platform's own OpenAI key.
    assert provider == "openai"
    assert model in [name for name, _ in CATALOG[provider][1]]


def test_catalog_has_no_duplicate_models():
    for _, models in CATALOG.values():
        names = [name for name, _ in models]
        assert len(names) == len(set(names))


async def test_guide_has_five_short_questions():
    questions = await AgentService().get_sample_questions(FakeSession(STARTER_AGENT_NAME), "a", "u")
    assert len(questions) == 5
    assert all(len(q) <= 70 for q in questions)


async def test_other_agents_have_no_questions():
    assert await AgentService().get_sample_questions(FakeSession("My agent"), "a", "u") == []


async def test_missing_agent_is_an_error():
    with pytest.raises(ValueError):
        await AgentService().get_sample_questions(FakeSession(None), "a", "u")
