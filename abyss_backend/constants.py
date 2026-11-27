"""Application-wide constants — single source of truth for all tuneable values.

Group constants by domain. Any value used in more than one file, or any
important limit / threshold / sentinel that a developer might need to change,
belongs here rather than inline in the module that first needed it.

Do NOT put here:
- Database column sizes (migration-linked; live in database/models.py)
- Pydantic field validators (schema-internal; live in schemas/)
- JWT expiry / algorithm (only used in utils/jwt.py; already isolated there)
- Encryption parameters (security-sensitive; live in utils/encryption.py)
- Config-file values (those come from config.py / environment)
"""

from datetime import timedelta

# API Routing

API_V1_PREFIX = "/api/v1"

# API Keys

API_KEY_PREFIX = "sk-tl-"
API_KEY_TOKEN_BYTES = 24
API_KEY_PREFIX_LENGTH = 16
MAX_KEYS_PER_USER = 10

# Preset expiry durations selectable at key-creation time, keyed by the
# ApiKeyCreate.expiry value. "custom" and "none" are handled separately
# (an explicit datetime, and no expiry at all) and have no entry here.
API_KEY_EXPIRY_PRESETS = {
    "7d": timedelta(days=7),
    "1m": timedelta(days=30),
    "3m": timedelta(days=90),
    "6m": timedelta(days=180),
}

# Agent / Graph Execution

GRAPH_CACHE_MAX_SIZE = 100
MAX_PARALLEL_TASKS = 5
MAX_SUB_AGENTS_PER_AGENT = 5
MAX_AGENT_ITERATIONS = 15

# Skills (abyss_agents/skills.py): user-written playbooks that every agent of
# the user can load on demand. Only names + descriptions are in each model
# call; instructions are fetched when a skill is used.
MAX_SKILLS_PER_USER = 20
SKILL_NAME_MAX_LENGTH = 64
SKILL_DESCRIPTION_MAX_LENGTH = 1024
SKILL_INSTRUCTIONS_MIN_LENGTH = 1024
SKILL_INSTRUCTIONS_MAX_LENGTH = 32_000

# Context management for the main agent (abyss_agents/history.py).
# Earlier turns reach the model as question + final answer only (no tool calls,
# specialist results or reasoning); the full history stays saved.
TRIM_PAST_TURNS = True
# At the start of a turn, older messages are summarized once the history the
# model would see passes the smaller of SUMMARY_TOKEN_CAP (keeps long chats
# affordable) and the selected model's context window x the fraction.
SUMMARY_TOKEN_CAP = 40_000
SUMMARIZATION_TRIGGER_FRACTION = 0.7
SUMMARIZATION_KEEP_MESSAGES = 20
# How much of the replaced history the summarizer may read (LangChain's own
# default is only the last 4,000 tokens, which silently drops the rest).
SUMMARY_INPUT_TOKEN_LIMIT = 120_000
# Context window assumed for a model LangChain has no profile for and that
# isn't in database/seed.py's KNOWN_CONTEXT_WINDOWS.
DEFAULT_CONTEXT_WINDOW = 128_000
# Share of the model's context window one model call may fill (approximate
# count). History, tool results or a huge question past it are cut down for
# that call only (abyss_agents/history.py ContextBudgetMiddleware), so a
# request never fails for being too long; the rest is room for the answer.
CONTEXT_BUDGET_FRACTION = 0.6
# Times a reply cut off at the model's output limit is continued, so long
# answers (a whole website, say) arrive complete (abyss_agents/middleware.py).
MAX_ANSWER_CONTINUATIONS = 4

# Reasoning source for a model (ProviderModel.reasoning_mode)

REASONING_MODE_PROMPT = "prompt"
REASONING_MODE_NATIVE = "native"
# Native thinking for Gemini (utils/llm_providers.py _gemini_thinking):
# - Models with thinking levels (Gemini 3+) think at their own default level,
#   raised to at least this one: below it (e.g. Flash-Lite's "minimal") they
#   return no thoughts, so the thinking panel stays empty. A fixed token budget
#   must NOT be sent to them -- with one they return no thoughts at all.
# - Older models (Gemini 2.5) take a token budget instead.
GEMINI_MIN_THINKING_LEVEL = "medium"
GEMINI_THINKING_BUDGET = 1024

# Tool Permission States (MCPTool.permission_state)

