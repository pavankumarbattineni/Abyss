"""Checks the ```visual and ```trench-ui blocks in an answer (pure, no LangChain).

The frontend validates every block with zod (abyss_frontend/src/lib/visuals/
schemas.ts and src/lib/interactive.ts) and is lenient: optional fields that
are wrong are dropped. What it can't recover from -- broken JSON, an unknown
format or component, a missing required field -- shows the user an error card.
This module finds exactly those problems on the server, so the answer's
broken blocks can be repaired before it is saved (visual_repair.py).
Keep the required fields here in step with the zod schemas.
"""
from __future__ import annotations

import json
import re
from dataclasses import dataclass

from abyss_agents.visual_specs import FORMATS, VISUAL_LANGUAGE
from abyss_agents.web_images import TOKEN_PREFIX, verify_image_token

INTERACTIVE_LANGUAGE = "trench-ui"
WIKIMEDIA_IMAGE = re.compile(r"^https://(upload|thumb)\.wikimedia\.org/")
# A fenced block: ```lang (rest of the line) ... ``` -- what the chat renders.
_FENCE = re.compile(r"```([\w-]*)[^\n]*\n(.*?)```", re.S)


@dataclass(frozen=True)
class Block:
    language: str  # "visual" or "trench-ui"
    source: str  # the JSON between the fences
    text: str  # the whole fenced block, as it appears in the answer
    errors: tuple[str, ...]
    format: str | None = None


def lenient_json(source: str):
    """Small models' usual slips, as the frontend forgives them: smart quotes, trailing commas."""
    cleaned = source.strip().replace("“", '"').replace("”", '"')
    cleaned = re.sub(r",\s*([}\]])", r"\1", cleaned)
    try:
        return json.loads(cleaned)
    except json.JSONDecodeError:
        # A small header object then a list -- {"format":"image"} followed by
        # search results -- is one visual: the list goes under "images".
        split = re.match(r"^(\{[^{}]*\})\s*(\[.*\])$", cleaned, re.S)
        if not split:
            raise
        return {**json.loads(split.group(1)), "images": json.loads(split.group(2))}


def _is_num(v) -> bool:
    if isinstance(v, bool):
        return False
    if isinstance(v, (int, float)):
        return True
    try:
        float(str(v))
        return True
    except ValueError:
        return False


def _items(data: dict, key: str, errors: list[str], minimum: int = 1, fields: tuple[str, ...] = ()) -> list:
    value = data.get(key)
    if not isinstance(value, list) or len(value) < minimum:
        errors.append(f"{key}: needs at least {minimum} item{'s' if minimum > 1 else ''}")
        return []
    for i, item in enumerate(value):
        if fields and not isinstance(item, dict):
            errors.append(f"{key}.{i}: must be an object")
            continue
        for f in fields:
            if item.get(f) in (None, ""):
                errors.append(f"{key}.{i}.{f}: required")
    return value


def _any_of(data: dict, keys: tuple[str, ...], errors: list[str]) -> None:
    if not any(isinstance(data.get(k), list) and data.get(k) for k in keys):
        errors.append(f"give at least one of: {', '.join(keys)}")


def _check_visual(data: dict) -> list[str]:
    errors: list[str] = []
    fmt = data.get("format")
    if fmt in ("flowchart", "diagram"):
        _items(data, "nodes", errors, 2, ("id", "label"))
    elif fmt == "blueprint":
        _items(data, "components", errors, 2, ("id", "label"))
    elif fmt == "tree":
        if not isinstance(data.get("root"), dict) or not data["root"].get("label"):
            errors.append("root.label: required")
    elif fmt == "timeline":
        _items(data, "events", errors, 1, ("title",))
    elif fmt == "roadmap":
        _items(data, "stages", errors, 1, ("label",))
    elif fmt == "cycle":
        _items(data, "stages", errors, 2, ("label",))
    elif fmt == "layers":
        _items(data, "layers", errors, 1, ("label",))
    elif fmt == "iceberg":
        _items(data, "levels", errors, 1, ("label",))
    elif fmt == "decision-matrix":
        _items(data, "criteria", errors, 1, ("name",))
        _items(data, "options", errors, 1, ("name",))
    elif fmt in ("canvas", "infographic", "handwritten"):
        _items(data, "sections", errors, 1)
    elif fmt == "sketchnotes":
        _items(data, "clusters", errors, 1)
    elif fmt == "exploded-view":
        _items(data, "parts", errors, 1, ("name",))
    elif fmt == "plot":
        _any_of(data, ("functions", "parametric", "polar", "areas", "data", "points", "segments"), errors)
    elif fmt == "geometry":
        _any_of(data, ("points", "segments", "vectors", "circles", "polygons", "boxes"), errors)
    elif fmt == "vector-field":
        for key in ("fx", "fy"):
            if not isinstance(data.get(key), (str, int, float)) or data.get(key) == "":
                errors.append(f"{key}: required (a formula in x and y)")
    elif fmt == "number-line":
        for key in ("min", "max"):
            if not _is_num(data.get(key)):
                errors.append(f"{key}: required number")
    elif fmt == "venn":
        sets = _items(data, "sets", errors, 2, ("id", "label"))
        if len(sets) > 3:
            errors.append("sets: at most 3")
    elif fmt == "molecule":
        molecules = data.get("molecules")
        if not isinstance(molecules, list) or not any(
            isinstance(m, dict) and any(re.match(r"(?i)smi", k) and m[k] for k in m) for m in molecules
        ):
            errors.append("molecules: needs at least one item with a SMILES string")
    elif fmt == "energy-levels":
        _any_of(data, ("orbitals", "levels"), errors)
    elif fmt == "circuit":
        _items(data, "loop", errors, 2)
    elif fmt == "steps":
        _items(data, "steps", errors, 1)
    elif fmt == "map":
        _any_of(data, ("places", "regions", "routes", "paths"), errors)
        for i, p in enumerate(data.get("places") or []):
            if not isinstance(p, dict) or not (_is_num(p.get("lat")) and _is_num(p.get("lon"))):
                errors.append(f"places.{i}: needs numeric lat and lon")
    elif fmt == "image":
        images = data.get("images") if isinstance(data.get("images"), list) else [data]
        if not images:
            errors.append("images: needs at least one image")
        for i, img in enumerate(images):
            src = img.get("src", "") if isinstance(img, dict) else ""
            src = str(src).strip()
            # Wikimedia, or a web image search_images signed (made-up tokens fail the check).
            if not (WIKIMEDIA_IMAGE.match(src) or (src.startswith(TOKEN_PREFIX) and verify_image_token(src))):
                errors.append(f"{'images.' + str(i) + '.' if 'images' in data else ''}src: must be an image URL from search_images")
    return errors


