"""Web image fallback (Brave) and the signed image proxy."""
import asyncio
import json

import httpx
import pytest
from fastapi import HTTPException

from abyss_agents import images, web_images
from abyss_agents.images import search_images
from abyss_agents.visual_check import check_block
from abyss_agents.web_images import parse_brave, sign_image_url, verify_image_token
from routers import image_proxy

_REAL_CLIENT = httpx.AsyncClient

BRAVE = {"results": [
    {"title": "Harry Potter and the Philosopher's Stone poster", "url": "https://example.com/hp",
     "meta_url": {"hostname": "www.example.com"}, "properties": {"url": "https://img.example.com/hp.jpg", "width": 600, "height": 900}},
    {"title": "Unrelated sunset", "url": "https://example.com/x", "properties": {"url": "https://img.example.com/x.jpg"}},
    {"title": "no image address", "url": "https://example.com/y", "properties": {}},
]}


@pytest.fixture(autouse=True)
def _fresh_cache():
    images._cache.clear()
    yield
    images._cache.clear()


def test_tokens_are_signed_and_tampering_is_caught():
    token = sign_image_url("https://img.example.com/hp.jpg")
    assert token.startswith("abyss-image:")
    assert verify_image_token(token) == "https://img.example.com/hp.jpg"
    body, sig = token.removeprefix("abyss-image:").split(".")
    forged = sign_image_url("https://evil.example.com/x.jpg").removeprefix("abyss-image:").split(".")[0]
    assert verify_image_token(f"abyss-image:{forged}.{sig}") is None  # another URL, old signature
    assert verify_image_token("abyss-image:junk") is None
    assert verify_image_token(sign_image_url("file:///etc/passwd")) is None  # never anything but http(s)


def test_brave_results_become_credited_signed_images():
    out = parse_brave(BRAVE)
    assert len(out) == 2  # the one without an image address is dropped
    hp = out[0]
    assert verify_image_token(hp["src"]) == "https://img.example.com/hp.jpg"
    assert hp["source"] == "example.com" and hp["page"] == "https://example.com/hp"
    # The image visual accepts signed web images, and nothing else from the web.
    assert check_block("visual", json.dumps({"format": "image", "src": hp["src"]})) == ([], "image")
    assert check_block("visual", json.dumps({"format": "image", "src": "abyss-image:aGk.forged"}))[0]


def _route(monkeypatch, commons, brave, key="test-key"):
    seen = []

    def handler(request):
        seen.append(request.url.host)
        if request.url.host == "api.search.brave.com":
            assert request.headers["x-subscription-token"] == key
            assert request.url.params["safesearch"] == "strict"
            return httpx.Response(200, json=brave)
        return httpx.Response(200, json=commons)

    transport = httpx.MockTransport(handler)
    monkeypatch.setattr(images.httpx, "AsyncClient", lambda **kw: _REAL_CLIENT(transport=transport, **kw))
    monkeypatch.setattr(web_images, "brave_api_key", lambda: key)
    return seen


def test_web_images_top_up_a_subject_wikimedia_lacks(monkeypatch):
    seen = _route(monkeypatch, commons={}, brave=BRAVE)  # Commons: nothing
    out = json.loads(asyncio.run(search_images.ainvoke({"queries": ["Harry Potter poster"], "limit": 3})))
    assert "api.search.brave.com" in seen
    assert [r["title"] for r in out] == ["Harry Potter and the Philosopher's Stone poster"]  # unrelated one filtered



def test_off_without_a_key(monkeypatch):
    seen = _route(monkeypatch, commons={}, brave=BRAVE, key="")
    monkeypatch.setattr(web_images, "brave_api_key", lambda: None)
    out = asyncio.run(search_images.ainvoke({"queries": ["Harry Potter poster"]}))
    assert "No images found" in out and "api.search.brave.com" not in seen


def test_the_proxy_refuses_private_addresses_and_unsigned_tokens():
    for url in ("http://127.0.0.1/a.png", "http://10.0.0.5/a.png", "http://localhost/a.png", "http://[::1]/a.png", "ftp://x/a.png"):
        assert asyncio.run(image_proxy._public_host(url)) is False, url
    with pytest.raises(HTTPException) as exc:
        asyncio.run(image_proxy.image_proxy(t="abyss-image:bm90.signed"))
    assert exc.value.status_code == 403


