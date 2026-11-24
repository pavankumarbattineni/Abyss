"""Image sources (abyss_agents/image_sources) and the search_images coordinator:
the agent chooses sources per subject, the open web only tops up."""
import asyncio
import json

import httpx
import pytest

from abyss_agents import image_sites, image_sources, images, web_images
from abyss_agents.image_sources import openlibrary, openverse, wikidata
from abyss_agents.image_sources.mediawiki import parse_files
from abyss_agents.images import search_images
from abyss_agents.web_images import image_token_targets, sign_image_url, verify_image_token

_REAL_CLIENT = httpx.AsyncClient


@pytest.fixture(autouse=True)
def _isolated(monkeypatch):
    images._cache.clear()

    async def nothing_skipped():
        return set()

    monkeypatch.setattr(image_sites, "skipped_sites", nothing_skipped)
    monkeypatch.setattr(image_sites, "configured_blocks", lambda: ())
    yield
    images._cache.clear()


def _file(title, src, licence="CC BY-SA 4.0", non_free=False, artist="A. Photographer", w=800, h=600, index=1):
    meta = {"LicenseShortName": {"value": licence}, "Artist": {"value": artist}}
    if non_free:
        meta["NonFree"] = {"value": "true"}
    return {"index": index, "title": f"File:{title}", "imageinfo": [{
        "mime": "image/jpeg", "thumburl": src, "thumbwidth": w, "thumbheight": h,
        "descriptionurl": f"https://example.org/{title}", "extmetadata": meta}]}


# --- Sources -------------------------------------------------------------------

def test_a_wikipedia_poster_is_credited_to_its_owner_not_given_a_free_licence():
    payload = {"query": {"pages": [
        _file("House of the Dragon season 3.jpg", "https://upload.wikimedia.org/wikipedia/en/f/f7/HotD3.jpg",
              licence="Fair use", non_free=True, artist="HBO"),
        _file("House of the dragon logo.png", "https://upload.wikimedia.org/wikipedia/commons/4/4b/logo.png",
              licence="Public domain", index=2),
    ]}}
    poster, logo = parse_files(payload, via="en.wikipedia.org")
    assert poster["license"] == "© its owner" and poster["author"] == "HBO" and poster["source"] == "en.wikipedia.org"
    assert logo["license"] == "Public domain" and "source" not in logo  # a free Commons file: credited as usual


def test_wikidata_finds_each_entitys_official_image_in_search_order():
    entities = {
        "Q2": {"claims": {}},  # no image
        "Q1": {"labels": {"en": {"value": "Christopher Nolan"}}, "descriptions": {"en": {"value": "filmmaker"}},
               "claims": {"P18": [{"mainsnak": {"datavalue": {"value": "Christopher Nolan 2018.jpg"}}}]}},
    }
    assert wikidata.images_of(entities, ["Q1", "Q2"]) == [("Christopher Nolan 2018.jpg", "Christopher Nolan -- filmmaker")]


def test_openverse_results_are_credited_and_load_through_the_proxy_with_a_fallback():
    [r] = openverse.parse({"results": [{
        "url": "https://live.staticflickr.com/1/red_panda_big.jpg", "thumbnail": "https://api.openverse.org/v1/images/x/thumb/",
        "foreign_landing_url": "https://www.flickr.com/photos/1", "title": "Red Panda", "creator": "Chester Zoo",
        "license": "by-nd", "license_version": "2.0", "source": "flickr", "width": 1024, "height": 768,
        "tags": [{"name": "panda"}],
    }]})
    assert r["license"] == "CC BY-ND 2.0" and r["author"] == "Chester Zoo" and r["source"] == "flickr"
    assert image_token_targets(r["src"]) == ["https://live.staticflickr.com/1/red_panda_big.jpg", "https://api.openverse.org/v1/images/x/thumb/"]


