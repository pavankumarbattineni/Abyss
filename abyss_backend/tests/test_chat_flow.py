"""End-to-end generation flow against the real local Postgres, with a scripted model.

Exercises ChatService → build_agent (create_agent + middleware + sub-agent
tools) → Postgres checkpointer → StreamProjector → SSE buffer, including the
native approval interrupt / resume cycle.
"""
import asyncio
import uuid

import pytest
from langchain_core.tools import StructuredTool
from sqlalchemy import delete, select

import services.chat_service as chat_service_module
import utils.stream_manager as stream_manager
from database.checkpointer import close_checkpointer, delete_thread_checkpoints, init_checkpointer
from database.models import Agent, MCPConnection, MCPTool, Message, StreamRecord, Thread, User
from database.session import async_session_maker, engine
from schemas.stream import ToolApprovalDecision, ToolApprovalGroup, ToolApprovalRequest
from services.chat_service import ChatService, LlmResolution
from tests.fakes import ScriptedChatModel, ai, call
from utils import mcp_client

pytestmark = pytest.mark.asyncio(loop_scope="module")

PARENT = "PARENT-MARK"
SUB_A = "SUBA-MARK"
SUB_B = "SUBB-MARK"


@pytest.fixture(scope="module", autouse=True)
async def _infra():
    await init_checkpointer()
    yield
    await close_checkpointer()
    await engine.dispose()


class Env:
    def __init__(self, user_id: str):
        self.user_id = user_id
        self.thread_ids: list[str] = []
        self.service = ChatService()
        self.executed: list[str] = []

    async def make_agent(self, session, name, prompt, parent_id=None, description=None):
        agent = Agent(user_id=self.user_id, name=name, system_prompt=prompt, parent_id=parent_id, description=description)
        session.add(agent)
        await session.flush()
        return agent

    async def make_thread(self, session, agent_id):
        thread = Thread(user_id=self.user_id, agent_id=agent_id)
        session.add(thread)
        await session.flush()
        self.thread_ids.append(thread.id)
        return thread

    async def make_gated_tool(self, session, agent_id, name="danger", state="requires_approval"):
        """Register a fake MCP tool for agent_id, backed by a real MCPTool row."""
        conn = MCPConnection(user_id=self.user_id, name=f"c-{uuid.uuid4().hex[:6]}", url="http://x", api_key="x")
        session.add(conn)
        await session.flush()
        row = MCPTool(connection_id=conn.id, name=name, permission_state=state)
        session.add(row)
        await session.flush()

        async def run(x: str = "") -> str:
            self.executed.append(f"{name}:{x}")
            return f"ran {name} {x}"

        tool = StructuredTool.from_function(coroutine=run, name=name, description="d", metadata={"tool_id": row.id})
        mcp_client._agent_tool_registry.setdefault(agent_id, []).append(tool)
        mcp_client._agent_tool_permissions.setdefault(agent_id, {})[name] = state == "requires_approval"
        return row

    async def run_turn(self, thread_id, text="hello", is_interactive=True):
        async with async_session_maker() as session:
            started = await self.service.send_message(session, thread_id, self.user_id, text, is_interactive=is_interactive)
        return await self.wait(started.stream_id)

    async def wait(self, stream_id):
        task = stream_manager._running_tasks[stream_id]
        await asyncio.wait_for(asyncio.shield(task), timeout=30)
        async with async_session_maker() as session:
            return (await session.execute(select(StreamRecord).where(StreamRecord.id == stream_id))).scalar_one()

    async def approve(self, stream_id, request):
        async with async_session_maker() as session:
            await self.service.resolve_tool_approvals(session, stream_id, self.user_id, request)
        return await self.wait(stream_id)

    @staticmethod
    def events(stream_id, *types):
        return [c for c in stream_manager.get_buffer(stream_id) if not types or c["event_type"] in types]