def _proxy_serves(monkeypatch, response):
    transport = httpx.MockTransport(lambda request: response)
    monkeypatch.setattr(image_proxy.httpx, "AsyncClient", lambda **kw: _REAL_CLIENT(transport=transport, **kw))

    async def public(_url):
        return True

    monkeypatch.setattr(image_proxy, "_public_host", public)
    return asyncio.run(image_proxy.image_proxy(t=sign_image_url("https://img.example.com/hp.jpg")))


def test_the_proxy_serves_raster_images_only(monkeypatch):
    ok = _proxy_serves(monkeypatch, httpx.Response(200, headers={"content-type": "image/jpeg"}, content=b"\xff\xd8jpeg"))
    assert ok.body == b"\xff\xd8jpeg" and ok.headers["access-control-allow-origin"] == "*"
    for bad, code in ((httpx.Response(200, headers={"content-type": "image/svg+xml"}, content=b"<svg/>"), 415),
                      (httpx.Response(200, headers={"content-type": "text/html"}, content=b"<html>"), 415),
                      (httpx.Response(404), 502)):
        with pytest.raises(HTTPException) as exc:
            _proxy_serves(monkeypatch, bad)
        assert exc.value.status_code == code


def test_stock_photo_sites_are_never_shown():
    stock = {"results": [
        {"title": "Hogwarts Castle photo", "url": "https://stock.adobe.com/x", "meta_url": {"hostname": "stock.adobe.com"},
         "properties": {"url": "https://t4.ftcdn.net/jpg/hp.jpg"}},
        {"title": "Hogwarts Castle", "url": "https://www.istockphoto.com/x", "properties": {"url": "https://media.istockphoto.com/hp.jpg"}},
        {"title": "Hogwarts Castle in the films", "url": "https://www.cbr.com/x", "properties": {"url": "https://static0.cbrimages.com/hp.jpg"}},
    ]}
    assert [r["source"] for r in parse_brave(stock)] == ["cbr.com"]



def test_a_throttled_web_search_is_retried(monkeypatch):
    calls = {"brave": 0}

    def handler(request):
        if request.url.host == "api.search.brave.com":
            calls["brave"] += 1
            return httpx.Response(429, headers={"retry-after": "0"}) if calls["brave"] == 1 else httpx.Response(200, json=BRAVE)
        return httpx.Response(200, json={})

    transport = httpx.MockTransport(handler)
    monkeypatch.setattr(images.httpx, "AsyncClient", lambda **kw: _REAL_CLIENT(transport=transport, **kw))
    monkeypatch.setattr(web_images, "brave_api_key", lambda: "test-key")
    out = json.loads(asyncio.run(search_images.ainvoke({"queries": ["Harry Potter poster"]})))
    assert calls["brave"] == 2 and len(out) == 1



def test_no_results_message_names_no_single_source(monkeypatch):
    _route(monkeypatch, commons={}, brave={"results": []})
    out = asyncio.run(search_images.ainvoke({"queries": ["Harry Potter poster"]}))
    assert out.startswith('No images found for "Harry Potter poster"') and "Wikimedia" not in out


# ── Source choice (`prefer`) ──────────────────────────────────────────────────

def _commons_pages(title, n):
    return {"query": {"pages": [
        {"index": i, "title": f"File:{title} {i}.jpg", "imageinfo": [{"mime": "image/jpeg",
         "url": f"https://upload.wikimedia.org/{i}.jpg", "descriptionurl": "https://commons.wikimedia.org/x"}]}
        for i in range(1, n + 1)]}}


def _web_results(title, n):
    return {"results": [{"title": f"{title} still {i}", "url": f"https://film.example.com/{i}",
                         "properties": {"url": f"https://img.example.com/{i}.jpg", "width": 800, "height": 450}}
                        for i in range(1, n + 1)]}


