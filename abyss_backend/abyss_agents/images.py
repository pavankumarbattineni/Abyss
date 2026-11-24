"""The `search_images` tool: real images for the `image` visual.

The agent names, for every subject it searches, the sources that suit it --
a film's poster from Wikipedia, a person's photo from Wikidata, a diagram
from Commons... (abyss_agents/image_sources, one module per source; the
tool's description lists them from there). No classifier, no fixed topic
map: the agent's own understanding of the subject decides. A subject searched
without sources gets the exact-subject and openly licensed ones.

For each call this coordinator:
  1. searches every chosen source for every subject at once (each source
     with its own concurrency gate and 6 h cache, so one slow or failing
     source never holds up the others);
  2. per subject, alternates the sources' results in the agent's order,
     keeps only images whose title, description or page names the subject
     (relevant()), drops copies of the same image, sites that keep failing or
     are excluded (image_sites.py) and images too small to read;
  3. tops up a subject that came back short from the open web (Brave) --
     never the first choice, so answers don't fill with arbitrary web images;
  4. returns the best `limit` per subject, with only the fields the model
     copies (for_model()).

The model never invents image URLs: the chat accepts only Wikimedia
addresses and tokens this server signed (abyss_frontend/src/lib/visuals/schemas.ts,
abyss_agents/visual_check.py). Only the search words leave the server: no user
or conversation data.
"""
from __future__ import annotations

import asyncio
import json
import logging
import re
import time
from urllib.parse import urlsplit

import httpx
from langchain_core.tools import tool
from pydantic import BaseModel, Field, model_validator

from abyss_agents import image_sites, image_sources
from abyss_agents.http_retry import describe
from abyss_agents.image_sources.base import ImageSource
from abyss_agents.image_sources.mediawiki import clean_url as _clean_url  # noqa: F401  (re-exported)
from abyss_agents.image_sources.mediawiki import parse_files as parse_results  # noqa: F401  (re-exported)
from abyss_agents.tool_display import background_step

logger = logging.getLogger(__name__)

# Wikimedia's User-Agent policy asks API clients for "name/version (contact)
# library": requests without contact information get throttled or refused,
# above all from shared cloud servers. The contact is the app's public
# repository -- no user, account or deployment details. Sent to every source.
USER_AGENT = "AbyssImageSearch/1.1 (https://github.com/pavankumarbattineni/Abyss) python-httpx"
TIMEOUT_SECONDS = 10.0
MAX_QUERIES = 5
MAX_RESULTS = 8
# Below this many images for a subject, the open web tops it up.
_TOP_UP_BELOW = 2
# Smaller images (when the size is known) are icons or thumbnails, unreadable in a gallery.
_MIN_WIDTH, _MIN_HEIGHT = 300, 200
# Successful searches are reused for a while (the same subjects come up again).
_CACHE_SECONDS = 6 * 3600
_CACHE_MAX = 500
_cache: dict[tuple[str, int], tuple[float, list[dict]]] = {}


# --- Relevance -----------------------------------------------------------------

# Words that describe a picture rather than its subject: they don't make a result relevant.
_GENERIC = {
    "the", "and", "for", "with", "from", "image", "images", "photo", "photos", "picture", "pictures",
    "portrait", "diagram", "illustration", "drawing", "map", "view", "movie", "film", "films", "series",
    "show", "tv", "set", "scene", "scenes", "location", "locations", "filming", "actor", "actress",
    "cast", "character", "characters", "official", "poster", "still", "real", "famous", "book", "cover",
    "game", "games", "novel", "album", "season",
}


def _words(text: str) -> set[str]:
    return {w for w in re.findall(r"[a-z0-9]+", text.lower().replace("_", " ")) if len(w) >= 3 or w.isdigit()}


def _about(result: dict) -> str:
    """What a result says it shows: its title, description and page address
    (a web page's path often names the film or product: /interstellar-review)."""
    page = urlsplit(result.get("page") or "").path.replace("-", " ").replace("/", " ")
    return f"{result.get('title', '')} {result.get('description', '')} {page}"


def relevant(query: str, results: list[dict], limit: int) -> list[dict]:
    """Only results whose title, description or page names the query's subject
    (one of its distinctive words), most matching words first -- so an image is
    never unrelated to what was searched. Order is kept among equals (the
    sources' own ranking, in the agent's order)."""
    subject = _words(query) - _GENERIC
    if not subject:
        return results[:limit]
    stem = lambda w: w[:6] if len(w) >= 6 else w  # noqa: E731 -- "mitochondrion" ~ "mitochondria"
    wanted = {stem(w) for w in subject}
    scored = []
    for i, r in enumerate(results):
        hits = len(wanted & {stem(w) for w in _words(_about(r))})
        if hits:
            scored.append((-hits, i, r))
    return [r for _, _, r in sorted(scored)][:limit]


# --- Merging ---------------------------------------------------------------------


