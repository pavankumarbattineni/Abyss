"""Replies that neither act nor answer: retried once, and written-out tool calls
kept out of the visible answer (utils/fake_tool_call.py, ActOrAnswerGuard)."""

from types import SimpleNamespace

from langchain_core.messages import AIMessage, HumanMessage

from abyss_agents.middleware import ACT_OR_ANSWER_NUDGE, ActOrAnswerGuard, _needs_another_try
from utils.fake_tool_call import CallTextFilter, has_written_call, strip_written_calls

FAKE = "<call>default_api:formula_specialist{task:BMI}</call>"


def stream(chunks):
    f = CallTextFilter()
    return "".join(f.feed(c) for c in chunks) + f.flush()


def test_written_call_is_removed_even_when_split_across_chunks():
    text = "Intro. " + FAKE + " Here is the answer."
    assert stream([text]) == "Intro.  Here is the answer."
    assert stream([c for c in text]) == "Intro.  Here is the answer."  # one char at a time
    assert stream(["Intro. <ca", "ll>default_api:x{}</ca", "ll> Done."]) == "Intro.  Done."


def test_normal_text_and_lookalikes_pass_through():
    assert stream(["a < b and <cal", "endar> stays"]) == "a < b and <calendar> stays"
    assert stream(["ends with <"]) == "ends with <"


def test_unclosed_written_call_is_dropped():
    assert stream(["Answer. <call>default_api:x{half"]) == "Answer. "


def test_written_call_detection():
    assert has_written_call(FAKE)
    assert has_written_call("print(default_api.formula_specialist(task='x'))")
    assert not has_written_call("The default API returns JSON.")
    assert strip_written_calls("a " + FAKE + " b") == "a  b"


def test_which_replies_get_another_try():
    real_call = AIMessage("", tool_calls=[{"name": "t", "args": {}, "id": "1"}])
    assert not _needs_another_try(real_call)
    assert not _needs_another_try(AIMessage("<reasoning>ok</reasoning>Here is your answer."))
    assert _needs_another_try(AIMessage("<reasoning>I will delegate to the specialist.</reasoning>"))
    assert _needs_another_try(AIMessage("<reasoning>x</reasoning>" + FAKE + "<reasoning>done</reasoning>Answer."))
    assert _needs_another_try(AIMessage(""))


async def test_guard_asks_once_more_with_a_note_then_returns():
    seen = []
    replies = [AIMessage("<reasoning>I will call the tool.</reasoning>"), AIMessage("Final answer.")]

    async def handler(request):
        seen.append(request.messages)
        return SimpleNamespace(result=[replies[len(seen) - 1]])

    class Request(SimpleNamespace):
        def override(self, **kw):
            return Request(**{**self.__dict__, **kw})

    response = await ActOrAnswerGuard().awrap_model_call(Request(messages=[HumanMessage("q")]), handler)
    assert response.result[0].content == "Final answer."
    assert len(seen) == 2 and seen[1][-1].content == ACT_OR_ANSWER_NUDGE


async def test_guard_leaves_good_replies_alone():
    calls = []

    async def handler(request):
        calls.append(1)
        return SimpleNamespace(result=[AIMessage("Here you go.")])

    await ActOrAnswerGuard().awrap_model_call(SimpleNamespace(messages=[]), handler)
    assert calls == [1]
