"""Removing a provider key switches the user's selected model back to Default if it needs that key (no database)."""

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
    """Answers the provider lookup, the credential lookup, then the user update."""

    def __init__(self, credential, users_reset):
        self.credential = credential
        self.users_reset = users_reset
        self.statements = []
        self.committed = False

    async def execute(self, statement):
        self.statements.append(statement)
        if isinstance(statement, Update):
            return _Result(rowcount=self.users_reset)
        if len(self.statements) == 1:
            return _Result(SimpleNamespace(id="prov-1", name="openai"))
        return _Result(self.credential)

    async def commit(self):
        self.committed = True


def _sql(statement) -> str:
    return str(statement.compile(dialect=postgresql.dialect(), compile_kwargs={"literal_binds": True}))


async def test_removing_a_key_resets_the_users_model_to_default():
    credential = SimpleNamespace(is_active=True)
    session = _Session(credential, users_reset=1)

    reset = await LlmCredentialService().delete_credential(session, "user-1", "prov-1")

    assert reset is True
    assert credential.is_active is False and session.committed
    update = next(s for s in session.statements if isinstance(s, Update))
    sql = _sql(update)
    assert "UPDATE users SET llm_model_id=NULL" in sql
    # Only this user, and only if their model belongs to the removed provider.
    assert "users.id = 'user-1'" in sql
    assert "provider_models.provider_id = 'prov-1'" in sql


async def test_removing_a_key_for_an_unused_provider_keeps_the_model():
    session = _Session(SimpleNamespace(is_active=True), users_reset=0)
    assert await LlmCredentialService().delete_credential(session, "user-1", "prov-1") is False
    assert session.committed


async def test_removing_a_missing_key_changes_nothing():
    session = _Session(credential=None, users_reset=1)
    with pytest.raises(ValueError):
        await LlmCredentialService().delete_credential(session, "user-1", "prov-1")
    assert not any(isinstance(s, Update) for s in session.statements)
    assert not session.committed
