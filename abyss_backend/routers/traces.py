"""Tracing: the signed-in user's own LangSmith traces, as copied by
services/trace_sync.py. Every query is filtered by the caller's user id."""
import logging
from datetime import timedelta
from typing import Literal, Optional

from fastapi import APIRouter, Depends, HTTPException, Query, status
from langsmith.utils import (
    LangSmithAuthError,
    LangSmithConnectionError,
    LangSmithError,
    LangSmithRateLimitError,
)
from sqlalchemy import Date, cast, func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from database.models import Trace, TraceSpan, utcnow
from database.session import get_async_session
from schemas.trace import (
    TraceDayStat,
    TraceDetail,
    TraceListResponse,
    TraceModelStat,
    TraceSpanOut,
    TraceStats,
    TraceSummary,
    TraceSyncResponse,
)
from services import trace_sync
from utils import langsmith_client
from utils.auth import get_current_user

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/traces", tags=["traces"])


def _since(days: int):
    return utcnow() - timedelta(days=days)


@router.get("", response_model=TraceListResponse)
async def list_traces(
    days: int = Query(7, ge=1, le=trace_sync.RETENTION_DAYS),
    status_filter: Optional[Literal["success", "error", "pending"]] = Query(None, alias="status"),
    kind: Optional[Literal["agent_turn", "thread_title"]] = None,
    q: Optional[str] = Query(None, max_length=200),
    page: int = Query(1, ge=1),
    page_size: int = Query(25, ge=1, le=100),
    user_id: str = Depends(get_current_user),
    session: AsyncSession = Depends(get_async_session),
):
    """The caller's traces, newest first."""
    filters = [Trace.user_id == user_id, Trace.start_time >= _since(days)]
    if status_filter:
        filters.append(Trace.status == status_filter)
    if kind:
        filters.append(Trace.kind == kind)
    if q and q.strip():
        like = f"%{q.strip()}%"
        filters.append(or_(Trace.name.ilike(like), Trace.input_preview.ilike(like), Trace.output_preview.ilike(like)))

    total = (await session.execute(select(func.count()).select_from(Trace).where(*filters))).scalar_one()
    rows = (await session.execute(
        select(Trace).where(*filters).order_by(Trace.start_time.desc())
        .offset((page - 1) * page_size).limit(page_size)
    )).scalars().all()
    last_synced = (await session.execute(
        select(func.max(Trace.synced_at)).where(Trace.user_id == user_id)
    )).scalar_one_or_none()
    return TraceListResponse(
        items=[TraceSummary.model_validate(r) for r in rows],
        total=total, page=page, page_size=page_size,
        enabled=langsmith_client.tracing_enabled(), last_synced_at=last_synced,
    )


@router.get("/stats", response_model=TraceStats)
async def trace_stats(
    days: int = Query(7, ge=1, le=trace_sync.RETENTION_DAYS),
    user_id: str = Depends(get_current_user),
    session: AsyncSession = Depends(get_async_session),
):
    """Volume, errors, latency percentiles, tokens and cost for the period,
    per day and per model."""
    where = (Trace.user_id == user_id, Trace.start_time >= _since(days))
    p50 = func.percentile_cont(0.5).within_group(Trace.latency_ms)
    p95 = func.percentile_cont(0.95).within_group(Trace.latency_ms)
    totals = (await session.execute(select(
        func.count(), func.count().filter(Trace.status == "error"), p50, p95,
        func.coalesce(func.sum(Trace.total_tokens), 0), func.coalesce(func.sum(Trace.total_cost), 0),
    ).where(*where))).one()

    day = cast(Trace.start_time, Date)
    by_day = (await session.execute(select(
        day, func.count(), func.count().filter(Trace.status == "error"), p50,
        func.coalesce(func.sum(Trace.total_tokens), 0), func.coalesce(func.sum(Trace.total_cost), 0),
    ).where(*where).group_by(day).order_by(day))).all()

    by_model = (await session.execute(select(
        TraceSpan.model, func.count(), func.coalesce(func.sum(TraceSpan.total_tokens), 0),
        func.coalesce(func.sum(TraceSpan.total_cost), 0), func.avg(TraceSpan.latency_ms),
    ).join(Trace, Trace.id == TraceSpan.trace_id)
     .where(*where, TraceSpan.run_type == "llm", TraceSpan.model.is_not(None))
     .group_by(TraceSpan.model).order_by(func.count().desc()))).all()

    count, errors = totals[0], totals[1]
    return TraceStats(
        days=days, traces=count, errors=errors,
        error_rate=round(errors / count, 4) if count else 0.0,
        p50_latency_ms=int(totals[2]) if totals[2] is not None else None,
        p95_latency_ms=int(totals[3]) if totals[3] is not None else None,
        total_tokens=int(totals[4]), total_cost=float(totals[5]),
        by_day=[TraceDayStat(date=d.isoformat(), traces=c, errors=e,
                             p50_latency_ms=int(p) if p is not None else None,
                             total_tokens=int(t), total_cost=float(cost))
                for d, c, e, p, t, cost in by_day],
        by_model=[TraceModelStat(model=m, calls=c, total_tokens=int(t), total_cost=float(cost),
                                 avg_latency_ms=int(lat) if lat is not None else None)
                  for m, c, t, cost, lat in by_model],
    )


@router.post("/sync", response_model=TraceSyncResponse)
async def sync_traces(user_id: str = Depends(get_current_user)):
    """Pull the caller's recent traces from LangSmith that are missing or
    were incomplete (the automatic sync after each run covers the rest)."""
    try:
        result = await trace_sync.sync_recent(user_id)
    except Exception as exc:
        logger.exception("Trace refresh failed")
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=_sync_error(exc)) from exc
    return TraceSyncResponse(**result)


def _sync_error(exc: Exception) -> str:
    """Why a refresh failed, in words a user can act on (or report)."""
    if isinstance(exc, LangSmithAuthError) or "403" in str(exc) or "401" in str(exc):
        return "LangSmith rejected this server's API key, so traces can't be refreshed. Ask an administrator to check it."
    if isinstance(exc, LangSmithRateLimitError):
        return "LangSmith is busy right now. Try again in a minute."
    if isinstance(exc, LangSmithConnectionError):
        return "LangSmith is unreachable right now. Try again shortly."
    if isinstance(exc, LangSmithError):
        return "LangSmith returned an error, so traces couldn't be refreshed. Try again shortly."
    return "Traces couldn't be refreshed right now. Try again shortly."


@router.get("/{trace_id}", response_model=TraceDetail)
async def get_trace(
    trace_id: str,
    user_id: str = Depends(get_current_user),
    session: AsyncSession = Depends(get_async_session),
):
    trace = (await session.execute(
        select(Trace).where(Trace.id == trace_id, Trace.user_id == user_id)
    )).scalar_one_or_none()
    if trace is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Trace not found")
    spans = (await session.execute(
        select(TraceSpan).where(TraceSpan.trace_id == trace_id).order_by(TraceSpan.position)
    )).scalars().all()
    return TraceDetail(
        **TraceSummary.model_validate(trace).model_dump(),
        spans=[TraceSpanOut.model_validate(s) for s in spans],
    )
