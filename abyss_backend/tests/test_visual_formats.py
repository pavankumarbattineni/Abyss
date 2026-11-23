"""Native visual formats: catalog, specs, /command detection and the middleware."""
from types import SimpleNamespace

from langchain_core.messages import AIMessage, HumanMessage, SystemMessage

from abyss_agents.visual_formats import VisualFormatMiddleware, get_visual_format
from abyss_agents.visual_specs import (
    FORMATS, MAX_REQUESTED_FORMATS, catalog, requested_format, requested_formats, spec_for,
)

EXPECTED = {
    "flowchart", "diagram", "blueprint", "tree", "timeline", "roadmap", "cycle", "layers",
    "iceberg", "decision-matrix", "canvas", "infographic", "handwritten", "sketchnotes",
    "exploded-view", "plot", "geometry", "vector-field", "number-line", "venn", "molecule",
    "periodic-table", "energy-levels", "circuit", "steps", "map", "image",
}


def test_every_format_has_a_spec():
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


def test_several_leading_commands_are_all_requested():
    assert requested_formats("/timeline /flowchart How did X evolve?") == ["timeline", "flowchart"]
    assert requested_formats("/tree /tree /cycle Plants") == ["tree", "cycle"]  # no repeats
    assert requested_formats("/timeline /nope /tree x") == ["timeline"]  # stops at an unknown word
    many = "/timeline /flowchart /tree /cycle /layers x"
    assert requested_formats(many) == ["timeline", "flowchart", "tree"][:MAX_REQUESTED_FORMATS]
    assert requested_formats("Compare /tree and /cycle") == []


def test_middleware_adds_every_requested_spec_in_order():
    system = _run([HumanMessage("/timeline /flowchart History of the web")])
    assert "## Requested formats" in system and "`/timeline`, `/flowchart`" in system
    assert "one ```visual block per format" in system
    assert system.index('"format":"timeline"') < system.index('"format":"flowchart"')


def test_shared_notes_are_added_only_where_a_spec_uses_them():
    plot = spec_for("plot")
    assert "PARAM = {" in plot and "FORMULAS are plain text" in plot
    assert "FORMULAS are plain text" in spec_for("vector-field")
    tree = spec_for("tree")
    assert "PARAM = {" not in tree and "FORMULAS" not in tree


def test_frontend_schemas_know_every_backend_format():
    """The specs here and the zod schemas the frontend validates with must list the same formats."""
    import pathlib
    import re

    schemas = pathlib.Path(__file__).resolve().parents[2] / "abyss_frontend/src/lib/visuals/schemas.ts"
    if not schemas.exists():  # backend checked out alone
        return
    block = schemas.read_text(encoding="utf-8").split("export const VISUAL_SCHEMAS = {", 1)[1].split("}", 1)[0]
    names = {m.strip('"') for m in re.findall(r'^\s*("?[a-z-]+"?):', block, re.M)}
    assert names == set(FORMATS)
