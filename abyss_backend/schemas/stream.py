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
    tool_call_id: str
    decision: Literal["allow_once", "always_allow", "deny"]


class ToolApprovalGroup(BaseModel):
    interrupt_id: str
    decisions: list[ToolApprovalDecision]


class ToolApprovalRequest(BaseModel):
    approvals: list[ToolApprovalGroup]
