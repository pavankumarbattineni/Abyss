"""Custom middleware for Abyss agents.

Everything generic — human approval, model retries, call limits, summarization —
uses LangChain's built-in middleware (see abyss_agents/factory.py). Only the pieces
that are specific to Abyss live here.
"""
from __future__ import annotations

import logging
import re
from collections.abc import Awaitable, Callable
from typing import Any

import asyncio
from uuid import uuid4

import anyio
import httpx
from langchain.agents.middleware import AgentMiddleware, HumanInTheLoopMiddleware
from langchain_core.callbacks.manager import adispatch_custom_event
from langchain_core.messages import AIMessage, HumanMessage, ToolMessage
from langgraph.errors import GraphBubbleUp
from langgraph.prebuilt.tool_node import ToolCallRequest
from langgraph.types import Command

from utils.fake_tool_call import has_written_call, strip_written_calls
from utils.reasoning_splitter import sanitize_for_reasoning_tags
from utils.tool_output import extract_tool_output

logger = logging.getLogger(__name__)

# Transient network errors talking to the LLM provider (dropped connection,
# reset mid-stream). Not specific to request content, so a bare retry of the
# model call is safe — nothing with side effects has run yet in that call.
TRANSIENT_LLM_EXCEPTIONS = (
    anyio.BrokenResourceError,
    anyio.ClosedResourceError,
    httpx.RemoteProtocolError,
    httpx.ReadError,
    httpx.WriteError,
    httpx.ConnectError,
    ConnectionError,
)


class ToolResultMiddleware(AgentMiddleware):
    """Normalizes every tool result before it reaches the model.

    - Flattens MCP content blocks to plain text and escapes literal reasoning
      tags in the (untrusted) output so injected tags can't hijack the
      reasoning/answer split of the token stream.
    - Converts a raised tool exception into an error ToolMessage so the agent
      can adapt instead of the whole run failing. Graph control-flow signals
      (interrupts) are never swallowed.
    - Runs each call in a task of its own and waits for it with a time limit
      (TOOL_CALL_TIMEOUT_SECONDS; none for the names in `no_timeout`, i.e.
      specialists, which have their own). A tool that hangs -- an MCP server
      that never answers -- gives the agent an error instead of holding the
      turn forever, and a Stop always reaches the turn: MCP clients run on
      anyio task groups, which can absorb a cancel aimed at the turn while it
      waits inside them, leaving the turn running and unsaved.
    """

    def __init__(self, timeout: float | None = None, no_timeout: frozenset[str] = frozenset()) -> None:
        super().__init__()
        from constants import TOOL_CALL_TIMEOUT_SECONDS

        self.timeout = TOOL_CALL_TIMEOUT_SECONDS if timeout is None else timeout
        self.no_timeout = no_timeout

    def _error(self, request: ToolCallRequest, text: str) -> ToolMessage:
        return ToolMessage(
            content=sanitize_for_reasoning_tags(text),
            tool_call_id=request.tool_call["id"],
            name=request.tool_call["name"],
            status="error",
        )

    async def awrap_tool_call(
        self,
        request: ToolCallRequest,
        handler: Callable[[ToolCallRequest], Awaitable[ToolMessage | Command[Any]]],
    ) -> ToolMessage | Command[Any]:
        name = request.tool_call["name"]
        call = asyncio.ensure_future(handler(request))
        try:
            done, _ = await asyncio.wait({call}, timeout=None if name in self.no_timeout else self.timeout)
        except asyncio.CancelledError:
            call.cancel()  # the turn was stopped: stop the call too, without waiting on it
            raise
        if not done:
            call.cancel()
            logger.warning("Tool %s didn't answer within %ss", name, self.timeout)
            return self._error(
                request, f"Tool error: {name} didn't answer within {int(self.timeout)} seconds. Try again or go on without it.",
            )
        try:
            result = call.result()
        except GraphBubbleUp:
            raise
        except Exception as exc:
            logger.warning("Tool %s raised: %r", name, exc)
            return self._error(request, f"Tool error: {exc}")
        if isinstance(result, ToolMessage):
            result.content = sanitize_for_reasoning_tags(extract_tool_output(result) or "")
        return result


