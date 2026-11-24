"""A slow model or provider never stalls an answer for minutes, and never costs
the answer its database connection."""
import asyncio
import inspect

import pytest

from abyss_agents import middleware
from abyss_agents.middleware import MODEL_ACTIVITY, ModelActivity, RestartFailedReply, is_passing_provider_error
from services import chat_service
from utils.llm_providers import ModelStalled, classify_llm_error


# --- the database connection (fix: no transaction held while the model runs) ---

def test_the_setup_transaction_ends_before_the_model_runs():
    """Neon closes a connection left idle in a transaction for 5 minutes; a
    run that held its setup transaction open through a slow model lost the
    connection and failed at its first save."""
    source = inspect.getsource(chat_service._run_generation)
    setup_ends = source.index("await session.commit()\n\n            # Every model chunk")
    assert setup_ends < source.index("graph.astream_events(")
    assert source.index("build_agent(") < setup_ends  # after the last setup read


@pytest.mark.parametrize(
    ("new_tokens", "seconds", "changed", "due"),
    [
        (50, 0, False, True),     # a full batch of tokens
        (10, 11, True, True),     # slow but moving: steps, tool results
        (0, 11, True, True),
        (10, 3, True, False),     # moving, not yet time
        (0, 600, False, False),   # nothing new: nothing to save
    ],
)
def test_progress_is_saved_by_tokens_or_by_time(new_tokens, seconds, changed, due):
    assert chat_service._progress_due(new_tokens, seconds, changed) is due


# --- the silent model (fix: give up on a call that produces nothing) ---

async def test_a_silent_model_call_is_given_up(monkeypatch):
    monkeypatch.setattr(middleware, "MODEL_SILENCE_SECONDS", 0.1)
    MODEL_ACTIVITY.set(ModelActivity())
    hung = asyncio.Event()

    async def call():
        await hung.wait()  # a provider holding the request open

    with pytest.raises(ModelStalled):
        await asyncio.wait_for(middleware._within_silence_limit(call()), 2)


async def test_a_long_answer_that_keeps_streaming_is_never_cut(monkeypatch):
    monkeypatch.setattr(middleware, "MODEL_SILENCE_SECONDS", 0.15)
    activity = ModelActivity()
    MODEL_ACTIVITY.set(activity)

    async def streaming_answer():
        for _ in range(8):  # 0.4 s in all, far beyond the silence limit
            await asyncio.sleep(0.05)
            activity.touch()
        return "the whole answer"

    assert await middleware._within_silence_limit(streaming_answer()) == "the whole answer"


async def test_without_a_run_clock_the_call_is_just_awaited(monkeypatch):
    monkeypatch.setattr(middleware, "MODEL_SILENCE_SECONDS", 0.01)
    MODEL_ACTIVITY.set(None)

    async def slow():
        await asyncio.sleep(0.05)
        return "ok"

    assert await middleware._within_silence_limit(slow()) == "ok"


def test_a_stalled_call_is_a_passing_timeout_with_a_clear_message():
    code, message = classify_llm_error(ModelStalled("no output"))
    assert code == "provider_timeout" and "stopped responding" in message
    assert is_passing_provider_error(ModelStalled("no output"))


async def test_a_stalled_call_is_tried_again(monkeypatch):
    monkeypatch.setattr(middleware, "MODEL_SILENCE_SECONDS", 0.05)
    MODEL_ACTIVITY.set(ModelActivity())
    calls = []

    async def handler(request):
        calls.append(request)
        if len(calls) == 1:
            await asyncio.Event().wait()  # the first try hangs
        return "answered"

    restart = RestartFailedReply(delays=(0.0,))
    assert await asyncio.wait_for(restart.awrap_model_call("request", handler), 2) == "answered"
    assert len(calls) == 2


def test_gemini_high_demand_reads_as_busy():
    from google.genai.errors import ServerError

    error = ServerError(503, {"error": {"code": 503, "message": "high demand", "status": "UNAVAILABLE"}})
    code, message = classify_llm_error(error)
    assert code == "provider_unavailable" and "busy" in message


# --- reopening a thread (fix: the page reconnects to an answer in progress) ---

class _Rows:
    def __init__(self, value):
        self.value = value

    def scalar_one_or_none(self):
        return self.value


class _Session:
    """Answers the ownership check, then the latest active run."""

    def __init__(self, *values):
        self.values = list(values)

    async def execute(self, _statement):
        return _Rows(self.values.pop(0))


def _record(status="RUNNING", seconds_ago=1):
    from datetime import timedelta

    from database.models import StreamRecord, utcnow

    at = utcnow() - timedelta(seconds=seconds_ago)
    return StreamRecord(id="s1", thread_id="t1", status=status, created_at=at, updated_at=at)


async def test_a_running_answer_is_found_for_its_thread(monkeypatch):
    monkeypatch.setattr(chat_service.stream_manager, "is_task_running", lambda _id: True)
    active = await chat_service.ChatService().get_active_stream(_Session("t1", _record()), "t1", "u1")
    assert (active.stream_id, active.status) == ("s1", "RUNNING")


async def test_an_answer_waiting_for_approval_is_found_too(monkeypatch):
    monkeypatch.setattr(chat_service.stream_manager, "is_task_running", lambda _id: False)
    active = await chat_service.ChatService().get_active_stream(
        _Session("t1", _record("AWAITING_APPROVAL", seconds_ago=3600)), "t1", "u1"
    )
    assert active.status == "AWAITING_APPROVAL"  # a pause, not a lost run


async def test_a_run_nothing_works_on_any_more_is_not_offered(monkeypatch):
    monkeypatch.setattr(chat_service.stream_manager, "is_task_running", lambda _id: False)
    active = await chat_service.ChatService().get_active_stream(_Session("t1", _record(seconds_ago=3600)), "t1", "u1")
    assert active.stream_id is None and active.status is None


async def test_no_run_no_stream():
    active = await chat_service.ChatService().get_active_stream(_Session("t1", None), "t1", "u1")
    assert active.stream_id is None


async def test_someone_elses_thread_is_not_found():
    from utils.errors import NotFoundError

    with pytest.raises(NotFoundError):
        await chat_service.ChatService().get_active_stream(_Session(None), "t1", "intruder")
