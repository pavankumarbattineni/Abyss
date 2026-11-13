from datetime import UTC, datetime
from typing import Optional
from uuid import uuid4
from sqlalchemy import JSON, Boolean, DateTime, ForeignKey, Index, Integer, Numeric, String, Text, UniqueConstraint, text
from sqlalchemy.orm import Mapped, mapped_column, relationship
from database.session import Base
from constants import MCP_CONNECTION_STATUS_CONNECTED, MCP_DEFAULT_TRANSPORT, STREAM_STATUS_PENDING

def utcnow() -> datetime:
    """The current time in UTC, timezone-naive -- how every timestamp column
    is stored. The API sends these without an offset; the frontend reads a
    zone-less timestamp as UTC (lib/server-date.ts)."""
    return datetime.now(UTC).replace(tzinfo=None)


class BasicModel(Base):
    __abstract__ = True

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid4()))
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow, onupdate=utcnow, nullable=False)


class User(BasicModel):
    __tablename__ = "users"

    username: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)
    email: Mapped[str] = mapped_column(String(255), unique=True, index=True, nullable=False)
    password_hash: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)
    thinking_enabled: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)


class Provider(BasicModel):
    __tablename__ = "providers"

    name: Mapped[str] = mapped_column(String(50), nullable=False, unique=True)
    display_name: Mapped[str] = mapped_column(String(100), nullable=False)


class ProviderModel(BasicModel):
    __tablename__ = "provider_models"

    provider_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("providers.id", ondelete="CASCADE"), nullable=False, index=True
    )
    model_name: Mapped[str] = mapped_column(String(100), nullable=False)
    display_name: Mapped[str] = mapped_column(String(150), nullable=False)
    is_platform_default: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    # 'prompt' = reasoning comes from the <reasoning> prompt protocol (works on any model);
    # 'native' = the provider's own reasoning/thinking output (see utils/llm_providers.py).
    # Existing databases need: ALTER TABLE provider_models ADD COLUMN reasoning_mode
    # VARCHAR(10) NOT NULL DEFAULT 'prompt' (create_all never alters existing tables).
    reasoning_mode: Mapped[str] = mapped_column(
        String(10), default="prompt", server_default="prompt", nullable=False
    )

    provider: Mapped["Provider"] = relationship("Provider")

    # Partial unique index — at most one row across the whole table may be
    # the platform default at any time.
    __table_args__ = (
        UniqueConstraint("provider_id", "model_name", name="uq_provider_models_provider_model"),
        Index(
            "uq_provider_models_single_default",
            "is_platform_default",
            unique=True,
            postgresql_where=text("is_platform_default = true"),
        ),
    )


class Agent(BasicModel):
    __tablename__ = "agents"

    user_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True
    )
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    description: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    system_prompt: Mapped[str] = mapped_column(Text, nullable=False)
    # NULL for top-level agents; set to parent Agent.id for sub-agents.
    parent_id: Mapped[Optional[str]] = mapped_column(
        String(36), ForeignKey("agents.id", ondelete="CASCADE"), nullable=True, index=True
    )
    # NULL means "Default" — resolved at request time to whichever ProviderModel
    # row has is_platform_default=true, using the platform's own OpenAI key.
    # Never resolved to a concrete model at save time, so the platform default
    # can change (by flipping is_platform_default) without migrating agent rows.
    llm_model_id: Mapped[Optional[str]] = mapped_column(
        String(36), ForeignKey("provider_models.id"), nullable=True
    )


class LlmCredential(BasicModel):
    __tablename__ = "llm_credentials"

    user_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True
    )
    provider_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("providers.id"), nullable=False
    )
    # Stored Fernet-encrypted (purpose="llm") — see utils/encryption.py.
    encrypted_api_key: Mapped[str] = mapped_column(String(1024), nullable=False)

    provider: Mapped["Provider"] = relationship("Provider")

    __table_args__ = (
        UniqueConstraint("user_id", "provider_id", name="uq_llm_credential_user_provider_id"),
    )