class SubAgentCallLimitMiddleware(AgentMiddleware):
    """Caps how many sub-agent calls a single parent turn may make.

    The parent can emit several tool calls in one model turn. Calls beyond
    `limit` (counted in order among the sub-agent tools of that turn) are
    rejected with an explanatory ToolMessage so the model can re-plan, instead
    of silently fanning out without bound.
    """

    def __init__(self, sub_agent_tool_names: set[str], limit: int) -> None:
        super().__init__()
        self._names = sub_agent_tool_names
        self._limit = limit

    async def awrap_tool_call(
        self,
        request: ToolCallRequest,
        handler: Callable[[ToolCallRequest], Awaitable[ToolMessage | Command[Any]]],
    ) -> ToolMessage | Command[Any]:
        call = request.tool_call
        if call["name"] in self._names:
            last = next(
                (m for m in reversed(request.state["messages"]) if isinstance(m, AIMessage)),
                None,
            )
            turn_calls = [tc for tc in (last.tool_calls if last else []) if tc["name"] in self._names]
            position = next((i for i, tc in enumerate(turn_calls) if tc["id"] == call["id"]), 0)
            if position >= self._limit:
                return ToolMessage(
                    content=(
                        f"Not run: at most {self._limit} specialist calls are allowed per turn. "
                        "Call this specialist again in a later turn if the result is still needed."
                    ),
                    tool_call_id=call["id"],
                    name=call["name"],
                    status="error",
                )
        return await handler(request)


class ToolApprovalMiddleware(HumanInTheLoopMiddleware):
    """HumanInTheLoopMiddleware that also puts each tool's MCPTool.id on its approval request.

    The approval payload is the stock HITL shape plus one extra key per action
    request, `tool_id`. "Always Allow" resolves the tool by that primary key —
    MCPTool.name is only unique per connection, not globally.
    """

    def __init__(self, tool_ids: dict[str, str | None], **kwargs: Any) -> None:
        super().__init__(**kwargs)
        self._tool_ids = tool_ids

    def _create_action_and_config(self, tool_call, config, state, runtime):
        action_request, review_config = super()._create_action_and_config(tool_call, config, state, runtime)
        tool_id = self._tool_ids.get(tool_call["name"])
        if tool_id:
            action_request["tool_id"] = tool_id
        return action_request, review_config


_REASONING_BLOCKS = re.compile(r"<reasoning>.*?(?:</reasoning>|$)", re.DOTALL)
ACT_OR_ANSWER_NUDGE = (
    "[Note from the system, not the user] Your last reply ended without acting: it "
    "either stopped after the reasoning or wrote a tool call as text, so nothing ran. "
    "Now make the tool call you described through the function-calling interface "
    "(never as text), or write the final answer."
)


def _needs_another_try(message: AIMessage) -> bool:
    """A reply that did nothing: no real tool call, and either only reasoning
    (no answer) or a tool call written out as text."""
    if message.tool_calls:
        return False
    text = message.text if isinstance(message.text, str) else str(message.text)
    if has_written_call(text):
        return True
    return not strip_written_calls(_REASONING_BLOCKS.sub("", text)).strip()


class ActOrAnswerGuard(AgentMiddleware):
    """Asks the model once more when a reply neither acts nor answers.

    Some models occasionally end a turn with only their `<reasoning>` block, or
    write a tool call as text instead of making it, so nothing runs (and the
    main agent's turn ends with no answer). One retry, with a short note that
    names the mistake; a second miss is returned as is.
    """

    async def awrap_model_call(self, request: Any, handler: Callable[[Any], Awaitable[Any]]) -> Any:
        response = await handler(request)
        message = next((m for m in reversed(response.result) if isinstance(m, AIMessage)), None)
        if message is None or not _needs_another_try(message):
            return response
        logger.warning("Model reply neither acted nor answered; asking once more")
        return await handler(
            request.override(messages=[*request.messages, system_note(ACT_OR_ANSWER_NUDGE)])
        )


