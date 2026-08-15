# Thinkloop

A production-ready **multi-agent AI backend** built with FastAPI, LangGraph, and async SQLAlchemy. Thinkloop lets you define a parent agent with parallel sub-agents, connect external tools via MCP servers, gate sensitive tool calls behind a human-in-the-loop approval flow, stream responses token-by-token with full reconnect/resume support, bring your own LLM provider key, track token usage and cost per run, and run agents automatically on a schedule.

---

## Table of Contents

1. [Architecture](#architecture)
2. [Project Structure](#project-structure)
3. [Data Model](#data-model)
4. [Multi-Agent Execution Flow](#multi-agent-execution-flow)
5. [Reasoning & Streaming Architecture](#reasoning--streaming-architecture)
6. [Tool Permissions & Human-in-the-Loop Approval](#tool-permissions--human-in-the-loop-approval)
7. [Bring Your Own LLM Key (BYOK)](#bring-your-own-llm-key-byok)
8. [Token Usage & Cost Tracking](#token-usage--cost-tracking)
9. [Onboarding — Temporary Agent](#onboarding--temporary-agent)
10. [Agent Scheduling](#agent-scheduling)
11. [Configuration](#configuration)
12. [Getting Started](#getting-started)
13. [API Reference](#api-reference)
14. [Key Design Decisions](#key-design-decisions)

---

## Architecture

```
Client
  │
  ├── POST /api/v1/threads/{id}/messages  →  202 Accepted  →  {message_id, stream_id}
  │
  └── GET  /api/v1/streams/{stream_id}   →  SSE text/event-stream
            │  (token-by-token, resumable via Last-Event-ID)
            │  may pause mid-stream: AWAITING_APPROVAL → POST /streams/{id}/tool-approvals → resumes

FastAPI (async) — single gunicorn worker (uvicorn.workers.UvicornWorker, -w 1)
  │
  ├── Auth            (email/password → access + refresh JWT; forgot/reset password;
  │                     signup auto-provisions the "ThinkLoop Guide" starter agent)
  ├── API Keys        (sk-tl-... tokens for programmatic access)
  ├── Agent CRUD      (parent + sub-agents, MCP tool assignment by ID, sample questions)
  ├── LLM Credentials (BYOK: provider/model catalog, per-provider API key upsert/delete)
  ├── Schedules       (recurring triggers per agent: interval/daily/weekly/monthly)
  ├── Thread CRUD     (conversation containers, auto-generated titles)
  ├── Streams         (SSE endpoint, cancel, status polling, tool-approval resolution)
  ├── MCP CRUD        (external tool connections, encrypted api_key at rest, tool
  │                     permission gating: allowed / requires_approval / blocked)
  └── Usage           (per-run token usage + cost list/CSV download, account-wide summary)

Background Task (_run_generation)
  │
  └── LangGraph StateGraph
        ├── agent node        (custom ReAct loop; decides to respond directly, delegate,
        │                      or pause on a gated tool via LangGraph interrupt())
        ├── sub-agent nodes   (create_react_agent, dispatched in parallel via Send API)
        └── synthesizer node  (aggregates sub-agent results → final response)
      Every on_chat_model_end event's usage_metadata is accumulated into
      input/output/cache-read token counts; cost is computed via LiteLLM's
      local pricing table once the run reaches a terminal state.

Background Task (scheduler tick loop, utils/scheduler.py)
  │
  └── every 60s: reconcile in-flight scheduled runs, then fire any due schedules
        → each due schedule creates a new Thread and posts a message through the
          same send_message() path a manual chat request uses
        → a gated tool encountered on a scheduled run is auto-denied (skipped),
          never paused — there's no one present to approve it

Persistence
  ├── PostgreSQL  (users, providers, provider_models, llm_credentials, agents, threads,
  │                messages, mcp_connections, mcp_tools, agent_tools, stream_records,
  │                agent_schedules, schedule_runs)
  └── LangGraph AsyncPostgresSaver  (per-thread conversation checkpoints; also the
                  durable source of truth for pending tool-approval interrupts)

In-Memory (single process — see "Why a single worker" in Key Design Decisions)
  ├── stream_manager  (_chunk_buffers, _sse_queues, _running_tasks)
  ├── mcp_client      (_agent_tool_registry, _active_mcp_clients)
  └── graph_builder   (_graph_cache — LRU, capped at GRAPH_CACHE_MAX_SIZE)
```

**Single worker note:** the app currently runs with exactly one gunicorn worker (`gunicorn_starter.sh: -w 1`). This is a deliberate simplification while the app is still in active development — the in-memory stream buffers, SSE queues, and scheduler tick loop are all per-process state, so a single worker guarantees every request and every scheduled trigger is seen consistently without cross-process coordination. Scaling to multiple workers/instances later needs either a shared broker (Redis) for stream chunk fan-out and scheduler leader election, or a Postgres advisory lock around the scheduler tick — see [Key Design Decisions](#key-design-decisions).

---

## Project Structure

```
thinkloop-backend/
├── main.py                      # FastAPI app, lifespan, orphan stream/schedule-run recovery, scheduler start/stop
├── config.py                    # Pydantic Settings — reads THINKLOOP_CONFIG (a JSON blob) from .env
├── constants.py                 # Single source of truth for all tuneable constants
├── gunicorn_starter.sh          # Production launcher: gunicorn + UvicornWorker, -w 1
│
├── database/
│   ├── models.py                # SQLAlchemy ORM models + utcnow() (IST) helper
│   ├── db_enums.py               # ScheduleType, ScheduleRunStatus — native Postgres ENUM-backed
│   ├── session.py               # Async engine + session factory
│   └── checkpointer.py          # LangGraph AsyncPostgresSaver (psycopg pool)
│
├── USER_GUIDE.txt               # End-user, step-by-step guide (keep in sync with the starter agent's prompt)
│
├── routers/
│   ├── auth.py                  # POST /auth/signup (also provisions the starter agent), /signin,
│   │                               /refresh, /signout, /me, /settings, /forgot-password, /reset-password
│   ├── api_keys.py              # API key CRUD (create, list, rename, revoke)
│   ├── agents.py                # Agent + sub-agent CRUD, sample-questions
│   ├── llm_credentials.py       # BYOK: provider/model catalog, per-provider credential upsert/delete
│   ├── schedules.py             # Schedule CRUD + execution history, per agent
│   ├── threads.py               # Thread CRUD + send message + get messages
│   ├── streams.py               # SSE stream + cancel + status poll + tool-approval resolution
│   ├── mcp.py                   # MCP connection CRUD + tool discovery/refresh + permission gating
│   └── usage.py                 # Per-run token usage/cost list (+ CSV download) + account summary
│
├── services/
│   ├── oauth_service.py         # User registration/authentication/token lifecycle + starter-agent provisioning
│   ├── api_key_service.py       # API key generation, listing, revocation
│   ├── agent_service.py         # Agent + sub-agent business logic (cascades to schedules on delete)
│   ├── llm_credential_service.py # BYOK credential validation (real provider call), encryption, catalog
│   ├── schedule_service.py      # Schedule CRUD, dedup-signature + next_run_at calendar math
│   ├── thread_service.py        # Thread lifecycle + checkpointer cleanup
│   ├── chat_service.py          # Non-blocking send + background generation + LLM resolution (default/BYOK)
│   │                               + tool-approval interrupt handling + token/cost capture
│   ├── mcp_service.py           # MCP connection management + tool sync + permission_state updates
│   └── usage_service.py         # Filtered/paginated usage queries, CSV export, account-wide summary
│
├── schemas/
│   ├── oauth.py                 # SignupRequest, SigninRequest, TokenPairResponse, ...
│   ├── api_key.py               # ApiKeyCreate/Rename/Response/CreateResponse
│   ├── agent.py                 # AgentCreate/Update/Response, SubAgent*, AgentSampleQuestionsResponse
│   ├── llm_credential.py        # ProviderInfo, ProviderCatalogEntry, LlmCredential*
│   ├── schedule.py               # ScheduleCreate/Update/Response, ScheduleRunResponse
│   ├── thread.py                # ThreadCreate/Response/CreateResponse
│   ├── message.py               # MessageCreate, MessageResponse
│   ├── stream.py                # StreamStartResponse, StreamStatusResponse, ToolApprovalRequest, StreamCancelResponse
│   ├── mcp.py                   # MCPConnection*/MCPTool*/MCPToolPermissionUpdate/MCPRefreshResponse
│   └── usage.py                 # UsageRunItem, UsageRunListResponse, UsageSummaryResponse
│
├── middleware/
│   ├── middleware.py            # setup_middleware: CORS, error handler wiring
│   └── error_handler.py         # Global exception → JSON error response (ValueError → 422)
│
└── utils/
    ├── auth.py                  # get_current_user, get_current_user_sse, get_current_user_flexible
    ├── encryption.py             # Fernet encrypt/decrypt for MCP API keys and BYOK credentials
    ├── graph_builder.py          # LangGraph StateGraph builder, LRU graph cache, LLM retry wrapper,
    │                               shared tool-result/permission-denial prompt instructions
    ├── reasoning_splitter.py      # Stateful <reasoning> tag splitter for token streams
    ├── scheduler.py               # Background tick loop: reconcile + fire due schedules
    ├── jwt.py                    # JWT encode/decode, expiry constants
    ├── mcp_client.py             # MCP tool registry (per agent_id), permission-aware tool exposure
    ├── security.py               # Password hashing and verification
    ├── sse.py                    # SSE generator, stream record verification, DB-reconstruction fallback
    └── stream_manager.py         # In-memory chunk buffers, SSE queues, task registry
```

---

## Data Model

All models inherit `BasicModel`, which provides `id` (UUID string), `is_active`, `created_at`, and `updated_at` (IST, naive). No row is ever physically deleted — all deletes set `is_active = False`.

```
users
  id  email(unique)  username(nullable)  password_hash  thinking_enabled(bool, default true)
  is_active  created_at  updated_at

providers
  id  name(unique)  display_name
  is_active  created_at  updated_at
                                       ← seed data: openai / anthropic / google

provider_models
  id  provider_id(FK→providers)  model_name  display_name  is_platform_default(bool)
  is_active  created_at  updated_at
                                       ← catalog backing the BYOK model picker

llm_credentials                       ← one row per (user, provider) — a saved BYOK key
  id  user_id(FK→users CASCADE)  provider_id(FK→providers)
  encrypted_api_key(Fernet-encrypted)
  is_active  created_at  updated_at

api_keys
  id  user_id(FK→users CASCADE)  name  key_hash(sha256, unique)  key_prefix(first 16 chars)
  expires_at(nullable)              ← NULL = never expires; naive IST, compared against utcnow()
  is_active  created_at  updated_at

agents
  id  user_id(FK→users CASCADE)  name  description  system_prompt
  parent_id(FK→agents CASCADE, nullable)   ← NULL = top-level; set = sub-agent
  llm_model_id(FK→provider_models, nullable)   ← NULL = platform default model
  is_active  created_at  updated_at

mcp_connections
  id  user_id(FK→users CASCADE)  name  url  api_key(Fernet-encrypted)  transport
  status(varchar, default "connected")   ← connected | disconnected — independent of is_active;
                                            disconnecting is a reversible pause, is_active is hard-delete
  is_active  created_at  updated_at

mcp_tools
  id  connection_id(FK→mcp_connections CASCADE)  name  description
  permission_state(varchar, default "allowed")   ← allowed | requires_approval | blocked
  is_active  created_at  updated_at
  UNIQUE(connection_id, name)

agent_tools                          ← junction: which tools each agent can use
  id  agent_id(FK→agents CASCADE)  tool_id(FK→mcp_tools CASCADE)
  is_active  created_at  updated_at
  UNIQUE(agent_id, tool_id)

threads
  id  user_id(FK→users CASCADE)  agent_id(FK→agents CASCADE)  title(nullable)
  is_active  created_at  updated_at

messages
  id  thread_id(FK→threads CASCADE)  role(user|assistant)  content
  is_partial(bool)    ← true for partial content saved on cancellation
  is_active  created_at  updated_at

stream_records
  id  thread_id(FK→threads CASCADE)
  user_message_id(FK→messages)  assistant_message_id(FK→messages, nullable)
  status(PENDING|RUNNING|AWAITING_APPROVAL|COMPLETED|FAILED|CANCELLED)   ← plain varchar
  partial_content(Text, nullable)     ← periodic flush for crash recovery
  reasoning(Text JSON, nullable)      ← structured {"steps": [...]} trace (see Reasoning & Streaming)
  error_message(Text, nullable)
  total_chunks(int)  completed_at(nullable)
  input_tokens(int, nullable)  cache_read_tokens(int, nullable)  output_tokens(int, nullable)
  cost_usd(Numeric(12,6), nullable)   ← null when the model's pricing isn't known, not 0
  llm_source(varchar, nullable)      ← "default" | "byok"
  llm_provider(varchar, nullable)    llm_model(varchar, nullable)
  is_active  created_at  updated_at

agent_schedules
  id  agent_id(FK→agents CASCADE)  user_id(FK→users CASCADE)
  schedule_type(schedule_type_enum: INTERVAL|DAILY|WEEKLY|MONTHLY)   ← native Postgres ENUM
  interval_minutes(nullable, 15|30|45|60)   time_of_day(nullable, "HH:MM")
  weekdays(nullable, "0,2,4" — 0=Mon..6=Sun)   day_of_month(nullable, 1-31)
  dedup_signature(varchar)          ← normalized recurrence fingerprint, see below
  next_run_at(nullable, indexed)    last_run_at(nullable)
  is_active  created_at  updated_at
  UNIQUE(agent_id, dedup_signature)

schedule_runs
  id  schedule_id(FK→agent_schedules CASCADE)  agent_id
  scheduled_for(indexed)            ← the trigger timestamp this run answers for
  thread_id(FK→threads, nullable)   stream_id(nullable)
  status(schedule_run_status_enum: PENDING|RUNNING|COMPLETED|FAILED|SKIPPED)  ← native Postgres ENUM
  error_message(Text, nullable)
  is_active  created_at  updated_at
  UNIQUE(agent_id, scheduled_for)
```

**Sub-agents** are stored in the `agents` table with `parent_id` set to their parent agent's ID. Top-level (parent) agents have `parent_id = NULL`. The `agent_tools` join table links agents to their allowed `mcp_tools` by primary key ID.

**Native enum columns, no Alembic:** `agent_schedules.schedule_type` and `schedule_runs.status` are native Postgres `ENUM` types (`schedule_type_enum`, `schedule_run_status_enum`) backed by the Python enums in `database/db_enums.py`. This project has no migration framework — `Base.metadata.create_all` creates missing tables/types on boot but never alters existing ones. Adding a new enum value later (including any new `stream_records` column, like the token/cost fields above) requires a manual `ALTER TABLE`/`ALTER TYPE` run directly against the database.

---

## Multi-Agent Execution Flow

### Graph topology

```
START
  │
  ▼
agent ──(no pending_tasks)──────────────────────────────► END
  │                                                        ▲
  │ (pending_tasks set by dispatch_to_subagents)           │
  ▼                                                        │
Send(sub_agent_1, task_1) ──────────────┐                 │
Send(sub_agent_2, task_2) ──────────────┤  parallel       │
Send(sub_agent_N, task_N) ──────────────┘                 │
  │                                                        │
  ▼ (all sub-agents converge)                              │
synthesizer ────────────────────────────────────────────► END
```

### Step-by-step

1. **Agent node** receives the conversation and runs a custom ReAct loop (max `MAX_AGENT_ITERATIONS` turns).
   - The node has access to all assigned MCP tools plus, when sub-agents are configured, a synthetic `dispatch_to_subagents` tool.
   - Every response — direct answer, tool call, or dispatch — must begin with a `<reasoning>...</reasoning>` block as plain text content before any tool call (enforced via the `REASONING_INSTRUCTION` system-prompt rules; see [Reasoning & Streaming Architecture](#reasoning--streaming-architecture)).
   - **No dispatch** (responds directly or uses own tools) → returns an `AIMessage`, graph routes to `END`.
   - **Dispatches** → intercepts the `dispatch_to_subagents` call before execution, extracts the `targets` list into `pending_tasks`, stores a clean `AIMessage` (no `tool_calls`) in state, then graph fans out via `Send`.

2. **Sub-agent nodes** each run an independent `create_react_agent` ReAct loop with their own system prompt, MCP tools, and the same reasoning-block requirement. Each is wrapped in `asyncio.wait_for(..., timeout=SUB_AGENT_TIMEOUT_SECONDS)` (default 900s / 15 minutes). Sub-agents are dispatched in parallel (max `MAX_PARALLEL_TASKS`, default 5).

3. **Synthesizer node** collects all sub-agent `AIMessage` results and the full conversation history, then calls the LLM once more to produce a single coherent final response within the parent agent's configured persona. It never reasons or dispatches — its output is always the final answer.

### Transient-network retry

`utils/graph_builder.py`'s `_ainvoke_with_retry()` wraps the two side-effect-free LLM calls — the main agent's per-turn call and the synthesizer's call — with up to `LLM_CALL_MAX_RETRIES` (default 2) retries on transient connection errors (`anyio.BrokenResourceError`, `httpx` connection/read/write errors, etc.), with a linear backoff of `LLM_CALL_RETRY_BACKOFF_SECONDS` per attempt. The sub-agent's internal ReAct loop is deliberately **not** retried the same way — its `create_react_agent` loop may have already executed a non-idempotent MCP tool (e.g. `push_prompt`, `create_dataset`) before a transient failure; blindly retrying the whole loop risks duplicating that side effect. Instead, a transient failure there is caught and surfaced as a graceful per-task failure message, leaving the top-level agent free to decide whether to re-dispatch.

### dispatch_to_subagents tool schema

```python
class _DispatchTarget(BaseModel):
    tool_name: str        # exact snake_case node name from the available sub-agent list
    task: str             # complete, self-contained task description with all context
    context: str = ""     # additional conversation context this sub-agent needs (optional)
    reason: str            # why this sub-agent was chosen and what result is expected

class _DispatchInput(BaseModel):
    targets: list[_DispatchTarget]   # max MAX_PARALLEL_TASKS (default 5)
```

### Safety guarantees

| Guarantee | Mechanism |
|---|---|
| No hallucinated sub-agents | `valid_sub_agent_names` filter strips any target not in the configured set |
| Parallel task cap | `[:MAX_PARALLEL_TASKS]` slice (default 5) |
| Sub-agent timeout | `asyncio.wait_for(..., timeout=SUB_AGENT_TIMEOUT_SECONDS)` (default 900s) |
| Transient LLM failure recovery | `_ainvoke_with_retry()` on the two safe call sites; graceful failure message for the sub-agent loop instead of a blind retry |
| Clean checkpointer state | Dispatch branch stores `AIMessage(content=...)` without `tool_calls` — prevents OpenAI 400 errors on subsequent turns |
| Corrupted history recovery | Agent node sanitizes persisted history: any `AIMessage` with unpaired `tool_calls` has them stripped before LLM invocation |
| Graph cache consistency | `invalidate_graph_cache(agent_id)` on every agent/sub-agent/MCP-tool change that affects a compiled graph |
| One active stream per thread | Active PENDING/RUNNING check before accepting a new message |
| Concurrent graph builds | Per-agent `asyncio.Lock` with double-check pattern |
| Bounded graph cache | `_LRUGraphCache` evicts least-recently-used entry (+ its build lock) when `GRAPH_CACHE_MAX_SIZE` (default 100) is reached |

---

## Reasoning & Streaming Architecture

### Transport: Server-Sent Events (SSE)

Token-by-token streaming over a standard HTTP `text/event-stream` response. Chosen over WebSockets because:
- Strictly unidirectional (server → client) — SSE is purpose-built for this
- Browser `EventSource` sends `Last-Event-ID` automatically on reconnect — resumable for free
- Standard HTTP; no sticky sessions or special proxy config beyond `X-Accel-Buffering: no`

### The `<reasoning>` tag protocol

Every agent and sub-agent node is instructed (`REASONING_INSTRUCTION` in `utils/graph_builder.py`) to wrap its thinking in `<reasoning>...</reasoning>` tags before any tool call or final answer. `utils/reasoning_splitter.py`'s `ReasoningSplitter` is a stateful, per-LLM-run token splitter that watches the raw token stream for these tags and routes each token to either the `reasoning` channel or the `content` channel in real time — it holds back a small trailing buffer (`max(len("<reasoning>"), len("</reasoning>")) - 1` characters) so a tag split across two token chunks is never missed. `sanitize_for_reasoning_tags()` escapes any literal `<reasoning>`/`</reasoning>` text arriving from external sources (tool output, scraped content) before it re-enters the LLM context, so untrusted content can never hijack the split. A safety valve (`REASONING_FORCE_CLOSE_AFTER_TOKENS`, default 1200) force-closes a reasoning block if the closing tag never arrives.

Only the **synthesizer's** output, and the **top-level agent's** output when it answers directly without dispatching, are treated as final user-visible content (`token` events). A dispatching agent's post-reasoning content and every sub-agent's post-reasoning content are tracked internally (for the `synthesis_start` event's `agents_completed` list) but never streamed as `token` events — the synthesizer always produces the one final answer the user sees.

### Flow

```
POST /api/v1/threads/{id}/messages
  → validate thread + agent ownership
  → check no active stream on this thread (concurrent block)
  → INSERT user Message to DB
  → INSERT StreamRecord (status=PENDING)
  → asyncio.create_task(_run_generation(...))
  → return 202 {message_id, stream_id}   ← immediate, non-blocking

GET /api/v1/streams/{stream_id}
  → verify stream ownership via DB (derives thread from stream record)
  → if COMPLETED + no in-memory buffer: reconstruct the SSE sequence from the DB trace
  → return StreamingResponse(sse_generator)

_run_generation  (background asyncio.Task, independent of HTTP lifecycle)
  → UPDATE StreamRecord status=RUNNING
  → capture pre-turn checkpoint ID (for cancellation rollback)
  → graph.astream_events(version="v2")
  → per on_chat_model_stream event: ReasoningSplitter routes tokens to reasoning_* or token events
  → per on_tool_start/on_tool_end, on_chain_start/on_chain_end: agent_start/agent_end/tool_start/tool_end
  → every TOKEN_FLUSH_INTERVAL (50) tokens: flush partial_content + structured reasoning trace to DB
  → on synthesizer on_chain_start: emit synthesis_start with agents_completed list
  → on completion:
      INSERT assistant Message (synthesizer or direct-response output only)
      UPDATE StreamRecord status=COMPLETED, partial_content=NULL, reasoning=JSON {"steps": [...]}
  → signal_done → schedule in-memory cleanup after STREAM_CLEANUP_DELAY_SECONDS (300s)
```

### SSE event reference

| Event | Data fields | Description |
|---|---|---|
| `reasoning_start` | `agent` | A `<reasoning>` block opened for this agent/sub-agent |
| `reasoning_token` | `content`, `agent` | Token inside an open reasoning block |
| `reasoning_end` | `agent`, `truncated` | Reasoning block closed (`truncated=true` if force-closed by the safety valve) |
| `token` | `content` | Final user-visible response token (synthesizer, or top-level agent answering directly) |
| `agent_start` | `agent_name` | A sub-agent node started |
| `agent_end` | `agent_name` | A sub-agent node finished |
| `tool_start` | `tool_name`, `agent_name` | MCP tool call started |
| `tool_end` | `tool_name`, `agent_name`, `output` | MCP tool call finished |
| `dispatch_decision` | `target`, `reason` | The top-level agent chose to delegate to a specific sub-agent |
| `synthesis_start` | `agents_completed` | Synthesizer started; lists every sub-agent that produced reasoning output |
| `thread_title` | `title` | Auto-generated thread title (first turn only, emitted before `done`) |
| `done` | `message_id`, `total_chunks` | Generation complete |
| `error` | `message`, `code` | Generation failed or cancelled |

### Resumable streaming

Every SSE event carries an `id:` field (chunk index starting at 0). On reconnect:

```
Client:  GET /api/v1/streams/{stream_id}
         Last-Event-ID: 42

Server:  resume_from = 43
         → replay in-memory buffer from index 43 (paced — SSE_REPLAY_PACING_SECONDS
           per chunk — so the client's reader sees them as separate reads, not one burst)
         → subscribe to live queue for new chunks
         → skip any chunk with index ≤ 42 (dedup guard)
```

The browser `EventSource` sends `Last-Event-ID` automatically on every reconnect — no client code required.

If the original in-memory buffer is gone (different reconnect timing, or a restart), `utils/sse.py` reconstructs a best-effort event sequence directly from the persisted `stream_records.reasoning` JSON trace and `partial_content`/final message — the client still sees a coherent `reasoning_start → reasoning_token → reasoning_end → token → done` sequence, just replayed rather than live.

### Stream states

```
PENDING ──────────────────────────────► CANCELLED
   │
   │ (background task starts)
   ▼
RUNNING ──────────────────────────────► CANCELLED
   │                  │
   │ (complete)       │ (error / timeout)
   ▼                  ▼
COMPLETED           FAILED
```

`COMPLETED`, `FAILED`, and `CANCELLED` are terminal. Failed or cancelled streams require a new `POST /messages` to retry.

**On cancellation:** any content already generated is saved as a `Message` with `is_partial=True`. The structured reasoning trace accumulated so far is saved to `stream_records.reasoning`. Partial checkpoints written during the cancelled turn are deleted; all prior turns' checkpoints are preserved.

**On startup**, any `PENDING`/`RUNNING` `StreamRecord` older than `STREAM_ORPHAN_GRACE_SECONDS` (30s) is marked `FAILED` — these are streams whose background task was killed when the server last stopped.

**The LLM is never called again on reconnect under any circumstances.**

### Client-side auth for SSE

```javascript
// fetch + ReadableStream (recommended — supports Authorization header)
fetch(`/api/v1/streams/${streamId}`, {
  headers: { Authorization: `Bearer ${token}` }
})

// Native EventSource (token in query param — cannot set custom headers)
new EventSource(`/api/v1/streams/${streamId}?token=${token}`)
```

Both are accepted by the `get_current_user_sse` dependency.

---

## Tool Permissions & Human-in-the-Loop Approval

Every MCP tool has a `permission_state`, set per tool or for every tool under a connection at once (`PATCH /mcp-tools`):

| State | Effect |
|---|---|
| `allowed` (default) | Runs automatically whenever an agent decides to call it |
| `requires_approval` | The agent's turn pauses via a LangGraph `interrupt()` and waits for a human decision before the tool actually runs |
| `blocked` | Removed from every agent's tool set immediately, regardless of assignment |

### Pause/resume flow

1. The agent (or a sub-agent) decides to call a gated tool. Instead of executing it, the graph's tools node raises a single combined `interrupt()` carrying every gated call requested in that turn at once — this matters because more than one gated tool can be requested in parallel within the same turn, and they must all resolve together before any of them executes (no side effect happens before the interrupt is answered).
2. `_run_generation` sees the interrupt surface through `astream_events`, marks the `StreamRecord` `AWAITING_APPROVAL`, and emits a `tool_approval_required` SSE event containing each pending `interrupt_id`/`tool_call_id`, the tool name/input, and the agent's stated reason.
3. The client calls `POST /streams/{stream_id}/tool-approvals` with one decision per pending call:
   - **`allow_once`** — runs it this one time only; still gated next time.
   - **`always_allow`** — runs it now **and** flips that tool's `permission_state` to `allowed` globally (every agent, not just this one) — no more asking, anywhere.
   - **`deny`** — the tool is skipped; the agent is told the user declined and continues without that result. The shared, tool-agnostic prompt instruction (`_tool_result_handling_instruction()` in `utils/graph_builder.py`) tells the agent to treat this as a deliberate decision, not a malfunction, and not to immediately re-request the same tool in the same response.
4. The server re-validates every `interrupt_id`/`tool_call_id` against the graph's own Postgres checkpoint before resuming — a stale or forged request can't approve something that isn't actually pending.
5. If a pending approval sits unanswered, it simply waits — there's no expiry. Cancelling the stream (`DELETE /streams/{stream_id}`) while `AWAITING_APPROVAL` denies every pending call so the interrupt resolves cleanly, then lets the agent's resulting follow-up run in the background (reconnect to see it).

### Scheduled runs are never blocked on approval

A scheduled trigger has no human present to answer a pause, so a gated tool encountered on a scheduled run is **auto-denied (skipped)** rather than paused — the run continues with whatever it can do without that tool, and notes the skip in its response. A tool a schedule needs every time should be set to `allowed`, not `requires_approval`.

### Sub-agent visibility

Sub-agents share the exact same interrupt-based gating as the top-level agent — there's no code path where a sub-agent's tool call bypasses `permission_state`.

---

## Bring Your Own LLM Key (BYOK)

By default every agent runs on ThinkLoop's own built-in OpenAI key and model — no setup, no cost to the user. A user can instead add their own API key for **OpenAI**, **Anthropic**, or **Google Gemini** once in Settings, then pick a model from that provider for a specific agent.

- `GET /llm-credentials/catalog` (public, no auth) returns the full provider/model list from the `providers`/`provider_models` tables, used to populate the model picker before a user has even added a key.
- `PUT /llm-credentials/{provider_id}` validates the raw key with a real call to the provider before encrypting (Fernet) and storing it, and invalidates the compiled-graph cache for every agent already configured on that provider so the very next message uses the new key.
- `DELETE /llm-credentials/{provider_id}` removes the credential; agents pointed at that provider either fall back to the platform default (OpenAI only) or fail with a clear error at chat time (Anthropic/Google have no platform-default fallback).
- `resolve_llm_for_agent()` in `services/chat_service.py` is the single place that decides, per run, whether an agent uses the platform default or the user's own credential — it returns an `LlmResolution(llm, provider, model, llm_source)`, and `llm_source` (`"default"` / `"byok"`) is what ultimately gets persisted per run for [usage/cost tracking](#token-usage--cost-tracking).
- Switching an agent's model later never affects existing conversation history.

---

## Token Usage & Cost Tracking

Every agent run (each message sent, and each scheduled trigger) is recorded with its token usage and dollar cost, clearly attributed to whichever key paid for it.

### Capture

- LangGraph's `on_chat_model_end` event carries a standardized `usage_metadata` dict (`input_tokens`, `output_tokens`, `input_token_details.cache_read`) across every supported provider — no per-provider parsing needed. `_run_generation` accumulates these into `input_tokens`/`cache_read_tokens`/`output_tokens` on the `StreamRecord` as the run streams.
- These accumulators are seeded from the `StreamRecord`'s own previously-persisted values on resume (e.g. after a tool-approval pause), so a paused-then-resumed run's totals are additive across the pause boundary rather than reset to zero.
- `llm_source`, `llm_provider`, and `llm_model` are stamped from the same `LlmResolution` used to actually run the turn (see [BYOK](#bring-your-own-llm-key-byok)).
- A cancelled or failed run still records whatever partial usage was accumulated up to that point — the tokens were genuinely spent regardless of how the run ended.

### Cost calculation

Cost is computed via **LiteLLM**'s bundled local pricing table (`litellm.cost_per_token`), not a hand-maintained pricing map — `LITELLM_LOCAL_MODEL_COST_MAP=True` is set before import so pricing lookups never make a network call. If a model's pricing is unknown to LiteLLM, `cost_usd` is stored as `NULL` (never `0` — that would read as genuinely free) while the token counts themselves are still recorded.

### API

- `GET /usage/runs` — every run for the authenticated user, filterable by `agent_id`, `start_date`/`end_date`, `provider`, `model`, `status`, paginated (`page`/`page_size`). Always ordered newest-first. Pass `is_download=true` to ignore pagination and instead receive every matching row (capped at 50,000) as a CSV file attachment — same filters, no separate export endpoint.
- `GET /usage/summary` — account-wide totals: total spent, total threads, total runs, and total agents (top-level agents only; sub-agent usage is folded into its parent run's totals, not counted as a separate agent).

---

## Onboarding — Temporary Agent

Every new signup (`POST /auth/signup`) automatically provisions a permanent starter agent named **"ThinkLoop Guide"** for the new user, so there's something to explore the platform with from the very first login instead of an empty workspace.

- Provisioning happens inside `signup()` in `services/oauth_service.py`, right after the `User` row is created — it's best-effort (wrapped in try/except, logs a warning on failure) and never blocks account creation if it fails.
- The agent's system prompt (`STARTER_AGENT_SYSTEM_PROMPT` in `constants.py`) gives it full working knowledge of ThinkLoop itself: agents/sub-agents, model choice & BYOK, conversations, MCP tools, tool permissions & approval, scheduling, and usage/cost tracking.
- It ships with four specialist sub-agents (`STARTER_AGENT_SUB_AGENTS`) it can delegate to for deeper detail: **Agents & Conversations**, **Tools, Integrations & Permissions**, **Automation & Scheduling**, and **Account & Credentials** (the last one deliberately excludes sign-up/sign-in — that's covered by the sign-up/sign-in screens themselves, not the agent).
- It's a completely normal, permanent agent once created — the user can rename, edit, or delete it freely; nothing about it is special-cased at the data-model level.
- Only new signups get it going forward; existing users at the time this was introduced were not backfilled.
- `GET /agents/{agent_id}/sample-questions` returns 5 pre-written starter questions **only** when the given agent's name is `"ThinkLoop Guide"` (empty list for any other agent) — used by the UI to show quick-start prompts.
- `USER_GUIDE.txt` at the repo root is the human-readable, step-by-step companion to this same agent — keep the two conceptually in sync when either changes.

---

## Agent Scheduling

Any top-level agent can have multiple independent recurring schedules — each fires the agent automatically, in a fresh conversation thread, without any client request.

### Schedule types

| Type | Fields | Example |
|---|---|---|
| `INTERVAL` | `interval_minutes` ∈ {15, 30, 45, 60} | every 30 minutes |
| `DAILY` | `time_of_day` ("HH:MM", 24h, IST) | every day at 09:00 |
| `WEEKLY` | `time_of_day` + `weekdays` (0=Mon..6=Sun, ≥1 required) | Mon/Wed/Fri at 18:30 |
| `MONTHLY` | `time_of_day` + `day_of_month` (1-31) | day 4 of every month at 04:00 |

All times are interpreted in **IST** (matching the rest of the app's `utcnow()` convention). India observes no DST, so there's no daylight-saving edge case to handle.

### Duplicate detection

Each schedule has a normalized `dedup_signature` computed from its recurrence definition. Creating an exact duplicate of an existing active schedule for the same agent is **rejected with a 422**, not silently merged. A `WEEKLY` schedule selecting all 7 days is normalized to the same signature as an equivalent `DAILY` schedule, so the two are correctly treated as duplicates of each other too.

### Month-end handling

If `day_of_month` is 29, 30, or 31, the response includes a `warning` field. In any month that doesn't contain that day, the schedule is simply **skipped** for that month — it does not fall back to the last valid day.

### Execution engine (`utils/scheduler.py`)

A single background `asyncio` task (started from `main.py`'s lifespan) ticks every `SCHEDULER_TICK_INTERVAL_SECONDS` (60s):

1. **Reconcile** — every `schedule_runs` row still `RUNNING` is checked against its linked `StreamRecord`; once that stream reaches `COMPLETED`/`FAILED`/`CANCELLED`, the `schedule_runs` row is updated to match, freeing that schedule's concurrency slot.
2. **Fire due schedules** — every active `agent_schedules` row with `next_run_at <= now` is processed:
   - **Concurrency policy — skip, not queue:** if that schedule already has a `RUNNING` `schedule_runs` row, the new trigger is recorded as `SKIPPED` (no execution) rather than queued. A schedule whose runs are consistently slower than its own interval would otherwise build an ever-growing backlog under a queueing policy; skipping keeps it always caught up, at the cost of occasionally missing a beat.
   - **Otherwise**, a new `Thread` is created for the agent and a message is sent through the exact same `ChatService.send_message()` path a manual chat request uses — so a scheduled run gets identical streaming, reasoning, and retry behavior to a manual one. Each scheduled execution gets its own brand-new thread; there is no shared conversation memory across runs of the same schedule.
   - `next_run_at` is advanced from the trigger's own `scheduled_for` timestamp (not from "now"), so tick delay/jitter never drifts the cadence forward over time.

On startup, any `schedule_runs` row left `RUNNING` from a killed server process is marked `FAILED` (mirroring the stream orphan sweep), so a crash never permanently blocks a schedule.

Failures are logged to `schedule_runs.error_message` only — there is currently no proactive notification; check `GET /agents/{id}/schedules/{schedule_id}/runs` for history.

---

## Configuration

Configuration is a single JSON blob read from the `THINKLOOP_CONFIG` environment variable (via `pydantic-settings`, `env_prefix="THINKLOOP_"`), loaded from a `.env` file in the project directory:

```env
THINKLOOP_CONFIG='{
  "ENVIRONMENT": "DEV",
  "DB": {
    "username": "postgres",
    "password": "your-db-password",
    "database": "thinkloop",
    "ip_address": "localhost",
    "port": "5432",
    "pool_size": 40,
    "max_overflow": 10,
    "pool_timeout": 30,
    "pool_recycle": 1800
  },
  "LLM": {
    "openai_api_key": "sk-...",
    "openai_model": "gpt-5-mini"
  },
  "JWT": {
    "secret_key": "a-long-random-secret",
    "algorithm": "HS256"
  },
  "LANGSMITH": {
    "tracing_enabled": false,
    "api_key": "",
    "project": ""
  },
  "MCP": {
    "encryption_key": "output of: python -c \"from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())\""
  }
}'
```

| Key path | Required | Description |
|---|---|---|
| `DB.*` | Yes | PostgreSQL connection details (async engine uses `postgresql+asyncpg://`; the LangGraph checkpointer pool uses a plain `postgresql://` conninfo built from the same values) |
| `LLM.openai_api_key` | Yes | OpenAI API key |
| `LLM.openai_model` | Yes | OpenAI chat model (e.g. `gpt-5-mini`) |
| `JWT.secret_key` | Yes | Signs/verifies access + refresh tokens |
| `JWT.algorithm` | Yes | e.g. `HS256` |
| `LANGSMITH.tracing_enabled` | No | Enables LangSmith tracing when `true` |
| `LANGSMITH.api_key` / `project` | No | Required only if tracing is enabled |
| `MCP.encryption_key` | Yes | Fernet key encrypting MCP connection API keys at rest |

> **Important:** the app reads config exclusively through `THINKLOOP_CONFIG` — do not rely on individual flat environment variables (`DATABASE_URL`, `OPENAI_API_KEY`, etc.) being read directly; they are not. If a shell-level `config` or `THINKLOOP_CONFIG` variable is already set in your environment (e.g. via `~/.bashrc`), it takes precedence over the `.env` file's value — real process environment variables always outrank `.env` in `pydantic-settings`.

---

## Getting Started

### Prerequisites

- Python 3.12+
- PostgreSQL 14+

### Install

```bash
cd thinkloop-backend
python -m venv .venv
source .venv/bin/activate       # Windows: .venv\Scripts\activate
pip install -r requirements.txt
```

Create a `.env` file as shown in [Configuration](#configuration).

### Run (development)

```bash
uvicorn main:app --reload --port 8000
```

### Run (production-style, single worker)

```bash
./gunicorn_starter.sh
```

which runs:

```sh
gunicorn main:app -k uvicorn.workers.UvicornWorker -w 1 --bind 0.0.0.0:8000 --timeout 120 --keep-alive 5
```

- Swagger UI: `http://localhost:8000/docs`
- ReDoc: `http://localhost:8000/redoc`
- Health check: `GET /health`

### Startup sequence

On every start, the application's `lifespan`:

1. **`Base.metadata.create_all`** — creates all tables (and any new native enum types) if they don't already exist
2. **`init_checkpointer()`** — opens the psycopg pool and creates LangGraph checkpoint tables
3. **`_mark_orphaned_streams()`** — marks any `PENDING`/`RUNNING` streams older than `STREAM_ORPHAN_GRACE_SECONDS` (30s) as `FAILED`
4. **`_mark_orphaned_schedule_runs()`** — same recovery for `schedule_runs` left `RUNNING` by a killed process
5. **`build_agent_tool_registry()`** — loads MCP tools into memory for all active agents using a single batch query
6. **`start_scheduler()`** — starts the background scheduler tick loop

---

## API Reference

All endpoints except `/auth/*` require:
```
Authorization: Bearer <token>
```

Tokens can be a JWT from `/auth/signin` or a programmatic API key created via `POST /api-keys` (`sk-tl-...`).

All routes are prefixed with `/api/v1`.

### Auth

| Method | Path | Description |
|---|---|---|
| `POST` | `/auth/signup` | Register a new user (`username?`, `email`, `password`, `confirm_password`); auto-provisions the "ThinkLoop Guide" starter agent (see [Onboarding](#onboarding--temporary-agent)) |
| `POST` | `/auth/signin` | Sign in → `{access_token, refresh_token}` |
| `GET` | `/auth/me` | Get the authenticated user's profile |
| `PATCH` | `/auth/settings` | Update account settings (e.g. `thinking_enabled`) |
| `POST` | `/auth/refresh` | Exchange a refresh token for a new token pair |
| `POST` | `/auth/signout` | Invalidate the current session (stateless — client discards tokens) |
| `POST` | `/auth/forgot-password` | Reset password directly via email + new password (no proof-of-ownership step) |
| `POST` | `/auth/reset-password` | Change password by providing email + old password + new password |

### LLM Credentials (BYOK)

| Method | Path | Description |
|---|---|---|
| `GET` | `/llm-credentials/providers` | List active providers (public, no auth) |
| `GET` | `/llm-credentials/catalog` | Full provider + active-model catalog for the model picker (public, no auth) |
| `GET` | `/llm-credentials` | List the authenticated user's saved credentials (masked key preview only) |
| `PUT` | `/llm-credentials/{provider_id}` | Add/replace the user's API key for a provider (validated against the real provider first) |
| `DELETE` | `/llm-credentials/{provider_id}` | Remove the user's credential for a provider |

```json
PUT /api/v1/llm-credentials/{provider_id}
{"api_key": "sk-..."}
→ 200 {"provider_id": "...", "provider_name": "openai", "masked_key": "sk-...abcd", "created_at": "..."}
```

See [Bring Your Own LLM Key (BYOK)](#bring-your-own-llm-key-byok) for how a credential is picked up at generation time.

### API Keys

| Method | Path | Description |
|---|---|---|
| `POST` | `/api-keys` | Create a new API key with an expiry (raw key returned once only) |
| `GET` | `/api-keys` | List all active keys (prefix + metadata + expiry, no raw key) |
| `PATCH` | `/api-keys/{id}` | Rename a key |
| `DELETE` | `/api-keys/{id}` | Revoke a key (soft-delete) |

```json
POST /api/v1/api-keys
{"name": "My Integration", "expiry": "3m"}
→ 201 {
  "id": "...", "name": "My Integration", "key": "sk-tl-...", "key_prefix": "sk-tl-aBcDeFgH",
  "expires_at": "2026-11-13T00:00:00", "is_expired": false, "created_at": "..."
}
```

`expiry` is one of `"7d"`, `"1m"`, `"3m"`, `"6m"`, `"custom"`, or `"none"` (default). For `"custom"`, also send `custom_expires_at` (an ISO 8601 datetime in the future) — e.g. `{"name": "...", "expiry": "custom", "custom_expires_at": "2027-01-01T00:00:00Z"}`. `"none"` never expires.

An expired key is **not** auto-revoked: it keeps `is_active: true` and stays visible in `GET /api-keys` with `is_expired: true` until the user explicitly revokes it — but any request authenticated with it is rejected with the same `401 Invalid or revoked API key` used for a bad/unknown key, so a caller can't distinguish "wrong key" from "expired key."

> Store the `key` value immediately — it cannot be retrieved after creation.

### MCP Connections

Register external MCP servers to expose their tools to your agents.

| Method | Path | Description |
|---|---|---|
| `POST` | `/mcp-connections` | Register an MCP server (validated + synced immediately) |
| `GET` | `/mcp-connections` | List connections with `status` and `tools_count` |
| `PATCH` | `/mcp-connections/{id}` | Rename a connection |
| `PATCH` | `/mcp-connections/{id}/status` | Connect or disconnect a connection (reversible pause — see below) |
| `DELETE` | `/mcp-connections/{id}` | Soft-delete + cascade cleanup (permanent — see below) |
| `POST` | `/mcp-connections/{id}/refresh` | Re-sync tools from the MCP server |
| `GET` | `/mcp-tools` | List active MCP tools (optionally filtered by `?connection_id=`), ordered by creation time |
| `PATCH` | `/mcp-tools` | Set `permission_state` (`allowed`/`requires_approval`/`blocked`) for one tool (`?tool_id=`) or every tool under one connection (`?connection_id=`) — exactly one of the two query params is required |

```json
POST /api/v1/mcp-connections
{
  "name": "my-tools",
  "url": "https://mcp.example.com/mcp/v1",
  "api_key": "sk-mcp-...",
  "transport": "streamable_http"
}
→ 201 {"id": "...", "name": "my-tools", "url": "...", "transport": "streamable_http", "status": "connected", "tools_count": 12}
```

The MCP API key is encrypted at rest using Fernet with a key from `MCP.encryption_key`. It is never returned in any API response. The same URL cannot be registered twice (per user, while active).

**Connect / Disconnect vs. Delete.** `status` (`connected`/`disconnected`) is independent of `is_active` (permanent soft-delete):

- **Disconnect** (`PATCH .../status {"status": "disconnected"}`) is a reversible pause — it evicts the connection's tools from the live registry so agents stop invoking them, but leaves the connection's config, its `mcp_tools` catalog, and every agent's tool assignments completely untouched.
- **Connect** (`PATCH .../status {"status": "connected"}`) re-validates the server is reachable, re-syncs its tool list, and automatically restores it to every agent that still had an active assignment — no manual reassignment needed.
- **Delete** is permanent: it deactivates the connection's tools and every `AgentTool` link to them. There is no undo short of creating a new connection and reassigning tools by hand.
- While disconnected, the connection's tools disappear from `GET /mcp-tools` and cannot be assigned to an agent, but the connection itself still appears in `GET /mcp-connections` (with `status: "disconnected"`) so it can be reconnected later.

```json
PATCH /api/v1/mcp-connections/{id}/status
{"status": "disconnected"}
→ 200 {"id": "...", "name": "my-tools", "url": "...", "transport": "streamable_http", "status": "disconnected", "tools_count": 12}
```

```
GET /api/v1/mcp-tools?connection_id=<id>
→ [{"id": "abc123", "name": "web_search", "display_name": "Web Search", "description": "...", "connection_id": "...", "connection_name": "..."}, ...]

PATCH /api/v1/mcp-tools?tool_id=abc123
{"permission_state": "requires_approval"}
→ 200 [{"id": "abc123", "name": "web_search", "permission_state": "requires_approval", ...}]
```

Copy the `id` values — you'll use them when creating or updating agents. See [Tool Permissions & Human-in-the-Loop Approval](#tool-permissions--human-in-the-loop-approval) for the full pause/resume/deny flow this gate triggers.

### Agents

| Method | Path | Description |
|---|---|---|
| `POST` | `/agents` | Create an agent with optional sub-agents |
| `GET` | `/agents` | List all top-level agents |
| `GET` | `/agents/{id}` | Get agent by ID |
| `PUT` | `/agents/{id}` | Update agent and/or sub-agents |
| `DELETE` | `/agents/{id}` | Soft-delete agent, all sub-agents, and all its schedules |
| `POST` | `/agents/{id}/sub-agents` | Add a new sub-agent to an existing agent |
| `DELETE` | `/agents/{id}/sub-agents/{sub_id}` | Remove a sub-agent (soft-delete) |
| `GET` | `/agents/{id}/threads` | List threads for this agent |
| `GET` | `/agents/{id}/sample-questions` | 5 starter questions if this agent is the "ThinkLoop Guide", else `[]` |

**`tools` fields accept MCPTool IDs** (not names). Use `GET /mcp-tools` to get valid IDs first.

```json
POST /api/v1/agents
{
  "name": "Research Supervisor",
  "system_prompt": "You are a research supervisor. Delegate tasks to specialists.",
  "description": "Orchestrates research sub-agents",
  "tools": [],
  "sub_agents": [
    {
      "name": "Web Search Agent",
      "system_prompt": "You are a web search specialist. Use your tools to find accurate information.",
      "tools": ["<mcp_tool_id_for_web_search>", "<mcp_tool_id_for_fetch_url>"]
    },
    {
      "name": "Data Analysis Agent",
      "system_prompt": "You are a data analyst. Interpret and summarize data findings.",
      "tools": []
    }
  ]
}
→ 201 AgentResponse with nested sub_agents and tools (tool names, not IDs)
```

- Only top-level (parent) agents can have threads. Sub-agent IDs are rejected by `POST /threads`.
- Sub-agent structure (which sub-agents exist) is managed via `POST /sub-agents` and `DELETE /sub-agents/{id}`. `PUT /agents/{id}` updates name, description, system prompt, and tools of existing sub-agents only.
- Deleting an agent cascades to all sub-agents and all its schedules, evicts them from the tool registry and graph cache, but retains all historical threads and messages.

### Schedules

| Method | Path | Description |
|---|---|---|
| `POST` | `/agents/{agent_id}/schedules` | Create a schedule rule |
| `GET` | `/agents/{agent_id}/schedules` | List active schedules for an agent |
| `PATCH` | `/agents/{agent_id}/schedules/{schedule_id}` | Update recurrence, or pause/resume via `is_active` |
| `DELETE` | `/agents/{agent_id}/schedules/{schedule_id}` | Soft-delete a schedule |
| `GET` | `/agents/{agent_id}/schedules/{schedule_id}/runs` | Execution history, newest first |

```json
POST /api/v1/agents/{agent_id}/schedules
{"schedule_type": "DAILY", "time_of_day": "09:00"}
→ 201 {
  "id": "...", "agent_id": "...", "schedule_type": "DAILY",
  "interval_minutes": null, "time_of_day": "09:00", "weekdays": null, "day_of_month": null,
  "is_active": true, "next_run_at": "2026-08-01T09:00:00", "last_run_at": null, "warning": null
}

PATCH /api/v1/agents/{agent_id}/schedules/{schedule_id}
{"is_active": false}
→ 200 (pauses the schedule)

GET /api/v1/agents/{agent_id}/schedules/{schedule_id}/runs
→ [{"id": "...", "schedule_id": "...", "scheduled_for": "...", "thread_id": "...", "status": "COMPLETED", "error_message": null, "created_at": "..."}]
```

Max `MAX_SCHEDULES_PER_AGENT` (10) active schedules per agent. Creating an exact duplicate of an existing active schedule returns 422. See [Agent Scheduling](#agent-scheduling) for the full recurrence/dedup/execution model.

### Threads & Messaging

| Method | Path | Description |
|---|---|---|
| `POST` | `/threads` | Create a conversation thread |
| `GET` | `/threads/{id}` | Get thread by ID |
| `PATCH` | `/threads/{id}` | Update thread title |
| `DELETE` | `/threads/{id}` | Soft-delete thread + checkpointer cleanup |
| `POST` | `/threads/{id}/messages` | Send message, start generation (202) |
| `GET` | `/threads/{id}/messages` | Get all messages with per-turn reasoning |

```json
POST /api/v1/threads
{"agent_id": "<parent_agent_id>"}
→ 201 {"thread_id": "..."}

POST /api/v1/threads/{thread_id}/messages
{"message": "What are the latest trends in AI?"}
→ 202 {"message_id": "...", "stream_id": "...", "status": "PENDING"}
```

`GET /api/v1/threads/{id}/messages` returns all messages ordered by creation time, each assistant message including its structured `reasoning` trace:

```json
[
  {
    "id": "...", "thread_id": "...", "role": "user",
    "content": "What are the latest trends in AI?",
    "is_partial": false, "reasoning": null,
    "created_at": "2026-01-01T00:00:00"
  },
  {
    "id": "...", "thread_id": "...", "role": "assistant",
    "content": "Based on recent research, the key trends are...",
    "is_partial": false,
    "reasoning": {"steps": [{"agent": "web_researcher", "step": "thought", "content": "...", "duration_ms": 812, "truncated": false}]},
    "created_at": "2026-01-01T00:00:10"
  }
]
```

`is_partial: true` means the message was saved from a cancelled generation (incomplete response).

### Streams

| Method | Path | Description |
|---|---|---|
| `GET` | `/streams/{stream_id}` | Open SSE token stream (or replay/reconstruct a completed one) |
| `DELETE` | `/streams/{stream_id}` | Cancel an in-progress generation, or deny every pending tool approval |
| `POST` | `/streams/{stream_id}/tool-approvals` | Resolve pending tool-approval decision(s) and resume generation |
| `GET` | `/streams/{stream_id}/status` | Poll stream state without opening SSE |

```json
GET /api/v1/streams/{stream_id}/status
→ {
  "stream_id": "...", "status": "RUNNING", "total_chunks": 47,
  "partial_content": "Based on recent...",
  "reasoning": {"steps": [{"agent": "web_researcher", "step": "thought", "content": "...", "partial": true}]}
}

GET /api/v1/streams/{stream_id}/status   (when paused on a gated tool)
→ {
  "stream_id": "...", "status": "AWAITING_APPROVAL", "total_chunks": 12,
  "pending_approval": {"pending": [
    {"interrupt_id": "...", "tool_call_id": "...", "tool_name": "send_email",
     "tool_input": {"to": "...", "subject": "..."}, "reason": "User asked to notify the team", "agent": "agent"}
  ]}
}

POST /api/v1/streams/{stream_id}/tool-approvals
{"decisions": [{"interrupt_id": "...", "tool_call_id": "...", "decision": "allow_once"}]}
→ 202 {"message_id": "...", "stream_id": "...", "status": "RUNNING"}
```

`decision` is one of `allow_once`, `always_allow`, or `deny`. See [Tool Permissions & Human-in-the-Loop Approval](#tool-permissions--human-in-the-loop-approval) for what each one does.

### Usage & Cost

| Method | Path | Description |
|---|---|---|
| `GET` | `/usage/runs` | List runs (filters: `agent_id`, `start_date`, `end_date`, `provider`, `model`, `status`; paginated) — pass `is_download=true` for a CSV of every matching row instead |
| `GET` | `/usage/summary` | Account-wide totals: `total_spent_usd`, `total_threads`, `total_runs`, `total_agents` |

```json
GET /api/v1/usage/runs?start_date=2026-08-01T00:00:00Z&end_date=2026-08-12T23:59:59Z&page=1&page_size=20
→ {
  "items": [{
    "stream_id": "...", "thread_id": "...", "agent_id": "...", "agent_name": "Research Supervisor",
    "status": "COMPLETED", "input_tokens": 1611, "cache_read_tokens": 0, "output_tokens": 202,
    "total_tokens": 1813, "cost_usd": 0.0043, "llm_source": "default", "provider": "openai",
    "model": "gpt-5-mini", "created_at": "...", "completed_at": "..."
  }],
  "total": 1, "page": 1, "page_size": 20
}

GET /api/v1/usage/summary
→ {"total_spent_usd": 4.82, "total_threads": 37, "total_runs": 112, "total_agents": 5}
```

See [Token Usage & Cost Tracking](#token-usage--cost-tracking) for how capture and cost calculation work.

---

## Key Design Decisions

| Decision | Choice | Rationale |
|---|---|---|
| Streaming transport | SSE | Unidirectional; built-in `Last-Event-ID` reconnect; no sticky sessions |
| Generation on client disconnect | Continue independently | Reconnecting client gets all missed chunks from buffer; no duplicate LLM calls |
| Chunk storage | In-memory + periodic DB flush | No Redis dependency (yet); buffer survives 5 min post-completion; DB is crash-recovery fallback |
| Idempotency | Backend-generated `stream_id` | Same `stream_id` = same generation, never re-executed |
| Sub-agent storage | `parent_id` FK on `agents` table | Sub-agents are config rows within the same table; clean hierarchy with one self-referential FK |
| Tool assignment | MCPTool primary-key IDs | Unambiguous; decoupled from tool name changes on the MCP server; ownership verified at write time |
| Tool registry | In-memory `_agent_tool_registry` keyed by `agent_id` | O(1) lookup at inference time; populated at startup and on every create/update |
| Agent dispatch mechanism | `dispatch_to_subagents` synthetic tool | The LLM calls a tool to signal delegation; the call is intercepted before execution and converted into `pending_tasks` for the routing edge — no structured output type needed |
| Reasoning enforcement | System-prompt `REASONING_INSTRUCTION` (not a code-level gate) | Every response must start with a `<reasoning>` block; kept prompt-only rather than parsing/rejecting model output, per an earlier deliberate choice to avoid brittle server-side enforcement of LLM output shape |
| Transient LLM retry scope | Only side-effect-free call sites (`_ainvoke_with_retry`) | Retrying the sub-agent's whole ReAct loop is unsafe — it may have already run a non-idempotent tool before failing; graceful per-task failure is used there instead |
| Dispatch message sanitization | Store `AIMessage(content=...)` without `tool_calls` | `dispatch_to_subagents` never produces a `ToolMessage`; persisting the raw response with `tool_calls` would corrupt the checkpointer and cause OpenAI 400 errors on every subsequent turn |
| Corrupted history recovery | Agent node sanitizes `responded_ids` on every turn | Any persisted `AIMessage` with unpaired `tool_calls` has them stripped before the LLM call — backward-compatible with threads written before the sanitization was added |
| Graph cache | `_LRUGraphCache` (OrderedDict) with explicit invalidation | Compiled graphs are expensive; LRU eviction caps memory; build lock co-evicted to prevent unbounded lock growth |
| MCP API key security | Fernet encryption at rest | API keys never stored in plaintext; never returned in any API response |
| Duplicate MCP URL prevention | Application-level check scoped to `is_active=True` | Allows re-creation after soft-delete without a DB `UniqueConstraint` |
| Concurrent graph builds | Per-agent `asyncio.Lock` + double-check pattern | Prevents duplicate builds when multiple requests hit a cold cache simultaneously |
| LLM instance | Module-level singleton `_get_llm()` with tuned `httpx` connection pool | Single connection pool shared across all requests; short `keepalive_expiry` reduces the odds of handing out a silently-stale pooled connection (the main practical cause of a mid-stream `BrokenResourceError`) |
| Soft deletes | `is_active = False` throughout | Full audit trail; no data loss; consistent cascade behaviour across all models |
| Checkpointer | `AsyncPostgresSaver` (psycopg pool) | Per-thread LangGraph conversation memory, persisted across server restarts |
| Concurrent message block | Active stream check before insert | Prevents multiple parallel generations on the same thread |
| Partial cancellation | `is_partial=True` Message + reasoning saved on cancel | Content generated before cancel is saved as a partial message; the reasoning trace accumulated so far is saved to `stream_records.reasoning` |
| Constants centralisation | `constants.py` module | Single source of truth for all tuneable values; eliminates magic numbers scattered across files |
| Enum columns | Native Postgres `ENUM` types for `schedule_type`/`status`, Python enums in `database/db_enums.py` | Strongest DB-level guarantee against invalid values; accepted the tradeoff that adding a new value later needs a manual `ALTER TYPE` since this project has no Alembic |
| Schedule duplicate handling | Reject at creation (422), not silent merge | Keeps the schedule list free of redundant rows; dedup is enforced by a DB `UniqueConstraint` on a normalized signature |
| Schedule concurrency policy | Skip overlapping triggers, never queue | A schedule slower than its own interval would otherwise build an unbounded backlog under a queueing policy; skipping keeps it always caught up |
| Schedule execution isolation | New `Thread` per scheduled run | No shared conversation memory across runs — avoids unbounded thread growth and matches how manual chat threads already work |
| Scheduler reconciliation | Poll `StreamRecord` status from the tick loop rather than awaiting the generation task directly | Scheduled generation reuses the same fire-and-forget `send_message()` path as manual chat; the tick loop's next pass simply checks whether the linked stream finished |
| Single gunicorn worker | `-w 1` in `gunicorn_starter.sh` | In-memory stream buffers/queues and the scheduler tick loop are per-process state; one worker avoids cross-process consistency issues without needing Redis yet — planned to move to Redis-backed coordination when scaling beyond one worker/instance |
| Config loading | Single `THINKLOOP_CONFIG` JSON blob via `pydantic-settings` (`env_prefix="THINKLOOP_"`) | One structured source of truth instead of many flat env vars; real process env vars still take precedence over `.env`, so a stray shell-level `THINKLOOP_CONFIG`/`config` export can silently shadow the `.env` file's value |
| Streams as separate router | `routers/streams.py` at `/api/v1/streams/` | Stream operations (SSE, cancel, status) are independent of thread context; stream `id` is self-contained — thread ownership is derived from the stream record itself |
| Tool approval mechanism | LangGraph `interrupt()`, checkpointer as source of truth | Pausing is a first-class graph state, not an ad-hoc flag; resuming re-validates against the durable checkpoint so a stale/forged approval request can't succeed |
| Tool approval scope | Global per tool (`MCPTool.permission_state`), not per-agent or per-thread | One switch protects a tool everywhere it's assigned; simpler mental model than per-agent or per-conversation overrides, at the cost of no thread-scoped "allow just this chat" option (considered, not built) |
| Scheduled-run approval handling | Auto-deny (skip), never pause | No human is present to answer a scheduled trigger's pause; skipping keeps the run moving instead of hanging forever |
| Cost calculation | LiteLLM local pricing table (`LITELLM_LOCAL_MODEL_COST_MAP=True`) instead of a hand-maintained map | Standardized, provider-agnostic pricing without owning a pricing table; forcing the local-only mode avoids a network call at import time; unknown models cleanly fall back to `cost_usd: NULL` |
| Token capture point | LangGraph's `on_chat_model_end` `usage_metadata`, not a custom wrapper | Already standardized across every supported provider by LangChain itself; no per-provider parsing needed |
| Usage export | `is_download` flag on `GET /usage/runs`, not a separate export endpoint | The list and the download share one filter-building code path — the exported file can never drift from what the UI's filtered list shows |
| BYOK credential resolution | Single `resolve_llm_for_agent()` returning `LlmResolution` | One place decides default-vs-BYOK per run; the same `llm_source`/`provider`/`model` it returns is what gets persisted for usage/cost tracking — no duplicated resolution logic |
| MCP connection pause | Separate `status` column, not overloading `is_active` | Keeps "temporarily off" and "permanently deleted" as distinct, independent states; disconnect never touches `MCPTool`/`AgentTool` rows, so reconnect needs zero reassignment |
| Connect/Disconnect API shape | One `PATCH .../status {"status": ...}` endpoint, not two separate POST endpoints | A single status-setting endpoint mirrors the existing `PATCH /mcp-tools` permission-state pattern instead of introducing a new verb-per-action convention |
| API key expiry lifecycle | Expired key stays `is_active=true` with `is_expired=true`, no auto-revoke | Full audit trail — the key remains visible until the user explicitly revokes it; the 401 it triggers is worded identically to a revoked/unknown key so expiry can't be probed for |
| Starter agent provisioning | Best-effort, inside `signup()`, no dedicated "first login" tracking column | Simpler than tracking first-login state separately; a provisioning failure never blocks account creation, it's just logged |
