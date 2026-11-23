"""find_places: Wikipedia coordinates for the map visual."""
import asyncio
import json

import httpx

from abyss_agents import images, places
from abyss_agents.places import find_places, parse_place, parse_titles

_REAL_CLIENT = httpx.AsyncClient
_REAL_SLEEP = asyncio.sleep


def page(title, lat=None, lon=None, index=1, globe="earth"):
    p = {"title": title, "index": index, "description": f"About {title}"}
    if lat is not None:
        p["coordinates"] = [{"lat": lat, "lon": lon, "globe": globe}]
    return p


def test_the_first_search_hit_with_coordinates_wins():
    payload = {"query": {"pages": [page("Merv (band)", index=1), page("Merv", 37.66277778, 62.1925, index=2)]}}
    assert parse_place("Merv", payload) == {
        "name": "Merv", "lat": 37.6628, "lon": 62.1925, "article": "Merv", "description": "About Merv"}
    assert parse_place("Olympus Mons", {"query": {"pages": [page("Olympus Mons", 18.6, 226.2, globe="mars")]}}) is None
    assert parse_place("x", {}) is None


def test_the_batched_title_lookup_follows_normalisation_and_redirects():
    payload = {"query": {
        "normalized": [{"from": "rome", "to": "Rome"}],
        "redirects": [{"from": "Byzantium", "to": "Constantinople"}],
        "pages": [page("Rome", 41.9, 12.5), page("Constantinople", 41.0, 28.98), page("Atlantis")],
    }}
    out = parse_titles(["rome", "Byzantium", "Atlantis"], payload)
    assert set(out) == {"rome", "Byzantium"} and out["Byzantium"]["article"] == "Constantinople"


def _patch(monkeypatch, handler):
    transport = httpx.MockTransport(handler)
    monkeypatch.setattr(places.httpx, "AsyncClient", lambda **kw: _REAL_CLIENT(transport=transport, **kw))
    monkeypatch.setattr(images.asyncio, "sleep", lambda _s: _REAL_SLEEP(0))


def test_one_title_request_then_a_search_only_for_the_misses(monkeypatch):
    requests = []

    def handler(request):
        params = dict(request.url.params)
        requests.append(params)
        assert "@" not in request.headers["user-agent"]
        if "titles" in params:
            return httpx.Response(200, json={"query": {"pages": [page("Constantinople", 41.0, 29.0), page("Atlantis")]}})
        return httpx.Response(200, json={})  # the search finds nothing either

    _patch(monkeypatch, handler)
    out = json.loads(asyncio.run(find_places.ainvoke({"names": ["Constantinople", "Atlantis", "Constantinople", " "]})))
    assert [r.get("titles") or r.get("gsrsearch") for r in requests] == ["Constantinople|Atlantis", "Atlantis"]
    assert out[0]["lat"] == 41.0 and "not found" in out[1]["error"]
    assert "place names" in asyncio.run(find_places.ainvoke({"names": []}))


def test_a_throttled_request_is_tried_again(monkeypatch):
    calls = []

    def handler(request):
        calls.append(1)
        if len(calls) == 1:
            return httpx.Response(429, headers={"retry-after": "1"})
        return httpx.Response(200, json={"query": {"pages": [page("Rome", 41.9, 12.5)]}})

    _patch(monkeypatch, handler)
    out = json.loads(asyncio.run(find_places.ainvoke({"names": ["Rome"]})))
    assert len(calls) == 2 and out[0]["lat"] == 41.9