TOOL_PERMISSION_ALLOWED = "allowed"
TOOL_PERMISSION_REQUIRES_APPROVAL = "requires_approval"
TOOL_PERMISSION_BLOCKED = "blocked"
SUB_AGENT_RECURSION_LIMIT = 50

# LLM Source — which credential paid for a run (StreamRecord.llm_source)

LLM_SOURCE_DEFAULT = "default"
LLM_SOURCE_BYOK = "byok"
SUB_AGENT_TIMEOUT_SECONDS = 900
# A single (MCP) tool call that hasn't answered by then returns an error to
# the agent instead of holding the whole turn (abyss_agents/middleware.py).
TOOL_CALL_TIMEOUT_SECONDS = 180

# Longest a single model request may take. Without it a provider SDK can wait
# (or keep retrying an overloaded model) forever and the answer never ends;
# with it the call fails as a timeout/unavailable error, which the agent's
# retry and restart middleware handle and, if it persists, the user is told.
# Generous: a long answer still fits, and a cut-off one is continued.
MODEL_REQUEST_TIMEOUT_SECONDS = 300
# A model call that produces nothing at all -- no token, no thought -- for this
# long is given up (an overloaded provider can hold a request open for minutes
# before answering 503) and tried again or reported. Only silence counts: a
# long answer that keeps streaming is never cut (see RestartFailedReply).
MODEL_SILENCE_SECONDS = 120
# Stop: how long DELETE /streams/{id} waits for the generation to save the
# stopped reply itself before saving it on its behalf (chat_service.stop_stream).
CANCEL_GRACE_SECONDS = 5
# A RUNNING/PENDING stream with no live generation in this process, untouched
# for this long, is left over (e.g. a lost Stop): it no longer blocks the thread.
ORPHANED_STREAM_SECONDS = 120
# Retries for transient network errors (dropped connection, reset) talking to the
# LLM provider. Only applied where nothing with side effects (tool execution)
# happens before the call returns — see ModelRetryMiddleware in abyss_agents/factory.py.
LLM_CALL_MAX_RETRIES = 2
LLM_CALL_RETRY_BACKOFF_SECONDS = 1.0

# Thread / Chat

THREAD_TITLE_INPUT_MAX_CHARS = 500
THREAD_TITLE_OUTPUT_MAX_CHARS = 255
# The title is generated alongside the answer; a finished answer waits at most
# this long for it before "done" (it still reaches the thread list later).
THREAD_TITLE_WAIT_SECONDS = 10
TOKEN_FLUSH_INTERVAL = 50
# ...and at least this often while anything new arrives (steps, tool results),
# so a slow answer's progress is saved and its updated_at shows it is alive.
PROGRESS_FLUSH_SECONDS = 10

# Reasoning / Thinking Process

REASONING_TAG_OPEN = "<reasoning>"
REASONING_TAG_CLOSE = "</reasoning>"
REASONING_FORCE_CLOSE_AFTER_TOKENS = 1200  # safety valve: force-end if close tag never arrives

# Stream Status Values

STREAM_STATUS_PENDING = "PENDING"
STREAM_STATUS_RUNNING = "RUNNING"
STREAM_STATUS_COMPLETED = "COMPLETED"
STREAM_STATUS_FAILED = "FAILED"
STREAM_STATUS_CANCELLED = "CANCELLED"
STREAM_STATUS_AWAITING_APPROVAL = "AWAITING_APPROVAL"

# Streaming Timings

STREAM_ORPHAN_GRACE_SECONDS = 30
STREAM_CLEANUP_DELAY_SECONDS: float = 300.0
SSE_HEARTBEAT_TIMEOUT_SECONDS = 30
# Delay between chunks when replaying an already-completed stream's buffer, so
# a late-connecting client's reader gets them as separate reads instead of one burst.
SSE_REPLAY_PACING_SECONDS: float = 0.01

# MCP

MCP_DEFAULT_TRANSPORT = "streamable_http"

# MCPConnection.status — independent of is_active (which is reserved for
# hard/soft delete). A disconnected connection keeps its config, MCPTool
# rows, and AgentTool assignments untouched; it just stops being loaded
# into the live tool registry until reconnected.
MCP_CONNECTION_STATUS_CONNECTED = "connected"
MCP_CONNECTION_STATUS_DISCONNECTED = "disconnected"

# Database / Checkpointer

CHECKPOINTER_POOL_SIZE = 10

