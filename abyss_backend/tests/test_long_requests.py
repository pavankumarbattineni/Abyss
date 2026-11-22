"""Requests complete whatever their length: a reply cut off at the output limit
is continued (ContinueCutOffAnswer), and a model call over its share of the
context window is cut down to fit (ContextBudgetMiddleware). No LLM, no DB."""

from types import SimpleNamespace

from langchain_core.messages import AIMessage, HumanMessage, ToolMessage
from langchain_core.messages.utils import count_tokens_approximately

from abyss_agents.history import _is_question, fit_to_budget, trim_past_turns
from abyss_agents.middleware import (
    CONTINUE_EVENT,
    CONTINUE_IN_CODE_NOTE,
    CONTINUE_LINE_NUDGE,
    CONTINUE_NUDGE,
    ContinueCutOffAnswer,
    SeamFilter,
    clean_seam,
    join_replies,
    removed_line_note,
    system_note,
    unfinished_line,
    was_cut_off,
)
from abyss_agents.factory import PARENT_AGENT_NAME
from services.stream_projector import StreamProjector


class Request(SimpleNamespace):
    def override(self, **kw):
        return Request(**{**self.__dict__, **kw})


def _cut(text, **meta):
    return AIMessage(text, response_metadata=meta or {"finish_reason": "length"})


def test_every_provider_cut_off_signal_is_recognised():
    assert was_cut_off(_cut("x", finish_reason="length"))  # OpenAI chat completions
    assert was_cut_off(_cut("x", stop_reason="max_tokens"))  # Anthropic
    assert was_cut_off(_cut("x", finish_reason="MAX_TOKENS"))  # Gemini
    assert was_cut_off(_cut("x", status="incomplete", incomplete_details={"reason": "max_output_tokens"}))
    assert not was_cut_off(_cut("x", finish_reason="stop"))
    assert not was_cut_off(_cut("x", stop_reason="end_turn"))
    assert not was_cut_off(_cut("x", finish_reason="STOP"))
    assert not was_cut_off(_cut("x", status="incomplete", incomplete_details={"reason": "content_filter"}))
    assert not was_cut_off(AIMessage("x"))


def test_the_unfinished_last_line_is_rewritten_unless_unsafe():
    assert unfinished_line(_cut("<html>\n<script>\nconst r = Math.sin")) == "const r = Math.sin"
    assert unfinished_line(_cut("a\nline two\n")) == "line two\n"  # cut right at a line end
    assert unfinished_line(_cut("one\n\n")) == "\n"  # a blank line
    assert unfinished_line(_cut("if (a) {\n    ")) == "    "  # only indentation so far
    assert unfinished_line(_cut("a\n" + "x" * 5_000)) == ""  # minified code: continue as is
    assert unfinished_line(_cut("<reasoning>thinking about\nthe pla")) == ""  # inside reasoning
    blocks = _cut("")
    blocks.content = [{"type": "thinking", "thinking": "t"}, {"type": "text", "text": "a\nb = (1"}]
    assert unfinished_line(blocks) == "b = (1"


async def test_a_cut_off_reply_is_continued_from_its_last_line_start():
    seen = []
    replies = [
        _cut("<html><body>\n<script>\nconst r = p.radius + Math.sin"),
        _cut("const r = p.radius + Math.sin(t) * 2;\nconst b ="),
        AIMessage("const b = 2;\n</script></body></html>", response_metadata={"finish_reason": "stop"}),
    ]

    async def handler(request):
        seen.append(request.messages)
        return SimpleNamespace(result=[replies[len(seen) - 1]])

    response = await ContinueCutOffAnswer(4).awrap_model_call(Request(messages=[HumanMessage("Build a site")]), handler)
    assert response.result[0].content == (
        "<html><body>\n<script>\nconst r = p.radius + Math.sin(t) * 2;\nconst b = 2;\n</script></body></html>"
    )
    assert len(seen) == 3
    # Each continuation sees the reply up to its last complete line, then the note.
    assert seen[1][-2].content == "<html><body>\n<script>\n"
    assert seen[1][-1].content.startswith(CONTINUE_LINE_NUDGE)
    assert seen[2][-2].content == "<html><body>\n<script>\nconst r = p.radius + Math.sin(t) * 2;\n"


