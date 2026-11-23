"""find_places: Wikipedia coordinates for the map visual."""
import asyncio
import json

import httpx

from abyss_agents import places
from abyss_agents.places import find_places, parse_place

_REAL_CLIENT = httpx.AsyncClient


def page(title, lat=None, lon=None, index=1, globe="earth"):
    p = {"title": title, "index": index, "description": f"About {title}"}
    if lat is not None:
        p["coordinates"] = [{"lat": lat, "lon": lon, "globe": globe}]
    return p


def test_the_first_hit_with_coordinates_wins():
    payload = {"query": {"pages": [page("Merv (band)", index=1), page("Merv", 37.66277778, 62.1925, index=2)]}}
    assert parse_place("Merv", payload) == {
        "name": "Merv", "lat": 37.6628, "lon": 62.1925, "article": "Merv", "description": "About Merv"}
    assert parse_place("Olympus Mons", {"query": {"pages": [page("Olympus Mons", 18.6, 226.2, globe="mars")]}}) is None
    assert parse_place("x", {}) is None


def test_tool_looks_up_each_name_once_and_marks_misses(monkeypatch):
    seen = []

    def handler(request):
        q = dict(request.url.params)["gsrsearch"]
        seen.append(q)
        assert "@" not in request.headers["user-agent"]
        return httpx.Response(200, json={"query": {"pages": [page(q, 41.0, 29.0)]}} if q == "Constantinople" else {})

    transport = httpx.MockTransport(handler)
    monkeypatch.setattr(places.httpx, "AsyncClient", lambda **kw: _REAL_CLIENT(transport=transport, **kw))
    out = json.loads(asyncio.run(find_places.ainvoke({"names": ["Constantinople", "Atlantis", "Constantinople", " "]})))
    assert sorted(seen) == ["Atlantis", "Constantinople"]
    assert out[0]["lat"] == 41.0 and "not found" in out[1]["error"]
    assert "place names" in asyncio.run(find_places.ainvoke({"names": []}))
