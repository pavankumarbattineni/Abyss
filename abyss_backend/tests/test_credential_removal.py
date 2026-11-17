"""Removing a provider key switches the user's agents on that provider back to Default (no database)."""

from types import SimpleNamespace

import pytest
from sqlalchemy.dialects import postgresql
from sqlalchemy.sql.dml import Update

from services.llm_credential_service import LlmCredentialService


class _Result:
    def __init__(self, value=None, rowcount=0):
        self._value = value
        self.rowcount = rowcount

    def scalar_one_or_none(self):
        return self._value


class _Session:
    """Answers the provider lookup, the credential lookup, then the agent update."""

    def __init__(self, credential, agents_reset):
        self.credential = credential
        self.agents_reset = agents_reset
        self.statements = []
        self.committed = False

    async def execute(self, statement):
        self.statements.append(statement)
        if isinstance(statement, Update):
            return _Result(rowcount=self.agents_reset)
        if len(self.statements) == 1:
            return _Result(SimpleNamespace(id="prov-1", name="openai"))
        return _Result(self.credential)

    async def commit(self):
        self.committed = True


def _sql(statement) -> str:
    return str(statement.compile(dialect=postgresql.dialect(), compile_kwargs={"literal_binds": True}))


async def test_removing_a_key_resets_that_providers_agents_to_default():
    credential = SimpleNamespace(is_active=True)
    session = _Session(credential, agents_reset=2)

    reset = await LlmCredentialService().delete_credential(session, "user-1", "prov-1")

    assert reset == 2
    assert credential.is_active is False and session.committed
    update = next(s for s in session.statements if isinstance(s, Update))
    sql = _sql(update)
    assert "UPDATE agents SET llm_model_id=NULL" in sql
    # Only this user's agents, and only models of the removed provider.
    assert "agents.user_id = 'user-1'" in sql
    assert "provider_models.provider_id = 'prov-1'" in sql


async def test_removing_a_missing_key_changes_nothing():
    session = _Session(credential=None, agents_reset=5)
    with pytest.raises(ValueError):
        await LlmCredentialService().delete_credential(session, "user-1", "prov-1")
    assert not any(isinstance(s, Update) for s in session.statements)
    assert not session.committed
