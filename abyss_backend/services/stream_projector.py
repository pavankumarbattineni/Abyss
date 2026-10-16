"""Projects LangGraph `astream_events` output into Abyss SSE chunks.

One StreamProjector lives for the duration of one generation run. It is fed
every event of the run via `handle()` and turns them into SSE chunk dicts
(sent through `emit`), while accumulating what `chat_service` persists: the
final answer text, structured reasoning steps and token usage.

Event sources (agent labels come from `lc_agent_name`, which `create_agent`
stamps from its `name=`):

    parent model tokens            → token / reasoning_* (final answer channel)
    sub-agent model tokens         → reasoning_* only
    sub-agent tool call (parent)   → agent_start / dispatch_decision / agent_end
    any other tool call            → tool_start / tool_end
    tool call that never executed  → synthesized tool_start / tool_end
      (approval rejected, or skipped on an unattended run)
    parent model turn after        → synthesis_start
      sub-agents returned
"""
from __future__ import annotations

import json
import logging
import time
from collections.abc import Callable

from langchain_core.messages import AIMessage, ToolMessage

from abyss_agents.factory import PARENT_AGENT_NAME
from utils.reasoning_splitter import ReasoningSplitter
from utils.tool_output import extract_tool_output

logger = logging.getLogger(__name__)

# Graph nodes whose tool-result messages can include calls that never ran.
_TOOL_RESULT_NODES = ("tools",)
_HITL_NODE_SUFFIX = ".after_model"


def _is_top_level(checkpoint_ns: str) -> bool:
    """True when the event comes from the parent's own graph, not a sub-agent's."""
    return "|" not in checkpoint_ns


