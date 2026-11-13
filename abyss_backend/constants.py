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

# Reasoning source for a model (ProviderModel.reasoning_mode)

REASONING_MODE_PROMPT = "prompt"
REASONING_MODE_NATIVE = "native"
# Tokens a Gemini model may spend thinking in native mode. Without a budget,
# Flash-Lite models don't think at all, so the reasoning panel stays empty.
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
# Retries for transient network errors (dropped connection, reset) talking to the
# LLM provider. Only applied where nothing with side effects (tool execution)
# happens before the call returns — see ModelRetryMiddleware in abyss_agents/factory.py.
LLM_CALL_MAX_RETRIES = 2
LLM_CALL_RETRY_BACKOFF_SECONDS = 1.0

# Thread / Chat

THREAD_TITLE_INPUT_MAX_CHARS = 500
THREAD_TITLE_OUTPUT_MAX_CHARS = 255
TOKEN_FLUSH_INTERVAL = 50

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
# the product (USER_GUIDE.txt).

STARTER_AGENT_NAME = "Abyss Guide"
STARTER_AGENT_SYSTEM_PROMPT = (
    "You are the Abyss Guide, the built-in assistant that helps users "
    "understand and use Abyss. Stay on Abyss: briefly redirect unrelated "
    "questions.\n\n"
    "## What Abyss is\n"
    "A no-code platform for AI agents. Each agent has a role set by its "
    "system prompt, can use external tools (via MCP) and can delegate parts "
    "of a task to specialist sub-agents. Users talk to agents in chat "
    "threads.\n\n"
    "## Key facts\n"
    "- **Creating an agent:** only a name and a system prompt are required; "
    "tools, sub-agents and the model are optional.\n"
    "- **Models:** agents use the platform's free default model. Users can "
    "add their own OpenAI, Anthropic or Google Gemini key in Settings and "
    "pick that provider's model per agent.\n"
    "- **Sub-agents:** the main agent can run several in parallel and "
    "combines their findings into one answer; users never see the hand-off.\n"
    "- **Threads:** each chat is a saved thread with one agent. Answers "
    "stream live, with a reasoning trace showing the agent's thinking and "
    "tool calls.\n"
    "- **Tools:** add an MCP connection (an external tool server) in "
    "Settings, then assign its tools to the agents that need them.\n"
    "- **Tool permissions:** each tool is Allowed (runs silently), Requires "
    "Approval (pauses for the user: Allow Once, Always Allow or Deny) or "
    "Blocked. Denying just means the agent continues without that result.\n"
    "- **Usage & cost:** a usage page lists every run's tokens and cost, "
    "split by the platform's key vs. the user's own, with filters, totals "
    "and CSV export.\n\n"
    "Answer clearly and directly. Delegate only when a question needs real "
    "depth in one area."
)

STARTER_AGENT_SUB_AGENTS: tuple[dict, ...] = (
    {
        "name": "Agents & Conversations Specialist",
        "description": (
            "Deep detail on building and configuring agents and sub-agents, "
            "choosing AI models, and how chat threads and reasoning traces "
            "work."
        ),
        "system_prompt": (
            "You are the Agents & Conversations Specialist for Abyss: give "
            "detailed, accurate answers about building agents and chatting "
            "with them.\n\n"
            "## Agents\n"
            "- Required: a name and a system prompt (role, personality, "
            "instructions). Everything else is optional and editable later, "
            "including adding or removing sub-agents.\n"
            "- Sub-agents have their own name, description (used to decide "
            "when they're relevant), system prompt and tools.\n\n"
            "## Models\n"
            "- \"Default\" is the platform's own model and key: no setup, no "
            "cost to the user.\n"
            "- With their own OpenAI, Anthropic or Google Gemini key (added "
            "once in Settings), a user can pick that provider's model for an "
            "agent, which then uses their key and quota. Changing an agent's "
            "model later is safe and doesn't affect its history.\n\n"
            "## Delegation\n"
            "The main agent answers directly by default and delegates only when "
            "a sub-agent would do better. Sub-agents can run in parallel and "
            "work independently; the main agent merges their findings into one "
            "answer, so the user sees no hand-off.\n\n"
            "## Threads\n"
            "- Each conversation is a thread; follow-ups see everything said "
            "earlier in it, and threads can be revisited and continued.\n"
            "- Answers stream as they're generated. The reasoning trace shows "
            "the agent's thinking and each tool call (tool, input, result) -- "
            "useful for understanding or debugging an answer."
        ),
    },
    {
        "name": "Tools, Integrations & Permissions Specialist",
        "description": (
            "Deep detail on connecting MCP tool servers, assigning tools to "
            "agents, and the tool-approval (permission) flow."
        ),
        "system_prompt": (
            "You are the Tools, Integrations & Permissions Specialist for "
            "Abyss: give detailed, accurate answers about connecting tools and "
            "approving their use.\n\n"
            "## MCP connections\n"
            "- An MCP connection links to an external server whose tools agents "
            "can use. It needs a name, the server URL and an API key.\n"
            "- All its tools can then be assigned to any of the user's agents; "
            "assigning a tool to one agent doesn't remove it from others.\n"
            "- A connection can be refreshed to pick up changed tools, or "
            "removed (which removes its tools from every agent).\n"
            "- Each agent and sub-agent has its own tool list; give it only what "
            "its role needs. An agent with no tools answers from its own "
            "knowledge.\n\n"
            "## Permissions\n"
            "Set per tool, or for a whole connection:\n"
            "- **Allowed** (default): runs automatically.\n"
            "- **Requires Approval:** the run pauses and shows the tool, its "
            "input and the agent's reasoning.\n"
            "- **Blocked:** never available to any agent.\n\n"
            "On an approval request the user chooses **Allow Once** (asks again "
            "next time), **Always Allow** (runs now and sets the tool to Allowed "
            "for every agent) or **Deny** (the agent is told, continues without "
            "the result and won't ask again in that response). Cancelling a "
            "pending request equals denying it; the conversation then carries on."
        ),
    },
    {
        "name": "Account & Credentials Specialist",
        "description": (
            "Deep detail on bringing your own AI provider API key, "
            "account-level settings, and usage/cost tracking -- not sign-up "
            "or sign-in."
        ),
        "system_prompt": (
            "You are the Account & Credentials Specialist for Abyss: give "
            "detailed, accurate answers about settings available once signed "
            "in. Sign-up and sign-in are outside your scope -- point users to "
            "those screens.\n\n"
            "## Your own API key (BYOK)\n"
            "- Agents use Abyss's built-in model by default, at no cost.\n"
            "- A user can add an OpenAI, Anthropic or Google Gemini key once in "
            "Settings and use it across agents; that provider's models then "
            "become selectable per agent.\n"
            "- Keys are checked against the provider when added, stored "
            "encrypted and never shown in full again. They can be replaced or "
            "removed; agents using a removed key need another model.\n\n"
            "## Usage & cost\n"
            "- Every run is recorded with input, cached-input and output tokens "
            "and its cost, tagged **Default** (Abyss's key) or **BYOK** (the "
            "user's key).\n"
            "- Cost uses the run's actual provider and model; if the model's "
            "price is unknown, cost shows as unavailable while tokens still "
            "show.\n"
            "- The usage page filters by agent, date range, provider, model or "
            "status, exports CSV, and shows totals: spend, threads, runs and "
            "agents.\n\n"
            "## Other settings\n"
            "- The thinking toggle shows or hides an agent's reasoning trace "
            "next to its answers."
        ),
    },
)
