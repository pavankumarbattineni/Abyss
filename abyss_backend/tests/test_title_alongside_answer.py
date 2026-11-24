"""A new thread's title is generated alongside its first answer, never after it."""
import asyncio
import inspect

from services import chat_service


class _Result:
    def __init__(self, rowcount):
        self.rowcount = rowcount


class _Session:
    """Stands in for a database session: records the title update."""

    def __init__(self, rowcount, log):
        self.rowcount, self.log = rowcount, log

    async def __aenter__(self):
        return self

    async def __aexit__(self, *exc):
        return False

    async def execute(self, statement):
        self.log.append(statement.compile().params)
        return _Result(self.rowcount)

    async def commit(self):
        self.log.append("commit")


def _patch(monkeypatch, *, title="Kyoto Travel Plan", rowcount=1):
    log = []

    async def generate(message, meta, ids, usage):
        return title

    import database.session

    monkeypatch.setattr(chat_service, "_generate_thread_title", generate)
    monkeypatch.setattr(database.session, "async_session_maker", lambda: _Session(rowcount, log))
    return log


async def test_the_title_is_saved_and_sent_to_the_stream(monkeypatch):
    log = _patch(monkeypatch)
    sent = []
    await chat_service._title_thread("t1", "Plan a trip to Kyoto", None, [], chat_service.TitleUsage(), sent.append)
    assert sent == ["Kyoto Travel Plan"]
    assert {"title": "Kyoto Travel Plan"}.items() <= log[0].items() and log[-1] == "commit"


async def test_a_title_the_user_set_meanwhile_is_kept(monkeypatch):
    _patch(monkeypatch, rowcount=0)  # the update only touches an untitled thread
    sent = []
    await chat_service._title_thread("t1", "Plan a trip", None, [], chat_service.TitleUsage(), sent.append)
    assert sent == []


async def test_no_title_no_write(monkeypatch):
    log = _patch(monkeypatch, title=None)  # the model call failed
    await chat_service._title_thread("t1", "Plan a trip", None, [], chat_service.TitleUsage(), lambda _t: None)
    assert log == []


async def test_stopping_the_answer_never_stops_the_title(monkeypatch):
    release = asyncio.Event()

    async def slow_title():
        await release.wait()
        return "done"

    title = asyncio.create_task(slow_title())
    waiter = asyncio.create_task(chat_service._await_title(title))
    await asyncio.sleep(0)
    waiter.cancel()  # the run is stopped while waiting for the title
    await asyncio.gather(waiter, return_exceptions=True)
    assert not title.cancelled()
    release.set()
    assert await title == "done"


async def test_a_slow_title_never_holds_the_answer_back(monkeypatch):
    monkeypatch.setattr(chat_service, "THREAD_TITLE_WAIT_SECONDS", 0.05)
    title = asyncio.create_task(asyncio.sleep(5))
    await asyncio.wait_for(chat_service._await_title(title), 1)  # returns, doesn't raise
    assert not title.done()
    title.cancel()


def test_the_title_starts_before_the_answer_streams():
    source = inspect.getsource(chat_service)
    assert source.index("title_task = _start_title_task(") < source.index("graph.astream_events(")
    # ...and the finished answer only waits for it, it doesn't start it.
    assert "_generate_thread_title(title_source" not in source