async def test_a_cut_at_a_line_end_rewrites_that_line():
    seen = []
    replies = [
        _cut("zero\none\n"),
        _cut("one\n\n"),
        AIMessage("two", response_metadata={"finish_reason": "stop"}),
    ]

    async def handler(request):
        seen.append(request.messages)
        return SimpleNamespace(result=[replies[len(seen) - 1]])

    response = await ContinueCutOffAnswer(4).awrap_model_call(Request(messages=[HumanMessage("q")]), handler)
    assert response.result[0].content == "zero\none\ntwo"
    assert seen[1][-2].content == "zero\n"
    assert seen[1][-1].content == CONTINUE_LINE_NUDGE + removed_line_note("one\n")
    assert seen[2][-2].content == "zero\none\n"  # the blank line is rewritten too


async def test_a_continuation_inside_code_never_opens_a_second_block():
    seen = []
    replies = [
        _cut("Here it is:\n```html\n<canvas></canvas>\n<script>\nconst a ="),
        AIMessage("```javascript\nconst a = 1;\n</script>\n```", response_metadata={"finish_reason": "stop"}),
    ]

    async def handler(request):
        seen.append(request.messages)
        return SimpleNamespace(result=[replies[len(seen) - 1]])

    response = await ContinueCutOffAnswer(4).awrap_model_call(Request(messages=[HumanMessage("q")]), handler)
    assert response.result[0].content == "Here it is:\n```html\n<canvas></canvas>\n<script>\nconst a = 1;\n</script>\n```"
    assert seen[1][-1].content == CONTINUE_LINE_NUDGE + removed_line_note("const a =") + CONTINUE_IN_CODE_NOTE


async def test_a_closing_fence_rewritten_at_the_seam_is_kept():
    replies = [_cut("```js\nx()\n```"), AIMessage("```\nDone.", response_metadata={"finish_reason": "stop"})]
    calls = []

    async def handler(request):
        calls.append(1)
        return SimpleNamespace(result=[replies[len(calls) - 1]])

    response = await ContinueCutOffAnswer(4).awrap_model_call(Request(messages=[HumanMessage("q")]), handler)
    assert response.result[0].content == "```js\nx()\n```\nDone."


def test_lines_a_continuation_repeats_are_dropped_once():
    tail = "  for (let i = 0; i < n; i++) {\n"
    # Restarted one line early (seen live): the repeat goes.
    assert clean_seam(tail + "    push(i);\n  }\n", tail, False) == "    push(i);\n  }\n"
    # Restarted two lines early, after a new fence.
    tail2 = "  const n = 40;\n" + tail
    assert clean_seam("```js\n" + tail2 + "    go();\n", tail2, True) == "    go();\n"
    # A short repeated line may be meant ("}" closing two blocks): kept.
    assert clean_seam("  }\n}\n", "    x();\n  }\n", False) == "  }\n}\n"
    # Nothing in common: unchanged.
    assert clean_seam("next line\n", tail, False) == "next line\n"


def test_seam_filter_streams_the_same_text_as_the_joined_reply():
    tail = "a();\n  for (let i = 0; i < n; i++) {\n"
    cases = [
        ("```javascript\nconst a = 1;", "", True),
        ("\n```js\nx", "", True),
        ("```\nDone", "", True),
        ("plain\ntext", "", False),
        ("short", "", False),
        ("  for (let i = 0; i < n; i++) {\n    b();\n  }\n", tail, False),
        ("```js\na();\n  for (let i = 0; i < n; i++) {\n    b();", tail, True),
        ("a();\n", tail, False),
    ]
    for text, seam, in_code in cases:
        for step in (1, 3, 1000):
            f = SeamFilter(seam, in_code)
            out = "".join(f.feed(text[i:i + step]) for i in range(0, len(text), step)) + f.flush()
            assert out == clean_seam(text, seam, in_code), (text, step)


