"""Phase 3 security fixes: CORS origins, active-user check, header-only SSE
auth, Firebase clock skew."""
import inspect

import pytest
from fastapi import HTTPException

from config import parse_origins
from tests._fakes import FakeSession
from utils import auth, firebase


def test_origins_are_explicit_and_normalized():
    assert parse_origins(" https://a.app/ ,http://localhost:3100,,") == [
        "https://a.app",
        "http://localhost:3100",
    ]


def test_wildcard_origin_is_refused():
    with pytest.raises(ValueError):
        parse_origins("https://a.app,*")


async def test_deleted_or_inactive_user_is_rejected():
    with pytest.raises(HTTPException) as exc:
        await auth._ensure_active_user("gone-user", FakeSession(None))
    assert exc.value.status_code == 401


async def test_active_user_passes():
    assert await auth._ensure_active_user("u1", FakeSession("u1")) == "u1"


def test_stream_auth_no_longer_reads_a_query_token():
    assert "token" not in inspect.signature(auth.get_current_user_sse).parameters


async def test_firebase_verification_allows_clock_skew(monkeypatch):
    seen = {}

    def fake_verify(token, **kwargs):
        seen.update(kwargs)
        return {"email": "a@b.c"}

    monkeypatch.setattr(firebase, "initialize_firebase", lambda: None)
    monkeypatch.setattr(firebase.auth, "verify_id_token", fake_verify)
    assert await firebase.verify_firebase_token("t") == {"email": "a@b.c"}
    assert seen.get("clock_skew_seconds") == 10
