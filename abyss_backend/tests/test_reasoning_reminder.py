"""Prompt-protocol reasoning: the instruction is repeated after the latest question (view only)."""

from types import SimpleNamespace

from langchain_core.messages import AIMessage, HumanMessage, ToolMessage

from abyss_agents.middleware import (
    REASONING_REMINDER,
    ReasoningReminderMiddleware,
    with_reasoning_reminder,
)


def test_reminder_follows_the_latest_question_only():
    first = HumanMessage("Earlier question")
    question = HumanMessage("Explain attention. Answer in sections A) to E).")
    messages = [first, AIMessage("Earlier answer"), question]

    view = with_reasoning_reminder(messages)

    assert view[0].content == "Earlier question"
    assert view[-1].content == question.content + REASONING_REMINDER
    assert "<reasoning>" in REASONING_REMINDER
    # The saved conversation is untouched.
    assert question.content.endswith("E).") and messages[-1] is question


def test_reminder_survives_tool_steps_within_the_turn():
    question = HumanMessage("Find the open issues")
    messages = [question, AIMessage("", tool_calls=[{"name": "list", "args": {}, "id": "c1"}]),
                ToolMessage("[]", tool_call_id="c1")]
    view = with_reasoning_reminder(messages)
    assert view[0].content.endswith(REASONING_REMINDER)
    assert view[1:] == messages[1:]


def test_summaries_are_not_treated_as_the_question():
    summary = HumanMessage("Summary of the conversation", additional_kwargs={"lc_source": "summarization"})
    assert with_reasoning_reminder([summary]) == [summary]


def test_multimodal_questions_get_a_text_block():
    question = HumanMessage([{"type": "text", "text": "What is in this image?"}])
    view = with_reasoning_reminder([question])
    assert view[0].content[-1] == {"type": "text", "text": REASONING_REMINDER}


async def test_middleware_passes_the_reminded_view_to_the_model():
    seen = {}

    class Request(SimpleNamespace):
        def override(self, **changes):
            return Request(**{**vars(self), **changes})

    async def handler(request):
        seen["messages"] = request.messages
        return "ok"

    original = [HumanMessage("Hi")]
    result = await ReasoningReminderMiddleware().awrap_model_call(Request(messages=original), handler)

    assert result == "ok"
    assert seen["messages"][-1].content == "Hi" + REASONING_REMINDER
    assert original[0].content == "Hi"
