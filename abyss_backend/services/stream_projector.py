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

Where each step happened: every step (thought, tool call, hand-off to a
specialist) carries `at`, the length of the answer text when it began -- in
its live event and in the saved step log. The chat splits the answer at
these points and shows each step's activity between the text written before
and after it, so a turn reads in the order it happened (think, search,
answer part one, search again, answer part two) live and after a reload.
Text from separate model calls of the turn is joined with a blank line, so
the parts stay separate paragraphs.
"""
from __future__ import annotations

import json
import logging
import time
from collections.abc import Callable

from langchain_core.messages import AIMessage, ToolMessage

from abyss_agents.factory import PARENT_AGENT_NAME
from abyss_agents.middleware import (
    CALL_START_EVENT,
    CONTINUE_EVENT,
    RESUME_EVENT,
    SeamFilter,
    in_open_code_block,
    resolve_resume,
    seam_tail,
    unfinished_line,
)
from utils.fake_tool_call import CallTextFilter
from utils.reasoning_splitter import ReasoningSplitter
from utils.tool_output import extract_tool_output

logger = logging.getLogger(__name__)

# Graph nodes whose tool-result messages can include calls that never ran.
_TOOL_RESULT_NODES = ("tools",)
_HITL_NODE_SUFFIX = ".after_model"
# A running tool call's input, as sent live (the full input is saved with the step).
_INPUT_PREVIEW_CHARS = 500


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
        # Drops tool calls a model wrote as text from the visible answer (utils/fake_tool_call.py).
        self._call_filters: dict[str, CallTextFilter] = {}
        self._labels: dict[str, str] = {}
        self._last_run: dict[str, str] = {}          # agent label → its latest model call's run_id
        self._continuing: dict[str, tuple[str, bool, str]] = {}  # label → (tail, in_code, removed line) for its next call
        # label → where in the answer its current reply began: a continuation's
        # steps belong with that reply, not in the middle of its text.
        self._reply_at: dict[str, int] = {}
        self._seam_filters: dict[str, SeamFilter] = {}
        self._run_seams: dict[str, tuple[str, bool, str]] = {}  # run_id → the seam it continues at
        self._call_start: dict[str, int] = {}  # label → len(content_tokens) when its model call began
        self._is_final: dict[str, bool] = {}
        self._turn_start: dict[str, int] = {}        # run_id → len(content_tokens) at turn start
        self._reasoning_buffers: dict[str, list[str]] = {}
        self._reasoning_start: dict[str, float] = {}
        self._reasoning_agent: dict[str, str] = {}
        self._native_open: set[str] = set()          # run_ids with an open native reasoning block
        self._reasoning_at: dict[str, int] = {}      # run_id → answer length when its thought began
        self._answer_started: set[str] = set()       # model calls that already wrote answer text

        self._tool_start: dict[str, float] = {}
        self._tool_input: dict[str, str | None] = {}
        self._tool_at: dict[str, int] = {}
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

    def answer_length(self) -> int:
        """Characters of answer text so far: where a step starting now sits in it."""
        return sum(len(token) for token in self.content_tokens)

    def _thought_at(self, run_id: str, label: str) -> int:
        """Where a thought begins in the answer. A continuation of a cut-off or
        failed reply is the same reply: its thinking goes with that reply's
        start, never into the middle of its text (e.g. inside a code block)."""
        if run_id in self._run_seams:
            return self._reply_at.get(label, self.answer_length())
        return self.answer_length()

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
        elif kind == "on_custom_event" and event.get("name") == CALL_START_EVENT:
            self._call_start[label] = len(self.content_tokens)
        elif kind == "on_custom_event" and event.get("name") == RESUME_EVENT:
            self._on_resume(label, str((event.get("data") or {}).get("request_id") or ""))
        elif kind == "on_custom_event" and event.get("name") == CONTINUE_EVENT:
            data = event.get("data") or {}
            self._on_continue(label, str(data.get("rewind") or ""), bool(data.get("in_code")), str(data.get("tail") or ""))

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
                    "at": self._reasoning_at.get(run_id, self.answer_length()),
                })
        return steps

    def finish(self) -> None:
        """Flush splitters after the event stream ended cleanly, emitting the held-back tail."""
        for run_id in list(self._splitters):
            self._flush_run(run_id)

    def _flush_run(self, run_id: str) -> None:
        """Emit what a model call's splitter and call filter still hold back."""
        splitter = self._splitters[run_id]
        label = self._labels.get(run_id, "unknown")
        if run_id in self._seam_filters:
            self._on_text(run_id, label, self._seam_filters.pop(run_id).flush(), filtered=True)
        for sc in splitter.flush(generation_ended_cleanly=True):
            if sc.channel == "reasoning":
                if sc.text:
                    self._reasoning_buffers.setdefault(run_id, []).append(sc.text)
                    self._reasoning_token_count += 1
                    self._emit("reasoning_token", {"content": sc.text, "agent": label})
                if sc.event == "end":
                    self._close_reasoning(run_id, label, sc.truncated)
            elif sc.text and self._is_final.get(run_id, False):
                self._emit_answer(run_id, sc.text)
        if self._is_final.get(run_id, False):
            self._emit_answer(run_id, "", flush=True)

    def _take_back(self, text: str) -> None:
        """Remove `text` from the end of the answer, here and in the chat."""
        remaining = len(text)
        while remaining:
            last = self.content_tokens[-1]
            if len(last) <= remaining:
                self.content_tokens.pop()
                remaining -= len(last)
            else:
                self.content_tokens[-1] = last[: len(last) - remaining]
                remaining = 0
        self._emit("answer_rewind", {"text": text})

    def _on_resume(self, label: str, request_id: str) -> None:
        """A model call failed part-way and will be tried again, continuing
        what it showed (abyss_agents/middleware.py RestartFailedReply): hand
        back that text, its unfinished last line taken off here and in the
        chat (answer_rewind) to be written again, like a cut-off reply."""
        shown: dict = {"text": ""}
        run_id = self._last_run.get(label)
        if run_id is not None and self._is_final.get(run_id):
            self._flush_run(run_id)
            # Without the paragraph break that joined this call to earlier text.
            text = "".join(self.content_tokens[self._call_start.get(label, len(self.content_tokens)):]).lstrip("\n")
            if text:
                line = unfinished_line(AIMessage(text))
                if line:
                    self._take_back(line)
                    text = text[: len(text) - len(line)]
                tail, in_code = seam_tail(text), in_open_code_block(text)
                self._continuing[label] = (tail, in_code, line)
                shown = {"text": text, "line": line, "tail": tail, "in_code": in_code}
        resolve_resume(request_id, shown)

    def _on_continue(self, label: str, line: str, in_code: bool = False, tail: str = "") -> None:
        """A cut-off answer is about to be continued, its unfinished last line
        written again in full (abyss_agents/middleware.py ContinueCutOffAnswer):
        show everything the cut-off call held back, then take that line off --
        here and, through an answer_rewind event, in the chat."""
        run_id = self._last_run.get(label)
        if run_id is None or not self._is_final.get(run_id):
            return  # a specialist's text is never shown
        self._flush_run(run_id)
        # The continuation's start is cleaned like the joined reply (clean_seam),
        # and the removed line put back if the model skips it -- only a line
        # that was actually taken off the chat.
        start = self._turn_start.get(run_id, 0)
        shown = bool(line) and "".join(self.content_tokens[start:]).endswith(line)
        self._continuing[label] = (tail, in_code, line if shown else "")
        if shown:
            self._take_back(line)

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
                "at": self._reasoning_at.pop(run_id, self.answer_length()),
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
                            "at": self._reasoning_at.pop(run_id, self.answer_length()),
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
            "at": self._reasoning_at.pop(run_id, self.answer_length()),
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

        self._last_run[label] = run_id
        if run_id not in self._splitters:
            self._splitters[run_id] = ReasoningSplitter()
            self._reasoning_buffers[run_id] = []
            self._labels[run_id] = label
            self._is_final[run_id] = label == PARENT_AGENT_NAME
            self._turn_start[run_id] = len(self.content_tokens)
            if label in self._continuing:
                self._run_seams[run_id] = self._continuing.pop(label)
                self._seam_filters[run_id] = SeamFilter(*self._run_seams[run_id])
            else:
                self._reply_at[label] = self.answer_length()
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
            self._reasoning_at[run_id] = self._thought_at(run_id, label)
            self._emit("reasoning_start", {"agent": label, "at": self._reasoning_at[run_id]})
        if text:
            self._reasoning_buffers[run_id].append(text)
            self._reasoning_token_count += 1
            self._emit("reasoning_token", {"content": text, "agent": label})

    def _close_native_reasoning(self, run_id: str, label: str) -> None:
        """End a native reasoning block once the model moves on to answer text or a tool call."""
        if run_id in self._native_open:
            self._native_open.discard(run_id)
            self._close_reasoning(run_id, label, truncated=False)

    def _on_text(self, run_id: str, label: str, token: str, *, filtered: bool = False) -> None:
        if not filtered and run_id in self._seam_filters:
            token = self._seam_filters[run_id].feed(token)
        if not token:
            return
        for sc in self._splitters[run_id].feed(token):
            if sc.channel == "reasoning":
                if sc.event == "start":
                    self._reasoning_start[run_id] = time.monotonic()
                    self._reasoning_agent[run_id] = label
                    self._reasoning_at[run_id] = self._thought_at(run_id, label)
                    self._emit("reasoning_start", {"agent": label, "at": self._reasoning_at[run_id]})
                elif sc.event == "end":
                    self._close_reasoning(run_id, label, sc.truncated)
                elif sc.text:
                    self._reasoning_buffers[run_id].append(sc.text)
                    self._reasoning_token_count += 1
                    self._emit("reasoning_token", {"content": sc.text, "agent": label})
            elif sc.text:
                if self._is_final[run_id]:
                    self._emit_answer(run_id, sc.text)
                else:
                    self._side_tokens += 1

    def _emit_answer(self, run_id: str, text: str, flush: bool = False) -> None:
        """Stream answer text to the user, minus any tool call written as text."""
        call_filter = self._call_filters.setdefault(run_id, CallTextFilter())
        visible = call_filter.feed(text)
        if flush:
            visible += call_filter.flush()
        if not visible:
            return
        if run_id not in self._answer_started:
            self._answer_started.add(run_id)
            # A new model call of the turn starts a new part of the answer: keep
            # it a separate paragraph from the text before it (its own steps sit
            # in between). A continuation of a cut-off or failed call joins
            # seamlessly instead (see SeamFilter).
            if run_id not in self._run_seams and self.content_tokens:
                visible = _paragraph_break("".join(self.content_tokens[-2:]), visible) + visible
        self.content_tokens.append(visible)
        self._emit("token", {"content": visible})

    def _on_model_end(self, event: dict) -> None:
        message = event.get("data", {}).get("output")

        usage = getattr(message, "usage_metadata", None) if message else None
        if usage:
            self.input_tokens += usage.get("input_tokens") or 0
            self.output_tokens += usage.get("output_tokens") or 0
            self.cache_read_tokens += (usage.get("input_token_details") or {}).get("cache_read") or 0

        run_id = event.get("run_id", "")
        if run_id in self._seam_filters:  # a one-line continuation: release what was held
            self._on_text(run_id, self._labels[run_id], self._seam_filters.pop(run_id).flush(), filtered=True)
        if run_id in self._labels:
            self._close_native_reasoning(run_id, self._labels[run_id])
        # Text the main agent writes before calling tools or specialists (what
        # it is about to do, or the part of the answer it already has) stays
        # where it was written: the chat shows the turn step by step. So the
        # call's held-back tail is released now, before its tool calls and the
        # next call's text -- not when the whole turn ends.
        if run_id in self._splitters:
            self._flush_run(run_id)

    def _on_tool_start(self, event: dict, label: str, ns: str) -> None:
        name = event.get("name", "")
        run_id = event.get("run_id", "")
        raw_in = event.get("data", {}).get("input")

        if name in self.sub_agent_names and _is_top_level(ns) and label == PARENT_AGENT_NAME:
            args = raw_in if isinstance(raw_in, dict) else {}
            task = args.get("task", "")
            self._tool_start[run_id] = time.monotonic()
            at = self.answer_length()
            self._emit("agent_start", {"agent_name": name, "at": at})
            self._emit("dispatch_decision", {"target": name, "reason": task, "at": at})
            self.reasoning_steps.append({
                "agent": PARENT_AGENT_NAME,
                "step": "dispatch_decision",
                "target": name,
                "reason": task,
                "duration_ms": 0,
                "truncated": False,
                "at": at,
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
        self._tool_at[run_id] = self.answer_length()
        # The input shows what is being looked up while it runs (capped: a preview, not a payload).
        preview = (self._tool_input[run_id] or "")[:_INPUT_PREVIEW_CHARS]
        self._emit("tool_start", {"tool_name": name, "agent_name": label, "at": self._tool_at[run_id], "input": preview})

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
            "at": self._tool_at.pop(run_id, self.answer_length()),
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
            at = self.answer_length()
            self._emit("tool_start", {"tool_name": tool_name, "agent_name": label, "at": at})
            self._emit("tool_end", {"tool_name": tool_name, "agent_name": label, "output": text})
            self.reasoning_steps.append({
                "agent": label,
                "step": "tool_call",
                "tool_name": tool_name,
                "input": None,
                "output": text,
                "duration_ms": 0,
                "truncated": False,
                "at": at,
            })


def _paragraph_break(before: str, text: str) -> str:
    """What goes between earlier answer text and a new part so they are
    separate paragraphs: nothing if a blank line is already there."""
    gap = len(before) - len(before.rstrip("\n")) + len(text) - len(text.lstrip("\n"))
    return "\n" * max(0, 2 - gap)
