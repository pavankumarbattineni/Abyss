import csv
import io
import logging
from datetime import datetime
from typing import Optional

from sqlalchemy import Select, desc, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from database.models import Agent, StreamRecord, Thread
from schemas.usage import UsageRunItem, UsageRunListResponse, UsageSummaryResponse
from utils.datetime_utils import to_storage_naive as _to_storage_naive

logger = logging.getLogger(__name__)

# Export is capped, not unbounded — protects the server from a pathological
# all-time-all-agents request holding a huge result set in memory. Reported
# explicitly via response headers when hit, never a silent truncation.
MAX_EXPORT_ROWS = 50_000

# Internal IDs (stream_id/thread_id/agent_id) are omitted from the exported
# file — it's meant for human reading/reporting, not for linking back into
# the app. They're still present in the JSON list response for the UI.
_CSV_COLUMNS = (
    "agent_name", "status",
    "input_tokens", "cache_read_tokens", "output_tokens", "total_tokens",
    "cost_usd", "llm_source", "provider", "model", "created_at", "completed_at",
)


class UsageService:

    def _build_filtered_query(
        self,
        user_id: str,
        agent_id: Optional[str],
        start_date: Optional[datetime],
        end_date: Optional[datetime],
        provider: Optional[str],
        model: Optional[str],
        status: Optional[str],
    ) -> Select:
        """Build the filtered base query shared by list_runs and download_runs.

        Sharing this exact query-building logic (not just visually matching
        filter lists in two places) is what actually guarantees the export
        respects the same filters as the UI — the two can't drift apart.

        No is_active filtering on Thread/Agent: a run's cost already
        happened regardless of whether the thread or agent was later
        soft-deleted, so historical usage stays visible either way.
        """
        stmt = (
            select(StreamRecord, Thread.agent_id, Agent.name)
            .join(Thread, Thread.id == StreamRecord.thread_id)
            .join(Agent, Agent.id == Thread.agent_id)
            .where(Thread.user_id == user_id)
        )
        if agent_id:
            stmt = stmt.where(Thread.agent_id == agent_id)
        if start_date:
            stmt = stmt.where(StreamRecord.created_at >= _to_storage_naive(start_date))
        if end_date:
            stmt = stmt.where(StreamRecord.created_at <= _to_storage_naive(end_date))
        if provider:
            stmt = stmt.where(StreamRecord.llm_provider == provider)
        if model:
            stmt = stmt.where(StreamRecord.llm_model == model)
        if status:
            stmt = stmt.where(StreamRecord.status == status)
        return stmt

    def _row_to_item(self, record: StreamRecord, agent_id: str, agent_name: str) -> UsageRunItem:
        total_tokens = None
        if record.input_tokens is not None or record.output_tokens is not None:
            total_tokens = (record.input_tokens or 0) + (record.output_tokens or 0)
        return UsageRunItem(
            stream_id=record.id,
            thread_id=record.thread_id,
            agent_id=agent_id,
            agent_name=agent_name,
            status=record.status,
            input_tokens=record.input_tokens,
            cache_read_tokens=record.cache_read_tokens,
            output_tokens=record.output_tokens,
            total_tokens=total_tokens,
            cost_usd=float(record.cost_usd) if record.cost_usd is not None else None,
            llm_source=record.llm_source,
            provider=record.llm_provider,
            model=record.llm_model,
            created_at=record.created_at,
            completed_at=record.completed_at,
        )

    async def get_summary(self, session: AsyncSession, user_id: str) -> UsageSummaryResponse:
        """Overall usage summary for the authenticated user — 2 aggregate
        queries total, no row fetching.

        threads/runs/spend all come from one query: a LEFT JOIN from Thread
        to StreamRecord means threads with zero runs are still counted
        (an INNER JOIN or deriving totals from StreamRecord alone would
        silently drop them), while COUNT(DISTINCT thread.id) keeps a
        multi-run thread from being counted once per run.

        total_agents is necessarily a separate query — agents aren't 1:1
        with threads (an agent could have zero threads), so joining it into
        the same query would either undercount or require a second distinct
        join with its own counting subtleties for no real efficiency gain.
        """
        threads_result = await session.execute(
            select(
                func.count(func.distinct(Thread.id)),
                func.count(StreamRecord.id),
                func.coalesce(func.sum(StreamRecord.cost_usd), 0),
            )
            .select_from(Thread)
            .outerjoin(StreamRecord, StreamRecord.thread_id == Thread.id)
            .where(Thread.user_id == user_id)
        )
        total_threads, total_runs, total_spent = threads_result.one()

        agents_result = await session.execute(
            select(func.count())
            .select_from(Agent)
            .where(
                Agent.user_id == user_id,
                Agent.parent_id.is_(None),
                Agent.is_active == True,
            )
        )
        total_agents = agents_result.scalar_one()

        return UsageSummaryResponse(
            total_spent_usd=float(total_spent),
            total_threads=total_threads,
            total_runs=total_runs,
            total_agents=total_agents,
        )

    async def list_runs(
        self,
        session: AsyncSession,
        user_id: str,
        agent_id: Optional[str] = None,
        start_date: Optional[datetime] = None,
        end_date: Optional[datetime] = None,
        provider: Optional[str] = None,
        model: Optional[str] = None,
        status: Optional[str] = None,
        page: int = 1,
        page_size: int = 20,
    ) -> UsageRunListResponse:
        """Paginated, filtered list of agent runs for the usage/cost page.

        Args:
            session: Active async database session.
            user_id: The authenticated user's ID — every run is scoped to
                threads this user owns.
            agent_id: Filter to one main agent (a run's agent is always the
                top-level agent that owns its thread; sub-agent usage is
                already folded into that same run's totals).
            start_date / end_date: Inclusive range on StreamRecord.created_at.
            provider / model / status: Exact-match filters.
            page: 1-indexed page number.
            page_size: Rows per page.

        Returns:
            UsageRunListResponse with items, total matching count, and the
            echoed page/page_size. Always ordered newest-first.
        """
        base_stmt = self._build_filtered_query(
            user_id, agent_id, start_date, end_date, provider, model, status,
        )

        count_result = await session.execute(select(func.count()).select_from(base_stmt.subquery()))
        total = count_result.scalar_one()

        stmt = (
            base_stmt
            .order_by(desc(StreamRecord.created_at))
            .limit(page_size)
            .offset((page - 1) * page_size)
        )
        result = await session.execute(stmt)
        items = [self._row_to_item(record, aid, aname) for record, aid, aname in result.all()]

        return UsageRunListResponse(items=items, total=total, page=page, page_size=page_size)

    async def download_runs(
        self,
        session: AsyncSession,
        user_id: str,
        agent_id: Optional[str] = None,
        start_date: Optional[datetime] = None,
        end_date: Optional[datetime] = None,
        provider: Optional[str] = None,
        model: Optional[str] = None,
        status: Optional[str] = None,
    ) -> tuple[bytes, str, bool, int]:
        """Download every run matching the given filters (no pagination) as a
        CSV file — same filter-building code as list_runs, so the download
        always reflects exactly what the UI would show.

        Args:
            (filters mirror list_runs, minus page/page_size — the
            download covers everything matching, up to MAX_EXPORT_ROWS,
            always ordered newest-first)

        Returns:
            (file_bytes, content_type, was_truncated, total_matching_count).
            was_truncated is True when total_matching_count > MAX_EXPORT_ROWS
            — the caller surfaces this via a response header, not silently.
        """
        base_stmt = self._build_filtered_query(
            user_id, agent_id, start_date, end_date, provider, model, status,
        )

        count_result = await session.execute(select(func.count()).select_from(base_stmt.subquery()))
        total_matching = count_result.scalar_one()

        stmt = base_stmt.order_by(desc(StreamRecord.created_at)).limit(MAX_EXPORT_ROWS)
        result = await session.execute(stmt)
        items = [self._row_to_item(record, aid, aname) for record, aid, aname in result.all()]
        was_truncated = total_matching > MAX_EXPORT_ROWS

        content, content_type = self._to_csv(items)
        return content, content_type, was_truncated, total_matching

    def _row_values(self, item: UsageRunItem) -> list:
        return [
            item.agent_name, item.status,
            item.input_tokens, item.cache_read_tokens, item.output_tokens, item.total_tokens,
            item.cost_usd, item.llm_source, item.provider, item.model,
            item.created_at.isoformat() if item.created_at else None,
            item.completed_at.isoformat() if item.completed_at else None,
        ]

    def _to_csv(self, items: list[UsageRunItem]) -> tuple[bytes, str]:
        buf = io.StringIO()
        writer = csv.writer(buf)
        writer.writerow(_CSV_COLUMNS)
        for item in items:
            writer.writerow(self._row_values(item))
        return buf.getvalue().encode("utf-8"), "text/csv"
