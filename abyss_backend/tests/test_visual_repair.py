"""Server-side checks and repair of an answer's ```visual / ```abyss-ui blocks."""
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
    assert check_block("abyss-ui", json.dumps(ui))[0] == []


def test_fatal_problems_are_reported_with_the_field():
    assert "invalid JSON" in check_block("visual", '{"format":"plot",')[0][0]
    assert "unknown format" in check_block("visual", '{"format":"pie"}')[0][0]
    assert check_block("visual", '{"format":"venn","sets":[{"id":"a","label":"A"}]}')[0] == ["sets: needs at least 2 items"]
    assert "lat and lon" in check_block("visual", '{"format":"map","places":[{"name":"Rome"}]}')[0][0]
    assert "image URL from search_images" in check_block("visual", '{"format":"image","src":"https://example.com/a.png"}')[0][0]
    gallery = {"format": "image", "images": [{"src": "https://upload.wikimedia.org/a.png"}, {"src": "http://x/b.png"}]}
    assert check_block("visual", json.dumps(gallery))[0] == ["images.1.src: must be an image URL from search_images"]
    assert "unknown 'donut'" in check_block("abyss-ui", '{"version":1,"components":[{"type":"donut"}]}')[0][0]


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


def test_bare_search_results_count_as_an_image_visual():
    bare = [{"src": "https://upload.wikimedia.org/a.png", "author": "A", "license": "CC0"}]
    assert check_block("visual", json.dumps(bare)) == ([], "image")
    assert check_block("visual", json.dumps({"src": "https://evil.example.com/a.png"}))[0]  # unsafe host still fails


def test_json_on_the_fence_line_is_moved_to_its_own_line_without_a_model_call():
    one_line = 'Intro\n```visual {"format":"plot","functions":[{"y":"x"}]}```\nEnd'
    opening = 'Intro\n```visual {"format":"plot","functions":[{"y":"x"}]}\n```\nEnd'
    for text in (one_line, opening):
        fixed, llm = run(text, [])
        assert llm.configs == []  # no model call
        assert '```visual\n{"format":"plot"' in fixed
        assert [b.errors for b in find_blocks(fixed)] == [()]


def test_image_lists_under_other_names_or_after_a_header_count_as_images():
    src = "https://upload.wikimedia.org/a.png"
    assert check_block("visual", json.dumps({"format": "image", "items": [{"src": src}]})) == ([], "image")
    header_then_list = '{"format":"image"}\n' + json.dumps([{"src": src}, {"src": src}])
    assert check_block("visual", header_then_list) == ([], "image")


# ── Edge cases found in production (Abyss-40) ─────────────────────────────────

COMPARISON = {"format": "comparison", "title": "Pan-India Success Drivers",
              "items": [{"title": "RRR", "points": ["Spectacle", "Music"]}, {"title": "Pushpa", "points": ["Swagger"]}]}


def test_an_interactive_component_in_a_visual_block_moves_to_its_own_block_without_a_model_call():
    text, llm = run(f"Why each hit\n{fence('visual', COMPARISON)}\nEnd", [])
    assert llm.configs == []
    assert "```abyss-ui" in text and '"type": "comparison"' in text
    assert [b.errors for b in find_blocks(text)] == [()]


def test_a_visual_format_in_an_interactive_block_moves_to_a_visual_block():
    steps = {"type": "steps", "steps": [{"title": "A", "detail": "x"}, {"title": "B", "detail": "y"}]}
    text, llm = run(fence("abyss-ui", {"version": 1, "components": [steps]}), [])
    assert llm.configs == [] and text.startswith("```visual") and '"format": "steps"' in text


def test_an_unknown_format_is_rewritten_into_the_one_that_fits():
    broken = fence("visual", {"format": "pros-cons", "title": "T", "points": [["A", "x"], ["B", "y"]]})
    steps = {"format": "steps", "title": "T", "steps": [{"title": "A", "detail": "x"}, {"title": "B", "detail": "y"}]}
    text, llm = run(broken, ["steps", json.dumps(steps)])
    assert text == fence("visual", steps)
    assert [c["run_name"] for c in llm.configs] == ["visual_format_choice", "visual_block_repair"]


def test_a_visual_that_still_cant_be_drawn_is_shown_as_text_not_an_error():
    broken = fence("visual", {"format": "pros-cons", "title": "RRR vs Pushpa",
                              "items": [{"title": "RRR", "points": ["Spectacle"]}]})
    text, _ = run(f"Intro\n{broken}\nEnd", ["no-such-format", '{"format":"pros-cons"}'])
    assert "```" not in text and "**RRR vs Pushpa**" in text and "- **RRR**" in text and "Spectacle" in text