async def test_continuations_are_capped():
    calls = []

    async def handler(request):
        calls.append(1)
        return SimpleNamespace(result=[_cut(f"part{len(calls)}\n\n")])

    response = await ContinueCutOffAnswer(2).awrap_model_call(Request(messages=[HumanMessage("q")]), handler)
    assert len(calls) == 3
    assert was_cut_off(response.result[0])  # still cut after the last try: returned as is


async def test_complete_replies_and_tool_calls_are_left_alone():
    for reply in (
        AIMessage("Done.", response_metadata={"finish_reason": "stop"}),
        AIMessage("", tool_calls=[{"name": "t", "args": {}, "id": "1"}], response_metadata={"finish_reason": "length"}),
    ):
        calls = []

        async def handler(request, reply=reply):
            calls.append(1)
            return SimpleNamespace(result=[reply])

        response = await ContinueCutOffAnswer(4).awrap_model_call(Request(messages=[HumanMessage("q")]), handler)
        assert len(calls) == 1 and response.result[0] is reply


def test_joining_block_content_keeps_every_block():
    first = AIMessage([{"type": "thinking", "thinking": "t"}, {"type": "text", "text": "a"}])
    joined = join_replies(first, AIMessage("b", response_metadata={"stop_reason": "end_turn"}))
    assert joined.content == [{"type": "thinking", "thinking": "t"}, {"type": "text", "text": "a"}, {"type": "text", "text": "b"}]
    assert joined.id == first.id and joined.response_metadata == {"stop_reason": "end_turn"}


def test_system_notes_never_count_as_the_users_question():
    note = system_note(CONTINUE_NUDGE)
    assert not _is_question(note)
    assert _is_question(HumanMessage("real question"))
    # Trimming keeps the whole current turn, which starts at the user's question.
    call = AIMessage("", tool_calls=[{"name": "t", "args": {}, "id": "1"}])
    turn = [HumanMessage("q2"), call, ToolMessage("r", tool_call_id="1"), _cut("partial"), note]
    history = [HumanMessage("q1"), AIMessage("a1")]
    assert trim_past_turns(history + turn)[2:] == turn


def test_messages_within_budget_are_untouched():
    messages = [HumanMessage("hi"), AIMessage("hello"), HumanMessage("again")]
    assert fit_to_budget(messages, 10_000) is messages


def test_oldest_turns_are_left_out_first_and_a_summary_is_kept():
    summary = HumanMessage("Summary...", additional_kwargs={"lc_source": "summarization"})
    big = "x" * 40_000  # ~10k tokens
    messages = [
        summary,
        HumanMessage("q1 " + big), AIMessage("a1 " + big),
        HumanMessage("q2"), AIMessage("a2"),
        HumanMessage("q3 now"),
    ]
    result = fit_to_budget(messages, 2_000)
    assert [m.content for m in result] == ["Summary...", "q2", "a2", "q3 now"]


def test_a_huge_question_is_shortened_in_the_middle_to_fit():
    question = "START " + "word " * 400_000 + " END"  # ~500k tokens
    result = fit_to_budget([HumanMessage("q1"), AIMessage("a1"), HumanMessage(question)], 50_000)
    assert count_tokens_approximately(result) <= 50_000
    text = result[-1].content
    assert text.startswith("START") and text.endswith("END") and "characters left out" in text


def test_huge_tool_results_are_shortened_and_calls_stay_paired():
    call = AIMessage("", tool_calls=[{"name": "search", "args": {}, "id": "c1"}])
    result_text = "row\n" * 300_000
    messages = [HumanMessage("find it"), call, ToolMessage(result_text, tool_call_id="c1")]
    result = fit_to_budget(messages, 20_000)
    assert count_tokens_approximately(result) <= 20_000
    assert result[1].tool_calls == call.tool_calls and result[2].tool_call_id == "c1"
    assert result[0].content == "find it"


