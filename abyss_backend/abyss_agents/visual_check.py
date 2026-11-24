"""Checks the ```visual and ```abyss-ui blocks in an answer (pure, no LangChain).

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
from collections.abc import Callable
from dataclasses import dataclass

from abyss_agents.visual_specs import FORMATS, VISUAL_LANGUAGE
from abyss_agents.web_images import TOKEN_PREFIX, verify_image_token

INTERACTIVE_LANGUAGE = "abyss-ui"
# Earlier names of the interactive block tag: answers saved with them are
# still read (and a repaired one is written back under the current name).
LEGACY_INTERACTIVE_LANGUAGES = ("trench-ui",)
_BLOCK_LANGUAGES = "|".join(re.escape(x) for x in (VISUAL_LANGUAGE, INTERACTIVE_LANGUAGE, *LEGACY_INTERACTIVE_LANGUAGES))


def block_language(fence: str) -> str:
    """A fence's tag as the current block language (a legacy tag counts as the interactive one)."""
    return INTERACTIVE_LANGUAGE if fence in LEGACY_INTERACTIVE_LANGUAGES else fence
WIKIMEDIA_IMAGE = re.compile(r"^https://(upload|thumb)\.wikimedia\.org/")
# A fenced block: ```lang (rest of the line) ... ``` -- what the chat renders.
_FENCE = re.compile(r"```([\w-]*)[^\n]*\n(.*?)```", re.S)


@dataclass(frozen=True)
class Block:
    language: str  # "visual" or "abyss-ui"
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
            if not image_src_ok(img):
                errors.append(f"{'images.' + str(i) + '.' if 'images' in data else ''}src: must be an image URL from search_images")
    return errors


def image_src_ok(image: object) -> bool:
    """An image from search_images: on Wikimedia, or a web image token this
    server signed (made-up or rewritten addresses fail)."""
    src = str(image.get("src", "") if isinstance(image, dict) else "").strip()
    return bool(WIKIMEDIA_IMAGE.match(src) or (src.startswith(TOKEN_PREFIX) and verify_image_token(src)))


ImageCheck = Callable[[object], bool]
# What a search result gives an image (the model's own alt and caption are kept).
_SEARCH_FIELDS = ("src", "page", "author", "license", "source")


def _image_blocks(text: str):
    """(block text, data, its images) for every ```visual image block whose JSON parses."""
    for match in _FENCE.finditer(text or ""):
        if match.group(1) != VISUAL_LANGUAGE:
            continue
        try:
            data = lenient_json(match.group(2))
        except ValueError:  # broken JSON: the model repair's job (JSONDecodeError is a ValueError)
            continue
        if not isinstance(data, dict) or data.get("format") != "image":
            continue
        gallery = isinstance(data.get("images"), list)
        images = [i for i in data["images"] if isinstance(i, dict)] if gallery else ([data] if "src" in data else [])
        yield match.group(0), data, gallery, images


def image_search_for(image: dict, block: dict) -> tuple[str, str] | None:
    """The search that finds a real image for one the model wrote itself: its
    own description (alt, caption or title, else the block's title), from the
    source its made-up address pointed at -- a Wikimedia-like one: "open",
    any other: "web". None when nothing describes it."""
    words = next((str(v) for v in (image.get("alt"), image.get("caption"), image.get("title"), block.get("title"))
                  if v and str(v).strip()), "")
    query = " ".join(words.split())[:120]
    if not query:
        return None
    return query, "open" if "wikimedia.org" in str(image.get("src", "")) else "web"


def image_srcs(text: str) -> list[str]:
    """Every image address in the answer's image blocks."""
    return [str(i.get("src", "")).strip() for _, _, _, images in _image_blocks(text) for i in images]


def image_searches(text: str, ok: ImageCheck = image_src_ok) -> list[tuple[str, str]]:
    """(query, prefer) for every image in the answer that fails `ok`, each once."""
    wanted = []
    for _, data, _, images in _image_blocks(text):
        for image in images:
            search = None if ok(image) else image_search_for(image, data)
            if search and search not in wanted:
                wanted.append(search)
    return wanted


def image_fixes(
    text: str, ok: ImageCheck = image_src_ok, found: dict[tuple[str, str], list[dict]] | None = None,
) -> list[tuple[str, str]]:
    """(old, new) rewrites of image blocks holding images that fail `ok` (an
    address the model wrote itself instead of taking it from search_images).
    Each such image becomes a real one from `found` -- the results of its
    image_searches() entry, each result used once -- or, when there is none,
    is left out; a block with no image left is removed. No model call: a model
    can't recover an image's real address, only the search can."""
    fixes = []
    for block_text, data, gallery, images in _image_blocks(text):
        used = {str(i.get("src")) for i in images if ok(i)}
        kept, changed = [], False
        for image in images:
            if ok(image):
                kept.append(image)
                continue
            changed = True
            search = image_search_for(image, data)
            pick = next((r for r in (found or {}).get(search, []) if r.get("src") not in used), None) if search else None
            if pick:
                used.add(pick["src"])
                own = {k: v for k, v in image.items() if k not in _SEARCH_FIELDS}
                kept.append({**own, **{k: pick[k] for k in _SEARCH_FIELDS if pick.get(k) is not None}})
        if not changed:
            continue
        if not kept:
            new = ""
        elif gallery:
            new = f"```{VISUAL_LANGUAGE}\n{json.dumps({**data, 'images': kept}, ensure_ascii=False)}\n```"
        else:
            new = f"```{VISUAL_LANGUAGE}\n{json.dumps({**data, **kept[0]}, ensure_ascii=False)}\n```"
        fixes.append((block_text, new))
    return fixes


