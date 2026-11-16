"""The native visual formats' data: names, summaries and specs (pure, no LangChain).

The model writes a small JSON spec in a ```visual block and the frontend draws
it (abyss_frontend/src/components/visuals, validated by src/lib/visuals/schemas.ts
-- keep both in sync with the specs here). Used by the parent prompt (the
catalog) and by abyss_agents/visual_formats.py (the tool and middleware).
"""
from __future__ import annotations

import re
from dataclasses import dataclass

#: The fence the frontend renders natively.
VISUAL_LANGUAGE = "visual"

_ICONS = (
    "brain, database, server, cloud, code, chart, shield, lock, users, user, book, "
    "lightbulb, target, rocket, settings, search, globe, zap, layers, cpu, file, "
    "message, clock, money, check, alert, heart, star, flag, tool, leaf, home"
)


@dataclass(frozen=True)
class VisualFormat:
    name: str
    summary: str
    spec: str


_FORMATS: tuple[VisualFormat, ...] = (
    VisualFormat(
        "flowchart",
        "a process with steps, decisions and branches",
        '{"format":"flowchart","title","direction":"TB|LR"?,'
        '"nodes":[{"id","label","kind":"start|end|process|decision|io|subprocess","detail"?}],'
        '"edges":[{"from","to","label"?}]}\n'
        "- 4-20 nodes: exactly one start, at least one end. Every decision has 2+ outgoing "
        'edges, each labelled ("Yes"/"No" or the condition). Loops are allowed.\n'
        '- "direction" TB (default) for long processes, LR for short wide ones.',
    ),
    VisualFormat(
        "diagram",
        "how concepts, parts or systems relate",
        '{"format":"diagram","title","nodes":[{"id","label","detail"?,"group"?,"icon"?}],'
        '"edges":[{"from","to","label"?,"dashed"?:true}],"groups"?:[{"id","label"}]}\n'
        "- 3-20 nodes. Label edges with the relationship (\"uses\", \"feeds\"). "
        'Use "groups" to cluster related nodes; dashed edges for optional or indirect links.',
    ),
    VisualFormat(
        "blueprint",
        "the technical structure of a system or product",
        '{"format":"blueprint","title","components":[{"id","label","role"?,"detail"?,'
        '"inputs"?:[...],"outputs"?:[...],"group"?}],"links":[{"from","to","label"?}],'
        '"groups"?:[{"id","label"}],"legend"?:[{"label","text"}],"notes"?:[...]}\n'
        "- 4-14 components, each with its role and its main inputs/outputs (2-4 words "
        'each). Links carry what flows ("tokens", "HTTP"). Notes: key constraints or '
        "specifications.",
    ),
    VisualFormat(
        "tree",
        "a hierarchy: a topic and its branches",
        '{"format":"tree","title","root":{"label","detail"?,"children"?:[{...same shape}]}}\n'
        "- Up to 4 levels and about 40 nodes. Siblings are parallel ideas of the same "
        "kind; order them logically.",
    ),
    VisualFormat(
        "timeline",
        "events in time order",
        '{"format":"timeline","title","events":[{"date","title","detail"?,'
        '"milestone"?:true,"era"?}]}\n'
        '- 3-20 events in chronological order; "date" as written for people ("1956", '
        '"Mar 2023"). "era" groups consecutive events under one heading; mark turning '
        'points as "milestone".',
    ),
    VisualFormat(
        "roadmap",
        "a path of stages, milestones and projects",
        '{"format":"roadmap","title","stages":[{"label","duration"?,"summary"?,'
        '"items":[{"id"?,"title","detail"?,"kind":"topic|milestone|project",'
        '"requires"?:[item ids]}]}]}\n'
        "- 3-6 stages in order (e.g. beginner to expert), 3-8 items each. End each stage "
        'with a milestone or project; "requires" names prerequisite item ids.',
    ),
    VisualFormat(
        "cycle",
        "a repeating loop of stages",
        '{"format":"cycle","title","center"?,"stages":[{"label","detail"?,"icon"?}]}\n'
        '- 3-8 stages in order; the last leads back to the first. "center" names the loop.',
    ),
    VisualFormat(
        "layers",
        "a stack of layers, each built on the one below",
        '{"format":"layers","title","layers":[{"label","role"?,"items"?:[...],"tech"?:[...]}],'
        '"flows"?:[{"from","to","label"}]}\n'
        '- 3-7 layers, top (closest to the user or output) first. "flows" connect layer '
        'labels and say what passes between them.',
    ),
    VisualFormat(
        "iceberg",
        "what is visible vs what lies beneath",
        '{"format":"iceberg","title","levels":[{"label","items":[{"label","detail"?}]}]}\n'
        "- 3-5 levels: the first is above the water (what most people see), each next one "
        "deeper and less known. 2-5 items per level.",
    ),
    VisualFormat(
        "decision-matrix",
        "options scored against weighted criteria",
        '{"format":"decision-matrix","title","criteria":[{"name","weight":1-5}],'
        '"options":[{"name","summary"?,"scores":[1-10 per criterion, same order],'
        '"pros"?:[...],"cons"?:[...]}],"recommendation"?}\n'
        "- 2-6 options, 3-8 criteria. Scores must follow from facts you state or were "
        "given; the totals are computed for you. \"recommendation\": one sentence.",
    ),
    VisualFormat(
        "canvas",
        "a one-page overview split into named sections",
        '{"format":"canvas","title","center":{"label","detail"?},'
        '"sections":[{"label","icon"?,"items":[...]}]}\n'
        "- 4-9 sections around the central idea (e.g. goals, components, challenges, "
        "outcomes), 2-5 short items each.",
    ),
    VisualFormat(
        "infographic",
        "key facts, numbers and takeaways at a glance",
        '{"format":"infographic","title","subtitle"?,"stats"?:[{"value","label"}],'
        '"sections":[{"title","icon"?,"text"?,"points"?:[...],'
        '"chart"?:{"type":"bar|pie","data":[{"label","value"}]}}],"takeaways"?:[...]}\n'
        "- 3-6 sections; 2-4 stats. Numbers only from the user, tools or well-established "
        "facts -- otherwise leave stats and charts out.",
    ),
    VisualFormat(
        "handwritten",
        "study notes on a notebook page",
        '{"format":"handwritten","title","sections":[{"heading","notes"?:[...],'
        '"definitions"?:[{"term","meaning"}],"highlights"?:[...],"formula"?}],'
        '"summary"?:[...]}\n'
        "- 3-6 sections in plain language. Highlights are the must-remember points; "
        "summary is 2-4 recap lines.",
    ),
    VisualFormat(
        "sketchnotes",
        "visual notes: a central idea with clusters around it",
        '{"format":"sketchnotes","title","center","clusters":[{"title","icon"?,'
        '"points":[...]}]}\n'
        "- 4-8 clusters, 2-4 points each, at most 8 words per point.",
    ),
    VisualFormat(
        "exploded-view",
        "an object pulled apart into its parts",
        '{"format":"exploded-view","title","object","parts":[{"name","detail"?,'
        '"shape":"cover|panel|board|box|cylinder|disc|ring|screen"}]}\n'
        '- 3-10 parts in assembly order, outermost first. "shape" is the closest simple '
        "form; detail says what the part does.",
    ),
)

FORMATS: dict[str, VisualFormat] = {f.name: f for f in _FORMATS}

_COMMON = (
    "Reply with at most 2 short sentences of context, then ONE ```" + VISUAL_LANGUAGE
    + " block holding the JSON below (valid JSON: double quotes, no comments). Fields "
    "marked ? are optional. Labels at most ~6 words, details at most ~20. Facts follow "
    "the usual rules: only from tools, the user or well-established knowledge. "
    f"Icons, where allowed, are one of: {_ICONS}."
)


def spec_for(name: str) -> str | None:
    fmt = FORMATS.get(name.strip().lstrip("/").lower())
    return f"Visual format `{fmt.name}`. {_COMMON}\n{fmt.spec}" if fmt else None


def catalog() -> str:
    """The one-line list for the parent prompt."""
    return ", ".join(f.name for f in _FORMATS)


_COMMAND = re.compile(r"^\s*/([a-z][a-z-]*)\b")


def requested_format(text: str) -> str | None:
    """The format a message asks for with a leading `/<format>`, if any."""
    match = _COMMAND.match(text or "")
    return match.group(1) if match and match.group(1) in FORMATS else None