def interleave(*lists: list[dict], limit: int | None = None) -> list[dict]:
    """lists[0][0], lists[1][0], ..., lists[0][1], ... -- every source gets a turn, in order."""
    out: list[dict] = []
    for i in range(max((len(x) for x in lists), default=0)):
        out.extend(x[i] for x in lists if i < len(x))
    return out if limit is None else out[:limit]


def _identity(result: dict) -> str:
    """The same picture found by several sources -- at different sizes or
    hosts -- shares its file name: one key for all its copies."""
    raw = str(result.get("key") or result.get("src") or "")
    name = urlsplit(raw).path.rsplit("/", 1)[-1] if "/" in raw else raw
    name = re.sub(r"^\d+px-", "", name.lower())
    return name if len(name) >= 12 else raw.lower()


def _usable(result: dict, skipped: set[str], excluded: tuple[str, ...]) -> bool:
    """Not too small to read, and not from a site that keeps failing or is excluded."""
    try:
        if int(result.get("width")) < _MIN_WIDTH or int(result.get("height")) < _MIN_HEIGHT:
            return False
    except (TypeError, ValueError):
        pass
    host = image_sites.site_of(str(result.get("key") or ""))
    return not host or not (image_sites.is_listed(host, skipped) or image_sites.is_listed(host, excluded))


def subject_names(per_source: list[list[dict]]) -> list[str]:
    """The subject's real name as an exact-subject source resolved it (its best
    result's article or entity name: "Grand Theft Auto V" for "GTA V")."""
    for results in per_source:
        for r in results[:1]:
            if r.get("subject"):
                return [r["subject"]]
    return []


def pick(query: str, per_source: list[list[dict]], limit: int, skipped: set[str] = frozenset(),
         excluded: tuple[str, ...] = (), names: list[str] | None = None) -> list[dict]:
    """One subject's best images from its sources' results: each source's own
    results ranked by relevance, then the sources alternating in the agent's
    order -- so the agent's choice leads. An image names the subject when it
    matches the query or the subject's real name (`names`)."""
    names = names if names is not None else subject_names(per_source)
    ranked = []
    for results in per_source:
        ordered: dict[str, dict] = {}  # query matches first (most matching words first), then name matches
        for subject in [query, *names]:
            for r in relevant(subject, results, 4 * limit):
                ordered.setdefault(_identity(r), r)
        ranked.append(list(ordered.values()))
    seen: set[str] = set()
    out = []
    for r in interleave(*ranked):
        key = _identity(r)
        if key in seen or not _usable(r, skipped, excluded):
            continue
        seen.add(key)
        out.append(r)
    return out[:limit]


# --- Searching -------------------------------------------------------------------


def _remember(key: tuple[str, int], results: list[dict]) -> None:
    """Cache a search, keeping at most _CACHE_MAX: expired entries go first, then the oldest."""
    if len(_cache) >= _CACHE_MAX:
        now = time.monotonic()
        for stale in [k for k, (expires, _) in _cache.items() if expires <= now]:
            del _cache[stale]
        while len(_cache) >= _CACHE_MAX:
            del _cache[next(iter(_cache))]
    _cache[key] = (time.monotonic() + _CACHE_SECONDS, results)


async def _cached(source: ImageSource, client: httpx.AsyncClient, gate: asyncio.Semaphore,
                  query: str, limit: int) -> list[dict] | None:
    """One source's results for one subject: from the cache, or searched under the
    source's concurrency gate. None when the source failed (logged, never raised)."""
    key = (f"{source.name}:{query.lower()}", limit)
    hit = _cache.get(key)
    if hit and hit[0] > time.monotonic():
        return hit[1]
    async with gate:
        try:
            results = await source.search(client, query, limit)
        except (httpx.HTTPError, ValueError, KeyError, TypeError) as exc:
            logger.warning("%s image search failed (%s) for a %d-word query", source.name, describe(exc), len(query.split()))
            return None
    _remember(key, results)
    return results


