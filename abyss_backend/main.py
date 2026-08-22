import logging
import os
from contextlib import asynccontextmanager
from datetime import timedelta

from fastapi import FastAPI
from fastapi.responses import HTMLResponse
from sqlalchemy import text, update

from constants import (
    API_V1_PREFIX,
    STREAM_ORPHAN_GRACE_SECONDS,
    STREAM_STATUS_FAILED,
    STREAM_STATUS_PENDING,
    STREAM_STATUS_RUNNING,
)
from database.checkpointer import init_checkpointer, close_checkpointer
from database.db_enums import ScheduleRunStatus
from database.models import Base, ScheduleRun, StreamRecord, utcnow
from database.session import async_session_maker, engine
from middleware.middleware import setup_middleware
from routers.api_keys import router as api_keys_router
from routers.auth import router as auth_router
from routers.agents import router as agents_router
from routers.llm_credentials import router as llm_credentials_router
from routers.schedules import router as schedules_router
from routers.streams import router as streams_router
from routers.threads import router as threads_router
from routers.mcp import router as mcp_router
from routers.usage import router as usage_router
from utils.mcp_client import build_agent_tool_registry
from utils.scheduler import start_scheduler, stop_scheduler

logger = logging.getLogger(__name__)


async def _mark_orphaned_streams() -> None:
    """On startup, mark any PENDING/RUNNING streams as FAILED.

    These are streams whose background tasks were killed when the server last
    stopped. Clients that reconnect will receive a FAILED status and can retry.
    A 30-second grace window avoids racing with tasks that just started.
    """
    cutoff = utcnow() - timedelta(seconds=STREAM_ORPHAN_GRACE_SECONDS)
    async with async_session_maker() as session:
        result = await session.execute(
            update(StreamRecord)
            .where(
                StreamRecord.status.in_([STREAM_STATUS_PENDING, STREAM_STATUS_RUNNING]),
                StreamRecord.created_at < cutoff,
            )
            .values(
                status=STREAM_STATUS_FAILED,
                error_message="Server restarted during generation",
                updated_at=utcnow(),
            )
        )
        await session.commit()
        if result.rowcount:
            logger.warning(
                "Marked %d orphaned stream(s) as FAILED on startup", result.rowcount
            )


async def _mark_orphaned_schedule_runs() -> None:
    """On startup, mark any RUNNING ScheduleRuns as FAILED.

    Mirrors _mark_orphaned_streams: these are scheduled runs whose background
    generation task was killed when the server last stopped. The scheduler's
    per-schedule concurrency check treats a RUNNING run as still active, so
    without this sweep an orphaned run would permanently block that schedule.

    This is defense-in-depth for the moment of restart specifically —
    utils/scheduler.py._reclaim_stale_runs now also sweeps on every tick
    (heartbeat-based), which is what catches a run that gets orphaned
    mid-session rather than only at boot.
    """
    cutoff = utcnow() - timedelta(seconds=STREAM_ORPHAN_GRACE_SECONDS)
    async with async_session_maker() as session:
        result = await session.execute(
            update(ScheduleRun)
            .where(
                ScheduleRun.status == ScheduleRunStatus.RUNNING,
                ScheduleRun.created_at < cutoff,
            )
            .values(
                status=ScheduleRunStatus.FAILED,
                error_message="Server restarted during generation",
                updated_at=utcnow(),
            )
        )
        await session.commit()
        if result.rowcount:
            logger.warning(
                "Marked %d orphaned schedule run(s) as FAILED on startup", result.rowcount
            )


@asynccontextmanager
async def lifespan(app: FastAPI):
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
        # Passwords are managed by Firebase; keep the legacy column nullable
        # for existing databases while new users authenticate externally.
        await conn.execute(text("ALTER TABLE users ALTER COLUMN password_hash DROP NOT NULL"))
        # Firebase UID is deliberately not an Abyss persistence field.
        await conn.execute(text("ALTER TABLE users DROP COLUMN IF EXISTS firebase_uid CASCADE"))
    await init_checkpointer()
    await _mark_orphaned_streams()
    await _mark_orphaned_schedule_runs()
    async with async_session_maker() as db:
        await build_agent_tool_registry(db)
    start_scheduler()
    yield
    await stop_scheduler()
    await close_checkpointer()


app = FastAPI(
    title="Abyss-AI",
    lifespan=lifespan,
    docs_url="/docs",
    redoc_url=None,
    openapi_url="/openapi.json"
)

# Configure middleware
setup_middleware(app)

prefix = API_V1_PREFIX
app.include_router(auth_router, prefix=prefix)
app.include_router(api_keys_router, prefix=prefix)
app.include_router(agents_router, prefix=prefix)
app.include_router(llm_credentials_router, prefix=prefix)
app.include_router(schedules_router, prefix=prefix)
app.include_router(threads_router, prefix=prefix)
app.include_router(streams_router, prefix=prefix)
app.include_router(mcp_router, prefix=prefix)
app.include_router(usage_router, prefix=prefix)


@app.get("/health", include_in_schema=False)
async def health():
    return {"status": "ok", "image_tag": os.environ.get("IMAGE_TAG", "unknown")}


@app.get("/redoc", include_in_schema=False)
async def redoc_html():
    return HTMLResponse(content="""
<!DOCTYPE html>
<html>
<head>
    <title>Abyss-AI - ReDoc</title>
    <meta charset="utf-8"/>
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <link href="https://fonts.googleapis.com/css?family=Montserrat:300,400,700|Roboto:300,400,700" rel="stylesheet">
    <link rel="shortcut icon" href="https://fastapi.tiangolo.com/img/favicon.png">
    <style>
        body { margin: 0; padding: 0; }
    </style>
</head>
<body>
    <redoc spec-url="/openapi.json"></redoc>
    <script src="https://cdn.jsdelivr.net/npm/redoc@2.0.0/bundles/redoc.standalone.js"></script>
</body>
</html>
    """)