def system_note(text: str) -> HumanMessage:
    """A note to the model in a user-role message. Marked so history handling
    never mistakes it for the user's question (abyss_agents/history.py)."""
    return HumanMessage(text, additional_kwargs={"lc_source": "system_note"})


CONTINUE_NUDGE = (
    "[Note from the system, not the user] Your reply above was cut off by the "
    "output length limit. Continue it from the exact character where it stopped: "
    "no repetition, no preamble, no reasoning block, no note about the cut. If it "
    "stopped inside a code block, keep writing that code and close the block."
)
CONTINUE_LINE_NUDGE = (
    "[Note from the system, not the user] Your reply above was cut off by the "
    "output length limit, and its unfinished last line was removed. Continue the "
    "reply from the start of that line: write that line in full, then the rest. "
    "No repetition of earlier lines, no preamble, no reasoning block, no note "
    "about the cut. If it is inside a code block, keep writing that code and "
    "close the block."
)
CONTINUE_IN_CODE_NOTE = (
    " The cut is inside a code block that is still open: continue its code "
    "directly, with no new ``` fence."
)
# Custom stream event: the unfinished last line of a cut-off reply is about to
# be written again, so the chat drops it first (services/stream_projector.py).
CONTINUE_EVENT = "abyss_answer_continue"
_FENCE = re.compile(r"^[ \t]*```", re.MULTILINE)
# A fence that opens a block names its language; a closing fence never does.
_REOPENED_FENCE = re.compile(r"\s*```[A-Za-z0-9_+.#-]+[^\n]*\n")
# A longer unfinished line (minified code, say) is continued as is instead.
_MAX_REWRITTEN_LINE = 2_000

# How each provider reports a reply that hit its output-token limit.
_CUT_OFF_REASONS = {"length", "max_tokens", "max_output_tokens"}


def was_cut_off(message: AIMessage) -> bool:
    """True when the provider stopped the reply at its output-token limit:
    OpenAI finish_reason "length" (Responses API: status "incomplete" for
    max_output_tokens), Anthropic stop_reason "max_tokens", Gemini "MAX_TOKENS"."""
    meta = message.response_metadata or {}
    for key in ("finish_reason", "stop_reason"):
        if str(meta.get(key) or "").lower() in _CUT_OFF_REASONS:
            return True
    details = meta.get("incomplete_details") or {}
    return meta.get("status") == "incomplete" and (
        isinstance(details, dict) and details.get("reason") == "max_output_tokens"
    )


def stopped_unfinished(message: AIMessage) -> bool:
    """True when the reply isn't finished: cut off at the output limit, or
    stopped inside a ``` block it never closed -- a finished answer never ends
    there (a model can stop right after a gallery's JSON, with the rest unsaid)."""
    text = message.text if isinstance(message.text, str) else str(message.text)
    return was_cut_off(message) or in_open_code_block(text)


def _blocks(content: Any) -> list:
    return [{"type": "text", "text": content}] if isinstance(content, str) else list(content)