def unknown_format(source: str) -> bool:
    """A visual block whose JSON is fine but whose format doesn't exist (e.g. "comparison")."""
    try:
        data = lenient_json(source)
    except ValueError:
        return False
    return isinstance(data, dict) and isinstance(data.get("format"), str) and data["format"] not in FORMATS


def _label(value: object) -> str:
    return " ".join(str(value).split())


_HEADS = ("title", "label", "name", "heading")


def as_markdown(source: str) -> str | None:
    """A visual that can't be drawn, as readable text instead of an error card:
    its title in bold, then its content as (nested) bullets. None when the JSON
    doesn't parse. The last resort after a failed repair -- the content stays."""
    try:
        data = lenient_json(source)
    except ValueError:
        return None
    if not isinstance(data, dict):
        return None
    lines: list[str] = []

    def add(value: object, depth: int) -> None:
        pad = "  " * depth
        if isinstance(value, list):
            for item in value:
                add(item, depth)
        elif isinstance(value, dict):
            head = next((value[k] for k in _HEADS if isinstance(value.get(k), str) and value[k].strip()), None)
            if head is not None:
                lines.append(f"{pad}- **{_label(head)}**")
                depth += 1
                pad = "  " * depth
            for key, item in value.items():
                if key in _HEADS or key == "format" or item in (None, "", [], {}):
                    continue
                name = _label(key).replace("_", " ").capitalize()
                if isinstance(item, (dict, list)):
                    lines.append(f"{pad}- {name}:")
                    add(item, depth + 1)
                else:
                    lines.append(f"{pad}- {name}: {_label(item)}")
        elif value not in (None, ""):
            lines.append(f"{pad}- {_label(value)}")

    for key, value in data.items():
        if key in ("format", "title", "version"):
            continue
        # The content lists themselves ("items", "points"...) need no heading of their own.
        add(value if isinstance(value, list) else {key: value}, 0)
    title = f"**{_label(data['title'])}**\n\n" if isinstance(data.get("title"), str) and data["title"].strip() else ""
    return (title + "\n".join(lines)).strip() or None


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
    language = block_language(language)
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
_ONE_LINE = re.compile(r"^([ \t]*)```(" + _BLOCK_LANGUAGES + r")[ \t]+([{\[].*?)[ \t]*```[ \t]*$", re.M)
_OPENING = re.compile(r"^([ \t]*)```(" + _BLOCK_LANGUAGES + r")[ \t]+([{\[].*)$", re.M)


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


def language_fixes(text: str) -> list[tuple[str, str]]:
    """(old, new) rewrites of a block written in the wrong language: a
    ```visual block whose "format" is really an interactive component
    (comparison, table, bar_chart...) becomes an ```abyss-ui block, and a
    one-component ```abyss-ui block whose "type" is really a visual format
    becomes a ```visual block -- when the result is valid. No model call."""
    fixes = []
    for match in _FENCE.finditer(text or ""):
        language, source = block_language(match.group(1)), match.group(2)
        try:
            data = lenient_json(source)
        except ValueError:
            continue
        if not isinstance(data, dict):
            continue
        if language == VISUAL_LANGUAGE and data.get("format") in _CHART_FIELDS and data["format"] not in FORMATS:
            component = {"type": data["format"], **{k: v for k, v in data.items() if k != "format"}}
            new_language, new_data = INTERACTIVE_LANGUAGE, {"version": 1, "components": [component]}
        elif language == INTERACTIVE_LANGUAGE and len(data.get("components") or []) == 1 \
                and isinstance(data["components"][0], dict) and data["components"][0].get("type") in FORMATS \
                and data["components"][0]["type"] not in _CHART_FIELDS:
            component = data["components"][0]
            new_language, new_data = VISUAL_LANGUAGE, {"format": component["type"], **{k: v for k, v in component.items() if k != "type"}}
        else:
            continue
        new_source = json.dumps(new_data, ensure_ascii=False)
        if not check_block(new_language, new_source)[0]:
            fixes.append((match.group(0), f"```{new_language}\n{new_source}\n```"))
    return fixes


def find_blocks(text: str) -> list[Block]:
    """Every ```visual / ```abyss-ui block in the answer, with its problems."""
    blocks = []
    for match in _FENCE.finditer(text or ""):
        language = block_language(match.group(1))
        if language not in (VISUAL_LANGUAGE, INTERACTIVE_LANGUAGE):
            continue
        errors, fmt = check_block(language, match.group(2))
        blocks.append(Block(language, match.group(2), match.group(0), tuple(errors), fmt))
    return blocks
