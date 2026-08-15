from datetime import datetime
from typing import Optional

from fastapi import APIRouter, Depends, Query
from fastapi.responses import Response
from sqlalchemy.ext.asyncio import AsyncSession

from database.session import get_async_session
from schemas.usage import UsageRunListResponse, UsageSummaryResponse
from services.usage_service import UsageService
from utils.auth import get_current_user

router = APIRouter(prefix="/usage", tags=["usage"])
usage_service = UsageService()


@router.get("/summary", response_model=UsageSummaryResponse)
async def get_usage_summary(
    user_id: str = Depends(get_current_user),
    session: AsyncSession = Depends(get_async_session),
):
    """Overall usage summary for the authenticated user.

    total_spent_usd sums cost across every run (NULL-cost runs contribute 0,
    they're just not double-counted as free). total_threads/total_runs count
    every thread/run ever created, including later soft-deleted ones — the
    cost already happened regardless. total_agents counts only currently
    active, top-level agents — sub-agents are excluded.

    Args:
        user_id: JWT-authenticated user ID (injected by dependency).
        session: Async database session (injected by dependency).

    Returns:
        UsageSummaryResponse.
    """
    return await usage_service.get_summary(session, user_id)


@router.get("/runs")
async def list_usage_runs(
    agent_id: Optional[str] = Query(default=None, description="Filter to one main agent."),
    start_date: Optional[datetime] = Query(default=None, description="Inclusive lower bound on created_at."),
    end_date: Optional[datetime] = Query(default=None, description="Inclusive upper bound on created_at."),
    provider: Optional[str] = Query(default=None),
    model: Optional[str] = Query(default=None),
    status: Optional[str] = Query(default=None, description="e.g. COMPLETED, FAILED, CANCELLED, RUNNING"),
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=20, ge=1, le=200),
    is_download: bool = Query(default=False, description="If true, ignore pagination and return a CSV file of every matching row instead of JSON."),
    user_id: str = Depends(get_current_user),
    session: AsyncSession = Depends(get_async_session),
):
    """List (or download) the authenticated user's agent runs with token usage and cost.

    Every run (including PENDING/RUNNING/AWAITING_APPROVAL ones) is included
    by default — in-progress runs simply show cost_usd: null and whatever
    partial token counts have been flushed so far. Use the status filter to
    narrow to terminal runs only if desired. Results are always ordered
    newest-first.

    When is_download=true, the same filters apply but pagination is
    ignored — every matching row is returned as a CSV file attachment
    (capped at 50,000 rows; the true matching count is reported via headers
    if the cap is hit).

    Args:
        agent_id: Restrict to one main agent's runs.
        start_date / end_date: Inclusive date range on created_at.
        provider / model / status: Exact-match filters.
        page / page_size: Pagination (ignored when is_download=true).
        is_download: Return a CSV file instead of the paginated JSON list.
        user_id: JWT-authenticated user ID (injected by dependency).
        session: Async database session (injected by dependency).

    Returns:
        UsageRunListResponse (JSON) normally, or a CSV file Response when
        is_download=true.
    """
    if is_download:
        content, content_type, was_truncated, total_matching = await usage_service.download_runs(
            session, user_id,
            agent_id=agent_id, start_date=start_date, end_date=end_date,
            provider=provider, model=model, status=status,
        )
        return Response(
            content=content,
            media_type=content_type,
            headers={
                "Content-Disposition": 'attachment; filename="thinkloop-usage.csv"',
                "X-Total-Matching-Rows": str(total_matching),
                "X-Export-Truncated": "true" if was_truncated else "false",
            },
        )

    return await usage_service.list_runs(
        session, user_id,
        agent_id=agent_id, start_date=start_date, end_date=end_date,
        provider=provider, model=model, status=status,
        page=page, page_size=page_size,
    )
