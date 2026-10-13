from typing import Any, Literal, Optional

from pydantic import BaseModel


class StreamStartResponse(BaseModel):
    message_id: str
    stream_id: str
    status: Literal["PENDING"] = "PENDING"


class StreamStatusResponse(BaseModel):
    stream_id: str
    status: Literal["PENDING", "RUNNING", "COMPLETED", "FAILED", "CANCELLED", "AWAITING_APPROVAL"]
    total_chunks: int
    partial_content: Optional[str] = None
    reasoning: Optional[dict[str, Any]] = None
    pending_approval: Optional[dict[str, Any]] = None


class StreamCancelResponse(BaseModel):
    stream_id: str
    status: str


class ToolApprovalDecision(BaseModel):
    """One decision for one gated tool call, in HumanInTheLoopMiddleware's shape."""

    type: Literal["approve", "reject"]
    # Feedback returned to the agent on reject. Defaults to a standard
    # "the user declined" message when omitted.
    message: Optional[str] = None
    # Only meaningful with type="approve": also stop asking for this tool.
    always_allow: bool = False


class ToolApprovalGroup(BaseModel):
    """Decisions for one pending interrupt, positional: decisions[i] answers action_requests[i]."""

    interrupt_id: str
    decisions: list[ToolApprovalDecision]


class ToolApprovalRequest(BaseModel):
    approvals: list[ToolApprovalGroup]
