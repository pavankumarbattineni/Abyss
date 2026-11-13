"""Apply database migrations and seed the LLM catalog, then exit.

    uv run python scripts/migrate.py

The API does the same at startup; this runs it on its own -- in CI against a
throwaway database, and in the deploy workflow against Neon staging and
production *before* new code goes live.
"""
import asyncio
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from database.migrations import run_migrations  # noqa: E402
from database.seed import seed_catalog  # noqa: E402
from database.session import async_session_maker, engine  # noqa: E402


async def main() -> None:
    await run_migrations()
    async with async_session_maker() as session:
        added = await seed_catalog(session)
    await engine.dispose()
    print(f"Database at the latest migration; {added} catalog model(s) added.")


if __name__ == "__main__":
    asyncio.run(main())