def test_open_library_gives_covers_credited_to_their_owner():
    [r] = openlibrary.parse({"docs": [{"title": "The Hobbit", "author_name": ["J.R.R. Tolkien"], "cover_i": 14627509, "key": "/works/OL27482W"},
                                      {"title": "No cover"}]})
    assert verify_image_token(r["src"]) == "https://covers.openlibrary.org/b/id/14627509-L.jpg"
    assert r["license"] == "© its owner" and r["source"] == "openlibrary.org" and r["page"].endswith("/works/OL27482W")


# --- Coordinator -----------------------------------------------------------------

def _route(monkeypatch, by_host, brave_key=None):
    """Every request answered by its host's payload (or {}); returns the hosts asked, in order."""
    seen = []

    async def handler(request):
        seen.append(request.url.host)
        answer = by_host.get(request.url.host, {})
        if callable(answer):
            answer = await answer(request)
        return httpx.Response(200, json=answer)

    transport = httpx.MockTransport(handler)
    monkeypatch.setattr(images.httpx, "AsyncClient", lambda **kw: _REAL_CLIENT(transport=transport, **kw))
    monkeypatch.setattr(web_images, "brave_api_key", lambda: brave_key)
    return seen


def _commons(n, name="Red panda"):
    return {"query": {"pages": [_file(f"{name} {i}.jpg", f"https://upload.wikimedia.org/c/{name.replace(' ', '_')}_{i}.jpg", index=i)
                                for i in range(1, n + 1)]}}


def _openverse(n, name="Red panda"):
    return {"results": [{"url": f"https://live.staticflickr.com/{i}/{name.replace(' ', '_')}_photo_{i}.jpg", "title": f"{name} photo {i}",
                         "foreign_landing_url": f"https://flickr.com/{i}", "license": "by", "license_version": "2.0",
                         "source": "flickr", "width": 900, "height": 600} for i in range(1, n + 1)]}


def _search(**args):
    return json.loads(asyncio.run(search_images.ainvoke(args)))


def test_the_agents_sources_are_used_in_its_order_and_alternate(monkeypatch):
    seen = _route(monkeypatch, {"commons.wikimedia.org": _commons(3), "api.openverse.org": _openverse(3)})
    out = _search(queries=[{"query": "red panda", "sources": ["openverse", "commons"]}], limit=4)
    assert ["flickr" if r.get("source") == "flickr" else "commons" for r in out] == ["flickr", "commons", "flickr", "commons"]
    assert set(seen) == {"commons.wikimedia.org", "api.openverse.org"}  # only the chosen sources


def test_chosen_sources_are_searched_at_the_same_time(monkeypatch):
    started = {"commons.wikimedia.org": asyncio.Event(), "api.openverse.org": asyncio.Event()}

    def waits_for_the_other(payload):
        async def answer(request):
            started[request.url.host].set()
            other = next(h for h in started if h != request.url.host)
            await asyncio.wait_for(started[other].wait(), timeout=2)  # one after the other would time out
            return payload
        return answer

    _route(monkeypatch, {"commons.wikimedia.org": waits_for_the_other(_commons(2)),
                         "api.openverse.org": waits_for_the_other(_openverse(2))})
    assert len(_search(queries=[{"query": "red panda", "sources": ["commons", "openverse"]}], limit=4)) == 4


def test_the_open_web_only_tops_up_a_subject_the_chosen_sources_came_back_short_on(monkeypatch):
    brave = {"results": [{"title": "Red panda in a tree", "url": "https://zoo.example.com/rp",
                          "properties": {"url": "https://zoo.example.com/rp.jpg", "width": 900, "height": 600},
                          "thumbnail": {"src": "https://imgs.search.brave.com/rp"}}]}
    seen = _route(monkeypatch, {"commons.wikimedia.org": _commons(3), "api.search.brave.com": brave}, brave_key="test-key")
    _search(queries=[{"query": "red panda", "sources": ["commons"]}], limit=3)
    assert "api.search.brave.com" not in seen  # enough from the chosen source: the web isn't asked

    images._cache.clear()
    seen = _route(monkeypatch, {"commons.wikimedia.org": _commons(1), "api.search.brave.com": brave}, brave_key="test-key")
    out = _search(queries=[{"query": "red panda", "sources": ["commons"]}], limit=3)
    assert "api.search.brave.com" in seen and [r.get("source") for r in out] == [None, "zoo.example.com"]
    assert image_token_targets(out[1]["src"])[1] == "https://imgs.search.brave.com/rp"  # Brave's copy as the fallback