def test_block_content_is_shortened_without_losing_other_blocks():
    image = {"type": "image", "url": "https://example.com/a.png"}
    question = HumanMessage([image, {"type": "text", "text": "y" * 400_000}])
    result = fit_to_budget([question], 10_000)
    assert result[0].content[0] == image
    assert count_tokens_approximately(result) <= 10_000


def _stream(projector, run_id, text):
    projector.handle({
        "event": "on_chat_model_stream", "run_id": run_id,
        "metadata": {"langgraph_node": "model", "lc_agent_name": PARENT_AGENT_NAME},
        "data": {"chunk": SimpleNamespace(content=text, text=text)},
    })


def _continue(projector, line, agent=PARENT_AGENT_NAME):
    projector.handle({
        "event": "on_custom_event", "name": CONTINUE_EVENT, "run_id": "x",
        "metadata": {"langgraph_node": "model", "lc_agent_name": agent}, "data": {"rewind": line},
    })


def test_the_chat_drops_the_unfinished_line_before_it_is_rewritten():
    events = []
    projector = StreamProjector(events.append)
    for token in ["<div>\n", "<p>Hel", "lo</"]:  # "</" is held back: it could start a tag
        _stream(projector, "run-1", token)
    _continue(projector, "<p>Hello</")
    _stream(projector, "run-2", "<p>Hello</p>\n</div>")
    projector.finish()

    assert "".join(projector.content_tokens) == "<div>\n<p>Hello</p>\n</div>"
    shown = ""
    for event in events:
        if event["event_type"] == "token":
            shown += event["data"]["content"]
        elif event["event_type"] == "answer_rewind":
            assert shown.endswith(event["data"]["text"])
            shown = shown[: len(shown) - len(event["data"]["text"])]
    assert shown == "".join(projector.content_tokens)


def test_a_line_that_was_never_shown_is_not_dropped():
    events = []
    projector = StreamProjector(events.append)
    _stream(projector, "run-1", "Answer line\nsecond")
    _continue(projector, "something else")
    assert "".join(projector.content_tokens) == "Answer line\nsecond"
    assert not any(e["event_type"] == "answer_rewind" for e in events)
    _continue(projector, "second", agent="a_specialist")  # no visible text of its own
    assert "".join(projector.content_tokens) == "Answer line\nsecond"


def test_the_chat_drops_a_second_code_fence_opened_by_a_continuation():
    events = []
    projector = StreamProjector(events.append)
    _stream(projector, "run-1", "```html\n<script>\nlet x =")
    projector.handle({
        "event": "on_custom_event", "name": CONTINUE_EVENT, "run_id": "x",
        "metadata": {"langgraph_node": "model", "lc_agent_name": PARENT_AGENT_NAME},
        "data": {"rewind": "let x =", "in_code": True},
    })
    for token in ["```", "javascript\n", "let x = 1;\n", "</script>\n```"]:
        _stream(projector, "run-2", token)
    projector.finish()
    assert "".join(projector.content_tokens) == "```html\n<script>\nlet x = 1;\n</script>\n```"



class _Unavailable(Exception):
    """Stands in for a provider's "503 UNAVAILABLE" (recognised by its text)."""


async def test_a_reply_failing_part_way_is_made_again():
    from abyss_agents.middleware import RestartFailedReply

    calls = []

    async def handler(request):
        calls.append(1)
        if len(calls) < 3:
            raise _Unavailable("503 UNAVAILABLE: This model is currently experiencing high demand.")
        return SimpleNamespace(result=[AIMessage("Complete answer.")])

    response = await RestartFailedReply(delays=(0, 0)).awrap_model_call(Request(messages=[]), handler)
    assert response.result[0].content == "Complete answer." and len(calls) == 3


