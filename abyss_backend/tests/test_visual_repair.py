"""Server-side checks and repair of an answer's ```visual / ```trench-ui blocks."""
import asyncio
import json
from types import SimpleNamespace

from langchain_core.messages import AIMessage

from abyss_agents.visual_check import check_block, find_blocks
from abyss_agents.visual_repair import INTERNAL_TAG, VisualRepairMiddleware

GOOD_PLOT = {"format": "plot", "functions": [{"y": "x^2"}]}


def fence(lang, data):
    return f"```{lang}\n{data if isinstance(data, str) else json.dumps(data)}\n```"


def test_good_blocks_pass_and_lenient_json_is_accepted():
    assert check_block("visual", json.dumps(GOOD_PLOT)) == ([], "plot")
    assert check_block("visual", '{"format":"venn","sets":[{"id":"a","label":"A"},{"id":"b","label":"B"},],}')[0] == []
    assert check_block("visual", json.dumps({"format": "molecule", "molecules": [{"smils": "C"}]}))[0] == []
    ui = {"version": 1, "components": [{"type": "histogram", "values": [1, 2, 3]}]}
    assert check_block("trench-ui", json.dumps(ui))[0] == []


def test_fatal_problems_are_reported_with_the_field():
    assert "invalid JSON" in check_block("visual", '{"format":"plot",')[0][0]
    assert "unknown format" in check_block("visual", '{"format":"pie"}')[0][0]
    assert check_block("visual", '{"format":"venn","sets":[{"id":"a","label":"A"}]}')[0] == ["sets: needs at least 2 items"]
    assert "lat and lon" in check_block("visual", '{"format":"map","places":[{"name":"Rome"}]}')[0][0]
    assert "Wikimedia" in check_block("visual", '{"format":"image","src":"https://example.com/a.png"}')[0][0]
    gallery = {"format": "image", "images": [{"src": "https://upload.wikimedia.org/a.png"}, {"src": "http://x/b.png"}]}
    assert check_block("visual", json.dumps(gallery))[0] == ["images.1.src: must be a Wikimedia URL from search_images"]
    assert "unknown 'donut'" in check_block("trench-ui", '{"version":1,"components":[{"type":"donut"}]}')[0][0]


def test_find_blocks_ignores_other_code():
    text = "Intro\n" + fence("python", "print(1)") + "\n" + fence("visual", GOOD_PLOT) + "\n" + fence("visual", "{bad")
    blocks = find_blocks(text)
    assert [b.language for b in blocks] == ["visual", "visual"]
    assert not blocks[0].errors and blocks[1].errors


class FakeLLM:
    def __init__(self, replies):
        self.replies = list(replies)
        self.configs = []

    async def ainvoke(self, messages, config=None):
        self.configs.append(config)
        return AIMessage(self.replies.pop(0))


def run(text, replies):
    llm = FakeLLM(replies)
    response = SimpleNamespace(result=[AIMessage(text)])

    async def handler(request):
        return response

    out = asyncio.run(VisualRepairMiddleware(llm).awrap_model_call(SimpleNamespace(), handler))
    return out.result[-1].text, llm


def test_a_broken_block_is_rewritten_in_place_with_a_hidden_call():
    broken = fence("visual", '{"format":"venn","sets":[{"id":"a","label":"A"}]}')
    fixed = {"format": "venn", "sets": [{"id": "a", "label": "A"}, {"id": "b", "label": "B"}]}
    text, llm = run(f"Before\n{broken}\nAfter", ["```json\n" + json.dumps(fixed) + "\n```"])
    assert text == f"Before\n{fence('visual', fixed)}\nAfter"
    assert INTERNAL_TAG in llm.configs[0]["tags"]


def test_a_repair_that_is_still_broken_leaves_the_answer_alone():
    broken = fence("visual", '{"format":"plot"}')
    text, _ = run(f"x\n{broken}", ['{"format":"plot"}'])
    assert text == f"x\n{broken}"


def test_good_answers_and_tool_steps_make_no_call():
    text, llm = run("Just text " + fence("visual", GOOD_PLOT), [])
    assert llm.configs == []
    step = SimpleNamespace(result=[AIMessage("", tool_calls=[{"name": "t", "args": {}, "id": "1"}])])

    async def handler(request):
        return step

    assert asyncio.run(VisualRepairMiddleware(FakeLLM([])).awrap_model_call(SimpleNamespace(), handler)) is step


def test_the_chat_swaps_a_repaired_block_and_never_shows_the_hidden_call():
    from types import SimpleNamespace as NS

    from abyss_agents.factory import PARENT_AGENT_NAME
    from abyss_agents.visual_repair import REPAIR_EVENT
    from services.stream_projector import StreamProjector

    events = []
    projector = StreamProjector(events.append)
    meta = {"langgraph_node": "model", "lc_agent_name": PARENT_AGENT_NAME}
    old, new = fence("visual", '{"format":"plot"}'), fence("visual", GOOD_PLOT)
    for token in ["Intro\n", old[:10], old[10:], "\nEnd"]:
        projector.handle({"event": "on_chat_model_stream", "run_id": "r1", "metadata": meta,
                          "data": {"chunk": NS(content=token, text=token)}})
    # The repair call itself streams inside the model node, tagged internal.
    projector.handle({"event": "on_chat_model_stream", "run_id": "r2", "metadata": meta, "tags": [INTERNAL_TAG],
                      "data": {"chunk": NS(content="SECRET", text="SECRET")}})
    projector.handle({"event": "on_custom_event", "name": REPAIR_EVENT, "run_id": "x", "metadata": meta,
                      "data": {"old": old, "new": new}})
    projector.finish()

    assert "".join(projector.content_tokens) == f"Intro\n{new}\nEnd"
    shown = ""
    for event in events:
        if event["event_type"] == "token":
            shown += event["data"]["content"]
        elif event["event_type"] == "answer_replace":
            shown = shown.replace(event["data"]["old"], event["data"]["new"], 1)
    assert shown == "".join(projector.content_tokens) and "SECRET" not in shown


def test_every_provider_model_has_a_request_timeout():
    from constants import MODEL_REQUEST_TIMEOUT_SECONDS
    from utils.llm_providers import PROVIDERS

    for provider, model in (("openai", "gpt-5-mini"), ("anthropic", "claude-sonnet-4-5"), ("google", "gemini-3.5-flash")):
        for native in (False, True):
            llm = PROVIDERS[provider].build(model, "sk-dummy-key-for-tests", native)
            timeout = getattr(llm, "default_request_timeout", None) or getattr(llm, "timeout", None) or getattr(llm, "request_timeout", None)
            assert timeout == MODEL_REQUEST_TIMEOUT_SECONDS, (provider, native, timeout)
