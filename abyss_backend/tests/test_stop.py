"""Stopping a generation: tool calls can't hold a stopped turn, and a stream
left RUNNING with no generation no longer blocks its thread. No LLM, no DB
(the saving itself is covered end to end against a database)."""

import asyncio
from datetime import timedelta
from types import SimpleNamespace

import pytest
from langchain_core.messages import ToolMessage

import utils.stream_manager as stream_manager
from abyss_agents.middleware import ToolResultMiddleware
from constants import ORPHANED_STREAM_SECONDS, STREAM_STATUS_AWAITING_APPROVAL, STREAM_STATUS_RUNNING
from database.models import utcnow
from services.chat_service import _is_left_over


def _request(name="web_search"):
    return SimpleNamespace(tool_call={"name": name, "id": "call-1", "args": {}})


async def _hangs_and_absorbs_cancels(request):
    """Like an MCP call whose anyio task group swallows the cancel. It gives up
    after a few, only so the test's event loop can close."""
    for _ in range(2):  # ours, then the test loop's own at teardown
        try:
            await asyncio.sleep(3600)
        except asyncio.CancelledError:
            continue


async def test_a_tool_that_never_answers_gives_the_agent_an_error():
    result = await ToolResultMiddleware(timeout=0.05).awrap_tool_call(_request(), _hangs_and_absorbs_cancels)
    assert isinstance(result, ToolMessage) and result.status == "error"
    assert "didn't answer within" in result.content


async def test_stop_reaches_the_turn_even_inside_a_stuck_tool_call():
    turn = asyncio.create_task(ToolResultMiddleware(timeout=3600).awrap_tool_call(_request(), _hangs_and_absorbs_cancels))
    await asyncio.sleep(0.05)
    turn.cancel()
    with pytest.raises(asyncio.CancelledError):
        await asyncio.wait_for(turn, timeout=2)


async def test_specialists_have_no_tool_time_limit_and_results_pass_through():
    async def slow_specialist(request):
        await asyncio.sleep(0.1)
        return ToolMessage("done", tool_call_id="call-1", name="specialist")

    mw = ToolResultMiddleware(timeout=0.01, no_timeout=frozenset({"specialist"}))
    result = await mw.awrap_tool_call(_request("specialist"), slow_specialist)
    assert result.content == "done" and result.status != "error"


async def test_a_raised_tool_error_is_still_an_error_message():
    async def broken(request):
        raise RuntimeError("boom")

    result = await ToolResultMiddleware().awrap_tool_call(_request(), broken)
    assert result.status == "error" and "boom" in result.content


def _record(status=STREAM_STATUS_RUNNING, age=ORPHANED_STREAM_SECONDS + 60, sid="s-1"):
    updated = utcnow() - timedelta(seconds=age)
    return SimpleNamespace(id=sid, status=status, updated_at=updated, created_at=updated)


async def test_which_streams_count_as_left_over():
    assert _is_left_over(_record())  # RUNNING, nothing running it, long untouched
    assert not _is_left_over(_record(age=5))  # recent: may be live elsewhere (a deploy)
    assert not _is_left_over(_record(status=STREAM_STATUS_AWAITING_APPROVAL))  # waits for the user

    live = asyncio.create_task(asyncio.sleep(1))
    stream_manager.register_task("s-live", live)
    try:
        assert not _is_left_over(_record(sid="s-live"))  # its generation runs here
    finally:
        live.cancel()
        stream_manager.cleanup_stream("s-live")