async def test_other_errors_and_too_many_failures_are_raised():
    import pytest

    from abyss_agents.middleware import RestartFailedReply

    async def bad_key(request):
        raise ValueError("Invalid API key")

    with pytest.raises(ValueError):
        await RestartFailedReply(delays=(0, 0)).awrap_model_call(Request(messages=[]), bad_key)

    calls = []

    async def always_down(request):
        calls.append(1)
        raise _Unavailable("503 UNAVAILABLE")

    with pytest.raises(_Unavailable):
        await RestartFailedReply(delays=(0, 0, 0)).awrap_model_call(Request(messages=[]), always_down)
    assert len(calls) == 4  # the first try + one per delay


def _custom(projector, name, data):
    projector.handle({
        "event": "on_custom_event", "name": name, "run_id": "x",
        "metadata": {"langgraph_node": "model", "lc_agent_name": PARENT_AGENT_NAME}, "data": data,
    })


async def test_the_chat_keeps_what_a_failed_call_showed_and_continues_it():
    import asyncio

    from abyss_agents.middleware import CALL_START_EVENT, RESUME_EVENT, _resume_requests

    events = []
    projector = StreamProjector(events.append)
    projector.content_tokens.append("Earlier text.\n")  # an earlier model call of the turn
    _custom(projector, CALL_START_EVENT, {})
    _stream(projector, "run-1", "```html\n<div>\n<p>hal")  # the provider fails here
    future = asyncio.get_running_loop().create_future()
    _resume_requests["r1"] = future
    _custom(projector, RESUME_EVENT, {"request_id": "r1"})
    shown = future.result()
    # Only this call's text, minus its unfinished line (taken back to be rewritten).
    assert shown["text"] == "```html\n<div>\n" and shown["line"] == "<p>hal" and shown["in_code"]
    # The next try rewrites the line (a reopened fence and a repeated line are dropped).
    _stream(projector, "run-2", "```html\n<p>half done</p>\n</div>\n```")
    projector.finish()
    # A new call's text starts a new paragraph after the earlier call's (the retry joins seamlessly).
    assert "".join(projector.content_tokens) == "Earlier text.\n\n```html\n<div>\n<p>half done</p>\n</div>\n```"
    seen = "Earlier text.\n"
    for event in events:
        if event["event_type"] == "token":
            seen += event["data"]["content"]
        elif event["event_type"] == "answer_rewind":
            assert seen.endswith(event["data"]["text"])
            seen = seen[: len(seen) - len(event["data"]["text"])]
    assert seen == "".join(projector.content_tokens)


async def test_a_retry_continues_the_shown_text_into_one_reply(monkeypatch):
    import abyss_agents.middleware as mw

    async def shown(*_):
        return {"text": "Install Python 3.12\nCreate a virtual env\n", "line": "Then run", "tail": "Install Python 3.12\nCreate a virtual env\n", "in_code": False}

    monkeypatch.setattr(mw, "_shown_by_failed_call", shown)
    seen = []

    async def handler(request):
        seen.append(request.messages)
        if len(seen) == 1:
            raise _Unavailable("503 UNAVAILABLE")
        return SimpleNamespace(result=[AIMessage("Create a virtual env\nThen run the app.")])  # repeats a line: dropped

    response = await mw.RestartFailedReply(delays=(0,), visible=True).awrap_model_call(Request(messages=[]), handler)
    assert response.result[0].content == "Install Python 3.12\nCreate a virtual env\nThen run the app."
    assert seen[1][-2].content == "Install Python 3.12\nCreate a virtual env\n"
    assert "connection problem" in seen[1][-1].content and "Then run" in seen[1][-1].content


def test_provider_outages_are_recognised_from_their_text():
    """Regression: the pattern once held backspace characters instead of \b,
    so "503" / "UNAVAILABLE" were never recognised."""
    from utils.llm_providers import classify_llm_error

    for text in ("503 UNAVAILABLE", "Error code: 529 - overloaded", "Service Unavailable"):
        assert classify_llm_error(_Unavailable(text))[0] == "provider_unavailable", text
    assert classify_llm_error(_Unavailable("15030 tokens used"))[0] is None