def test_unknown_or_missing_sources_mean_the_default_ones_never_the_web(monkeypatch):
    seen = _route(monkeypatch, {"commons.wikimedia.org": _commons(3)}, brave_key="test-key")
    _search(queries=[{"query": "red panda", "sources": ["brave", "google"]}], limit=3)
    assert {"en.wikipedia.org", "www.wikidata.org", "commons.wikimedia.org", "api.openverse.org"} <= set(seen)
    assert "api.search.brave.com" not in seen  # the agent can't choose the open web
    assert [s.name for s in image_sources.chosen(["Wikidata", "nope", "wikidata"])] == ["wikidata"]


def test_the_same_image_from_two_sources_appears_once(monkeypatch):
    same = {"query": {"pages": [_file("Red panda 1.jpg", "https://upload.wikimedia.org/thumb/c/Red_panda_1.jpg/800px-Red_panda_1.jpg")]}}
    _route(monkeypatch, {"commons.wikimedia.org": same, "en.wikipedia.org": {}})
    picked = images.pick("red panda", [parse_files(same), parse_files(_commons(1))], 5)
    assert len(picked) == 1


def test_sites_that_keep_failing_or_are_excluded_are_left_out():
    results = openverse.parse(_openverse(2))
    results[0]["key"] = "https://blocked.example.com/red_panda_photo.jpg"
    kept = images.pick("red panda", [results], 5, skipped={"blocked.example.com"})
    assert len(kept) == 1 and "blocked" not in kept[0]["key"]
    assert images.pick("red panda", [results], 5, excluded=("staticflickr.com",)) == [results[0]]


def test_a_plain_string_is_still_a_search_with_the_default_sources():
    [q] = images.clean_queries(["  red   panda  "])
    assert q.query == "red panda" and q.sources == []


def test_the_tool_offers_exactly_the_registered_sources():
    schema = search_images.args_schema.model_json_schema()
    item = schema["$defs"]["ImageSearch"]["properties"]["sources"]["items"]
    assert item["enum"] == list(image_sources.CHOOSABLE) and "brave" not in item["enum"]
    for name in image_sources.CHOOSABLE:
        assert f'"{name}"' in search_images.description


# --- Fallback copy ---------------------------------------------------------------

def test_the_proxy_serves_the_fallback_copy_when_the_site_refuses(monkeypatch):
    from routers import image_proxy

    def handler(request):
        if request.url.host == "refusing.example.com":
            return httpx.Response(403)
        return httpx.Response(200, headers={"content-type": "image/jpeg"}, content=b"\xff\xd8copy")

    transport = httpx.MockTransport(handler)
    monkeypatch.setattr(image_proxy.httpx, "AsyncClient", lambda **kw: _REAL_CLIENT(transport=transport, **kw))

    async def public(_url):
        return True

    recorded = []

    async def record(url, ok):
        recorded.append((url.split("/")[2], ok))

    monkeypatch.setattr(image_proxy, "_public_host", public)
    monkeypatch.setattr(image_proxy.image_sites, "record", record)
    token = sign_image_url("https://refusing.example.com/a.jpg", "https://imgs.search.brave.com/a")
    response = asyncio.run(image_proxy.image_proxy(t=token))
    assert response.body == b"\xff\xd8copy"
    assert recorded == [("refusing.example.com", False), ("imgs.search.brave.com", True)]


def test_site_failures_are_best_effort_without_a_database(monkeypatch):
    # No database reachable (as in tests): recording and reading never raise.
    asyncio.run(image_sites.record("https://somewhere.example.com/a.jpg", ok=False))
    assert image_sites.is_listed("cdn.blocked.example.com", ("blocked.example.com",))
    assert not image_sites.is_listed("notblocked.example.com", ("blocked.example.com",))
