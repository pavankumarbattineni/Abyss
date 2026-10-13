"""Native provider reasoning: model construction, prompt choice and stream projection."""
import pytest
from langchain_core.messages import AIMessage, AIMessageChunk

from abyss_agents.prompts import REASONING_INSTRUCTION
from services.stream_projector import StreamProjector
from utils.llm_providers import PROVIDERS


def _stream(run_id, content, node="model", agent="agent"):
    return {
        "event": "on_chat_model_stream",
        "run_id": run_id,
        "metadata": {"langgraph_node": node, "langgraph_checkpoint_ns": "model:x", "lc_agent_name": agent},
        "data": {"chunk": AIMessageChunk(content=content)},
    }


def _end(run_id, message):
    return {
        "event": "on_chat_model_end",
        "run_id": run_id,
        "metadata": {"langgraph_node": "model", "langgraph_checkpoint_ns": "model:x", "lc_agent_name": "agent"},
        "data": {"output": message},
    }


def _projector():
    chunks = []
    return StreamProjector(chunks.append), chunks


def test_native_reasoning_blocks_stream_as_reasoning_then_answer():
    p, chunks = _projector()
    p.handle(_stream("r1", [{"type": "reasoning", "reasoning": "weigh "}]))
    p.handle(_stream("r1", [{"type": "reasoning", "reasoning": "options"}]))
    p.handle(_stream("r1", [{"type": "text", "text": "The answer"}]))
    p.handle(_end("r1", AIMessage(content="The answer")))
    p.finish()

    types = [c["event_type"] for c in chunks]
    assert types == ["reasoning_start", "reasoning_token", "reasoning_token", "reasoning_end", "token"]
    assert "".join(p.content_tokens) == "The answer"
    (step,) = p.reasoning_steps
    assert step["step"] == "thought" and step["content"] == "weigh options" and step["agent"] == "agent"


def test_native_reasoning_before_a_tool_call_closes_at_model_end():
    p, chunks = _projector()
    p.handle(_stream("r1", [{"type": "reasoning", "reasoning": "need a tool"}]))
    p.handle(_end("r1", AIMessage(content="", tool_calls=[{"name": "t", "args": {}, "id": "c1", "type": "tool_call"}])))

    assert [c["event_type"] for c in chunks] == ["reasoning_start", "reasoning_token", "reasoning_end"]
    assert p.reasoning_steps[0]["content"] == "need a tool" and p.content_tokens == []


def test_native_reasoning_aborted_mid_block_is_recorded_as_truncated():
    p, _ = _projector()
    p.handle(_stream("r1", [{"type": "reasoning", "reasoning": "half a thou"}]))
    p.abort()

    assert p.reasoning_steps[0]["truncated"] is True and p.reasoning_steps[0]["content"] == "half a thou"


def test_text_blocks_still_honor_the_prompt_reasoning_tags():
    p, chunks = _projector()
    p.handle(_stream("r1", [{"type": "text", "text": "<reasoning>why</reasoning>answer"}]))
    p.finish()

    assert "".join(p.content_tokens) == "answer"
    assert p.reasoning_steps[0]["content"] == "why"


def test_native_reasoning_models_get_provider_specific_settings():
    openai = PROVIDERS["openai"].build("gpt-5-mini", "k", True)
    assert openai.use_responses_api is True and openai.reasoning == {"effort": "medium", "summary": "auto"}
    anthropic = PROVIDERS["anthropic"].build("claude-sonnet-4-5", "k", True)
    assert anthropic.thinking["type"] == "enabled" and anthropic.max_tokens > anthropic.thinking["budget_tokens"]
    google = PROVIDERS["google"].build("gemini-2.5-flash", "k", True)
    assert google.include_thoughts is True
    # plain builds are untouched
    assert PROVIDERS["openai"].build("gpt-5-mini", "k", False).reasoning is None
    assert PROVIDERS["anthropic"].build("claude-sonnet-4-5", "k", False).thinking is None


def test_prompt_reasoning_instruction_is_omitted_for_native_models():
    from abyss_agents.prompts import build_parent_prompt

    assert REASONING_INSTRUCTION in build_parent_prompt("S", [], include_reasoning=True)
    assert REASONING_INSTRUCTION not in build_parent_prompt("S", [], include_reasoning=False)


@pytest.mark.asyncio(loop_scope="module")
async def test_resolution_enables_native_reasoning_only_for_flagged_models_and_when_thinking_is_on():
    import pytest as _pytest  # noqa: F401
    from sqlalchemy import update

    from database.models import Agent, ProviderModel
    from database.session import async_session_maker, engine
    from services.chat_service import resolve_llm_for_agent

    agent = Agent(user_id="u", name="n", system_prompt="s", llm_model_id=None)
    async with async_session_maker() as session:
        # uncommitted flag flip on the platform-default model; rolled back below
        await session.execute(
            update(ProviderModel).where(ProviderModel.is_platform_default == True).values(reasoning_mode="native")  # noqa: E712
        )
        on = await resolve_llm_for_agent(session, agent, enable_thinking=True)
        off = await resolve_llm_for_agent(session, agent, enable_thinking=False)
        await session.rollback()
        plain = await resolve_llm_for_agent(session, agent, enable_thinking=True)
    await engine.dispose()

    assert on.native_reasoning is True and on.llm.reasoning is not None
    assert off.native_reasoning is False and off.llm.reasoning is None
    assert plain.native_reasoning is False
