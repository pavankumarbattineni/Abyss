"""search_images: Wikimedia Commons results -> the `image` visual's fields."""
import asyncio
import json

import httpx

from abyss_agents import images
from abyss_agents.images import _clean_url, parse_results, search_images

_REAL_CLIENT = httpx.AsyncClient

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
    return asyncio.run(search_images.ainvoke({"query": "mitochondrion", **args}))


def test_tool_sends_only_the_keywords_and_returns_json(monkeypatch):
    seen = {}

    def handler(request):
        seen["params"] = dict(request.url.params)
        seen["agent"] = request.headers["user-agent"]
        return httpx.Response(200, json=PAYLOAD)

    out = json.loads(_run(monkeypatch, handler, limit=50))
    assert len(out) == 2
    assert seen["params"]["gsrsearch"].startswith("mitochondrion ")
    assert seen["params"]["gsrlimit"] == "6"  # capped
    assert "@" not in seen["agent"]


def test_tool_failures_and_empty_results_are_plain_messages(monkeypatch):
    assert "unavailable" in _run(monkeypatch, lambda r: httpx.Response(503))
    assert "No images found" in _run(monkeypatch, lambda r: httpx.Response(200, json={}))
    assert "keywords" in asyncio.run(search_images.ainvoke({"query": "   "}))
