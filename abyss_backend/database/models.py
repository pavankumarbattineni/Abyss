from datetime import datetime, timedelta, timezone
from typing import Optional
from uuid import uuid4
from sqlalchemy import Boolean, DateTime, ForeignKey, Index, Integer, Numeric, String, Text, UniqueConstraint, text
from sqlalchemy import Enum as PgEnum
from sqlalchemy.orm import Mapped, mapped_column, relationship
from database.session import Base
from database.db_enums import ScheduleRunStatus, ScheduleType
from constants import MCP_CONNECTION_STATUS_CONNECTED, MCP_DEFAULT_TRANSPORT, STREAM_STATUS_PENDING

_IST = timezone(timedelta(hours=5, minutes=30))


def utcnow() -> datetime:
    return datetime.now(_IST).replace(tzinfo=None)


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
    password_hash: Mapped[str] = mapped_column(String(255), nullable=False)
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
    # (parent agent + any sub-agents + synthesizer), excluding the separate
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


class AgentSchedule(BasicModel):
    __tablename__ = "agent_schedules"

    agent_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("agents.id", ondelete="CASCADE"), nullable=False, index=True
    )
    user_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True
    )
    # Native Postgres ENUM (schedule_type_enum) backed by ScheduleType (database/db_enums.py).
    schedule_type: Mapped[ScheduleType] = mapped_column(
        PgEnum(
            ScheduleType,
            name="schedule_type_enum",
            values_callable=lambda enum_cls: [member.value for member in enum_cls],
        ),
        nullable=False,
    )
    interval_minutes: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    time_of_day: Mapped[Optional[str]] = mapped_column(String(5), nullable=True)  # "HH:MM", 24h
    weekdays: Mapped[Optional[str]] = mapped_column(String(20), nullable=True)  # "0,2,4" Mon=0..Sun=6
    day_of_month: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)  # 1-31
    input_query: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    dedup_signature: Mapped[str] = mapped_column(String(255), nullable=False)
    next_run_at: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True, index=True)
    last_run_at: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)
    retry_count: Mapped[int] = mapped_column(Integer, default=0, nullable=False)

    agent: Mapped["Agent"] = relationship("Agent")

    # Partial unique index — active schedules only. A soft-deleted (is_active=False)
    # row with the same signature must not block recreating that recurrence.
    __table_args__ = (
        Index(
            "uq_agent_schedule_signature",
            "agent_id", "dedup_signature",
            unique=True,
            postgresql_where=text("is_active = true"),
        ),
    )


class ScheduleRun(BasicModel):
    __tablename__ = "schedule_runs"

    schedule_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("agent_schedules.id", ondelete="CASCADE"), nullable=False, index=True
    )
    agent_id: Mapped[str] = mapped_column(String(36), nullable=False, index=True)
    scheduled_for: Mapped[datetime] = mapped_column(DateTime, nullable=False, index=True)
    # A dedicated new Thread is created per scheduled execution (no shared
    # conversation memory across runs); stream_id lets the tick loop reconcile
    # this row's status against the StreamRecord once generation finishes.
    thread_id: Mapped[Optional[str]] = mapped_column(String(36), ForeignKey("threads.id"), nullable=True)
    stream_id: Mapped[Optional[str]] = mapped_column(String(36), nullable=True)
    # Native Postgres ENUM (schedule_run_status_enum) backed by ScheduleRunStatus (database/db_enums.py).
    status: Mapped[ScheduleRunStatus] = mapped_column(
        PgEnum(
            ScheduleRunStatus,
            name="schedule_run_status_enum",
            values_callable=lambda enum_cls: [member.value for member in enum_cls],
        ),
        nullable=False,
        default=ScheduleRunStatus.PENDING,
    )
    error_message: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    # Updated whenever the generation this run is watching makes observable
    # progress (see chat_service._run_generation's periodic flush). Combined
    # with created_at as a floor, this is what lets the tick-level sweep
    # reclaim a run stuck RUNNING mid-session — not just at server boot.
    heartbeat_at: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)
    # Which retry attempt this row represents (1 = first try). Copied from
    # AgentSchedule.retry_count at creation time — informational only, not
    # used for control flow (the schedule's own retry_count is authoritative).
    attempt: Mapped[int] = mapped_column(Integer, default=1, nullable=False)

    __table_args__ = (
        UniqueConstraint("schedule_id", "scheduled_for", name="uq_schedule_run_schedule_timestamp"),
        # Enforces "at most one active run per schedule" at the database level —
        # this is what makes the atomic-claim pattern in utils/scheduler.py safe
        # across multiple concurrent workers/instances, not just within one
        # in-process tick loop.
        Index(
            "uq_schedule_runs_one_active",
            "schedule_id",
            unique=True,
            postgresql_where=text("status = 'RUNNING'"),
        ),
    )


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