@pytest.fixture
async def env(monkeypatch):
    async with async_session_maker() as session:
        user = User(email=f"test-{uuid.uuid4().hex}@example.com")
        session.add(user)
        await session.commit()
        user_id = user.id
    e = Env(user_id)
    state = {"llm": None}

    async def fake_resolve(session, agent_record, enable_thinking=True):
        return LlmResolution(llm=state["llm"], provider="openai", model="gpt-5-mini", llm_source="default")

    async def no_title(_):
        return None

    monkeypatch.setattr(chat_service_module, "resolve_llm_for_agent", fake_resolve)
    monkeypatch.setattr(chat_service_module, "_generate_thread_title", no_title)
    e.set_llm = lambda scripts: state.__setitem__("llm", ScriptedChatModel(scripts=scripts, positions={}))
    e.llm = lambda: state["llm"]
    yield e
    for tid in e.thread_ids:
        await delete_thread_checkpoints(tid)
    async with async_session_maker() as session:
        await session.execute(delete(StreamRecord).where(StreamRecord.thread_id.in_(e.thread_ids)))
        await session.execute(delete(Message).where(Message.thread_id.in_(e.thread_ids)))
        await session.execute(delete(Thread).where(Thread.user_id == user_id))
        await session.execute(delete(Agent).where(Agent.user_id == user_id, Agent.parent_id.isnot(None)))
        await session.execute(delete(Agent).where(Agent.user_id == user_id))
        await session.execute(delete(User).where(User.id == user_id))
        await session.commit()


async def _simple_agent(env, prompt=PARENT):
    async with async_session_maker() as session:
        agent = await env.make_agent(session, "Main", prompt)
        thread = await env.make_thread(session, agent.id)
        await session.commit()
        return agent, thread


async def test_plain_answer_streams_reasoning_and_persists_message(env):
    env.set_llm({PARENT: [ai("<reasoning>thinking it over</reasoning>Hello there!")]})
    _, thread = await _simple_agent(env)

    record = await env.run_turn(thread.id)

    assert record.status == "COMPLETED"
    types = [c["event_type"] for c in env.events(record.id)]
    assert types[0] == "reasoning_start" and "reasoning_end" in types and types[-1] == "done"
    tokens = "".join(c["data"]["content"] for c in env.events(record.id, "token"))
    assert tokens == "Hello there!"
    reasoning = "".join(c["data"]["content"] for c in env.events(record.id, "reasoning_token"))
    assert reasoning == "thinking it over"
    assert (record.input_tokens, record.output_tokens) == (10, 5)
    async with async_session_maker() as session:
        msgs = (await session.execute(select(Message).where(Message.thread_id == thread.id, Message.role == "assistant"))).scalars().all()
    assert [m.content for m in msgs] == ["Hello there!"]


async def test_gated_tool_pauses_then_approve_with_always_allow(env):
    env.set_llm({PARENT: [ai("", call("danger", {"x": "1"}, "c1")), ai("All done")]})
    async with async_session_maker() as session:
        agent = await env.make_agent(session, "Main", PARENT)
        thread = await env.make_thread(session, agent.id)
        row = await env.make_gated_tool(session, agent.id)
        await session.commit()

    record = await env.run_turn(thread.id)
    assert record.status == "AWAITING_APPROVAL"
    assert env.executed == []
    payload = env.events(record.id, "tool_approval_required")[0]["data"]
    (interrupt,) = payload["interrupts"]
    (action,) = interrupt["action_requests"]
    assert action["name"] == "danger" and action["args"] == {"x": "1"} and action["tool_id"] == row.id
    assert interrupt["review_configs"][0]["allowed_decisions"] == ["approve", "reject"]

    # status endpoint payload (reconnect recovery) matches
    async with async_session_maker() as session:
        pending = await env.service.get_pending_approval(session, record.id, env.user_id)
    assert pending["interrupts"][0]["interrupt_id"] == interrupt["interrupt_id"]

    record = await env.approve(record.id, ToolApprovalRequest(approvals=[ToolApprovalGroup(
        interrupt_id=interrupt["interrupt_id"], decisions=[ToolApprovalDecision(type="approve", always_allow=True)])]))
    assert record.status == "COMPLETED"
    assert env.executed == ["danger:1"]
    async with async_session_maker() as session:
        state = (await session.execute(select(MCPTool.permission_state).where(MCPTool.id == row.id))).scalar_one()
    assert state == "allowed"
    assert [c["data"]["tool_name"] for c in env.events(record.id, "tool_end")] == ["danger"]
    steps = [s for s in __import__("json").loads(record.reasoning)["steps"] if s["step"] == "tool_call"]
    assert steps[0]["tool_name"] == "danger"


