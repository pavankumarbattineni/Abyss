"""What the main agent sees of earlier turns, and when it summarizes
(abyss_agents/history.py)."""

from types import SimpleNamespace

from langchain_core.language_models.fake_chat_models import FakeListChatModel
from langchain_core.messages import AIMessage, HumanMessage, ToolMessage

import constants
from abyss_agents import history as h


def call(name, call_id, text=""):
    return AIMessage(text, tool_calls=[{"name": name, "args": {"task": "t"}, "id": call_id}])


def summary(text="earlier stuff"):
    return HumanMessage(h.SUMMARY_PREFIX + text, additional_kwargs={"lc_source": "summarization"})


def contents(messages):
    return [(type(m).__name__, m.content) for m in messages]


def two_turns():
    return [
        HumanMessage("Create an arithmetic calculator."),
        call("formula_specialist", "c1", "<reasoning>delegate</reasoning>"),
        ToolMessage("formulas: a+b, a-b", tool_call_id="c1"),
        AIMessage("<reasoning>build it</reasoning>Here is your calculator."),
        HumanMessage("Create a BMI calculator."),
    ]


def test_first_turn_is_untouched():
    first = two_turns()[:4]
    assert h.trim_past_turns(first) == first


def test_earlier_turns_become_question_and_answer():
    assert contents(h.trim_past_turns(two_turns())) == [
        ("HumanMessage", "Create an arithmetic calculator."),
        ("AIMessage", "Here is your calculator."),
        ("HumanMessage", "Create a BMI calculator."),
    ]


def test_current_turn_keeps_its_tool_calls_and_results():
    messages = two_turns() + [call("formula_specialist", "c2"), ToolMessage("bmi = kg/m2", tool_call_id="c2")]
    trimmed = h.trim_past_turns(messages)
    assert contents(trimmed[3:]) == [
        ("AIMessage", ""), ("ToolMessage", "bmi = kg/m2"),
    ] and trimmed[3].tool_calls[0]["id"] == "c2"
    # No result is left without its call, and no call without its result.
    ids = {c["id"] for m in trimmed if isinstance(m, AIMessage) for c in m.tool_calls}
    assert {m.tool_call_id for m in trimmed if isinstance(m, ToolMessage)} == ids == {"c2"}


def test_paused_approval_is_part_of_the_current_turn():
    messages = two_turns() + [call("delete_file", "c9")]  # waiting for the user's decision
    assert h.trim_past_turns(messages)[-1].tool_calls[0]["id"] == "c9"


def test_text_beside_a_tool_call_and_several_reasoning_blocks_are_dropped():
    messages = [
        HumanMessage("q1"),
        call("x", "a", "Let me check."),
        ToolMessage("r", tool_call_id="a"),
        AIMessage("<reasoning>one</reasoning><call>fake</call><reasoning>two</reasoning>Answer one."),
        HumanMessage("q2"),
    ]
    assert contents(h.trim_past_turns(messages)) == [
        ("HumanMessage", "q1"), ("AIMessage", "<call>fake</call>Answer one."), ("HumanMessage", "q2"),
    ]


def test_native_thinking_blocks_are_removed():
    answer = AIMessage([{"type": "thinking", "thinking": "hmm"}, {"type": "text", "text": "Done."}])
    trimmed = h.trim_past_turns([HumanMessage("q1"), answer, HumanMessage("q2")])
    assert trimmed[1].content == [{"type": "text", "text": "Done."}]


def test_cancelled_turn_without_answer_keeps_the_question():
    messages = [HumanMessage("q1"), call("x", "a"), ToolMessage("r", tool_call_id="a"), HumanMessage("q2")]
    assert contents(h.trim_past_turns(messages)) == [("HumanMessage", "q1"), ("HumanMessage", "q2")]


def test_summary_message_is_kept_and_not_mistaken_for_a_question():
    messages = [summary(), HumanMessage("q1"), AIMessage("a1"), HumanMessage("q2")]
    trimmed = h.trim_past_turns(messages)
    assert h.is_summary(trimmed[0]) and contents(trimmed[1:]) == [
        ("HumanMessage", "q1"), ("AIMessage", "a1"), ("HumanMessage", "q2"),
    ]


def test_threshold_is_the_smaller_of_cap_and_window_fraction(monkeypatch):
    monkeypatch.setattr(constants, "SUMMARY_TOKEN_CAP", 40_000)
    big = SimpleNamespace(profile={"max_input_tokens": 1_000_000})
    small = SimpleNamespace(profile={"max_input_tokens": 32_000})
    unknown = SimpleNamespace(profile=None, model="claude-haiku-4-5-20251001")
    assert h.summary_threshold(big) == 40_000
    assert h.summary_threshold(small) == int(32_000 * constants.SUMMARIZATION_TRIGGER_FRACTION)
    assert h.context_window(unknown) == 200_000
    assert h.context_window(SimpleNamespace(profile=None, model="new-model")) == constants.DEFAULT_CONTEXT_WINDOW


async def test_summarizes_only_at_the_start_of_a_turn(monkeypatch):
    calls = []

    async def fake_parent(self, state, runtime):
        calls.append(len(state["messages"]))
        return None

    monkeypatch.setattr(h.SummarizationMiddleware, "abefore_model", fake_parent)
    middleware = h.TurnStartSummarization(FakeListChatModel(responses=["summary"], profile={"max_input_tokens": 1_000_000}))
    mid_turn = {"messages": two_turns() + [call("x", "z"), ToolMessage("r", tool_call_id="z")]}
    await middleware.abefore_model(mid_turn, None)
    assert calls == []  # a tool result is last: mid-turn, left alone
    await middleware.abefore_model({"messages": two_turns()}, None)
    assert calls == [5]  # a new question is last: checked


def test_summarizer_reads_the_whole_history_and_counts_the_trimmed_view():
    middleware = h.TurnStartSummarization(FakeListChatModel(responses=["summary"], profile={"max_input_tokens": 1_000_000}))
    assert middleware.trim_tokens_to_summarize == constants.SUMMARY_INPUT_TOKEN_LIMIT > 4_000
    full = two_turns()
    assert middleware.token_counter(full) < h.count_tokens_approximately(full)