def _run_with(text, *, messages=(), found=None, missing=(), monkeypatch):
    from abyss_agents import images, visual_repair

    calls = []

    async def fake_find(queries, limit=3, prefer=None):
        calls.append((list(queries), prefer))
        return [list((found or {}).get(q, [])) for q in queries]

    async def fake_missing(srcs):
        return {s for s in srcs if s in missing}

    monkeypatch.setattr(images, "find_images", fake_find)
    monkeypatch.setattr(visual_repair, "_missing", fake_missing)
    response = SimpleNamespace(result=[AIMessage(text)])

    async def handler(request):
        return response

    out = asyncio.run(VisualRepairMiddleware(FakeLLM([])).awrap_model_call(SimpleNamespace(messages=list(messages)), handler))
    return out.result[-1].text, calls


REAL = {"src": "https://upload.wikimedia.org/real/RRR_poster.jpg", "page": "https://commons.wikimedia.org/wiki/File:RRR.jpg",
        "author": "A", "license": "CC BY-SA 4.0"}


def test_an_image_the_model_made_up_is_replaced_by_a_real_one(monkeypatch):
    made_up = {"format": "image", "images": [{"src": "https://www.example-fan-site.com/rrr.jpg", "alt": "RRR movie poster"}]}
    text, calls = _run_with(fence("visual", made_up), found={"RRR movie poster": [REAL]}, monkeypatch=monkeypatch)
    assert calls == [(["RRR movie poster"], "web")]  # a web address: searched on the web first
    image = json.loads(text.split("\n", 1)[1].rsplit("```", 1)[0])["images"][0]
    assert image["src"] == REAL["src"] and image["alt"] == "RRR movie poster" and image["license"] == "CC BY-SA 4.0"


def test_a_made_up_wikimedia_address_that_doesnt_exist_is_replaced(monkeypatch):
    fake = "https://upload.wikimedia.org/wikipedia/commons/x/xx/Pushpa_invented.jpg"
    block = fence("visual", {"format": "image", "src": fake, "alt": "Pushpa The Rise poster"})
    text, calls = _run_with(block, found={"Pushpa The Rise poster": [REAL]}, missing={fake}, monkeypatch=monkeypatch)
    assert calls == [(["Pushpa The Rise poster"], "open")] and fake not in text and REAL["src"] in text


def test_images_from_the_conversations_searches_are_trusted_without_any_check(monkeypatch):
    from langchain_core.messages import ToolMessage

    searched = ToolMessage(json.dumps([REAL]), tool_call_id="1", name="search_images")
    block = fence("visual", {"format": "image", **REAL})
    text, calls = _run_with(block, messages=[searched], missing={REAL["src"]}, monkeypatch=monkeypatch)
    assert text == block and calls == []


def test_a_made_up_image_with_no_search_result_is_left_out(monkeypatch):
    block = fence("visual", {"format": "image", "src": "https://x.example.com/a.jpg", "alt": "Something obscure"})
    text, _ = _run_with(f"A\n{block}\nB", monkeypatch=monkeypatch)
    assert text == "A\n\nB"


def test_an_image_block_cut_short_mid_json_is_rebuilt_from_the_search_results(monkeypatch):
    from langchain_core.messages import ToolMessage

    other = {**REAL, "src": "https://upload.wikimedia.org/real/Awards.jpg"}
    searched = ToolMessage(json.dumps({"RRR film": [REAL], "awards": [other]}), tool_call_id="1", name="search_images")
    # As in the live run: results copied whole, then abandoned with "...".
    cut = ('```visual\n{"format":"image","title":"Awards","images":[{"author":"A","src":"' + REAL["src"]
           + '","description":"The President confers the National Film Awa…,height":480,...\n```')
    text, calls = _run_with(f"Q\n{cut}\nEnd", messages=[searched], monkeypatch=monkeypatch)
    block = find_blocks(text)
    assert [b.errors for b in block] == [()] and calls == []
    data = json.loads(block[0].source)
    assert data["title"] == "Awards" and data["src"] == REAL["src"] and data["license"] == REAL["license"]


def test_a_block_left_open_at_the_end_is_closed_and_checked():
    text, _ = run('Intro\n```visual\n' + json.dumps(GOOD_PLOT), [])
    assert text.endswith("\n```") and [b.errors for b in find_blocks(text)] == [()]


def test_blocks_saved_under_the_old_tag_are_still_read_and_written_back_under_the_new_one():
    ui = {"version": 1, "components": [{"type": "histogram", "values": [1, 2, 3]}]}
    assert check_block("trench-ui", json.dumps(ui))[0] == []
    assert [b.language for b in find_blocks(fence("trench-ui", ui))] == ["abyss-ui"]
    broken = fence("trench-ui", '{"version":1,"components":[{"type":"histogram"}]}')
    text, _ = run(broken, [json.dumps(ui)])
    assert text.startswith("```abyss-ui")