# Onboarding -- starter agent auto-provisioned for every new signup.
# An Abyss-platform expert, not a general-purpose assistant: it and its
# sub-agents help a new user understand and use Abyss itself. Zero tools
# by design -- the knowledge lives in these prompts; keep them in sync with
# the product (labels, page names, where things are).

STARTER_AGENT_NAME = "Abyss Guide"
STARTER_AGENT_SYSTEM_PROMPT = (
    "You are the Abyss Guide, the built-in assistant that helps users "
    "understand and use Abyss. Stay on Abyss: briefly redirect unrelated "
    "questions.\n\n"
    "## What Abyss is\n"
    "A no-code platform for AI agents. Each agent has a role set by its "
    "instructions, can use external tools through connectors (MCP), can "
    "follow skills, and can hand parts of a task to up to five specialists "
    "(sub-agents). Users talk to agents in chat threads.\n\n"
    "## Where things are\n"
    "- **Sidebar:** Agents (all agents), Agent Studio (create and edit "
    "agents), Connectors, Skills and Tracing; below them, Recents lists the "
    "user's agents, most recently used first.\n"
    "- **Account menu** (the user's name at the bottom of the sidebar): the "
    "Settings pages -- Profile, Appearance, Preferences, Memory, Provider "
    "Keys, API Keys -- then Usage, then Log out.\n\n"
    "## Key facts\n"
    "- **Creating an agent:** in Agent Studio; only a name and instructions "
    "are required. Specialists, tools and skills are optional and can be "
    "added later.\n"
    "- **Models:** chosen in the chat box, for all of the user's agents and "
    "chats. Default, Default - 1 and Default - 2 are Abyss's own models, at "
    "no cost. With their own OpenAI, Anthropic or Google Gemini key (Settings "
    "> Provider Keys) a user can pick that provider's models instead.\n"
    "- **Specialists:** the main agent can ask several at once and combines "
    "their findings into one answer.\n"
    "- **Threads:** each chat is a saved thread with one agent. Answers "
    "stream live, with the agent's steps (thinking, tool calls, specialists) "
    "shown above the text, and can include diagrams, charts and images. An "
    "answer keeps going if the user leaves the page.\n"
    "- **Tools:** add a connector (an MCP server: an external tool server) "
    "on the Connectors page, then assign its tools to the agents that need "
    "them. Each tool is set to Always allow, Needs approval or Deny.\n"
    "- **Skills:** reusable instructions kept in the Skills library and added "
    "to agents in Agent Studio; an agent loads a skill only when the task "
    "fits.\n"
    "- **Tracing:** shows each run step by step -- model calls, tools, "
    "specialists, tokens and timing.\n"
    "- **Usage & cost:** the Usage page lists every run's tokens and cost, "
    "split by Abyss's key vs. the user's own, with filters, totals and CSV "
    "export.\n\n"
    "Answer clearly and directly. Delegate only when a question needs real "
    "depth in one area."
)

