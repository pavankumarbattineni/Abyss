"""Run the Abyss API for local development, on Windows too.

    uv run python scripts/dev.py            # http://127.0.0.1:8100
    uv run python scripts/dev.py --reload   # restart on code changes

The async psycopg driver (LangGraph's checkpointer) can't use Windows' default
Proactor event loop, and `uvicorn main:app` picks that loop. This starts
uvicorn on a selector loop instead; elsewhere it behaves like plain uvicorn.
Port: ABYSS_PORT (default 8100, so Abyss runs alongside Trench on 8000).
"""
import asyncio
import os
import selectors
import sys
from pathlib import Path

import uvicorn

BACKEND_DIR = Path(__file__).resolve().parent.parent


def selector_loop() -> asyncio.AbstractEventLoop:
    return asyncio.SelectorEventLoop(selectors.SelectSelector())


def main() -> None:
    os.chdir(BACKEND_DIR)
    sys.path.insert(0, str(BACKEND_DIR))
    uvicorn.run(
        "main:app",
        host="127.0.0.1",
        port=int(os.environ.get("ABYSS_PORT", "8100")),
        reload="--reload" in sys.argv,
        # The reloader's child process imports this factory by path too.
        loop="scripts.dev:selector_loop" if sys.platform == "win32" else "auto",
    )


if __name__ == "__main__":
    main()