def unfinished_line(message: AIMessage) -> str:
    """The reply's last line, to be written again in full when the reply is
    continued; "" when the reply should be continued as is instead.

    Resuming at a line start is far more reliable than mid-word or mid-token
    (a model resuming "Math.sin(" may skip the bracket), and rewriting the
    last line even when the cut fell right after its line break stops the
    model skipping or repeating a line. Not used when the cut is inside a
    reasoning block or a written tool call, or the line is very long.
    """
    text = message.text if isinstance(message.text, str) else str(message.text)
    line = text[text.rfind("\n", 0, max(len(text) - 1, 0)) + 1:]
    if not line or len(line) > _MAX_REWRITTEN_LINE:
        return ""
    if text.count("<reasoning>") > text.count("</reasoning>") or text.count("<call>") > text.count("</call>"):
        return ""
    content = message.content
    if isinstance(content, str):
        return line if content.endswith(line) else ""
    last = next((b for b in reversed(content) if isinstance(b, dict) and b.get("type") == "text"), None)
    return line if last is not None and str(last.get("text", "")).endswith(line) else ""


def removed_line_note(line: str) -> str:
    """Quotes how the removed line began, so it is rewritten the same way."""
    if not line.strip():
        return ""
    return f" The removed line began with: «{line.rstrip(chr(10))}» -- write it in full, then go on."


def in_open_code_block(text: str) -> bool:
    """True when the text ends inside a ``` code block it has not closed."""
    return len(_FENCE.findall(text)) % 2 == 1


# The last lines of the reply so far that a continuation may repeat.
_SEAM_LINES = 8
_SEAM_CHARS = 4_000
# A repeated single line shorter than this ("}", "</div>") may be meant.
_MIN_REPEAT_CHARS = 12


def seam_tail(text: str) -> str:
    """The reply's last complete lines (at a line start only), for clean_seam."""
    if not text.endswith("\n"):
        return ""
    lines = text.splitlines(keepends=True)[-_SEAM_LINES:]
    while lines and sum(map(len, lines)) > _SEAM_CHARS:
        lines.pop(0)
    return "".join(lines)


# How much of a removed line a continuation must start with to count as
# writing it again (see restore_skipped_line).
_REWRITE_PREFIX_CHARS = 12


def restore_skipped_line(line: str, text: str) -> str:
    """The continuation, with the removed unfinished line put back in front of
    it when the model went on without writing that line again.

    The model is asked to rewrite the line it was cut off in (see
    unfinished_line), but sometimes takes the quoted line as already written
    and carries on after it -- or mid-way through it. Either way, putting the
    line back gives the reply the model meant: "...the Hel" + "lo world", or a
    JSON object's skipped `{"from": ...,` line followed by its next keys.
    """
    head = line.strip()[:_REWRITE_PREFIX_CHARS]
    body = text.lstrip()
    if not head or not body:
        return text
    n = min(len(head), len(body))
    return text if body[:n] == head[:n] else line + text


def clean_seam(text: str, tail: str, in_code: bool, line: str = "") -> str:
    """A continuation's text without what it should not repeat: a new
    ```lang fence when it is already inside a code block (a closing fence
    names no language, so it is kept), then lines that repeat the end of the
    reply so far (`tail`, see seam_tail) -- models sometimes restart a line
    or two early. The removed unfinished `line` is put back when the model
    skipped it (restore_skipped_line)."""
    return restore_skipped_line(line, _without_repeats(text, tail, in_code))


def _without_repeats(text: str, tail: str, in_code: bool) -> str:
    if in_code:
        match = _REOPENED_FENCE.match(text)
        if match:
            text = text[match.end():]
    before = tail.splitlines(keepends=True)
    after = text.splitlines(keepends=True)
    for k in range(min(len(before), len(after)), 0, -1):
        repeat = after[:k]
        if not all(line.endswith("\n") for line in repeat) or repeat != before[-k:]:
            continue
        if k == 1 and len(repeat[0].strip()) < _MIN_REPEAT_CHARS:
            continue
        return text[sum(map(len, repeat)):]
    return text


