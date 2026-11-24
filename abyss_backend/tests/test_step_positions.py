"""Where each step of a turn happened: the chat shows a turn step by step
(think, use a tool, answer part one, use another tool, answer part two), so
every step records `at` -- the answer length when it began -- live and in the
saved step log, and separate model calls' text stays separate paragraphs."""

from types import SimpleNamespace

from langchain_core.messages import AIMessage, ToolMessage

from abyss_agents.factory import PARENT_AGENT_NAME
from services.stream_projector import StreamProjector, _paragraph_break

SPECIALIST = "research_specialist"


def _meta(agent=PARENT_AGENT_NAME, node="model", ns=""):
    return {"langgraph_node": node, "lc_agent_name": agent, "langgraph_checkpoint_ns": ns}


def _say(projector, run_id, text, agent=PARENT_AGENT_NAME, ns=""):
    projector.handle({
        "event": "on_chat_model_stream", "run_id": run_id, "metadata": _meta(agent, ns=ns),
        "data": {"chunk": SimpleNamespace(content=text, text=text)},
    })


def _end(projector, run_id, message=None, agent=PARENT_AGENT_NAME):
    projector.handle({
        "event": "on_chat_model_end", "run_id": run_id, "metadata": _meta(agent),
        "data": {"output": message or AIMessage("")},
    })


def _tool(projector, run_id, name, output="result", agent=PARENT_AGENT_NAME, ns=""):
    meta = _meta(agent, node="tools", ns=ns)
    projector.handle({"event": "on_tool_start", "run_id": run_id, "name": name, "metadata": meta,
                      "data": {"input": {"query": "q"}}})
    projector.handle({"event": "on_tool_end", "run_id": run_id, "name": name, "metadata": meta,
                      "data": {"output": ToolMessage(output, tool_call_id=run_id)}})


def _two_part_turn(events):
    projector = StreamProjector(events.append, sub_agent_names={SPECIALIST})
    _say(projector, "m1", "<reasoning>Research part one first.</reasoning>")
    _end(projector, "m1")
    _tool(projector, "t1", "web_search")
    _say(projector, "m2", "<reasoning>Got it.</reasoning>Part one answer.")
    _end(projector, "m2")
    _tool(projector, "t2", "web_search")
    _say(projector, "m3", "<reasoning>Now part two.</reasoning>Part two answer.")
    _end(projector, "m3")
    projector.finish()
    return projector


def test_every_step_records_where_in_the_answer_it_happened():
    events = []
    projector = _two_part_turn(events)
    answer = "".join(projector.content_tokens)
    assert answer == "Part one answer.\n\nPart two answer."
    steps = [(s["step"], s["at"]) for s in projector.reasoning_steps]
    part_two = answer.index("Part two")
    # Thought + search before any text; thought before part one; search and thought after it.
    assert steps == [("thought", 0), ("tool_call", 0), ("thought", 0),
                     ("tool_call", len("Part one answer.")), ("thought", len("Part one answer."))]
    assert all(at <= part_two for _, at in steps)


def test_live_events_carry_the_same_positions():
    events = []
    projector = _two_part_turn(events)
    live = [(e["event_type"], e["data"]["at"]) for e in events if e["event_type"] in ("reasoning_start", "tool_start")]
    saved = [s["at"] for s in projector.reasoning_steps]
    assert [at for _, at in live] == saved


def test_text_before_handing_work_to_a_specialist_is_kept():
    events = []
    projector = StreamProjector(events.append, sub_agent_names={SPECIALIST})
    _say(projector, "m1", "I'll look into the first part.")
    _end(projector, "m1", AIMessage("I'll look into the first part.", tool_calls=[
        {"name": SPECIALIST, "args": {"task": "Research part one"}, "id": "c1"}]))
    meta = _meta(PARENT_AGENT_NAME, node="tools")
    projector.handle({"event": "on_tool_start", "run_id": "s1", "name": SPECIALIST, "metadata": meta,
                      "data": {"input": {"task": "Research part one"}}})
    projector.handle({"event": "on_tool_end", "run_id": "s1", "name": SPECIALIST, "metadata": meta,
                      "data": {"output": "findings"}})
    _say(projector, "m2", "Here is part one.")
    projector.finish()
    assert "".join(projector.content_tokens) == "I'll look into the first part.\n\nHere is part one."
    dispatch = next(s for s in projector.reasoning_steps if s["step"] == "dispatch_decision")
    assert dispatch["at"] == len("I'll look into the first part.")


def test_a_cut_off_continuation_joins_without_a_paragraph_break():
    from abyss_agents.middleware import CONTINUE_EVENT

    projector = StreamProjector([].append)
    _say(projector, "m1", "First line\nsecond li")
    projector.handle({"event": "on_custom_event", "name": CONTINUE_EVENT, "run_id": "x",
                      "metadata": _meta(), "data": {"rewind": "second li"}})
    _say(projector, "m2", "second line done.")
    projector.finish()
    assert "".join(projector.content_tokens) == "First line\nsecond line done."


def test_paragraph_breaks_are_never_doubled():
    assert _paragraph_break("a", "b") == "\n\n"
    assert _paragraph_break("a\n", "b") == "\n"
    assert _paragraph_break("a\n\n", "b") == ""
    assert _paragraph_break("a", "\nb") == "\n"
    assert _paragraph_break("a", "\n\nb") == ""


def test_steps_left_open_by_a_stop_still_get_a_position():
    projector = StreamProjector([].append)
    _say(projector, "m1", "Answer so far. <reasoning>Still thinking about")
    flushed = projector.steps_for_flush()
    assert flushed[-1]["partial"] and flushed[-1]["at"] == len("Answer so far. ")
    projector.abort()
    assert projector.reasoning_steps[-1]["at"] == len("Answer so far. ")


def test_a_running_tool_call_shows_its_input_live():
    events = []
    projector = StreamProjector(events.append)
    _tool(projector, "t1", "web_search")
    start = next(e for e in events if e["event_type"] == "tool_start")
    assert start["data"]["input"] == '{"query": "q"}'


def test_a_tool_that_declares_itself_a_background_step_carries_its_status():
    from abyss_agents.images import search_images
    from abyss_agents.tool_display import BACKGROUND, background_status
    from abyss_agents.visual_formats import get_visual_format

    # The built-in preparation tools declare it themselves; the chat needs no names.
    assert all(background_status(t.metadata) for t in (search_images, get_visual_format))

    events = []
    projector = StreamProjector(events.append)
    meta = {**_meta(PARENT_AGENT_NAME, node="tools"), BACKGROUND: "Finding images…"}
    projector.handle({"event": "on_tool_start", "run_id": "t1", "name": "any_tool", "metadata": meta, "data": {"input": {"q": "x"}}})
    projector.handle({"event": "on_tool_end", "run_id": "t1", "name": "any_tool", "metadata": meta,
                      "data": {"output": ToolMessage("[]", tool_call_id="t1")}})
    _tool(projector, "t2", "web_search")  # an ordinary tool: no mark
    by_type = [(e["event_type"], e["data"].get("background")) for e in events if e["event_type"] in ("tool_start", "tool_end")]
    assert by_type == [("tool_start", "Finding images…"), ("tool_end", "Finding images…"), ("tool_start", None), ("tool_end", None)]
    assert [s.get("background") for s in projector.reasoning_steps if s["step"] == "tool_call"] == ["Finding images…", None]
