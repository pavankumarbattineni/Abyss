"""Native visual formats: catalog, specs, /command detection and the middleware."""
from types import SimpleNamespace

from langchain_core.messages import AIMessage, HumanMessage, SystemMessage

from abyss_agents.visual_formats import VisualFormatMiddleware, get_visual_format
from abyss_agents.visual_specs import FORMATS, catalog, requested_format, spec_for

EXPECTED = {
    "flowchart", "diagram", "blueprint", "tree", "timeline", "roadmap", "cycle", "layers",
    "iceberg", "decision-matrix", "canvas", "infographic", "handwritten", "sketchnotes",
    "exploded-view",
}


def test_all_fifteen_formats_have_a_spec():
    assert set(FORMATS) == EXPECTED
    for name in EXPECTED:
        spec = spec_for(name)
        assert spec and f'"format":"{name}"' in spec and "```visual" in spec
    assert all(name in catalog() for name in EXPECTED)


def test_spec_lookup_is_forgiving_and_safe():
    assert spec_for("/Roadmap ") == spec_for("roadmap")
    assert spec_for("unknown") is None
    assert "Unknown format" in get_visual_format.invoke({"name": "pie"})
    assert '"format":"tree"' in get_visual_format.invoke({"name": "tree"})


def test_requested_format_only_for_a_leading_known_command():
    assert requested_format("/timeline History of AI") == "timeline"
    assert requested_format("  /decision-matrix\nPick a DB") == "decision-matrix"
    assert requested_format("/timelines of AI") is None
    assert requested_format("Show /tree of this") is None
    assert requested_format("/usr/bin is a path") is None


class _Request(SimpleNamespace):
    def override(self, **changes):
        return _Request(**{**self.__dict__, **changes})


def _run(messages):
    seen = {}

    def handler(request):
        seen["system"] = request.system_message.content
        return "ok"

    request = _Request(messages=messages, system_message=SystemMessage(content="BASE"))
    VisualFormatMiddleware().wrap_model_call(request, handler)
    return seen["system"]


def test_middleware_adds_the_requested_spec_for_the_turn():
    system = _run([HumanMessage("/cycle The water cycle")])
    assert system.startswith("BASE") and '"format":"cycle"' in system


def test_middleware_uses_the_latest_question_only():
    history = [HumanMessage("/cycle The water cycle"), AIMessage("..."), HumanMessage("Thanks!")]
    assert _run(history) == "BASE"
    summary = HumanMessage("summary", additional_kwargs={"lc_source": "summarization"})
    assert '"format":"tree"' in _run([HumanMessage("/tree Gen AI"), summary])