class StreamProjector:
    def __init__(
        self,
        emit: Callable[[dict], None],
        sub_agent_names: frozenset[str] | set[str] = frozenset(),
        *,
        starting_chunk_index: int = 0,
        content_tokens: list[str] | None = None,
        reasoning_steps: list[dict] | None = None,
        input_tokens: int = 0,
        cache_read_tokens: int = 0,
        output_tokens: int = 0,
    ) -> None:
        self._emit_chunk = emit
        self.sub_agent_names = frozenset(sub_agent_names)
        self.chunk_index = starting_chunk_index

        self.content_tokens: list[str] = list(content_tokens or [])
        self.reasoning_steps: list[dict] = list(reasoning_steps or [])
        self.input_tokens = input_tokens
        self.cache_read_tokens = cache_read_tokens
        self.output_tokens = output_tokens

        # Non-final (sub-agent) text, only to count toward flush cadence.
        self._side_tokens = 0
        self._reasoning_token_count = 0

        self._splitters: dict[str, ReasoningSplitter] = {}
        self._labels: dict[str, str] = {}
        self._is_final: dict[str, bool] = {}
        self._turn_start: dict[str, int] = {}        # run_id → len(content_tokens) at turn start
        self._reasoning_buffers: dict[str, list[str]] = {}
        self._reasoning_start: dict[str, float] = {}
        self._reasoning_agent: dict[str, str] = {}
        self._native_open: set[str] = set()          # run_ids with an open native reasoning block

        self._tool_start: dict[str, float] = {}
        self._tool_input: dict[str, str | None] = {}
        self._seen_tool_call_ids: set[str] = set()

        self._completed_sub_agents: list[str] = []
        self._awaiting_synthesis = False

    # ── public API ───────────────────────────────────────────────────────

    @property
    def total_tokens(self) -> int:
        """Monotonic activity counter used for the periodic crash-recovery flush."""
        return (
            len(self.content_tokens)
            + self._side_tokens
            + len(self.reasoning_steps)
            + self._reasoning_token_count
        )

    def handle(self, event: dict) -> None:
        kind = event["event"]
        md = event.get("metadata", {}) or {}
        node = md.get("langgraph_node", "")
        ns = md.get("langgraph_checkpoint_ns", "")
        label = md.get("lc_agent_name") or PARENT_AGENT_NAME

        if kind == "on_chain_start":
            self._on_chain_start(node, ns, label)
        elif kind == "on_chat_model_stream":
            self._on_model_stream(event, node, label)
        elif kind == "on_chat_model_end":
            self._on_model_end(event)
        elif kind == "on_tool_start":
            self._on_tool_start(event, label, ns)
        elif kind == "on_tool_end":
            self._on_tool_end(event, label, ns)
        elif kind == "on_chain_end":
            self._on_chain_end(event, node, label)

    def steps_for_flush(self) -> list[dict]:
        """Reasoning steps so far, including any still-open reasoning block as a partial step."""
        steps = list(self.reasoning_steps)
        for run_id, buf in self._reasoning_buffers.items():
            if buf:
                steps.append({
                    "agent": self._reasoning_agent.get(run_id, ""),
                    "step": "thought",
                    "content": "".join(buf),
                    "partial": True,
                })
        return steps

    def finish(self) -> None:
        """Flush splitters after the event stream ended cleanly, emitting the held-back tail."""
        for run_id, splitter in self._splitters.items():
            label = self._labels.get(run_id, "unknown")
            for sc in splitter.flush(generation_ended_cleanly=True):
                if sc.channel == "reasoning":
                    if sc.text:
                        self._reasoning_buffers.setdefault(run_id, []).append(sc.text)
                        self._reasoning_token_count += 1
                        self._emit("reasoning_token", {"content": sc.text, "agent": label})
                    if sc.event == "end":
                        self._close_reasoning(run_id, label, sc.truncated)
                elif sc.text and self._is_final.get(run_id, False):
                    self.content_tokens.append(sc.text)
                    self._emit("token", {"content": sc.text})

    def abort(self) -> None:
        """Close open reasoning blocks after a cancel. Records steps only — nothing is emitted."""
        for run_id in list(self._native_open):
            self._native_open.discard(run_id)
            start = self._reasoning_start.pop(run_id, None)
            self.reasoning_steps.append({
                "agent": self._labels.get(run_id, "unknown"),
                "step": "thought",
                "content": "".join(self._reasoning_buffers.get(run_id, [])),
                "duration_ms": int((time.monotonic() - start) * 1000) if start else 0,
                "truncated": True,
            })
        for run_id, splitter in self._splitters.items():
            label = self._labels.get(run_id, "unknown")
            for sc in splitter.flush(generation_ended_cleanly=False):
                if sc.channel == "reasoning":
                    if sc.text:
                        self._reasoning_buffers.setdefault(run_id, []).append(sc.text)
                    if sc.event == "end":
                        start = self._reasoning_start.pop(run_id, None)
                        self.reasoning_steps.append({
                            "agent": label,
                            "step": "thought",
                            "content": "".join(self._reasoning_buffers.get(run_id, [])),
                            "duration_ms": int((time.monotonic() - start) * 1000) if start else 0,
                            "truncated": True,
                        })

    # ── internals ────────────────────────────────────────────────────────

    def _emit(self, event_type: str, data: dict) -> None:
        self._emit_chunk({"index": self.chunk_index, "event_type": event_type, "data": data})
        self.chunk_index += 1

    def _close_reasoning(self, run_id: str, label: str, truncated: bool) -> None:
        start = self._reasoning_start.pop(run_id, None)
        self._reasoning_agent.pop(run_id, None)
        self.reasoning_steps.append({
            "agent": label,
            "step": "thought",
            "content": "".join(self._reasoning_buffers.get(run_id, [])),
            "duration_ms": int((time.monotonic() - start) * 1000) if start else 0,
            "truncated": truncated,
        })
        self._reasoning_buffers[run_id] = []
        self._emit("reasoning_end", {"agent": label, "truncated": truncated})

    def _on_chain_start(self, node: str, ns: str, label: str) -> None:
        # The parent's next model turn after sub-agents returned writes the final answer.
        if (
            node == "model"
            and _is_top_level(ns)
            and label == PARENT_AGENT_NAME
            and self._awaiting_synthesis
        ):
            self._awaiting_synthesis = False
            self._emit("synthesis_start", {"agents_completed": list(self._completed_sub_agents)})

    def _on_model_stream(self, event: dict, node: str, label: str) -> None:
        # Only the agent loop's own model node. Middleware-internal model calls
        # (e.g. summarization) run in other nodes and must not reach the user.
        if node != "model":
            return
        run_id = event.get("run_id", "")
        chunk = event["data"]["chunk"]
        if not run_id:
            return

        if run_id not in self._splitters:
            self._splitters[run_id] = ReasoningSplitter()
            self._reasoning_buffers[run_id] = []
            self._labels[run_id] = label
            self._is_final[run_id] = label == PARENT_AGENT_NAME
            self._turn_start[run_id] = len(self.content_tokens)
        label = self._labels[run_id]

        # Providers with native reasoning stream a list of content blocks; plain
        # models stream a string. Native `reasoning` blocks and tag-delimited
        # reasoning inside text blocks are routed to the same reasoning events.
        if isinstance(chunk.content, list):
            for block in chunk.content_blocks:
                if block.get("type") == "reasoning":
                    self._on_native_reasoning(run_id, label, str(block.get("reasoning") or ""))
                elif block.get("type") == "text":
                    self._close_native_reasoning(run_id, label)
                    self._on_text(run_id, label, str(block.get("text") or ""))
            return
        self._close_native_reasoning(run_id, label)
        self._on_text(run_id, label, str(chunk.text))

    def _on_native_reasoning(self, run_id: str, label: str, text: str) -> None:
        if run_id not in self._reasoning_start:
            self._reasoning_start[run_id] = time.monotonic()
            self._reasoning_agent[run_id] = label
            self._native_open.add(run_id)
            self._emit("reasoning_start", {"agent": label})
        if text:
            self._reasoning_buffers[run_id].append(text)
            self._reasoning_token_count += 1
            self._emit("reasoning_token", {"content": text, "agent": label})

    def _close_native_reasoning(self, run_id: str, label: str) -> None:
        """End a native reasoning block once the model moves on to answer text or a tool call."""
        if run_id in self._native_open:
            self._native_open.discard(run_id)
            self._close_reasoning(run_id, label, truncated=False)

    def _on_text(self, run_id: str, label: str, token: str) -> None:
        if not token:
            return
        for sc in self._splitters[run_id].feed(token):
            if sc.channel == "reasoning":
                if sc.event == "start":
                    self._reasoning_start[run_id] = time.monotonic()
                    self._reasoning_agent[run_id] = label
                    self._emit("reasoning_start", {"agent": label})
                elif sc.event == "end":
                    self._close_reasoning(run_id, label, sc.truncated)
                elif sc.text:
                    self._reasoning_buffers[run_id].append(sc.text)
                    self._reasoning_token_count += 1
                    self._emit("reasoning_token", {"content": sc.text, "agent": label})
            elif sc.text:
                if self._is_final[run_id]:
                    self.content_tokens.append(sc.text)
                    self._emit("token", {"content": sc.text})
                else:
                    self._side_tokens += 1

    def _on_model_end(self, event: dict) -> None:
        message = event.get("data", {}).get("output")

        usage = getattr(message, "usage_metadata", None) if message else None
        if usage:
            self.input_tokens += usage.get("input_tokens") or 0
            self.output_tokens += usage.get("output_tokens") or 0
            self.cache_read_tokens += (usage.get("input_token_details") or {}).get("cache_read") or 0

        # A parent turn that only calls specialists has nothing user-facing to
        # say yet; drop any text it leaked so it isn't persisted as the answer.
        run_id = event.get("run_id", "")
        if run_id in self._labels:
            self._close_native_reasoning(run_id, self._labels[run_id])
        if (
            run_id in self._turn_start
            and self._is_final.get(run_id)
            and isinstance(message, AIMessage)
            and message.tool_calls
            and all(tc["name"] in self.sub_agent_names for tc in message.tool_calls)
        ):
            del self.content_tokens[self._turn_start[run_id]:]

    def _on_tool_start(self, event: dict, label: str, ns: str) -> None:
        name = event.get("name", "")
        run_id = event.get("run_id", "")
        raw_in = event.get("data", {}).get("input")

        if name in self.sub_agent_names and _is_top_level(ns) and label == PARENT_AGENT_NAME:
            args = raw_in if isinstance(raw_in, dict) else {}
            task = args.get("task", "")
            self._tool_start[run_id] = time.monotonic()
            self._emit("agent_start", {"agent_name": name})
            self._emit("dispatch_decision", {"target": name, "reason": task})
            self.reasoning_steps.append({
                "agent": PARENT_AGENT_NAME,
                "step": "dispatch_decision",
                "target": name,
                "reason": task,
                "duration_ms": 0,
                "truncated": False,
            })
            return

        self._tool_start[run_id] = time.monotonic()
        if raw_in is None or isinstance(raw_in, str):
            self._tool_input[run_id] = raw_in
        else:
            try:
                self._tool_input[run_id] = json.dumps(raw_in)
            except Exception:
                self._tool_input[run_id] = str(raw_in)
        self._emit("tool_start", {"tool_name": name, "agent_name": label})

    def _on_tool_end(self, event: dict, label: str, ns: str) -> None:
        name = event.get("name", "")
        run_id = event.get("run_id", "")
        output = event.get("data", {}).get("output")
        if isinstance(output, ToolMessage):
            self._seen_tool_call_ids.add(output.tool_call_id)

        started = self._tool_start.pop(run_id, None)
        duration_ms = int((time.monotonic() - started) * 1000) if started else 0

        if name in self.sub_agent_names and _is_top_level(ns) and label == PARENT_AGENT_NAME:
            if name not in self._completed_sub_agents:
                self._completed_sub_agents.append(name)
            self._awaiting_synthesis = True
            self._emit("agent_end", {"agent_name": name})
            return

        output_str = extract_tool_output(output)
        self.reasoning_steps.append({
            "agent": label,
            "step": "tool_call",
            "tool_name": name,
            "input": self._tool_input.pop(run_id, None),
            "output": output_str,
            "duration_ms": duration_ms,
            "truncated": False,
        })
        self._emit("tool_end", {"tool_name": name, "agent_name": label, "output": output_str})

    def _on_chain_end(self, event: dict, node: str, label: str) -> None:
        """Surface tool calls that never executed.

        A rejected approval (HumanInTheLoopMiddleware) or a call skipped on an
        unattended run produces a ToolMessage without running the tool, so no
        on_tool_start/on_tool_end ever fires for it. The message does appear in
        the node's output, which is where it is picked up here.
        """
        if not (node in _TOOL_RESULT_NODES or node.endswith(_HITL_NODE_SUFFIX)):
            return
        output = event.get("data", {}).get("output")
        messages = output.get("messages") if isinstance(output, dict) else None
        for msg in messages or []:
            if (
                not isinstance(msg, ToolMessage)
                or msg.tool_call_id in self._seen_tool_call_ids
                or (msg.name or "") in self.sub_agent_names
            ):
                continue
            self._seen_tool_call_ids.add(msg.tool_call_id)
            text = extract_tool_output(msg) or ""
            tool_name = msg.name or ""
            self._emit("tool_start", {"tool_name": tool_name, "agent_name": label})
            self._emit("tool_end", {"tool_name": tool_name, "agent_name": label, "output": text})
            self.reasoning_steps.append({
                "agent": label,
                "step": "tool_call",
                "tool_name": tool_name,
                "input": None,
                "output": text,
                "duration_ms": 0,
                "truncated": False,
            })
