from psycopg_pool import AsyncConnectionPool
from langgraph.checkpoint.postgres.aio import AsyncPostgresSaver

from config import config
from constants import CHECKPOINTER_POOL_SIZE

_pool: AsyncConnectionPool | None = None
_checkpointer: AsyncPostgresSaver | None = None

_db = config["DB"]


def _build_conninfo() -> str:
    """Build a plain postgresql:// conninfo string from config for psycopg_pool."""
    username = _db["username"]
    password = _db["password"]
    ip_address = _db["ip_address"]
    port = _db["port"]
    database = _db["database"]
    return f"postgresql://{username}:{password}@{ip_address}:{port}/{database}"


async def init_checkpointer() -> None:
    global _pool, _checkpointer
    _pool = AsyncConnectionPool(
        conninfo=_build_conninfo(),
        max_size=CHECKPOINTER_POOL_SIZE,
        kwargs={"autocommit": True, "prepare_threshold": 0},
        open=False,
    )
    await _pool.open(wait=True)
    _checkpointer = AsyncPostgresSaver(_pool)
    await _checkpointer.setup()


def get_checkpointer() -> AsyncPostgresSaver:
    if _checkpointer is None:
        raise RuntimeError("Checkpointer not initialized")
    return _checkpointer


async def delete_thread_checkpoints(thread_id: str) -> None:
    if _pool is None:
        return
    async with _pool.connection() as conn:
        await conn.execute("DELETE FROM checkpoint_writes WHERE thread_id = %s", (thread_id,))
        await conn.execute("DELETE FROM checkpoint_blobs WHERE thread_id = %s", (thread_id,))
        await conn.execute("DELETE FROM checkpoints WHERE thread_id = %s", (thread_id,))


async def delete_checkpoints_after(thread_id: str, last_good_checkpoint_id: str | None) -> None:
    """Delete only the checkpoints written during a cancelled turn.

    Walks the checkpoint chain forward from last_good_checkpoint_id and
    removes every descendant row from checkpoint_writes and checkpoints,
    leaving all prior turns' state intact. If last_good_checkpoint_id is
    None (the turn was the very first), the entire thread is cleared.

    Args:
        thread_id: The LangGraph thread whose checkpoints are being trimmed.
        last_good_checkpoint_id: The checkpoint ID at the end of the last
            successfully completed turn, captured before the cancelled turn
            started. All descendants of this checkpoint are deleted.
    """
    if _pool is None:
        return
    if last_good_checkpoint_id is None:
        await delete_thread_checkpoints(thread_id)
        return
    async with _pool.connection() as conn:
        # Recursively find every checkpoint written after last_good_checkpoint_id.
        # The chain is linear in normal operation so this CTE is shallow.
        cur = await conn.execute(
            """
            WITH RECURSIVE to_delete AS (
                SELECT checkpoint_id
                FROM checkpoints
                WHERE thread_id = %s AND parent_checkpoint_id = %s
                UNION ALL
                SELECT c.checkpoint_id
                FROM checkpoints c
                INNER JOIN to_delete td ON c.parent_checkpoint_id = td.checkpoint_id
                WHERE c.thread_id = %s
            )
            SELECT checkpoint_id FROM to_delete
            """,
            (thread_id, last_good_checkpoint_id, thread_id),
        )
        rows = await cur.fetchall()
        descendant_ids = [row[0] for row in rows]

        if not descendant_ids:
            return

        placeholders = ",".join(["%s"] * len(descendant_ids))
        await conn.execute(
            f"DELETE FROM checkpoint_writes WHERE thread_id = %s AND checkpoint_id IN ({placeholders})",
            [thread_id, *descendant_ids],
        )
        await conn.execute(
            f"DELETE FROM checkpoints WHERE thread_id = %s AND checkpoint_id IN ({placeholders})",
            [thread_id, *descendant_ids],
        )


async def close_checkpointer() -> None:
    global _pool, _checkpointer
    _checkpointer = None
    if _pool is not None:
        await _pool.close()
        _pool = None
