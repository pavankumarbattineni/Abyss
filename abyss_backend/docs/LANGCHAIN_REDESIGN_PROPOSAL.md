# Abyss Backend: Agent Architecture Redesign (LangChain / LangGraph native)

Status: **IMPLEMENTED (backend, native reasoning, frontend) — uncommitted, awaiting your review.**
Branch: `feature/create-agent-supervisor`
Scope: `abyss_backend/utils/graph_builder.py` and everything that depends on its shape (`services/chat_service.py`, `studio/graph.py`, approval endpoints, scheduler).

---

## 1. Goals

1. Replace hand-rolled agent plumbing with native `langchain` / `langgraph` components (`create_agent`, middleware, `Command`/interrupt conventions, standard stream modes).
2. Keep every user-visible behavior: parent agent with MCP tools, parallel sub-agents, per-tool approval (Allow / Requires approval / Blocked), unattended (scheduled) runs, BYOK models, reasoning trace, SSE streaming and reconnect, cancel, token and cost accounting.
3. Shrink the surface we maintain. `graph_builder.py` is 1,051 lines and `chat_service.py` is 1,396 lines. Most of that is orchestration that the framework now provides.

Non-goals (unless you say otherwise): changing the DB schema, the REST API, the MCP registry, or the frontend contract (see open questions Q3, Q4).

---

## 1.1 Decisions made so far