class SeamFilter:
    """Streams a continuation through clean_seam: holds back only its first
    lines, as many as the seam can affect, and gives the same text as
    clean_seam on the whole reply."""

    def __init__(self, tail: str, in_code: bool, line: str = "") -> None:
        self._tail = tail
        self._in_code = in_code
        self._line = line
        self._lines_needed = len(tail.splitlines()) + (1 if in_code else 0)
        self._max_held = len(tail) + 400
        self._held = ""
        self._decided = False

    def feed(self, text: str) -> str:
        if self._decided:
            return text
        self._held += text
        body = self._held.lstrip()
        if (body and body.count("\n") >= max(1, self._lines_needed)) or len(self._held) > self._max_held:
            return self.flush()
        return ""

    def flush(self) -> str:
        if self._decided:
            return ""
        self._decided = True
        held, self._held = self._held, ""
        return clean_seam(held, self._tail, self._in_code, self._line)


def _with_clean_seam(message: AIMessage, tail: str, in_code: bool, line: str = "") -> AIMessage:
    content = message.content
    if isinstance(content, str):
        return message.model_copy(update={"content": clean_seam(content, tail, in_code, line)})
    blocks = list(content)
    first = next((i for i, b in enumerate(blocks) if isinstance(b, dict) and b.get("type") == "text"), None)
    if first is None:
        return message
    blocks[first] = {**blocks[first], "text": clean_seam(str(blocks[first].get("text", "")), tail, in_code, line)}
    return message.model_copy(update={"content": blocks})


def without_tail(message: AIMessage, tail: str) -> AIMessage:
    """The reply with `tail` (its unfinished last line) removed."""
    if not tail:
        return message
    content = message.content
    if isinstance(content, str):
        return message.model_copy(update={"content": content[: len(content) - len(tail)]})
    blocks = list(content)
    index = max(i for i, b in enumerate(blocks) if isinstance(b, dict) and b.get("type") == "text")
    text = blocks[index]["text"]
    blocks[index] = {**blocks[index], "text": text[: len(text) - len(tail)]}
    return message.model_copy(update={"content": blocks})


def join_replies(first: AIMessage, rest: AIMessage) -> AIMessage:
    """One reply made of a cut-off reply and its continuation."""
    if isinstance(first.content, str) and isinstance(rest.content, str):
        content: Any = first.content + rest.content
    else:
        content = _blocks(first.content) + _blocks(rest.content)
    return first.model_copy(update={
        "content": content,
        "tool_calls": rest.tool_calls,
        "invalid_tool_calls": rest.invalid_tool_calls,
        "response_metadata": rest.response_metadata,
    })


class ContinueCutOffAnswer(AgentMiddleware):
    """Continues a reply the provider cut off at its output-token limit.

    A long answer (a whole website, a long report) can be stopped mid-sentence
    or mid-code by the model's output limit; the user would get broken code and
    an error in its live preview. The model is asked to go on from where it
    stopped -- its partial reply plus a note -- up to MAX_ANSWER_CONTINUATIONS
    times. The unfinished last line is taken off first and written again in
    full (the chat drops it from view on CONTINUE_EVENT), so the seam is exact.
    Each continuation streams right after the text already shown, and the
    parts are joined into one reply in the conversation.
    """

    def __init__(self, max_continuations: int) -> None:
        super().__init__()
        self.max_continuations = max_continuations

    async def awrap_model_call(self, request: Any, handler: Callable[[Any], Awaitable[Any]]) -> Any:
        response = await handler(request)
        for attempt in range(1, self.max_continuations + 1):
            index = next(
                (i for i in range(len(response.result) - 1, -1, -1) if isinstance(response.result[i], AIMessage)),
                None,
            )
            if index is None:
                return response
            message = response.result[index]
            # A cut inside a tool call can't be resumed as text; the agent loop
            # (and ActOrAnswerGuard) handle a broken call.
            if not stopped_unfinished(message) or message.tool_calls or message.invalid_tool_calls:
                return response
            logger.warning("Reply stopped unfinished; continuing it (%d/%d)", attempt, self.max_continuations)
            line = unfinished_line(message)
            partial = without_tail(message, line).model_copy(update={"tool_calls": [], "invalid_tool_calls": []})
            text = partial.text if isinstance(partial.text, str) else str(partial.text)
            in_code = in_open_code_block(text)
            tail = seam_tail(text)
            try:  # the chat drops the line and cleans the seam the same way
                await adispatch_custom_event(CONTINUE_EVENT, {"rewind": line, "in_code": in_code, "tail": tail})
            except RuntimeError:  # no run to tell (direct call, tests)
                pass
            note = (
                (CONTINUE_LINE_NUDGE + removed_line_note(line) if line else CONTINUE_NUDGE)
                + (CONTINUE_IN_CODE_NOTE if in_code else "")
            )
            more = await handler(request.override(messages=[*request.messages, partial, system_note(note)]))
            rest = next((m for m in reversed(more.result) if isinstance(m, AIMessage)), None)
            if rest is None:
                # Nothing came back: keep the reply as it was, line and all.
                return response
            response.result[index] = join_replies(partial, _with_clean_seam(rest, tail, in_code, line))
        return response


