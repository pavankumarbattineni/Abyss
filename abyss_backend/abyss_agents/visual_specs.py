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
    VisualFormat(
        "plot",
        "graphs of functions, curves and data on axes",
        '{"format":"plot","title","x"?:[min,max],"y"?:[min,max],"xLabel"?,"yLabel"?,'
        '"xLog"?,"yLog"?,"equal"?,"params"?:[PARAM],'
        '"functions"?:[{"y":"formula in x","label"?,"x"?:[min,max],"dashed"?}],'
        '"parametric"?:[{"x":"formula in t","y":"formula in t","t":[min,max],"label"?}],'
        '"polar"?:[{"r":"formula in t","t":[min,max],"label"?}],'
        '"areas"?:[{"y","y2"?,"x":[a,b],"label"?}],'
        '"data"?:[{"label"?,"points":[[x,y],...],"line"?}],'
        '"points"?:[{"at":[x,y],"label"?,"open"?}],"segments"?:[{"from":[x,y],"to":[x,y],'
        '"label"?,"dashed"?,"arrow"?}],"vlines"?:[{"x","label"?}],"hlines"?:[{"y","label"?}],'
        '"notes"?:[{"at":[x,y],"text"}]}\n'
        "- FORMULAS. Up to 8 functions; mark roots, extrema, intercepts and asymptotes "
        '(points, vlines, hlines). "areas" shade integrals or regions between curves. '
        '"data" plots measured points. Set x (and y if it helps) to the interesting window.\n'
        "- PARAMS make it interactive: a slider per parameter (e.g. a, k, omega in "
        '"a*sin(k*x)"); "animate":true adds a play button.',
    ),
    VisualFormat(
        "geometry",
        "geometric figures, vectors, free-body diagrams, transformations",
        '{"format":"geometry","title","x"?:[min,max],"y"?:[min,max],"grid"?,"axes"?,'
        '"params"?:[PARAM],"points"?:[{"id","at":[x,y],"label"?,"hidden"?}],'
        '"segments"?:[{"from":P,"to":P,"label"?,"dashed"?}],'
        '"vectors"?:[{"from":P,"to"?:P,"d"?:[dx,dy],"label"?}],'
        '"circles"?:[{"center":P,"r","label"?}],"polygons"?:[{"points":[P,...],"label"?,"shade"?}],'
        '"angles"?:[{"vertex":P,"from":P,"to":P,"label"?,"right"?}],'
        '"boxes"?:[{"at":[x,y],"w","h","angle"?,"label"?}],"notes"?:[{"at":[x,y],"text"}],'
        '"transform"?:{"matrix":[[a,b],[c,d]],"label"?}}\n'
        "- P is a point id or [x,y]; coordinates may be FORMULAS over params. Units are "
        "equal on both axes. Label sides and angles with their values.\n"
        '- Forces: a box for the body and "vectors" from its centre (label "mg", "N", '
        '"F"). "transform" adds a before/after toggle (linear maps).',
    ),
    VisualFormat(
        "vector-field",
        "a 2D vector field: flows, forces, slope fields",
        '{"format":"vector-field","title","fx":"formula in x,y","fy":"formula in x,y",'
        '"x"?:[min,max],"y"?:[min,max],"density"?:6-24,"params"?:[PARAM],'
        '"markers"?:[{"at":[x,y],"label"?,"sign"?:"+|-"}],"xLabel"?,"yLabel"?}\n'
        "- FORMULAS. Arrows show direction, colour the strength. Slope field of y'=f(x,y): "
        '"fx":"1","fy":"f". Markers for charges, sources, sinks or equilibria.',
    ),
    VisualFormat(
        "number-line",
        "values, inequalities and intervals on a number line",
        '{"format":"number-line","title","min","max","step"?,'
        '"points"?:[{"at","label"?,"open"?}],"intervals"?:[{"from":number|"-inf",'
        '"to":number|"inf","fromOpen"?,"toOpen"?,"label"?}]}\n'
        '- Open circles for strict bounds ("<", ">"), filled for "<=" and ">=". One '
        "interval per part of a solution set.",
    ),
    VisualFormat(
        "venn",
        "overlapping sets",
        '{"format":"venn","title","sets":[{"id","label"}],"regions"?:[{"in":[set ids],'
        '"label"?,"value"?}],"universe"?}\n'
        '- 2-3 sets. A region is the sets it lies in (and no others): ["a","b"] = the '
        'overlap only; [] = outside all sets. "value" for counts or probabilities.',
    ),
    VisualFormat(
        "molecule",
        "chemical structures drawn from SMILES",
        '{"format":"molecule","title","molecules":[{"smiles","name"?,"caption"?}]}\n'
        "- 1-6 molecules, each a valid SMILES string (e.g. ethanol CCO, benzene "
        "c1ccccc1). Use several to show a reaction's reactants and products or isomers.",
    ),
    VisualFormat(
        "periodic-table",
        "the periodic table: elements, groups, trends",
        '{"format":"periodic-table","title","highlight"?:[symbols],"values"?:{"symbol":number},'
        '"valueLabel"?,"focus"?:"symbol","configuration"?,"legend"?}\n'
        '- "highlight" a set of elements (and say what they share in "legend"); "values" '
        "shades a trend (electronegativity, radius) for the elements given; \"focus\" one "
        'element with its electron "configuration".',
    ),
    VisualFormat(
        "energy-levels",
        "orbital box diagrams and energy level diagrams",
        '{"format":"energy-levels","title","orbitals"?:[{"label":"1s","boxes":1-7,'
        '"electrons"}],"levels"?:[{"id","label","energy"}],'
        '"transitions"?:[{"from":id,"to":id,"label"?}],"energyLabel"?}\n'
        '- "orbitals" for electron configurations, lowest energy first (boxes: s 1, p 3, '
        'd 5, f 7; filled by Hund\'s rule). "levels" with real energies for spectra and '
        "transitions (absorption/emission).",
    ),
    VisualFormat(
        "circuit",
        "an electric circuit schematic",
        '{"format":"circuit","title","loop":[PART | {"parallel":[[PART,...],[PART,...]]}]}\n'
        'PART = {"kind":"battery|cell|ac|resistor|capacitor|inductor|lamp|switch|'
        'switch-closed|diode|led|ammeter|voltmeter|fuse|motor|wire","label"?,"value"?}\n'
        "- The loop's parts in order, source first. A parallel group holds 2-4 branches "
        '(each a list of parts in series). Values with units ("10 Ω", "9 V").',
    ),
    VisualFormat(
        "steps",
        "a step-by-step derivation, proof, solution or algorithm trace",
        '{"format":"steps","title","steps":[{"title"?,"text"?,"math"?,"array"?:[values],'
        '"highlight"?:[indices],"pointers"?:{"name":index}}]}\n'
        '- 3-20 steps, one idea each. "math": one LaTeX equation (no $); "text" may hold '
        "inline $...$ math. Algorithm traces: the array's state each step, the cells "
        'being compared or swapped in "highlight", and "pointers" like {"i":0,"j":3}.',
    ),
    VisualFormat(
        "map",
        "places, countries and routes on a world map",
        '{"format":"map","title","places"?:[{"name","lat","lon","label"?}],'
        '"regions"?:[{"name":"country","value"?,"label"?}],'
        '"routes"?:[{"from":[lat,lon],"to":[lat,lon],"label"?}],"valueLabel"?}\n'
        '- Countries by English name; "value" shades them on a colour scale. Real '
        "coordinates only. The map zooms to what it shows.",
    ),
    VisualFormat(
        "image",
        "a real photo or illustration from Wikimedia Commons",
        '{"format":"image","title"?,"src","page","alt","caption"?,"author","license"}\n'
        "- Only from the search_images tool: copy src, page, author and license exactly "
        "as it returned them. Never invent or guess an image URL.",
    ),
)