def _search(**args):
    return json.loads(asyncio.run(search_images.ainvoke(args)))








# ── Web results quality ───────────────────────────────────────────────────────

def test_copies_tiny_images_and_wikimedia_files_are_dropped_from_web_results():
    payload = {"results": [
        {"title": "Dune poster", "url": "https://a.example.com/dune", "properties": {"url": "https://a.example.com/img/dune-poster.jpg", "width": 1000, "height": 1500}},
        {"title": "Dune poster", "url": "https://b.example.com/dune", "properties": {"url": "https://cdn.b.example.com/x/dune-poster.jpg", "width": 1000, "height": 1500}},
        {"title": "Dune icon", "url": "https://c.example.com/dune", "properties": {"url": "https://c.example.com/dune.png", "width": 64, "height": 64}},
        {"title": "Dune book", "url": "https://d.example.com/dune", "properties": {"url": "https://upload.wikimedia.org/dune.jpg", "width": 800, "height": 1200}},
        {"title": "Dune still", "url": "https://e.example.com/dune", "properties": {"url": "https://e.example.com/still.jpg"}},
    ]}
    assert [r["source"] for r in parse_brave(payload)] == ["a.example.com", "e.example.com"]


def test_a_web_page_address_can_show_the_image_is_relevant():
    result = {"title": "Image 4", "description": "", "page": "https://example.com/reviews/interstellar-review"}
    assert images.relevant("Interstellar film", [result], 3) == [result]


# ── Tokens a model can only copy ──────────────────────────────────────────────

def test_a_token_never_reveals_the_image_address():
    import base64
    url = "https://img.example.com/posters/interstellar.jpg"
    token = sign_image_url(url)
    body = token.removeprefix("abyss-image:").split(".")[0]
    assert base64.urlsafe_b64encode(url.encode()).decode()[:12] not in body  # not base64 of the address
    assert "interstellar" not in token and verify_image_token(token) == url
    assert sign_image_url(url) != token  # a fresh nonce every time


def test_tokens_from_before_encryption_still_load():
    # Chats saved before encryption hold plain base64 tokens: still verified, never forgeable.
    body = web_images._b64(b"https://img.example.com/old.jpg")
    sig = web_images._b64(web_images.hmac.new(web_images._signing_key(), body.encode(), web_images.hashlib.sha256).digest()[:16])
    assert verify_image_token(f"abyss-image:{body}.{sig}") == "https://img.example.com/old.jpg"
    assert verify_image_token(f"abyss-image:{body}.{sig[:-2]}xx") is None


def test_stock_photos_rehosted_on_other_sites_are_dropped():
    payload = {"results": [{"title": "Gion Kyoto", "url": "https://blog.example.com/gion",
                            "properties": {"url": "https://blog.example.com/uploads/AdobeStock_277982098.jpg"}}]}
    assert parse_brave(payload) == []


# ── Images the model wrote itself never reach the chat ────────────────────────

def test_images_not_from_the_search_are_left_out_without_a_model_call():
    from abyss_agents.visual_check import find_blocks, image_fixes

    good = "https://upload.wikimedia.org/wikipedia/commons/a/ab/Kyoto.jpg"
    raw = "https://blog.example.com/uploads/gion.jpg"
    gallery = json.dumps({"format": "image", "images": [{"src": good, "page": "p"}, {"src": raw, "page": "p"}]})
    single = json.dumps({"format": "image", "src": raw, "page": "p"})
    text = f"Kyoto\n```visual\n{gallery}\n```\nGion\n```visual\n{single}\n```\nEnd"
    for old, new in image_fixes(text):
        text = text.replace(old, new, 1)
    assert raw not in text and good in text and "Gion\n\nEnd" in text
    assert [b.errors for b in find_blocks(text)] == [()]


def test_broken_json_is_left_to_the_model_repair():
    from abyss_agents.visual_check import image_fixes

    # A header then a list with a raw line break inside a string: not valid JSON.
    broken = '```visual\n{"format":"image"}\n[{"src":"https://x.example.com/a.jpg","title":"line\nbreak"}]\n```'
    assert image_fixes(broken) == []
