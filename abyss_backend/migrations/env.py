"""Alembic environment: Abyss's async engine and model metadata."""
import asyncio
from logging.config import fileConfig

from alembic import context
from sqlalchemy.ext.asyncio import create_async_engine

import database.models  # noqa: F401 -- registers every table on Base.metadata
from database.session import DATABASE_URL, SSL, Base

config = context.config
if config.config_file_name is not None and not config.attributes.get("skip_logging_config"):
    fileConfig(config.config_file_name, disable_existing_loggers=False)

target_metadata = Base.metadata


def include_name(name, type_, parent_names):
    """Only Abyss's own tables. LangGraph's checkpoint tables live in the same
    database but are created and migrated by LangGraph itself."""
    if type_ == "table":
        return name in target_metadata.tables
    return True


def _configure(connection=None) -> None:
    context.configure(
        connection=connection,
        url=None if connection is not None else DATABASE_URL,
        target_metadata=target_metadata,
        include_name=include_name,
        compare_type=True,
        literal_binds=connection is None,
    )


def run_migrations_offline() -> None:
    _configure()
    with context.begin_transaction():
        context.run_migrations()


def _run_sync(connection) -> None:
    _configure(connection)
    with context.begin_transaction():
        context.run_migrations()


async def run_migrations_online() -> None:
    engine = create_async_engine(DATABASE_URL, connect_args={"ssl": "require"} if SSL else {})
    async with engine.connect() as connection:
        await connection.run_sync(_run_sync)
    await engine.dispose()


if context.is_offline_mode():
    run_migrations_offline()
else:
    asyncio.run(run_migrations_online())
