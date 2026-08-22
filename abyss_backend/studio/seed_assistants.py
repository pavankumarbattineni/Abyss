"""Seed LangGraph Studio with one assistant per Abyss agent.

Run this script ONCE after starting `langgraph dev` to pre-populate every
active agent for a user as a named LangGraph Platform assistant.  After
seeding, LangGraph Studio shows each agent by name in its sidebar — click
any entry to start a conversation with no further configuration required.

Usage
-----
    # Terminal 1 — start Studio dev server (from Abyss/ directory):
    langgraph dev

    # Terminal 2 — seed assistants for your user:
    python -m studio.seed_assistants --user-id <USER_ID>

    # Or set env var and omit the flag:
    STUDIO_USER_ID=<USER_ID> python -m studio.seed_assistants

Options
-------
    --user-id   Abyss user_id whose agents to expose (env: STUDIO_USER_ID)
    --url       LangGraph dev server URL (env: LANGGRAPH_URL, default: http://localhost:2024)
    --force     Re-create existing assistants instead of skipping them (if_exists=raise vs do_nothing)
"""
from __future__ import annotations

import argparse
import asyncio
import os
import sys

from sqlalchemy import select


async def _seed(user_id: str, studio_url: str, force: bool) -> None:
    from langgraph_sdk import get_client

    from database.models import Agent
    from database.session import async_session_maker

    client = get_client(url=studio_url)
    if_exists = "raise" if force else "do_nothing"

    print(f"Connecting to LangGraph Studio at {studio_url} …")

    async with async_session_maker() as session:
        result = await session.execute(
            select(Agent).where(
                Agent.user_id == user_id,
                Agent.is_active == True,
                Agent.parent_id.is_(None),
            ).order_by(Agent.created_at)
        )
        agents = result.scalars().all()

    if not agents:
        print(f"No active agents found for user_id={user_id!r}. Nothing to seed.")
        return

    print(f"Seeding {len(agents)} assistant(s) for user {user_id!r} …\n")

    created = 0
    skipped = 0
    failed = 0

    for agent_record in agents:
        try:
            assistant = await client.assistants.create(
                graph_id="thinkloop_agent",
                config={"configurable": {"agent_id": agent_record.id}},
                metadata={
                    "agent_id": agent_record.id,
                    "user_id": user_id,
                    "description": agent_record.description or "",
                },
                name=agent_record.name,
                description=agent_record.description or "",
                if_exists=if_exists,
            )
            status = "created" if assistant.get("assistant_id") else "ok"
            print(f"  ✓  [{status}]  {agent_record.name!r:40s}  id={agent_record.id}")
            created += 1
        except Exception as exc:
            err = str(exc)
            if "already exists" in err.lower() or "conflict" in err.lower():
                print(f"  –  [exists]  {agent_record.name!r:40s}  (use --force to recreate)")
                skipped += 1
            else:
                print(f"  ✗  [failed]  {agent_record.name!r:40s}  {exc}", file=sys.stderr)
                failed += 1

    print(
        f"\nDone.  created={created}  skipped={skipped}  failed={failed}\n"
        f"Open LangGraph Studio and connect to: {studio_url}"
    )


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Seed LangGraph Studio assistants from Abyss DB",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog=__doc__,
    )
    parser.add_argument(
        "--user-id",
        default=os.environ.get("STUDIO_USER_ID"),
        help="Abyss user_id whose agents to expose (env: STUDIO_USER_ID)",
    )
    parser.add_argument(
        "--url",
        default=os.environ.get("LANGGRAPH_URL", "http://localhost:2024"),
        help="LangGraph dev server URL (env: LANGGRAPH_URL, default: http://localhost:2024)",
    )
    parser.add_argument(
        "--force",
        action="store_true",
        default=False,
        help="Re-create assistants even if they already exist",
    )
    args = parser.parse_args()

    if not args.user_id:
        parser.error(
            "--user-id or STUDIO_USER_ID environment variable is required.\n"
            "Your user_id is the UUID from the users table — check your JWT or DB."
        )

    asyncio.run(_seed(args.user_id, args.url, args.force))


if __name__ == "__main__":
    main()
