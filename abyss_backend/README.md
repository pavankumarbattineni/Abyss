# Abyss backend

FastAPI API and the LangGraph agents behind [Abyss](../README.md). Python 3.13, SQLAlchemy
(async), Alembic, LangChain `create_agent`, MCP tools, PostgreSQL.

## Run

```bash
cp .env.example .env                     # ABYSS_CONFIG, ABYSS_FIREBASE_ADMIN_CONFIG, ABYSS_ALLOWED_ORIGINS
uv sync
uv run python scripts/dev.py --reload    # http://127.0.0.1:8100, docs at /docs
```

`scripts/dev.py` starts uvicorn on a selector event loop, which the async psycopg driver needs on
Windows. In Docker the image runs plain `uvicorn main:app` (see [`Dockerfile`](Dockerfile)).

On every start the API migrates the database (`alembic upgrade head`), seeds any missing models
of the LLM catalog ([`database/seed.py`](database/seed.py)), sets up LangGraph's checkpoint
tables, marks streams orphaned by a restart as failed, and loads MCP tools into memory.
`uv run python scripts/migrate.py` does the first two on their own (CI and the deploy workflow use it).

## Layout

| Path | What |
|---|---|
| `main.py` | App, startup sequence, `/health` (checks the DB, reports the running commit) |
| `routers/` | HTTP endpoints under `/api/v1`: auth, agents, threads, streams, mcp, llm-credentials, api-keys, usage |
| `services/` | Business logic; `chat_service.py` runs a turn, `stream_projector.py` turns graph events into SSE |
| `abyss_agents/` | Agent graph: `factory.py` (parent + sub-agents as tools), `prompts.py`, approval middleware |
| `database/` | Models, async session, Alembic runner, catalog seed, LangGraph checkpointer |
| `migrations/` | Alembic revisions (`0001` baseline, `0002` legacy cleanup) |
| `utils/` | Auth (JWT, API keys), Firebase, encryption, MCP client, pricing, title generation |
| `scripts/` | `dev.py`, `migrate.py`, `update_model_prices.py` |
| `tests/` | pytest, no external services needed |

## How a chat turn works

1. `POST /threads/{id}/messages` stores the message, creates a stream record and starts the
   run as a background task; it returns `{message_id, stream_id}` immediately (202).
2. The parent agent answers directly or calls its specialists, which are exposed to it as
   tools and run in parallel. Tools marked "requires approval" interrupt the run until
   `POST /streams/{id}/tool-approvals` resumes it.
3. `GET /streams/{id}` follows the run over Server-Sent Events, resumable with
   `Last-Event-ID`. Events: `token`, `reasoning_start` / `reasoning_token` / `reasoning_end`,
   `agent_start` / `agent_end`, `dispatch_decision`, `tool_start` / `tool_end`,
   `synthesis_start`, then `done` or `error`.
4. When the run ends, the answer, its reasoning trace, token counts and cost are saved.

Agents without a model of their own use the platform default (the catalog row flagged
`is_platform_default`, Gemini 3.5 Flash-Lite) on the platform's key for that provider from
`ABYSS_CONFIG.LLM.api_keys` (`utils/platform_llm.py`); thread titles use the same model. Any
other model runs on the user's own key.

Reasoning comes from a `<reasoning>…</reasoning>` block the prompt asks for
(`utils/reasoning_splitter.py` separates it from the answer), or from the provider's own
reasoning output for models whose catalog row says `reasoning_mode = 'native'`.

## Authentication

Firebase signs the user in; `POST /auth/firebase` exchanges the Firebase ID token for Abyss's own
access and refresh JWTs. Every request then needs `Authorization: Bearer <token>` (or an
`X-Api-Key` personal API key where allowed), and the account must still exist and be active.
Streams accept headers only, never a token in the URL. CORS allows only `ABYSS_ALLOWED_ORIGINS`.

## Database changes

```bash
# after editing database/models.py
uv run alembic revision --autogenerate -m "describe the change"
uv run alembic upgrade head
```

Review the generated file before committing; CI runs `alembic check` and fails if the models and
migrations disagree. Keep migrations additive (expand, then contract in a later release): the
deploy workflow migrates production before the new code goes live.

## Costs

Run costs come from [`utils/model_prices.json`](utils/model_prices.json) (per-token input, output
and cache-read prices). Refresh it from LiteLLM's public price list with
`uv run python scripts/update_model_prices.py`, then review and commit the diff. A model that isn't
listed gets cost `NULL`, never `0`.

## Checks

```bash
uv run ruff check .
uv run pytest -q
```
