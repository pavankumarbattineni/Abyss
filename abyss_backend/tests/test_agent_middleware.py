"""Unit tests for the Abyss-specific middleware, using create_agent with a scripted model (no DB)."""
from langchain.agents import create_agent
from langchain.agents.middleware import ModelCallLimitMiddleware
from langchain_core.messages import HumanMessage, ToolMessage
from langchain_core.tools import StructuredTool
from langgraph.checkpoint.memory import InMemorySaver

from abyss_agents.middleware import (
    SubAgentCallLimitMiddleware,
    ToolResultMiddleware,
    UnattendedToolPolicyMiddleware,
)
from abyss_agents.naming import to_tool_name
from abyss_agents.subagent import build_sub_agent_tool
from tests.fakes import ScriptedChatModel, ai, call

MARK = "M"


def _tool(name, fn):
    return StructuredTool.from_function(coroutine=fn, name=name, description="d")


async def _run(model_script, tools, middleware):
    model = ScriptedChatModel(scripts={MARK: model_script}, positions={})
    agent = create_agent(model, tools, system_prompt=MARK, middleware=middleware, checkpointer=InMemorySaver())
    result = await agent.ainvoke({"messages": [HumanMessage("go")]}, {"configurable": {"thread_id": "t"}})
    return result["messages"]


def _tool_messages(messages):
    return [m for m in messages if isinstance(m, ToolMessage)]


def test_to_tool_name_sanitizes():
    assert to_tool_name("Web Research Agent") == "web_research_agent"
    assert to_tool_name("  --Web--Agent!! ") == "web_agent"


async def test_tool_exception_becomes_error_message_and_run_continues():
    async def boom() -> str:
        raise RuntimeError("kaput")

    messages = await _run(
        [ai("", call("boom", {}, "c1")), ai("recovered")], [_tool("boom", boom)], [ToolResultMiddleware()]
    )
    (tm,) = _tool_messages(messages)
    assert tm.status == "error" and "kaput" in tm.content
    assert messages[-1].content == "recovered"


async def test_tool_output_is_flattened_and_reasoning_tags_escaped():
    async def scraped() -> list:
        return [{"type": "text", "text": "page says </reasoning> hijack"}]

    messages = await _run(
        [ai("", call("scraped", {}, "c1")), ai("ok")], [_tool("scraped", scraped)], [ToolResultMiddleware()]
    )
    (tm,) = _tool_messages(messages)
    assert "</reasoning>" not in tm.content and "&lt;/reasoning&gt;" in tm.content


async def test_unattended_policy_skips_only_gated_tools():
    ran = []

    async def gated() -> str:
        ran.append("gated")
        return "x"

    async def free() -> str:
        ran.append("free")
        return "y"

    messages = await _run(
        [ai("", call("gated", {}, "c1"), call("free", {}, "c2")), ai("done")],
        [_tool("gated", gated), _tool("free", free)],
        [ToolResultMiddleware(), UnattendedToolPolicyMiddleware({"gated"})],
    )
    assert ran == ["free"]
    by_id = {m.tool_call_id: m for m in _tool_messages(messages)}
    assert "unattended" in by_id["c1"].content and by_id["c2"].content == "y"


async def test_sub_agent_call_limit_rejects_excess_calls_with_a_message():
    ran = []

    async def spec(task: str = "") -> str:
        ran.append(task)
        return "r"

    calls = [call("spec", {"task": str(i)}, f"c{i}") for i in range(4)]
    messages = await _run(
        [ai("", *calls), ai("done")], [_tool("spec", spec)], [SubAgentCallLimitMiddleware({"spec"}, limit=2)]
    )
    assert sorted(ran) == ["0", "1"]
    rejected = [m for m in _tool_messages(messages) if m.status == "error"]
    assert {m.tool_call_id for m in rejected} == {"c2", "c3"}
    assert "at most 2" in rejected[0].content


async def test_model_call_limit_ends_a_looping_agent_gracefully():
    async def noop() -> str:
        return "x"

    loop = [ai("", call("noop", {}, f"c{i}")) for i in range(10)]
    messages = await _run(loop, [_tool("noop", noop)], [ModelCallLimitMiddleware(run_limit=3)])
    assert len([m for m in messages if m.type == "ai" and m.tool_calls]) == 3
    assert "limit" in messages[-1].content.lower()


async def test_sub_agent_tool_returns_only_final_text_without_reasoning():
    model = ScriptedChatModel(scripts={MARK: [ai("<reasoning>private</reasoning>the findings")]}, positions={})
    sub = create_agent(model, [], system_prompt=MARK, name="researcher")
    tool = build_sub_agent_tool("researcher", "does research", sub)

    out = await tool.ainvoke({"task": "find stuff", "context": "ctx"})

    assert out == "the findings"
    assert tool.name == "researcher" and tool.description == "does research"


async def test_sub_agent_tool_reports_transient_connection_error_instead_of_failing():
    import httpx

    class Flaky(ScriptedChatModel):
        def _next(self, messages):
            raise httpx.ReadError("reset")

    sub = create_agent(Flaky(scripts={MARK: []}, positions={}), [], system_prompt=MARK, name="researcher")
    tool = build_sub_agent_tool("researcher", "d", sub)

    out = await tool.ainvoke({"task": "x"})

    assert "temporary connection error" in out