class MCPConnection(BasicModel):
    __tablename__ = "mcp_connections"

    user_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True
    )
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    url: Mapped[str] = mapped_column(String(2048), nullable=False)
    # Stored Fernet-encrypted; max plaintext 512 chars encrypts to ~780 base64 chars
    api_key: Mapped[str] = mapped_column(String(1024), nullable=False)
    transport: Mapped[str] = mapped_column(String(50), nullable=False, default=MCP_DEFAULT_TRANSPORT)
    # 'connected' | 'disconnected' — independent of is_active. Disconnecting
    # is a reversible pause (config/tools/assignments all survive); is_active
    # remains the permanent-delete flag.
    status: Mapped[str] = mapped_column(
        String(20), nullable=False, default=MCP_CONNECTION_STATUS_CONNECTED
    )

    user: Mapped["User"] = relationship("User")


class MCPTool(BasicModel):
    __tablename__ = "mcp_tools"

    # Every tool is owned by exactly one MCP server connection.
    connection_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("mcp_connections.id", ondelete="CASCADE"), nullable=False, index=True
    )
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    description: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    # 'allowed' | 'requires_approval' | 'blocked' — see constants.TOOL_PERMISSION_*.
    # Global per tool (not per-agent): every agent that uses this tool shares
    # the same gate, so marking a sensitive tool once covers every assignment.
    permission_state: Mapped[str] = mapped_column(String(20), default="allowed", nullable=False)

    connection: Mapped["MCPConnection"] = relationship("MCPConnection")

    __table_args__ = (UniqueConstraint("connection_id", "name", name="uq_mcp_tool_connection_name"),)


class AgentTool(BasicModel):
    __tablename__ = "agent_tools"

    agent_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("agents.id", ondelete="CASCADE"), nullable=False, index=True
    )
    tool_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("mcp_tools.id", ondelete="CASCADE"), nullable=False, index=True
    )

    __table_args__ = (UniqueConstraint("agent_id", "tool_id", name="uq_agent_tool"),)


class Thread(BasicModel):
    __tablename__ = "threads"

    user_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True
    )
    agent_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("agents.id", ondelete="CASCADE"), nullable=False
    )
    title: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)


class Message(BasicModel):
    __tablename__ = "messages"

    thread_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("threads.id", ondelete="CASCADE"), nullable=False
    )
    role: Mapped[str] = mapped_column(String(10), nullable=False)
    content: Mapped[str] = mapped_column(Text, nullable=False)
    is_partial: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)


class StreamRecord(BasicModel):
    __tablename__ = "stream_records"

    thread_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("threads.id", ondelete="CASCADE"),
        nullable=False, index=True,
    )
    user_message_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("messages.id"), nullable=False,
    )
    assistant_message_id: Mapped[Optional[str]] = mapped_column(
        String(36), ForeignKey("messages.id"), nullable=True,
    )
    status: Mapped[str] = mapped_column(
        String(20), nullable=False, default=STREAM_STATUS_PENDING, index=True,
    )
    partial_content: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    error_message: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    total_chunks: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    completed_at: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)
    reasoning: Mapped[Optional[str]] = mapped_column(Text, nullable=True)

    # Token usage / cost — accumulated across every LLM call in this run
    # (parent agent + any sub-agents + summarization), excluding the separate
    # thread-title-generation call. Null until at least one LLM call
    # completes; cost_usd stays null (not 0) if the model has no known
    # pricing — see chat_service.py's usage-capture and cost helpers.
    input_tokens: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    cache_read_tokens: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    output_tokens: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    cost_usd: Mapped[Optional[float]] = mapped_column(Numeric(12, 6), nullable=True)
    llm_source: Mapped[Optional[str]] = mapped_column(String(20), nullable=True)  # 'default' | 'byok'
    llm_provider: Mapped[Optional[str]] = mapped_column(String(50), nullable=True)
    llm_model: Mapped[Optional[str]] = mapped_column(String(100), nullable=True)


