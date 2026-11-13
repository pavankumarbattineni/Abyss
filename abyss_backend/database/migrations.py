"""Bring the database schema up to date at startup (Alembic ``upgrade head``).

A database created before Alembic was introduced already has the baseline
tables but no ``alembic_version`` row; it is stamped at the baseline (0001)
first, so the upgrade adds only what came after instead of failing on
"table already exists". Revision 0002 then removes that era's leftovers.
"""
import asyncio
import logging
from pathlib import Path

from alembic import command
from alembic.config import Config
from sqlalchemy import inspect

from database.session import engine

logger = logging.getLogger(__name__)

_ALEMBIC_INI = Path(__file__).resolve().parent.parent / "alembic.ini"
BASELINE_REVISION = "0001"


def _config() -> Config:
    cfg = Config(str(_ALEMBIC_INI))
    # Keep the app's logging setup; alembic.ini's would replace it.
    cfg.attributes["skip_logging_config"] = True
    return cfg


async def _is_pre_alembic_database() -> bool:
    async with engine.connect() as conn:
        tables = await conn.run_sync(lambda sync_conn: set(inspect(sync_conn).get_table_names()))
    return "users" in tables and "alembic_version" not in tables


async def run_migrations() -> None:
    cfg = _config()
    if await _is_pre_alembic_database():
        logger.warning("Existing database without migration history: adopting it at the baseline")
        # Alembic's env.py runs its own event loop, so it gets a thread.
        await asyncio.to_thread(command.stamp, cfg, BASELINE_REVISION)
    await asyncio.to_thread(command.upgrade, cfg, "head")