| # | Decision |
|---|---|
| Q1 | Sub-agents return results to the main agent; the **main agent writes the final response**. No synthesizer node. Option A (sub-agents as tools). |
| Q3/Q4 | **Adopt the framework's native approval (HITL) and streaming shapes**; the frontend (`abyss_frontend`) is updated alongside the backend. No byte-compatibility layer. |
| Q4b | Approvals pending at cutover are auto-denied. |
| Q5 | **Hybrid reasoning**: provider-native reasoning where the model supports it, prompt-based `<reasoning>` fallback otherwise. Ship the migration on the existing method first; add native reasoning as a separate step. |
| Q8 | Drop the graph cache if compile time is negligible (measure first). |
| Q2 | **Max 5 sub-agents per main agent**; sub-agents may have any number of tools. One `@tool` per sub-agent (≤5 descriptions in the parent's context is cheap and gives the model the best routing signal). The 5-sub-agent cap is enforced at sub-agent creation (to be verified in `agent_service`; added if missing). |
| Q6 | **Parent agent gets `SummarizationMiddleware`**, implemented in this migration. Final config: `trigger=[("fraction", 0.7), ("tokens", 100_000)]` (whichever hits first; the token trigger is the fallback if a model profile has no context size), `keep=("messages", 20)`, summarizer = the same resolved model. Sub-agents are stateless per call and are not summarized. The UI reads history from the `Message` table, so condensing the checkpoint state does not affect what users see. |
| Q7 | Permission changes apply **from the next turn only**. The tool policy is built per run from the registry, so no dynamic lookup is needed. |
| Q9 | Keep the **900 s timeout** per sub-agent (`asyncio.wait_for` in `SubAgentTool`). The parallel cap becomes a **per-turn limit of 5 sub-agent tool calls** (a custom `wrap_tool_call` check). Excess calls are *rejected with an explanatory `ToolMessage`* (not queued), so the model can re-plan. Since there are ≤5 sub-agents, the limit only matters if the model calls the same sub-agent repeatedly in one turn. Recursion/loop cap: `ModelCallLimitMiddleware(run_limit=MAX_AGENT_ITERATIONS)` on the parent and a smaller limit on sub-agents (`SUB_AGENT_RECURSION_LIMIT` as backstop). |
| Q10 | **Retry only the model call** (`ModelRetryMiddleware`, max 2 retries, linear backoff as today, only for the existing transient-network exception list). **Never retry tools**, and never re-run a whole sub-agent (it may already have executed side-effecting MCP tools). A sub-agent that fails with a transient error returns a short failure message as its tool result, as today, and the parent decides whether to call it again. |
| Q11 | Yes: add `langchain>=1.3.3`; raise `langgraph` / `langchain-core` pins only if resolution requires it. |
| Q13 | LangGraph Studio is still used, so `studio/` is **ported**, not deleted. |
| Q14 | No staging environment. Verification = automated tests with fake chat models + your manual review. I will also run the app locally where the environment allows. |
| Q15 | **Per-model `reasoning_mode` column on `provider_models`** (`prompt` default, `native`), consistent with the existing data-driven model catalog (new models are rows, not deploys). Chosen over runtime inference because model profile data can lag new models and we want per-row rollout control. Ships as a **separate step after the core migration**; the repo has no Alembic, so the column will be added through whatever mechanism the project uses for schema changes (to be confirmed when we get there). |
| Q16 | **Backend first, completed and consistent on its own; then the frontend.** Until the frontend step is done the two will not match; that is acceptable because nothing is pushed before your review. |
| Q17 | **No runtime flag** (see §7.1). |
| Q12 | No commits or pushes until the implementation is finished and manually reviewed and approved by the user. Work stays uncommitted on `feature/create-agent-supervisor`. |

Consequence of Q3/Q4: scope now includes the frontend files that consume these events (`src/hooks/use-chat-stream.ts`, `src/hooks/use-reasoning-trace.ts`, `src/types/stream.ts`, `src/services/stream-service.ts`) and the approval UI. §4.7 and §5.3 should be read with "SSE/approval shape may change" instead of "unchanged"; the exact new payloads will be specified in the implementation plan.

## 2. Current architecture (as read from the code)

### 2.1 Graph shape (`build_agent_graph`)

```
START → agent ─┬─► END                        (answered directly)
               ├─► tools ──► agent            (own MCP tools; ReAct loop)
               └─► Send(sub_agent_i) ×N ─► synthesizer ─► END   (fan-out)
```

- One hand-built `StateGraph(AgentState)` per parent agent. Node names `agent`, `tools`, `synthesizer` are kept stable on purpose so existing thread checkpoints survive sub-agent config changes.
- `AgentState` = `messages` + five custom keys: `pending_tasks`, `dispatch_decisions`, `denied_tool_calls`, `enable_thinking`, `is_interactive`.

### 2.2 What is custom-built

| Concern | Current implementation | Location |
|---|---|---|
| ReAct loop | `agent_node` + `tools_node` + `route_from_agent` | `graph_builder.py:621`, `:519`, `:919` |
| Sub-agent delegation | Fake tool `dispatch_to_subagents` is bound to the LLM, then **intercepted** in `agent_node` and turned into `Send()` fan-out. The `AIMessage` is rewritten without `tool_calls` to avoid orphan-tool-call 400s | `:658`, `:707-748` |
| Orphan tool-call repair | Strips `tool_calls` from any `AIMessage` with no matching `ToolMessage` before each LLM call | `:680-694`, `:901-908` |
| Sub-agent runtime | One extra compiled mini `StateGraph` (`react` ⇄ `tools`) per sub-agent, run inside a wrapper with `asyncio.wait_for` (900 s) and a recursion limit | `:757-858` |
| Synthesis | Separate `synthesizer` node and a second system prompt ("don't mention specialists") | `:861-913` |
| Tool approval (HITL) | Hand-written `interrupt()` in `tools_node`: one combined prompt per batch, a `{tool_call_id: "allow"/"deny"}` resume map, auto-deny when `is_interactive=False`, synthetic denial `ToolMessage`s | `:519-618` |
| LLM retry | `_ainvoke_with_retry` for transient network errors | `:49-73` |
| Iteration cap | `recursion_limit = MAX_AGENT_ITERATIONS*2+10` (set in `chat_service`) | `chat_service.py:~470` |
| Prompt assembly | Five big string builders (format, behavior, tool-result handling, reasoning, sub-agent) with two precomputed variants (with/without reasoning) | `:75-516` |
| Reasoning trace | Prompt-enforced `<reasoning>…</reasoning>` in message text, split live by `ReasoningSplitter`; stripped from history by `strip_reasoning_block` | `utils/reasoning_splitter.py` |
| Tool output hygiene | `sanitize_for_reasoning_tags(extract_tool_output(...))` on every tool result | `:604`, `utils/tool_output.py` |
| Graph cache | LRU keyed by `(agent_id, llm_model_id)`, plus build locks, plus explicit invalidation hooks from agent update/delete and credential rotation | `:158-236` |
| Model per graph | The LLM instance (and therefore the user's BYOK key) is **closed over** by nodes at build time | `build_agent_graph(…, llm, …)` |

### 2.3 Run pipeline (`chat_service._run_generation`)

- `graph.astream_events(version="v2")` is consumed by one very large loop that:
  - runs a `ReasoningSplitter` per LLM `run_id`,
  - decides whether a token is "final content" by checking node names (`_FINAL_RESPONSE_NODES`, `synthesizer`, `agent` + `checkpoint_ns`),
  - turns `on_chain_end` outputs of `agent` and `tools` into `dispatch_decision` and denied-tool SSE events (this is why `pending_tasks`, `dispatch_decisions` and `denied_tool_calls` exist in state at all),
  - aggregates `reasoning_steps`, tool timings and token usage from `on_chat_model_end`,
  - flushes partial content to `StreamRecord` every N tokens for crash recovery.
- Pause/resume: after the loop, `aget_state().interrupts` is read; resume is `Command(resume={interrupt_id: {tool_call_id: decision}})`.
- Cancel: `delete_checkpoints_after(thread_id, last_good_checkpoint_id)` trims partial checkpoints.
- Studio: `studio/graph.py` keeps a skeleton graph plus a separate cache that imports `AgentState` / `route_from_agent` from `graph_builder`.

### 2.4 Pain points

1. **Fake-tool interception** couples three layers (prompt, state, SSE) and needs repair code in two places.
2. **Event-stream coupling.** SSE behavior depends on node names, `checkpoint_ns` string parsing and custom state keys leaked through `on_chain_end`. Renaming a node silently breaks streaming.
3. **Mixed-in sub-agent checkpointing.** Sub-agent subgraphs are compiled with the parent's checkpointer and invoked with the parent's `thread_id` inside a node. That is fragile, and it is exactly what the framework's inherited-checkpointer mode is for.
4. **Cache keyed on the model** means the compiled graph has to be invalidated whenever credentials or the model change, because the key is baked into closures.
5. **Unbounded growth of history.** There is no summarization or context management for long threads.
6. **Prompt text is code.** About 450 lines of prompt live in the graph module.
7. The approval protocol is custom (see §5.3), so we cannot use anything that comes with `HumanInTheLoopMiddleware` or LangGraph tooling.

---

## 3. What the LangChain 1.x stack offers (verified against the docs and the installed source)

> The project venv currently installs only `langchain-core` plus provider packages. **`langchain` itself is not a dependency yet** (`create_agent` and middleware live there). The `langchain 1.2.7` I inspected is the system install, not the project's. Docs reference features that need `langchain>=1.3.3` (e.g. the `when` predicate on HITL).

- **`create_agent(model, tools, system_prompt, middleware, context_schema, state_schema, checkpointer, name, ...)`** returns a compiled graph with a `model` ⇄ `tools` loop. Node names are fixed: **`model`** and **`tools`**.
- **Middleware hooks:** `before_agent`, `before_model`, `after_model`, `after_agent`, `wrap_model_call`, `wrap_tool_call`, `dynamic_prompt`. `ModelRequest.override(model=..., system_prompt=..., tools=...)` allows per-call changes.
- **Built-ins:** `HumanInTheLoopMiddleware`, `SummarizationMiddleware`, `ModelRetryMiddleware`, `ToolRetryMiddleware`, `ModelFallbackMiddleware`, `ModelCallLimitMiddleware`, `ToolCallLimitMiddleware`, `ContextEditingMiddleware`, `PIIMiddleware`, `LLMToolSelectorMiddleware`, `TodoListMiddleware`.
- **Runtime context:** `context_schema` + `agent.ainvoke(..., context=Ctx(...))` carries per-invocation, non-persisted data (ideal for `enable_thinking`, `is_interactive`, resolved credentials).
- **Multi-agent, "subagents as tools":** each sub-agent is a `create_agent` wrapped in a `@tool`. The supervisor calls them (in parallel if it emits several tool calls in one turn). Sub-agents get a clean context window by default, and interrupts inside them work with the inherited checkpointer.
  - Documented caveats: sub-agents called inside a tool are not statically discoverable, so `get_state(subgraphs=True)` does not show their state; the supervisor only sees the sub-agent's *final message*.
- **HITL:** `HumanInTheLoopMiddleware(interrupt_on={tool: True | False | {allowed_decisions, description, when}})`. Decisions: `approve`, `edit`, `reject` (with message), `respond`. Resume is `Command(resume={"decisions": [...]})` and **decisions are positional**, in the same order as the interrupt's `action_requests`.
- **Streaming:** `stream_mode=["messages","updates","custom"]` with `version="v2"` (`{type, ns, data}` chunks); `subgraphs=True` to see nested agents; `name=` on an agent surfaces as `lc_agent_name` in message metadata; `get_stream_writer()` for custom events from tools.

---

## 4. Proposed architecture

### 4.1 Overview

```
                    ┌────────────────────────────────────────────┐
 chat_service ─────►│ AgentFactory.build(agent_record) → create_agent  (parent)
                    │   tools      = MCP tools (existing registry)
                    │              + one @tool per active sub-agent
                    │   middleware = [PromptComposition, ModelResolver,
                    │                 ModelRetry, ToolPolicy(HITL+unattended),
                    │                 ToolOutputSanitizer, CallLimits,
                    │                 (Summarization)]
                    │   context_schema = RunContext
                    │   checkpointer = AsyncPostgresSaver (unchanged)
                    └────────────────────────────────────────────┘
                              │  sub-agent tool call(s), parallel
                              ▼
                    create_agent (sub-agent), same middleware stack minus
                    sub-agent tools, wrapped by SubAgentTool (timeout, name)
```

Graph topology becomes the framework default: `model ⇄ tools → END`. There is **no custom `StateGraph`, no `Send`, no synthesizer node, no dispatch interception, and no custom state keys**.

### 4.2 Component mapping

| Today | Proposed | Notes |
|---|---|---|
| `agent_node` / `tools_node` / `route_from_agent` | `create_agent` (`model`, `tools` nodes) | Deleted |
| `dispatch_to_subagents` fake tool + `Send` fan-out + `AIMessage` rewrite | Real tools: one `@tool` per sub-agent (named via `to_tool_name`), or a single `task(agent, description)` tool | Parallelism comes from parallel tool calls. Orphan tool-call repair becomes unnecessary because tool calls now get real `ToolMessage`s |
| `make_sub_agent_node` + mini-graph | `create_agent(name=<sub name>)` wrapped in `SubAgentTool` (adds `asyncio.wait_for`, returns last message text, handles transient-error message as today) | Inherits the parent checkpointer and config |
| `synthesizer` node | Parent's own final model turn after tool results | The "don't mention specialists" rule moves into the parent prompt. One LLM call either way |
| Hand-written `interrupt()` + resume map | `HumanInTheLoopMiddleware` for the interactive path, plus a small custom middleware for the unattended path (see §4.3) | Changes the resume payload (Q3) |
| `_ainvoke_with_retry` | `ModelRetryMiddleware` configured for the same transient exceptions | **No** `ToolRetryMiddleware` (MCP tools are not all idempotent, same reasoning as today's comment) |
| `recursion_limit` arithmetic | `ModelCallLimitMiddleware(run_limit=MAX_AGENT_ITERATIONS)` (+ recursion limit as backstop) | Clear user-facing limit message instead of a `GraphRecursionError` |
| Two precomputed prompt variants | `dynamic_prompt` middleware reads `runtime.context.enable_thinking` | No variants and no state flag |
| `enable_thinking`, `is_interactive` in state | `RunContext` passed as `context=` | State shrinks to `messages` |
| `denied_tool_calls`, `dispatch_decisions`, `pending_tasks` state | Gone. Denials are ordinary `ToolMessage`s; dispatch is an ordinary tool call | SSE derives these from standard `on_tool_*` / message events |
| `sanitize_for_reasoning_tags(extract_tool_output(...))` | `wrap_tool_call` middleware | One place for all agents |
| LRU graph cache keyed by `(agent_id, model_id)` + invalidation | Cache keyed by **agent config version** only; model resolved per request (see 4.4) | Credential rotation no longer touches the cache |
| `studio/graph.py` skeleton + custom cache | Simply return the `create_agent` graph; delete the skeleton and `AgentState` import | |

### 4.3 Tool policy (permission model)

Today: `AgentTool` / `MCPTool.permission_state` → `{tool_name: requires_approval}` → hand-written gate.

Proposed `ToolPolicyMiddleware` composed from native parts:

- **Interactive runs:** `HumanInTheLoopMiddleware(interrupt_on={name: {"allowed_decisions": ["approve","reject"]} for gated tools})`. Gated tools come from the same `get_tool_permissions_for_agent` map; **blocked tools are still excluded when tools are loaded**, as today.
- **Unattended runs (`is_interactive=False`):** a small custom `wrap_tool_call` that short-circuits gated tools with the existing "skipped, no one was available" `ToolMessage`. Both behaviors live in one middleware class so interactive vs. unattended is a single decision point reading `runtime.context.is_interactive`.
- **"Always Allow"** continues to flip the `AgentTool` row. With a dynamic policy the middleware can read permissions at call time rather than at build time, which removes another reason to invalidate the graph (Q7).
- **One behavior difference to decide:** HITL `reject` carries a message; we would keep our current "user declined, not a technical error" wording as the default reject message.

### 4.4 Model resolution and caching

Current: the model is closed over at build time → graph per `(agent, model)` and invalidation on credential change.

Proposed: `create_agent` is built with a placeholder/base model, and a `wrap_model_call` middleware does `request.override(model=runtime.context.llm)`. `RunContext.llm` is the BYOK-resolved `BaseChatModel` from `resolve_llm_for_agent` (unchanged). Result:

- Compiled graph depends only on **tools + prompt + sub-agent set**.
- Credential rotation and model switching do not touch the cache.
- The cache can shrink to a simple keyed dict with a `config_version` (e.g. hash of `updated_at` for agent + sub-agents + tool assignments), or be dropped entirely if compile cost measures as negligible (Q8).

(Risk: `bind_tools` is model-specific. I need to verify in a spike that overriding the model per-request in `wrap_model_call` re-binds tools correctly across OpenAI/Anthropic/Gemini. The factory does this binding inside the request path, but I want a test before committing to this.)

### 4.5 Prompts

- Move the five prompt builders into `abyss_backend/prompts/` as plain text/templates: `formatting.md`, `behavior.md`, `tool_results.md`, `reasoning.md`, `subagent_output.md`, `delegation.py` (generates the "available specialists" block from the sub-agent list; mostly static after the fake-tool is gone).
- `PromptCompositionMiddleware` (a `dynamic_prompt`) assembles: agent's `system_prompt` + behavior + formatting (+ reasoning if `enable_thinking`). Sub-agents use the lighter output guideline.
- The delegation section shrinks, since real tools carry their own descriptions and the rule "call dispatch as only tool and write nothing" goes away.

### 4.6 Reasoning trace

Two options; I recommend **A for the migration, B as a later evaluation**:

- **A. Keep the `<reasoning>` tag protocol** and `ReasoningSplitter` exactly as is, fed from the new stream. No behavior change; ties us to prompt discipline. `strip_reasoning_block` moves into a `after_model`/`wrap_model_call` hook so reasoning is not carried into history or into the text the supervisor gets back from sub-agents.
- **B. Native reasoning blocks** (`content_blocks` with `type="reasoning"`) where the provider supports it. Cleaner, but behavior differs per provider (BYOK across OpenAI/Anthropic/Gemini) and some models/settings do not emit them. See Q5.

### 4.7 Streaming and SSE

Do **not** change the SSE wire contract in the first migration. Instead:

1. Extract the 1,000-line event loop out of `_run_generation` into a `StreamProjector` class (`services/stream_projector.py`) that consumes LangGraph events and emits SSE chunk dicts, owning the splitter, reasoning steps, tool timings and token usage. `chat_service` keeps lifecycle (DB records, flush, cancel, resume).
2. Re-point the projector at the new graph. Phase 1 keeps `astream_events(version="v2")` (it still emits `on_chat_model_stream`, `on_tool_start/end`, `on_chat_model_end`). Changes needed:
   - "Final content" detection becomes: tokens from the parent's `model` node (top-level namespace), not a node-name allowlist; sub-agent tokens identified by `lc_agent_name`/namespace.
   - `dispatch_decision` events are derived from `on_tool_start` of a sub-agent tool (the tool args carry `task`, which replaces the `reason` field if we add a `reason` argument to the tool schema).
   - Denied tools come from `ToolMessage` content with a status, not state keys.
3. Phase 2 (optional): move to `astream(stream_mode=["messages","updates","custom"], subgraphs=True, version="v2")`. Tools can emit progress with `get_stream_writer()`.

Open verification item: that sub-agent LLM/tool events reach the parent's `astream_events` stream with usable namespaces when the sub-agent is invoked inside a tool (config must be propagated; the docs warn that nested state is not inspectable). This gets a spike before commit (§6, step 0).

### 4.8 Long threads

Add `SummarizationMiddleware` (token-threshold trigger, keep last N messages) to the parent. This is new behavior, so it ships behind a flag (Q6).

### 4.9 Target module layout

```
abyss_backend/
  agents/
    factory.py           # build_agent(agent_record, sub_agents) → create_agent graph; cache
    context.py           # RunContext (enable_thinking, is_interactive, llm, user_id)
    subagent_tool.py     # SubAgentTool wrapper (timeout, naming, error text)
    middleware/
      prompt.py          # dynamic_prompt composition
      model.py           # model resolver (override), retry, reasoning strip
      tool_policy.py     # HITL + unattended skip
      tool_output.py     # sanitize/extract
  prompts/               # text templates (§4.5)
  services/
    stream_projector.py  # LangGraph events → SSE chunks
    chat_service.py      # lifecycle only (shrinks substantially)
  utils/graph_builder.py # deleted at the end (shim during migration)
```

### 4.10 What deliberately does not change

- Postgres checkpointer, `delete_checkpoints_after` cancel logic, `StreamRecord` flush/reconnect, `stream_manager`.
- MCP registry (`utils/mcp_client.py`) and `MultiServerMCPClient` usage.
- BYOK resolution (`resolve_llm_for_agent`, `llm_providers.py`).
- Scheduler / `is_interactive=False` semantics.
- DB schema, REST routes.

### 4.11 Alternatives considered

| Option | Verdict |
|---|---|
| **A. Subagents-as-tools (recommended)** | Matches the documented pattern, removes the most custom code, keeps parallelism via parallel tool calls. Cost: sub-agent state is not visible through `get_state(subgraphs=True)`, so approval payloads for sub-agent tools must carry what the UI needs (they already carry `agent_id`). |
| B. Hybrid: parent `StateGraph` with `create_agent` sub-agents as **nodes** and `Send` fan-out | Keeps today's topology and nested-state visibility, but retains custom routing, state keys and a synthesizer. Smaller win. Good fallback if the §4.7 spike or HITL-in-subagent spike fails. |
| C. `langgraph-supervisor` prebuilt | It is a separate package, not in our dependencies, and the current LangChain docs present the tool-based pattern instead. Not recommended. |
| D. `deepagents` (planning, file system, task tool) | Much broader than our requirements. Out of scope. |

---

## 5. Risks and behavior changes to be aware of

1. **Checkpoint compatibility.** Node names change (`agent`/`synthesizer` → `model`; sub-agent nodes disappear). Completed threads load fine (messages carry over; unknown channels are ignored), **but threads paused on an approval interrupt at deploy time cannot be resumed**. Mitigation: drain or `deny_all_pending_approvals` before cutover (the code for it exists).
2. **Old history shape.** Existing threads contain empty `AIMessage`s from the dispatch rewrite; harmless but present. New runs will no longer produce them.
3. **Approval protocol change.** Native HITL uses positional `decisions: [{type: approve|reject|edit}]` and an `action_requests` interrupt payload, versus our `{tool_call_id: allow|deny}` map plus our payload fields (`tool_id`, `agent_id`, `reason`). Either (a) adapt the API/frontend, or (b) keep our wire contract and translate at the router boundary. I recommend (b) first (Q3).
4. **Parallel sub-agent interrupts.** Today each parallel branch can interrupt independently and we resume by interrupt id. With sub-agents-as-tools, several sub-agent tool calls may each interrupt inside the same `tools` node; this needs an explicit spike (§6 step 0) before we rely on it.
5. **Synthesizer removal changes final-answer behavior slightly.** The parent's prompt must carry the "answer as if end-to-end" rules, and quality needs a side-by-side eval on a few real agents.
6. **Tool binding per request** (§4.4) needs verification across the three providers.
7. **Dependency bump:** add `langchain>=1.3.3`; confirm compatibility with the pinned `langchain-core>=1.4.7`, `langgraph>=1.2.0`, and `langchain-mcp-adapters` (docs require `langchain>=1.3.3` for HITL `when`).

---

## 6. Migration plan (superseded by §8, kept for reference; it assumed a runtime flag and an unchanged SSE contract)

Each step is independently shippable and leaves the app working.

**Step 0: Spikes (throwaway, answers only).**
1. `create_agent` + sub-agent-as-tool + Postgres checkpointer: do nested LLM/tool events appear in `astream_events` with a usable namespace?
2. Interrupt inside a sub-agent tool, and two parallel sub-agent tools each interrupting: can we resume cleanly and what does `aget_state().interrupts` look like?
3. `wrap_model_call` model override re-binds tools correctly for OpenAI / Anthropic / Gemini.
4. Resume of a legacy-shape thread on the new graph (completed threads).
Outcome decides Option A vs. B (§4.11).

**Step 1: Foundations (no behavior change).** Add the `langchain` dependency; create `prompts/` and move text out of `graph_builder.py` verbatim; extract `StreamProjector` from `_run_generation` against the *current* graph with golden-file tests of the SSE chunk sequence.

**Step 2: Middleware layer.** Implement `RunContext`, prompt, model-resolver, retry, tool-output and tool-policy middleware with unit tests (including unattended-skip and reject messaging).

**Step 3: New factory behind a flag.** `AGENT_RUNTIME=legacy|native` in config. `abyss_agents/factory.py` builds the native agent; `chat_service` picks by flag. Both paths use the same `StreamProjector`. Update `studio/graph.py` for the native graph.

**Step 4: Evaluate.** Run representative agents (including multi-sub-agent and gated-tool ones) on both runtimes; compare answers, token usage, latency, SSE sequences. Verify cancel, reconnect, resume, scheduler runs.

**Step 5: Cutover.** Drain pending approvals, flip default to `native`, monitor.

**Step 6: Cleanup.** Delete `graph_builder.py` (keep `to_tool_name` in a small util), the Studio skeleton, state keys, and the legacy runtime; shrink the graph-cache invalidation hooks in `agent_service` to the reduced `config_version` model.

**Step 7: Optional follow-ups.** Summarization middleware; native reasoning blocks; `stream_mode` v2 projector; per-tool progress via `get_stream_writer`.

### Testing strategy
- Unit tests per middleware (pytest, fake chat models: `GenericFakeChatModel`).
- Golden SSE sequences for: plain answer, tool call, gated tool (approve / reject / unattended), single sub-agent, parallel sub-agents, cancel mid-run, resume.
- Provider matrix smoke tests behind a marker (needs keys).

---

## 7. Remaining clarification

### 7.1 Q17: the `legacy|native` runtime flag (explained)

My earlier plan was to ship the new agent runtime next to the old one behind a config switch (`AGENT_RUNTIME=legacy` or `native`), so both could be run and compared. That costs a lot: both runtimes would have to emit the same API/SSE shapes, and the old code would live in the repo longer.

Because (a) this is your personal branch, (b) nothing is pushed until you've reviewed it, and (c) the frontend contract is changing anyway, **I decided to drop the flag.** The old implementation is simply replaced on the branch; `main` and the git history remain your rollback. If you'd rather keep a switch for side-by-side comparison, tell me, otherwise the migration plan below is final.

## 8. Final migration plan (no flag)

0. **Spikes (throwaway):** nested sub-agent events in the stream; interrupt inside sub-agent tools (including two in parallel); per-request model override re-binding tools across OpenAI/Anthropic/Gemini; loading an existing thread on the new graph. Result decides Option A vs. the §4.11 fallback; I will report before proceeding.
1. **Foundations:** add `langchain`; move prompt text to `prompts/`; `RunContext`; `to_tool_name` to a small util.
2. **Middleware:** prompt composition, model resolver, model retry, reasoning strip, tool-output sanitizer, tool policy (native HITL + unattended skip), per-turn sub-agent limit, call limits, summarization. Unit tests with fake models for each.
3. **Agent factory + `SubAgentTool`:** replaces `graph_builder.py`; graph cache removed if compile time is negligible (Q8).
4. **Streaming + approval API:** `StreamProjector` extracted from `chat_service` and rewritten for the native graph; native approval request/decision shapes on the REST/SSE API; threads paused on approvals at cutover are auto-denied (Q4b).
5. **Port `studio/`** to the new graph; delete `graph_builder.py`, `AgentState`, the skeleton graph and the old cache/invalidation hooks.
6. **Backend verification:** full test suite, golden SSE sequences (plain answer, tool call, gated tool: approve/reject/unattended, single and parallel sub-agents, cancel, resume), scheduler runs.
7. **Native reasoning (`reasoning_mode`)** as a separate backend step.
8. **Frontend** adaptation (`abyss_frontend`) to the new event/approval shapes.
9. Your manual review → only then commit/push.