async def find_images(searches: list[tuple[str, list[str]]], limit: int = 3) -> list[list[dict] | None]:
    """Per (subject, chosen sources): its images, best first; [] when none
    match; None when every source searched failed. What search_images
    returns, for callers that aren't the model too -- the visual repair finding
    real images for ones the model wrote itself (visual_repair.py)."""
    limit = max(1, min(MAX_RESULTS, int(limit or 3)))
    plans = [(query, image_sources.chosen(names)) for query, names in searches]
    skipped = await image_sites.skipped_sites()
    excluded = image_sites.configured_blocks()
    fallback = image_sources.FALLBACK
    async with httpx.AsyncClient(timeout=TIMEOUT_SECONDS, headers={"User-Agent": USER_AGENT}, follow_redirects=True) as client:
        gates = {name: asyncio.Semaphore(s.concurrency) for name, s in image_sources.CHOOSABLE.items()}
        gates[fallback.name] = asyncio.Semaphore(fallback.concurrency)
        # Every subject x chosen source at once.
        runs = [[_cached(s, client, gates[s.name], query, limit) for s in sources] for query, sources in plans]
        flat = iter(await asyncio.gather(*(r for row in runs for r in row)))
        found = [[next(flat) for _ in row] for row in runs]
        names = [subject_names([r for r in lists if r]) for lists in found]
        picked = [pick(query, [r for r in lists if r], limit, skipped, excluded, names[i])
                  for i, ((query, _), lists) in enumerate(zip(plans, found))]
        # The open web only for subjects the chosen sources came back short on.
        short = [i for i, p in enumerate(picked) if len(p) < min(limit, _TOP_UP_BELOW)]
        extra: dict[int, list[dict] | None] = {}
        if short and fallback.available():
            more = await asyncio.gather(*(_cached(fallback, client, gates[fallback.name], plans[i][0], limit) for i in short))
            extra = dict(zip(short, more))
    out: list[list[dict] | None] = []
    for i, ((query, _), lists) in enumerate(zip(plans, found)):
        if all(r is None for r in lists) and extra.get(i) is None:
            out.append(None)
            continue
        top_up = extra.get(i) or []
        out.append(pick(query, [picked[i], top_up], limit, skipped, excluded, names[i]) if top_up else picked[i])
    return out


# --- The tool --------------------------------------------------------------------


class ImageSearch(BaseModel):
    """One subject to find images of."""

    query: str = Field(description="a few English keywords naming one subject")
    sources: list[str] = Field(
        default_factory=list,
        description="the sources that suit this subject, best first",
        # The registry's names, so a model can only choose a real source.
        json_schema_extra={"items": {"type": "string", "enum": list(image_sources.CHOOSABLE)}},
    )

    @model_validator(mode="before")
    @classmethod
    def _from_text(cls, value: object) -> object:
        return {"query": value} if isinstance(value, str) else value  # a plain string is a query with default sources


def clean_queries(queries: object) -> list[ImageSearch]:
    """Searches as the tool takes them: trimmed, deduplicated, at most MAX_QUERIES."""
    if isinstance(queries, (str, dict, ImageSearch)):
        queries = [queries]
    seen: dict[str, ImageSearch] = {}
    for item in queries or []:
        try:
            search = item if isinstance(item, ImageSearch) else ImageSearch.model_validate(item)
        except ValueError:
            continue
        text = " ".join(str(search.query or "").split())[:200]
        if text and text.lower() not in seen:
            seen[text.lower()] = ImageSearch(query=text, sources=search.sources)
    return list(seen.values())[:MAX_QUERIES]


# What the model copies into an image block (and the title, to know what each image shows).
# The description, size and key only serve relevance and filtering here: a long description
# is what models cut short mid-JSON when copying a result whole.
_FOR_MODEL = ("src", "page", "title", "author", "license", "source")


def for_model(result: dict) -> dict:
    return {k: result[k] for k in _FOR_MODEL if result.get(k) not in (None, "") or k in ("author", "license")}


@tool("search_images")
async def search_images(queries: list[ImageSearch], limit: int = 3) -> str:
    """Find real images of the subjects an answer explains, from the sources chosen for each."""
    cleaned = clean_queries(queries)
    if not cleaned:
        return "Give one or more searches, each a few keywords describing an image."
    found = await find_images([(q.query, q.sources) for q in cleaned], limit)
    if all(r is None for r in found):
        return "Image search is unavailable right now. Answer without images."
    found = [[for_model(r) for r in results] if results else results for results in found]
    if len(cleaned) == 1:
        if not found[0]:
            return f'No images found for "{cleaned[0].query}". Try other keywords or sources, or answer without an image.'
        return json.dumps(found[0], ensure_ascii=False)
    out = {q.query: (r or "no images found -- try other keywords or sources, or skip this image") for q, r in zip(cleaned, found)}
    return json.dumps(out, ensure_ascii=False)


search_images.description = f"""Find real images of the subjects an answer explains.

Use it when seeing the real thing helps: a place, landmark, person, organism,
artwork, object, historical photo, a labelled diagram, or a film's, series',
book's or game's poster or cover.
`queries`: one to five subjects, each {{"query": a few English keywords naming
one subject, "sources": the sources that suit THAT subject, best first}}, e.g.
[{{"query": "Interstellar film", "sources": ["wikipedia"]}},
 {{"query": "Christopher Nolan", "sources": ["wikidata", "wikipedia"]}},
 {{"query": "human heart anatomy", "sources": ["commons", "openverse"]}}].
Sources:
{image_sources.describe()}
Choose for each subject what will actually picture it; the open web tops up a
subject only when these come back short.
Returns up to `limit` (1-8) images per subject, best match first, each with
src, page, author and license (and `source`, the site, where it isn't
Wikimedia Commons): show them with ```visual {{"format":"image"}} blocks,
copying those fields exactly."""


# Only prepares what the answer shows: the chat lists no step for it (tool_display.py).
background_step(search_images, "Finding images…")
