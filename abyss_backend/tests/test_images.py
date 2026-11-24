"""search_images: Wikimedia Commons results -> the `image` visual's fields."""
import asyncio
import json
import re

import httpx
import pytest

from abyss_agents import images
from abyss_agents.images import _clean_url, parse_results, search_images

_REAL_CLIENT = httpx.AsyncClient


@pytest.fixture(autouse=True)
def _fresh_cache():
    images._cache.clear()
    yield
    images._cache.clear()

PAYLOAD = {
    "query": {
        "pages": [
            {
                "index": 2,
                "title": "File:Schema mitochondrion basic.svg",
                "imageinfo": [{
                    "mime": "image/svg+xml",
                    "thumburl": "https://thumb.wikimedia.org/wikipedia/commons/thumb/1/1a/x.svg/960px-x.svg.png?utm_source=commons",
                    "thumbwidth": 800, "thumbheight": 527,
                    "descriptionurl": "https://commons.wikimedia.org/wiki/File:Schema_mitochondrion_basic.svg",
                    "extmetadata": {
                        "Artist": {"value": '<a href="//commons.wikimedia.org/wiki/User:X">Kelvin &amp; Co</a>'},
                        "LicenseShortName": {"value": "CC BY-SA 4.0"},
                        "ImageDescription": {"value": "<p>Basic   diagram</p>"},
                    },
                }],
            },
            {
                "index": 1,
                "title": "File:Mitochondria TEM.jpg",
                "imageinfo": [{
                    "mime": "image/jpeg",
                    "url": "https://upload.wikimedia.org/wikipedia/commons/0/0c/M.jpg",
                    "descriptionurl": "https://commons.wikimedia.org/wiki/File:M.jpg",
                    "extmetadata": {},
                }],
            },
            {"index": 3, "title": "File:Talk.ogg", "imageinfo": [{"mime": "audio/ogg", "url": "https://upload.wikimedia.org/a.ogg"}]},
            {"index": 4, "title": "File:Evil.png", "imageinfo": [{"mime": "image/png", "url": "https://evil.example.com/a.png"}]},
        ]
    }
}


def test_results_are_ordered_cleaned_and_credited():
    results = parse_results(PAYLOAD)
    assert [r["title"] for r in results] == ["Mitochondria TEM", "Schema mitochondrion basic"]
    first, second = results
    assert first["src"] == "https://upload.wikimedia.org/wikipedia/commons/0/0c/M.jpg"
    assert first["author"] == "Unknown author" and first["license"] == "See file page"
    assert second["src"].startswith("https://thumb.wikimedia.org/") and "utm_" not in second["src"]
    assert second["author"] == "Kelvin & Co" and second["license"] == "CC BY-SA 4.0"
    assert second["description"] == "Basic diagram" and second["width"] == 800


def test_only_wikimedia_https_hosts_pass():
    assert _clean_url("http://upload.wikimedia.org/a.png") is None
    assert _clean_url("https://upload.wikimedia.org.evil.com/a.png") is None
    assert _clean_url("https://commons.wikimedia.org/a.png") is None
    assert _clean_url("https://upload.wikimedia.org/a.png?x=1#f") == "https://upload.wikimedia.org/a.png"


def _run(monkeypatch, handler, **args):
    transport = httpx.MockTransport(handler)
    monkeypatch.setattr(images.httpx, "AsyncClient", lambda **kw: _REAL_CLIENT(transport=transport, **kw))
    return asyncio.run(search_images.ainvoke({"queries": ["mitochondrion"], **args}))


def test_tool_sends_only_the_keywords_and_returns_json(monkeypatch):
    seen = {}

    def handler(request):
        seen["params"] = dict(request.url.params)
        seen["agent"] = request.headers["user-agent"]
        return httpx.Response(200, json=PAYLOAD)

    out = json.loads(_run(monkeypatch, handler, limit=50))
    assert len(out) == 2
    assert seen["params"]["gsrsearch"].startswith("mitochondrion ")
    assert seen["params"]["gsrlimit"] == "16"  # 2 x the capped 8, then filtered
    assert "@" not in seen["agent"]


def test_tool_failures_and_empty_results_are_plain_messages(monkeypatch):
    assert "unavailable" in _run(monkeypatch, lambda r: httpx.Response(503))
    assert "No images found" in _run(monkeypatch, lambda r: httpx.Response(200, json={}))
    assert "keywords" in asyncio.run(search_images.ainvoke({"queries": ["   "]}))


def test_several_queries_run_together_and_come_back_grouped(monkeypatch):
    seen = []

    def handler(request):
        q = dict(request.url.params)["gsrsearch"]
        seen.append(q)
        return httpx.Response(200, json=PAYLOAD if q.startswith("mitochondrion") else {})

    out = json.loads(_run(monkeypatch, handler, queries=["mitochondrion", "kidney", "mitochondrion", ""]))
    assert list(out) == ["mitochondrion", "kidney"] and len(seen) == 2  # no repeats, no blanks
    assert len(out["mitochondrion"]) == 2 and "no images found" in out["kidney"]


def test_a_repeated_search_is_served_from_the_cache(monkeypatch):
    calls = []

    def handler(request):
        calls.append(1)
        return httpx.Response(200, json=PAYLOAD)

    _run(monkeypatch, handler)
    _run(monkeypatch, handler)
    assert len(calls) == 1


def test_the_user_agent_follows_wikimedias_policy():
    # name/version (contact) library -- the contact is the app's public repository.
    assert re.match(r"^\S+/\S+ \(https://\S+\) python-httpx$", images.USER_AGENT)


def test_only_results_about_the_subject_are_kept_best_first():
    from abyss_agents.images import relevant

    results = [
        {"title": "Sunset over a lake", "description": "Generic landscape"},
        {"title": "Daniel Radcliffe 2009", "description": "Actor at a premiere"},
        {"title": "Daniel Radcliffe as Harry Potter", "description": "Harry Potter film promotion"},
        {"title": "Movie set photo", "description": "A film set"},
    ]
    kept = relevant("Daniel Radcliffe Harry Potter movie", results, 5)
    assert [r["title"] for r in kept] == ["Daniel Radcliffe as Harry Potter", "Daniel Radcliffe 2009"]
    # Generic words alone ("movie set photo") never make an image relevant.
    assert relevant("movie set photo", results, 5) == results[:5]  # nothing distinctive to check: unfiltered


def test_the_model_gets_only_what_it_copies():
    from abyss_agents.images import for_model

    full = {"src": "s", "page": "p", "title": "t", "description": "a long description", "author": "", "license": "L",
            "width": 800, "height": 600}
    assert for_model(full) == {"src": "s", "page": "p", "title": "t", "author": "", "license": "L"}