class ApiKey(BasicModel):
    __tablename__ = "api_keys"

    user_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True
    )
    name: Mapped[str] = mapped_column(String(100), nullable=False)
    key_hash: Mapped[str] = mapped_column(String(64), nullable=False, unique=True)
    key_prefix: Mapped[str] = mapped_column(String(16), nullable=False)
    # NULL = never expires. Naive IST wall-clock, like every other timestamp
    # column (see utcnow() above) — compared directly against utcnow().
    expires_at: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)


# ── Tracing (LangSmith traces copied into Abyss; see services/trace_sync.py) ──
# Plain Base, not BasicModel: ids are LangSmith's own run UUIDs, and rows are
# replaced wholesale on every sync rather than soft-deleted.


class Trace(Base):
    """One LangSmith trace (a root run and everything under it), summarised
    for lists and charts. Only ever shown to its own user."""

    __tablename__ = "traces"

    id: Mapped[str] = mapped_column(String(36), primary_key=True)  # LangSmith trace id = root run id
    user_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("users.id", ondelete="CASCADE"), nullable=False
    )
    thread_id: Mapped[Optional[str]] = mapped_column(String(36), nullable=True, index=True)
    agent_id: Mapped[Optional[str]] = mapped_column(String(36), nullable=True)
    stream_id: Mapped[Optional[str]] = mapped_column(String(36), nullable=True)
    kind: Mapped[str] = mapped_column(String(30), nullable=False)  # agent_turn | thread_title
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    status: Mapped[str] = mapped_column(String(20), nullable=False)  # success | error | pending
    error: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    start_time: Mapped[datetime] = mapped_column(DateTime, nullable=False)
    end_time: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)
    latency_ms: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    prompt_tokens: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    completion_tokens: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    total_tokens: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    total_cost: Mapped[Optional[float]] = mapped_column(Numeric(12, 6), nullable=True)
    span_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    llm_calls: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    tool_calls: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    error_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    models: Mapped[list] = mapped_column(JSON, nullable=False, default=list)
    input_preview: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    output_preview: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    langsmith_url: Mapped[Optional[str]] = mapped_column(String(500), nullable=True)
    # False while LangSmith hadn't finished ingesting it; re-fetched on sync.
    complete: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    synced_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, default=utcnow)

    __table_args__ = (Index("ix_traces_user_start", "user_id", "start_time"),)


class TraceSpan(Base):
    """One run inside a trace (chain, LLM call, tool call, ...)."""

    __tablename__ = "trace_spans"

    id: Mapped[str] = mapped_column(String(36), primary_key=True)  # LangSmith run id
    trace_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("traces.id", ondelete="CASCADE"), nullable=False, index=True
    )
    parent_id: Mapped[Optional[str]] = mapped_column(String(36), nullable=True)
    position: Mapped[int] = mapped_column(Integer, nullable=False)  # execution order
    depth: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    run_type: Mapped[str] = mapped_column(String(20), nullable=False)
    status: Mapped[str] = mapped_column(String(20), nullable=False)
    error: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    start_time: Mapped[datetime] = mapped_column(DateTime, nullable=False)
    end_time: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)
    latency_ms: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    prompt_tokens: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    completion_tokens: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    total_tokens: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    total_cost: Mapped[Optional[float]] = mapped_column(Numeric(12, 6), nullable=True)
    model: Mapped[Optional[str]] = mapped_column(String(150), nullable=True)
    inputs: Mapped[Optional[dict]] = mapped_column(JSON, nullable=True)
    outputs: Mapped[Optional[dict]] = mapped_column(JSON, nullable=True)
    inputs_truncated: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    outputs_truncated: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    meta: Mapped[Optional[dict]] = mapped_column(JSON, nullable=True)