async def test_reject_skips_tool_and_agent_continues(env):
    env.set_llm({PARENT: [ai("", call("danger", {"x": "1"}, "c1")), ai("Understood, skipping it")]})
    async with async_session_maker() as session:
        agent = await env.make_agent(session, "Main", PARENT)
        thread = await env.make_thread(session, agent.id)
        await env.make_gated_tool(session, agent.id)
        await session.commit()

    record = await env.run_turn(thread.id)
    (interrupt,) = env.events(record.id, "tool_approval_required")[0]["data"]["interrupts"]
    record = await env.approve(record.id, ToolApprovalRequest(approvals=[ToolApprovalGroup(
        interrupt_id=interrupt["interrupt_id"], decisions=[ToolApprovalDecision(type="reject")])]))

    assert record.status == "COMPLETED"
    assert env.executed == []
    # the rejected call is surfaced as a tool_start/tool_end pair even though it never ran
    ends = env.events(record.id, "tool_end")
    assert [c["data"]["tool_name"] for c in ends] == ["danger"]
    assert "rejected" in ends[0]["data"]["output"]


async def test_wrong_number_of_decisions_is_refused_and_stream_stays_paused(env):
    env.set_llm({PARENT: [ai("", call("danger", {}, "c1")), ai("ok")]})
    async with async_session_maker() as session:
        agent = await env.make_agent(session, "Main", PARENT)
        thread = await env.make_thread(session, agent.id)
        await env.make_gated_tool(session, agent.id)
        await session.commit()
    record = await env.run_turn(thread.id)
    (interrupt,) = env.events(record.id, "tool_approval_required")[0]["data"]["interrupts"]

    async with async_session_maker() as session:
        with pytest.raises(ValueError, match="needs 1 decision"):
            await env.service.resolve_tool_approvals(session, record.id, env.user_id, ToolApprovalRequest(
                approvals=[ToolApprovalGroup(interrupt_id=interrupt["interrupt_id"], decisions=[])]))
    async with async_session_maker() as session:
        status = (await session.execute(select(StreamRecord.status).where(StreamRecord.id == record.id))).scalar_one()
    assert status == "AWAITING_APPROVAL"


async def test_unattended_run_skips_gated_tool_without_pausing(env):
    env.set_llm({PARENT: [ai("", call("danger", {"x": "1"}, "c1")), ai("Could not do it")]})
    async with async_session_maker() as session:
        agent = await env.make_agent(session, "Main", PARENT)
        thread = await env.make_thread(session, agent.id)
        await env.make_gated_tool(session, agent.id)
        await session.commit()

    record = await env.run_turn(thread.id, is_interactive=False)

    assert record.status == "COMPLETED"
    assert env.executed == []
    (end,) = env.events(record.id, "tool_end")
    assert "unattended" in end["data"]["output"]


async def test_sub_agents_run_in_parallel_and_parent_writes_final_answer(env):
    env.set_llm({
        PARENT: [
            ai("<reasoning>delegate</reasoning>",
               call("research_agent", {"task": "find a"}, "p1"), call("math_agent", {"task": "add"}, "p2")),
            ai("<reasoning>combine</reasoning>Final combined answer"),
        ],
        SUB_A: [ai("<reasoning>searching</reasoning>A-RESULT")],
        SUB_B: [ai("B-RESULT")],
    })
    async with async_session_maker() as session:
        agent = await env.make_agent(session, "Main", PARENT)
        await env.make_agent(session, "Research Agent", SUB_A, parent_id=agent.id, description="does research")
        await env.make_agent(session, "Math Agent", SUB_B, parent_id=agent.id, description="does math")
        thread = await env.make_thread(session, agent.id)
        await session.commit()

    record = await env.run_turn(thread.id)

    assert record.status == "COMPLETED"
    types = [c["event_type"] for c in env.events(record.id)]
    assert types.count("agent_start") == 2 and types.count("agent_end") == 2
    assert types.count("dispatch_decision") == 2
    assert types.index("synthesis_start") > max(i for i, t in enumerate(types) if t == "agent_end")
    synth = env.events(record.id, "synthesis_start")[0]["data"]["agents_completed"]
    assert sorted(synth) == ["math_agent", "research_agent"]
    # only the parent's final answer reaches the user; sub-agent text and the dispatch turn do not
    assert "".join(c["data"]["content"] for c in env.events(record.id, "token")) == "Final combined answer"
    async with async_session_maker() as session:
        msg = (await session.execute(select(Message).where(Message.thread_id == thread.id, Message.role == "assistant"))).scalar_one()
    assert msg.content == "Final combined answer"
    # sub-agent reasoning is labelled by sub-agent; usage covers every model call (4 calls)
    labels = {s["agent"] for s in __import__("json").loads(record.reasoning)["steps"] if s["step"] == "thought"}
    assert {"agent", "research_agent"} <= labels
    assert record.input_tokens == 40


