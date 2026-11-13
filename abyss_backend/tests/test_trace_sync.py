"""Shaping LangSmith runs into Tracing rows (services/trace_sync.py)."""
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace
from uuid import uuid4

from services import trace_sync as ts

T0 = datetime(2026, 11, 13, 10, 0, 0, tzinfo=timezone.utc)


def run(name, run_type, dotted, parent=None, *, start=0.0, end=1.0, trace_id=None, **kw):
    return SimpleNamespace(
        id=kw.pop("id", uuid4()), trace_id=trace_id, parent_run_id=parent, name=name, run_type=run_type,
        dotted_order=dotted, start_time=T0 + timedelta(seconds=start),
        end_time=None if end is None else T0 + timedelta(seconds=end),
        error=kw.pop("error", None), inputs=kw.pop("inputs", {}), outputs=kw.pop("outputs", {}),
        prompt_tokens=kw.pop("prompt_tokens", None), completion_tokens=kw.pop("completion_tokens", None),
        total_tokens=kw.pop("total_tokens", None), total_cost=kw.pop("total_cost", None),
        extra=kw.pop("extra", {}), tags=kw.pop("tags", []), app_path=kw.pop("app_path", None),
    )


def lc(kind, content, **kwargs):
    return {"lc": 1, "type": "constructor", "id": ["langchain", "schema", "messages", kind],
            "kwargs": {"content": content, **kwargs}}


def sample_trace(user="u1", end=4.0):
    root_id = uuid4()
    root = run("abyss.agent_turn", "chain", "20261113T100000000000Z" + str(root_id), id=root_id,
               trace_id=root_id, end=end,
               inputs={"messages": [{"type": "human", "content": "What is Abyss?"}]},
               outputs={"messages": [{"type": "human", "content": "What is Abyss?"},
                                     {"type": "ai", "content": "A no-code agent platform."}]},
               extra={"metadata": {"user_id": user, "thread_id": "t1", "agent_name": "Guide",
                                   "abyss_kind": "agent_turn", "noise": "x" * 50}},
               app_path="/o/org/projects/p/proj/r/run")
    base = root.dotted_order
    llm = run("ChatGoogleGenerativeAI", "llm", base + ".20261113T100001Z" + "a", parent=root_id, trace_id=root_id,
              start=1, end=2.5, prompt_tokens=100, completion_tokens=20, total_tokens=120, total_cost=0.0005,
              inputs={"messages": [[lc("SystemMessage", "be brief"), lc("HumanMessage", "What is Abyss?")]]},
              outputs={"generations": [[{"text": "", "message": lc("AIMessage", [{"type": "text", "text": "A no-code agent platform."}],
                                                                       tool_calls=[{"name": "search", "args": {"q": "abyss"}}])}]]},
              extra={"metadata": {"ls_model_name": "gemini-3.5-flash-lite", "langgraph_node": "model"}})
    tool = run("search", "tool", base + ".20261113T100002Z" + "b", parent=root_id, trace_id=root_id,
               start=2.6, end=3.0, inputs={"input": "abyss"}, error="timeout")
    return root, [tool, root, llm]  # deliberately out of order


def test_spans_in_execution_order_with_depth():
    root, runs = sample_trace()
    spans = ts.build_spans(runs)
    assert [s["run_type"] for s in spans] == ["chain", "llm", "tool"]
    assert [s["depth"] for s in spans] == [0, 1, 1]
    assert [s["position"] for s in spans] == [0, 1, 2]
    assert spans[1]["latency_ms"] == 1500
    assert spans[1]["start_time"].tzinfo is None  # stored as naive UTC


def test_llm_messages_are_normalised():
    _, runs = sample_trace()
    llm = next(s for s in ts.build_spans(runs) if s["run_type"] == "llm")
    assert llm["inputs"] == {"messages": [{"role": "system", "content": "be brief"},
                                          {"role": "user", "content": "What is Abyss?"}]}
    out = llm["outputs"]["messages"][0]
    assert out["role"] == "assistant" and out["content"] == "A no-code agent platform."
    assert out["tool_calls"] == [{"name": "search", "args": {"q": "abyss"}}]
    assert llm["model"] == "gemini-3.5-flash-lite"
    assert llm["meta"] == {"ls_model_name": "gemini-3.5-flash-lite", "langgraph_node": "model"}


def test_summary_totals_and_previews():
    root, runs = sample_trace()
    spans = ts.build_spans(runs)
    summary = ts.summarize(root, spans)
    assert summary["name"] == "Guide" and summary["kind"] == "agent_turn"
    assert summary["thread_id"] == "t1"
    assert summary["status"] == "success"           # tool error was handled
    assert summary["error_count"] == 1
    assert (summary["llm_calls"], summary["tool_calls"], summary["span_count"]) == (1, 1, 3)
    assert summary["total_tokens"] == 120 and summary["total_cost"] == 0.0005
    assert summary["models"] == ["gemini-3.5-flash-lite"]
    assert summary["input_preview"] == "What is Abyss?"
    assert summary["output_preview"] == "A no-code agent platform."
    assert summary["latency_ms"] == 4000 and summary["complete"] is True
    assert summary["langsmith_url"] == "https://smith.langchain.com/o/org/projects/p/proj/r/run"


def test_unfinished_trace_is_not_complete():
    root, runs = sample_trace(end=None)
    summary = ts.summarize(root, ts.build_spans(runs))
    assert summary["complete"] is False and summary["status"] == "pending"


def test_large_payloads_are_trimmed():
    value, cut = ts.trim_payload({"text": "x" * 50_000}, limit=1_000)
    assert cut is True and len(value["_truncated"]) == 1_000
    small, cut = ts.trim_payload({"a": 1})
    assert small == {"a": 1} and cut is False


async def test_trace_of_another_user_is_never_stored(monkeypatch):
    root, runs = sample_trace(user="someone-else")
    monkeypatch.setattr(ts.ls, "fetch_trace_runs", lambda trace_id: runs)
    stored = []

    async def fake_store(*args):
        stored.append(args)

    monkeypatch.setattr(ts, "_store", fake_store)
    assert await ts.sync_trace(str(root.id), "u1") is None
    assert stored == []


def test_title_trace_preview_is_the_users_message():
    assert ts._title_subject('Message: """Plan a trip to Goa"""\nTitle:') == "Plan a trip to Goa"
    assert ts._title_subject('Message: """A very long question cut off by the preview') == "A very long question cut off by the preview"
    assert ts._title_subject("plain text") == "plain text"
