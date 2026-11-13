"""Profile edits and the checks that guard account deletion (no database)."""

import time
from types import SimpleNamespace

import pytest
from pydantic import ValidationError

from schemas.profile import DeleteAccountRequest, UpdateProfileRequest
from services import profile_service as ps

EMAIL = "owner@example.com"


class _Result:
    def __init__(self, value):
        self.value = value

    def scalar_one_or_none(self):
        return self.value

    def scalar_one(self):
        return self.value

    def scalars(self):
        return SimpleNamespace(all=lambda: self.value)


class _Session:
    """Answers execute() calls in order; records whether anything was deleted."""

    def __init__(self, *answers):
        self.answers = list(answers)
        self.committed = False

    async def execute(self, statement):
        return _Result(self.answers.pop(0))

    async def commit(self):
        self.committed = True


def _user():
    return SimpleNamespace(id="u1", email=EMAIL)


def _claims(monkeypatch, **claims):
    async def verify(token):
        return {"email": EMAIL, "auth_time": time.time(), **claims}

    monkeypatch.setattr(ps, "verify_firebase_token", verify)


def test_username_is_tidied_and_validated():
    assert UpdateProfileRequest(username="  Ada   Lovelace ").username == "Ada Lovelace"
    for bad in ["a", "  a  ", "<script>", "x" * 51]:
        with pytest.raises(ValidationError):
            UpdateProfileRequest(username=bad)


async def _delete(session, **request):
    body = {"confirm_email": EMAIL, "id_token": "token", **request}
    await ps.ProfileService().delete_account(session, "u1", DeleteAccountRequest(**body))


async def test_typed_email_must_match(monkeypatch):
    _claims(monkeypatch)
    session = _Session(_user())
    with pytest.raises(ps.ProfileError) as err:
        await _delete(session, confirm_email="someone@else.com")
    assert err.value.status_code == 400 and not session.committed


async def test_sign_in_must_be_recent(monkeypatch):
    _claims(monkeypatch, auth_time=time.time() - ps.RECENT_SIGN_IN_SECONDS - 60)
    session = _Session(_user())
    with pytest.raises(ps.ProfileError) as err:
        await _delete(session)
    assert err.value.status_code == 403 and not session.committed


async def test_sign_in_must_be_this_account(monkeypatch):
    _claims(monkeypatch, email="intruder@example.com")
    session = _Session(_user())
    with pytest.raises(ps.ProfileError) as err:
        await _delete(session)
    assert err.value.status_code == 403 and not session.committed


async def test_refused_while_an_answer_is_generating(monkeypatch):
    _claims(monkeypatch)
    session = _Session(_user(), ["t1", "t2"], 1)
    with pytest.raises(ps.ProfileError) as err:
        await _delete(session)
    assert err.value.status_code == 409 and not session.committed


async def test_deletes_then_cleans_up(monkeypatch):
    _claims(monkeypatch)
    cleaned, firebase_deleted = [], []

    async def fake_checkpoints(thread_id):
        cleaned.append(thread_id)

    monkeypatch.setattr(ps, "delete_thread_checkpoints", fake_checkpoints)
    monkeypatch.setattr(ps, "_delete_firebase_user", firebase_deleted.append)
    session = _Session(_user(), ["t1", "t2"], 0, None)
    await _delete(session, confirm_email=" OWNER@example.com ")
    assert session.committed
    assert cleaned == ["t1", "t2"] and firebase_deleted == [EMAIL]