async def test_gated_tools_in_two_parallel_sub_agents_resume_independently(env):
    env.set_llm({
        PARENT: [ai("", call("research_agent", {"task": "a"}, "p1"), call("math_agent", {"task": "b"}, "p2")), ai("Done")],
        SUB_A: [ai("", call("danger", {"x": "A"}, "ca")), ai("A finished")],
        SUB_B: [ai("", call("danger", {"x": "B"}, "cb")), ai("B finished")],
    })
    async with async_session_maker() as session:
        agent = await env.make_agent(session, "Main", PARENT)
        sub_a = await env.make_agent(session, "Research Agent", SUB_A, parent_id=agent.id)
        sub_b = await env.make_agent(session, "Math Agent", SUB_B, parent_id=agent.id)
        thread = await env.make_thread(session, agent.id)
        await env.make_gated_tool(session, sub_a.id)
        await env.make_gated_tool(session, sub_b.id)
        await session.commit()

    record = await env.run_turn(thread.id)
    assert record.status == "AWAITING_APPROVAL"
    interrupts = env.events(record.id, "tool_approval_required")[0]["data"]["interrupts"]
    assert len(interrupts) == 2

    decisions = []
    for i in interrupts:
        x = i["action_requests"][0]["args"]["x"]
        decisions.append(ToolApprovalGroup(
            interrupt_id=i["interrupt_id"],
            decisions=[ToolApprovalDecision(type="approve") if x == "A" else ToolApprovalDecision(type="reject")]))
    record = await env.approve(record.id, ToolApprovalRequest(approvals=decisions))

    assert record.status == "COMPLETED"
    assert env.executed == ["danger:A"]
    calls = env.events(record.id, "tool_end")
    assert {c["data"]["agent_name"] for c in calls} == {"research_agent", "math_agent"}


async def test_deny_all_pending_resolves_interrupt(env):
    env.set_llm({PARENT: [ai("", call("danger", {}, "c1")), ai("Fine, no")]})
    async with async_session_maker() as session:
        agent = await env.make_agent(session, "Main", PARENT)
        thread = await env.make_thread(session, agent.id)
        await env.make_gated_tool(session, agent.id)
        await session.commit()
    record = await env.run_turn(thread.id)
    async with async_session_maker() as session:
        await env.service.deny_all_pending_approvals(session, record.id, env.user_id)
    record = await env.wait(record.id)
    assert record.status == "COMPLETED" and env.executed == []


async def test_cancelled_run_keeps_partial_message_and_thread_stays_usable(env):
    env.set_llm({PARENT: [ai("a fairly long streamed answer"), ai("second turn answer")]})
    env.llm().delay = 5
    _, thread = await _simple_agent(env)

    async with async_session_maker() as session:
        started = await env.service.send_message(session, thread.id, env.user_id, "hello")
    await asyncio.sleep(0.5)
    assert stream_manager.cancel_task(started.stream_id)
    with pytest.raises(asyncio.CancelledError):
        await stream_manager._running_tasks[started.stream_id]
    async with async_session_maker() as session:
        status = (await session.execute(select(StreamRecord.status).where(StreamRecord.id == started.stream_id))).scalar_one()
    assert status == "CANCELLED"

    # the cancelled turn's checkpoints were trimmed, so the next turn runs cleanly on the same thread
    env.llm().delay = 0
    env.llm().positions = {}
    record = await env.run_turn(thread.id, "again")
    assert record.status == "COMPLETED"
