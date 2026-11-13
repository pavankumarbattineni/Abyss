from datetime import datetime
from typing import Any, Optional

from pydantic import BaseModel


class TraceSummary(BaseModel):
    id: str
    kind: str
    name: str
    status: str
    error: Optional[str] = None
    thread_id: Optional[str] = None
    agent_id: Optional[str] = None
    start_time: datetime
    end_time: Optional[datetime] = None
    latency_ms: Optional[int] = None
    prompt_tokens: int
    completion_tokens: int
    total_tokens: int
    total_cost: Optional[float] = None
    span_count: int
    llm_calls: int
    tool_calls: int
    error_count: int
    models: list[str]
    input_preview: Optional[str] = None
    output_preview: Optional[str] = None
    complete: bool

    model_config = {"from_attributes": True}


class TraceListResponse(BaseModel):
    items: list[TraceSummary]
    total: int
    page: int
    page_size: int
    # False when LangSmith tracing isn't configured for this deployment.
    enabled: bool
    last_synced_at: Optional[datetime] = None


class TraceSpanOut(BaseModel):
    id: str
    parent_id: Optional[str] = None
    position: int
    depth: int
    name: str
    run_type: str
    status: str
    error: Optional[str] = None
    start_time: datetime
    end_time: Optional[datetime] = None
    latency_ms: Optional[int] = None
    prompt_tokens: int
    completion_tokens: int
    total_tokens: int
    total_cost: Optional[float] = None
    model: Optional[str] = None
    inputs: Optional[Any] = None
    outputs: Optional[Any] = None
    inputs_truncated: bool
    outputs_truncated: bool
    meta: Optional[dict] = None

    model_config = {"from_attributes": True}


class TraceDetail(TraceSummary):
    langsmith_url: Optional[str] = None
    spans: list[TraceSpanOut]


class TraceDayStat(BaseModel):
    date: str
    traces: int
    errors: int
    p50_latency_ms: Optional[int] = None
    total_tokens: int
    total_cost: float


class TraceModelStat(BaseModel):
    model: str
    calls: int
    total_tokens: int
    total_cost: float
    avg_latency_ms: Optional[int] = None


class TraceStats(BaseModel):
    days: int
    traces: int
    errors: int
    error_rate: float
    p50_latency_ms: Optional[int] = None
    p95_latency_ms: Optional[int] = None
    total_tokens: int
    total_cost: float
    by_day: list[TraceDayStat]
    by_model: list[TraceModelStat]


class TraceSyncResponse(BaseModel):
    enabled: bool
    synced: int
