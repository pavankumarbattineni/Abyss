"""The only place Abyss reads from LangSmith (read-only).

Every query is scoped to Abyss's own tracing project (ABYSS_CONFIG.LANGSMITH
.project), so even an API key that can see other projects in the same
LangSmith account never exposes them here. Calls are synchronous (the SDK's
client); callers run them in a thread.

Uses `Client.list_runs` (LangSmith's /runs/query endpoint), supported until
January 2027; when moving to `client.runs.query`, only this file changes.
"""
import warnings
from datetime import datetime
from functools import lru_cache

from langsmith import Client
from langsmith.schemas import Run

from config import config

_cfg: dict = config.get("LANGSMITH", {}) or {}


def tracing_enabled() -> bool:
    return bool(_cfg.get("tracing_enabled") and _cfg.get("api_key") and _cfg.get("project"))


def project_name() -> str:
    return _cfg.get("project", "")


@lru_cache(maxsize=1)
def _client() -> Client:
    return Client(api_key=_cfg["api_key"], api_url=_cfg.get("endpoint") or None)


def fetch_trace_runs(trace_id: str) -> list[Run]:
    """Every run of one trace, in Abyss's project."""
    with warnings.catch_warnings():
        warnings.simplefilter("ignore", DeprecationWarning)
        return list(_client().list_runs(project_name=project_name(), trace_id=trace_id))


def list_user_root_runs(user_id: str, since: datetime, limit: int = 100) -> list[Run]:
    """Root runs tagged with this user's id (metadata.user_id), newest first."""
    # user_id is a UUID from our own database; quotes can't appear in it.
    query = f'and(eq(metadata_key, "user_id"), eq(metadata_value, "{user_id}"))'
    with warnings.catch_warnings():
        warnings.simplefilter("ignore", DeprecationWarning)
        return list(
            _client().list_runs(
                project_name=project_name(), is_root=True, start_time=since, filter=query, limit=limit
            )
        )