# Provider trouble that passes: an outage or overload (503/529), a timeout, a
# dropped connection. Waits before each new try.
_RESTART_DELAYS = (3.0, 8.0, 20.0)
_PASSING_ERRORS = {"provider_unavailable", "provider_timeout", "provider_unreachable"}
# Custom stream events between RestartFailedReply and the chat's stream
# projector (services/stream_projector.py), which knows what was shown:
# CALL_START_EVENT marks where a model call's answer text begins; on
# RESUME_EVENT the projector hands back the text that call has shown (via
# resolve_resume), taking its last line back so it can be written again.
CALL_START_EVENT = "abyss_model_call_start"
RESUME_EVENT = "abyss_answer_resume"
_RESUME_WAIT_SECONDS = 10
_resume_requests: dict[str, asyncio.Future] = {}


def is_passing_provider_error(exc: BaseException) -> bool:
    """True for provider failures worth another try (not a bad key, a missing
    model, a too-long request or a cancel)."""
    if isinstance(exc, TRANSIENT_LLM_EXCEPTIONS):
        return True
    from utils.llm_providers import classify_llm_error

    code, _ = classify_llm_error(exc)
    return code in _PASSING_ERRORS


def resolve_resume(request_id: str, shown: dict) -> None:
    """Called by the stream projector with what a failed model call had shown."""
    future = _resume_requests.pop(request_id, None)
    if future is not None and not future.done():
        future.set_result(shown)


async def _dispatch(name: str, data: dict) -> bool:
    try:
        await adispatch_custom_event(name, data)
        return True
    except RuntimeError:  # no run to tell (direct call, tests)
        return False


async def _shown_by_failed_call() -> dict | None:
    """What the failed call showed in the chat (its last line already taken
    back): {"text", "line", "tail", "in_code"}; None if nothing answers."""
    request_id = uuid4().hex
    future = asyncio.get_running_loop().create_future()
    _resume_requests[request_id] = future
    if not await _dispatch(RESUME_EVENT, {"request_id": request_id}):
        _resume_requests.pop(request_id, None)
        return None
    try:
        return await asyncio.wait_for(future, timeout=_RESUME_WAIT_SECONDS)
    except asyncio.TimeoutError:
        _resume_requests.pop(request_id, None)
        return None


def resume_note(line: str, in_code: bool) -> str:
    """The note asking the model to go on after a failed call."""
    reason = "by a connection problem with the model provider"
    base = (CONTINUE_LINE_NUDGE + removed_line_note(line)) if line else CONTINUE_NUDGE
    return base.replace("by the output length limit", reason) + (CONTINUE_IN_CODE_NOTE if in_code else "")


