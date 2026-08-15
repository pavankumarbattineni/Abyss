from datetime import datetime
from typing import Literal, Optional

from pydantic import BaseModel


class UsageRunItem(BaseModel):
    """One agent run's token usage and cost — one row per StreamRecord.

    total_tokens is input + output (cache_read_tokens is a subset of
    input_tokens, not additive). cost_usd is None (never 0) whenever the
    model's pricing isn't known to LiteLLM, distinct from a genuinely free
    model. Token/cost fields are also None for a run that never reached a
    completed LLM call (e.g. failed before resolving an agent).
    """
    stream_id: str
    thread_id: str
    agent_id: str
    agent_name: str
    status: str
    input_tokens: Optional[int] = None
    cache_read_tokens: Optional[int] = None
    output_tokens: Optional[int] = None
    total_tokens: Optional[int] = None
    cost_usd: Optional[float] = None
    llm_source: Optional[Literal["default", "byok"]] = None
    provider: Optional[str] = None
    model: Optional[str] = None
    created_at: datetime
    completed_at: Optional[datetime] = None


class UsageRunListResponse(BaseModel):
    items: list[UsageRunItem]
    total: int
    page: int
    page_size: int


class UsageSummaryResponse(BaseModel):
    """Overall usage summary for the authenticated user.

    total_threads/total_runs count every thread/run ever created, including
    ones later soft-deleted — the interaction (and any cost) already
    happened. total_agents counts only currently-active, top-level agents
    (sub-agents excluded) — an agent you've deleted isn't one you "have"
    anymore, unlike a historical thread or run.
    """
    total_spent_usd: float
    total_threads: int
    total_runs: int
    total_agents: int