_CHART_FIELDS = {
    "metric_cards": ("items",),
    "table": ("columns", "rows"),
    "bar_chart": ("x", "series"),
    "line_chart": ("x", "series"),
    "area_chart": ("x", "series"),
    "pie_chart": ("items",),
    "scatter_chart": ("series",),
    "histogram": ("values",),
    "box_plot": ("groups",),
    "progress": ("items",),
    "timeline": ("items",),
    "comparison": ("items",),
    "callout": ("text",),
    "calculator": ("inputs", "outputs"),
}


def _check_interactive(data) -> list[str]:
    if not isinstance(data, dict) or not isinstance(data.get("components"), list) or not data["components"]:
        return ['needs {"version":1,"components":[...]} with at least one component']
    errors: list[str] = []
    for i, c in enumerate(data["components"]):
        kind = c.get("type") if isinstance(c, dict) else None
        if kind not in _CHART_FIELDS:
            errors.append(f"components.{i}.type: unknown {kind!r}; use one of {', '.join(_CHART_FIELDS)}")
            continue
        for f in _CHART_FIELDS[kind]:
            if c.get(f) in (None, "", []):
                errors.append(f"components.{i} ({kind}).{f}: required")
    return errors


def bare_images(data) -> dict | None:
    """search_images results pasted as they came -- an image object or a list of
    them, without "format" -- as the image visual they mean (the chat draws
    them so too); None for anything else."""
    def is_image(v) -> bool:
        return isinstance(v, dict) and "format" not in v and isinstance(v.get("src"), str)

    if isinstance(data, list) and data and all(is_image(v) for v in data):
        return {"format": "image", "images": data}
    if is_image(data):
        return {"format": "image", "images": [data]}
    if isinstance(data, dict) and data.get("format") == "image" and not data.get("images") and not data.get("src"):
        # The image list under another name ("items", "queries"...): whichever list holds images.
        key = next((k for k, v in data.items() if isinstance(v, list) and v and all(is_image(i) for i in v)), None)
        if key:
            return {**data, "images": data[key]}
    return None


def check_block(language: str, source: str) -> tuple[list[str], str | None]:
    """(errors, format) for one block's JSON; no errors means the chat can draw it."""
    try:
        data = lenient_json(source)
    except (json.JSONDecodeError, ValueError) as exc:
        return [f"invalid JSON: {exc}"], None
    if language != INTERACTIVE_LANGUAGE:
        data = bare_images(data) or data
    if language == INTERACTIVE_LANGUAGE:
        return _check_interactive(data), None
    if not isinstance(data, dict):
        return ["the visual must be a JSON object"], None
    fmt = data.get("format")
    if fmt not in FORMATS:
        return [f"unknown format {fmt!r}; use one of {', '.join(FORMATS)}"], None
    return _check_visual(data), fmt


# JSON written on the fence line ("```visual {...}", even with the closing
# fence on the same line): Markdown reads it as the fence's label and the
# block renders empty. Same rules as abyss_frontend/src/lib/visuals/fences.ts.
_ONE_LINE = re.compile(r"^([ \t]*)```(visual|trench-ui)[ \t]+([{\[].*?)[ \t]*```[ \t]*$", re.M)
_OPENING = re.compile(r"^([ \t]*)```(visual|trench-ui)[ \t]+([{\[].*)$", re.M)


def fence_fixes(text: str) -> list[tuple[str, str]]:
    """(old, new) line rewrites that move fence-line JSON onto its own line, in order."""
    fixes: list[tuple[str, str]] = []
    for m in _ONE_LINE.finditer(text or ""):
        indent, lang, body = m.groups()
        fixes.append((m.group(0), f"{indent}```{lang}\n{body}\n{indent}```"))
    rest = text or ""
    for old, new in fixes:
        rest = rest.replace(old, new, 1)
    for m in _OPENING.finditer(rest):
        indent, lang, body = m.groups()
        fixes.append((m.group(0), f"{indent}```{lang}\n{body}"))
    return fixes


def find_blocks(text: str) -> list[Block]:
    """Every ```visual / ```trench-ui block in the answer, with its problems."""
    blocks = []
    for match in _FENCE.finditer(text or ""):
        language = match.group(1)
        if language not in (VISUAL_LANGUAGE, INTERACTIVE_LANGUAGE):
            continue
        errors, fmt = check_block(language, match.group(2))
        blocks.append(Block(language, match.group(2), match.group(0), tuple(errors), fmt))
    return blocks