#: Shared notes the specs refer to by name (appended to the specs that use them).
_SHARED = {
    "PARAM": (
        'PARAM = {"name","label"?,"min","max","value"?,"step"?,"animate"?:true}: a '
        "slider; formulas use it by name."
    ),
    "FORMULAS": (
        "FORMULAS are plain text, not LaTeX: + - * / ^, sin cos tan asin acos atan "
        "sinh cosh tanh sqrt abs exp ln log10 log2 floor min max, pi e, and implicit "
        'multiplication ("2x", "3sin(x)").'
    ),
}

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
    if not fmt:
        return None
    shared = "".join(f"\n{text}" for key, text in _SHARED.items() if key in fmt.spec)
    return f"Visual format `{fmt.name}`. {_COMMON}\n{fmt.spec}{shared}"


def catalog() -> str:
    """The one-line list for the parent prompt."""
    return ", ".join(f.name for f in _FORMATS)


# One or more `/<format>` commands at the start of a message, e.g.
# "/timeline /flowchart How did X evolve?". Capped so the specs added to the
# prompt stay a reasonable size.
MAX_REQUESTED_FORMATS = 3
_COMMAND = re.compile(r"\s*/([a-z][a-z-]*)\b")


def requested_formats(text: str) -> list[str]:
    """The formats a message asks for with leading `/<format>` commands, in
    order: known formats only, no repeats, at most MAX_REQUESTED_FORMATS.
    Reading stops at the first word that isn't a known command."""
    text = text or ""
    found: list[str] = []
    pos = 0
    while (match := _COMMAND.match(text, pos)) and match.group(1) in FORMATS:
        if match.group(1) not in found:
            found.append(match.group(1))
        pos = match.end()
    return found[:MAX_REQUESTED_FORMATS]


def requested_format(text: str) -> str | None:
    """The first format a message asks for with a leading `/<format>`, if any."""
    formats = requested_formats(text)
    return formats[0] if formats else None