class RestartFailedReply(AgentMiddleware):
    """Tries a model call again when the provider fails part-way through it.

    A provider outage ("503 high demand"), timeout or dropped connection would
    otherwise end the turn. After a short wait the call is made again, up to
    len(_RESTART_DELAYS) times. When it had already shown part of the answer
    (`visible`: the main agent, whose text the user sees), that text stays:
    the next try continues it from the start of its last line, exactly as a
    reply cut off at the output limit is continued -- nothing disappears or
    is shown twice. If the provider stays down, the error reaches the chat,
    which saves what was shown as a partial reply. Other errors are raised at once.
    """

    def __init__(self, delays: tuple[float, ...] = _RESTART_DELAYS, visible: bool = False) -> None:
        super().__init__()
        self.delays = delays
        self.visible = visible

    async def awrap_model_call(self, request: Any, handler: Callable[[Any], Awaitable[Any]]) -> Any:
        if self.visible:
            await _dispatch(CALL_START_EVENT, {})
        current = request
        partial: AIMessage | None = None
        tail, in_code, line = "", False, ""
        for attempt, delay in enumerate((*self.delays, None), start=1):
            try:
                response = await handler(current)
            except GraphBubbleUp:
                raise
            except Exception as exc:
                if delay is None or not is_passing_provider_error(exc):
                    raise
                logger.warning("Model call failed (%r); trying again (%d/%d)", exc, attempt, len(self.delays))
                shown = await _shown_by_failed_call() if self.visible else None
                if shown and shown.get("text"):
                    partial = AIMessage(shown["text"])
                    tail, in_code, line = shown.get("tail", ""), bool(shown.get("in_code")), shown.get("line", "")
                    note = resume_note(shown.get("line", ""), in_code)
                    current = request.override(messages=[*request.messages, partial, system_note(note)])
                else:
                    partial, current = None, request
                await asyncio.sleep(delay)
                continue
            if partial is None:
                return response
            index = next(
                (i for i in range(len(response.result) - 1, -1, -1) if isinstance(response.result[i], AIMessage)),
                None,
            )
            if index is not None:
                response.result[index] = join_replies(
                    partial, _with_clean_seam(response.result[index], tail, in_code, line)
                )
            return response
        raise AssertionError("unreachable")


REASONING_REMINDER = (
    "\n\n[Note from the system, not the user] Start your reply with your brief "
    "<reasoning> block, even if the message above asks for a specific format, "
    "then act or answer."
)


def _is_user_question(message: Any) -> bool:
    """A message the user wrote -- not a conversation summary or a system nudge."""
    return isinstance(message, HumanMessage) and not message.additional_kwargs.get("lc_source")


def with_reasoning_reminder(messages: list) -> list:
    """The messages with REASONING_REMINDER after the latest user question."""
    index = next((i for i in range(len(messages) - 1, -1, -1) if _is_user_question(messages[i])), None)
    if index is None:
        return messages
    question = messages[index]
    content = question.content
    if isinstance(content, str):
        new_content: Any = content + REASONING_REMINDER
    else:
        new_content = [*content, {"type": "text", "text": REASONING_REMINDER}]
    return [*messages[:index], question.model_copy(update={"content": new_content}), *messages[index + 1:]]


class ReasoningReminderMiddleware(AgentMiddleware):
    """Repeats the prompt-protocol reasoning instruction right after the question.

    With prompt-based reasoning (REASONING_INSTRUCTION in the system prompt),
    a model can skip the <reasoning> block when the user's message dictates a
    format of its own (e.g. "answer in sections A-E") -- the thinking panel
    then stays empty although thinking is on. The instruction placed after the
    latest question is what the model reads last. View only: the saved
    conversation, summaries and the user's message are unchanged. Used only
    when the prompt protocol is active (thinking on, no native reasoning).
    """

    def wrap_model_call(self, request: Any, handler: Callable[[Any], Any]) -> Any:
        return handler(request.override(messages=with_reasoning_reminder(request.messages)))

    async def awrap_model_call(self, request: Any, handler: Callable[[Any], Awaitable[Any]]) -> Any:
        return await handler(request.override(messages=with_reasoning_reminder(request.messages)))