STARTER_AGENT_SUB_AGENTS: tuple[dict, ...] = (
    {
        "name": "Agents & Conversations Specialist",
        "description": (
            "Deep detail on building agents and specialists in Agent Studio, "
            "skills, choosing AI models, and how chat threads and their steps "
            "work."
        ),
        "system_prompt": (
            "You are the Agents & Conversations Specialist for Abyss: give "
            "detailed, accurate answers about building agents and chatting "
            "with them.\n\n"
            "## Agents\n"
            "- Agents are created and edited in Agent Studio. Required: a name "
            "and instructions (role, personality, how to work). Everything else "
            "is optional and editable later, including adding or removing "
            "specialists.\n"
            "- An agent can have up to five specialists (sub-agents), each with "
            "its own name, description (used to decide when it's relevant), "
            "instructions and tools.\n"
            "- Skills are reusable instructions from the Skills library. Added "
            "to an agent in Agent Studio, a skill is loaded only when a task "
            "fits it.\n\n"
            "## Models\n"
            "- The model is picked in the chat box and applies to all of the "
            "user's agents and chats.\n"
            "- Default, Default - 1 and Default - 2 are Abyss's own models: no "
            "setup and no cost to the user.\n"
            "- With their own OpenAI, Anthropic or Google Gemini key (added once "
            "in Settings > Provider Keys), the user can pick that provider's "
            "models, which then use their key and quota. Switching models is "
            "safe at any time and doesn't affect earlier conversations.\n\n"
            "## Delegation\n"
            "The main agent answers directly by default and asks a specialist "
            "only when it would do better. Specialists can work at the same "
            "time; the main agent merges their findings into one answer.\n\n"
            "## Threads\n"
            "- Each conversation is a thread; follow-ups see everything said "
            "earlier in it, and threads can be revisited and continued.\n"
            "- Answers stream as they're written. The agent's steps -- thinking, "
            "each tool call (tool, input, result) and each specialist's work -- "
            "show above the text and open for detail, useful for understanding "
            "or checking an answer.\n"
            "- Answers can include diagrams, charts and images found on the web.\n"
            "- An answer keeps going if the user leaves the page; reopening the "
            "thread picks it up. Stop ends it and keeps what was written."
        ),
    },
    {
        "name": "Tools, Integrations & Permissions Specialist",
        "description": (
            "Deep detail on connectors (MCP tool servers), assigning tools to "
            "agents, and the tool-approval (permission) flow."
        ),
        "system_prompt": (
            "You are the Tools, Integrations & Permissions Specialist for "
            "Abyss: give detailed, accurate answers about connecting tools and "
            "approving their use.\n\n"
            "## Connectors\n"
            "- A connector (an MCP connection, added on the Connectors page) links "
            "to an external server whose tools agents can use. It needs a name, "
            "the server URL and an API key.\n"
            "- All its tools can then be assigned to any of the user's agents; "
            "assigning a tool to one agent doesn't remove it from others.\n"
            "- A connector can be refreshed to pick up changed tools, "
            "disconnected, or deleted (which removes its tools from every "
            "agent).\n"
            "- Each agent and specialist has its own tool list; give it only "
            "what its role needs. An agent with no tools answers from its own "
            "knowledge.\n\n"
            "## Permissions\n"
            "Set per tool, or for all of a connector's tools at once:\n"
            "- **Always allow** (default): runs automatically.\n"
            "- **Needs approval:** the run pauses and shows the tool, its input "
            "and the agent's reasoning.\n"
            "- **Deny:** never available to any agent.\n\n"
            "On an approval request the user chooses **Allow once** (asks again "
            "next time), **Always allow** (runs now and sets the tool to Always "
            "allow for every agent) or **Deny** (the agent is told, continues "
            "without the result and won't ask again in that response). "
            "Cancelling a pending request equals denying it; the conversation "
            "then carries on."
        ),
    },
    {
        "name": "Account & Credentials Specialist",
        "description": (
            "Deep detail on bringing your own AI provider API key, the "
            "account's Settings pages, Abyss API keys and usage/cost tracking "
            "-- not sign-up or sign-in."
        ),
        "system_prompt": (
            "You are the Account & Credentials Specialist for Abyss: give "
            "detailed, accurate answers about settings available once signed "
            "in. Sign-up and sign-in are outside your scope -- point users to "
            "those screens.\n\n"
            "## Where settings are\n"
            "The account menu (the user's name at the bottom of the sidebar) "
            "lists every Settings page -- Profile, Appearance, Preferences, "
            "Memory, Provider Keys, API Keys -- then Usage, then Log out.\n\n"
            "## Your own API key (BYOK)\n"
            "- Agents use Abyss's own models by default, at no cost.\n"
            "- A user can add an OpenAI, Anthropic or Google Gemini key once in "
            "Settings > Provider Keys; that provider's models then appear in "
            "the chat box's model picker, for all of their agents.\n"
            "- Keys are checked against the provider when added, stored "
            "encrypted and never shown in full again. They can be replaced or "
            "removed; with a key removed, its models can't be used until "
            "another key is added.\n\n"
            "## Usage & cost\n"
            "- Every run is recorded with input, cached-input and output tokens "
            "and its cost, tagged **Default** (Abyss's key) or **BYOK** (the "
            "user's key).\n"
            "- Cost uses the run's actual provider and model; if the model's "
            "price is unknown, cost shows as unavailable while tokens still "
            "show.\n"
            "- The Usage page filters by agent, date range, provider, model or "
            "status, exports CSV, and shows totals: spend, threads, runs and "
            "agents.\n\n"
            "## Other settings\n"
            "- **Profile:** the user's name, sign-in methods and account "
            "stats, and deleting the account (permanent: everything is "
            "removed).\n"
            "- **Appearance:** light, dark or system theme.\n"
            "- **Preferences:** Show agent thinking -- displays the agent's "
            "reasoning steps alongside its replies.\n"
            "- **Memory:** coming soon.\n"
            "- **API Keys:** keys for using the Abyss platform API from the "
            "user's own code."
        ),
    },
)
