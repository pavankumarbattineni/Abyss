"""Which sites' images to leave out of searches.

- Learned: the image proxy records every image site it can't load from
  (refused, gone, not an image); after FAILURES_TO_SKIP failures in a row the
  site is skipped for SKIP_DAYS, then tried again. Stored in the database
  (image_sites), so it survives restarts and is shared by every instance;
  read through a short in-memory cache.
- Chosen: ABYSS_CONFIG.IMAGES.blocked_sites -- sites an operator excludes,
  changed in the environment settings without a deploy.

Best effort: if the database can't be reached nothing is skipped or
recorded, and image search goes on as usual.
"""
from __future__ import annotations

import logging
import time
from datetime import timedelta

from sqlalchemy import select
from sqlalchemy.dialects.postgresql import insert

from config import config

logger = logging.getLogger(__name__)

FAILURES_TO_SKIP = 3
SKIP_DAYS = 7
_REFRESH_SECONDS = 300
_skipped: set[str] = set()
_failing: set[str] = set()  # sites with failures recorded: a success there resets them
_loaded_at = 0.0


def _sessions():
    """The database sessions this module uses (tests replace it to keep it offline)."""
    from database.session import async_session_maker

    return async_session_maker()


def site_of(url: str) -> str:
    from urllib.parse import urlsplit

    return (urlsplit(url or "").hostname or "").lower().removeprefix("www.")


def configured_blocks() -> tuple[str, ...]:
    sites = (config.get("IMAGES") or {}).get("blocked_sites") or []
    return tuple(str(s).strip().lower().removeprefix("www.") for s in sites if str(s).strip())


def is_listed(host: str, sites) -> bool:
    """`host` is one of `sites` or a subdomain of one."""
    return any(host == s or host.endswith("." + s) for s in sites)


async def skipped_sites() -> set[str]:
    """Sites to leave out now: the learned ones still within their skip period."""
    global _loaded_at
    if time.monotonic() - _loaded_at < _REFRESH_SECONDS:
        return _skipped
    try:
        from database.models import ImageSite, utcnow

        async with _sessions() as session:
            rows = (await session.execute(select(ImageSite.host, ImageSite.failures, ImageSite.skip_until))).all()
        now = utcnow()
        _skipped.clear()
        _skipped.update(host for host, _, until in rows if until and until > now)
        _failing.clear()
        # Failing or skipped: a success there (an older answer's image) resets the site.
        _failing.update(host for host, failures, until in rows if failures or until)
    except Exception as exc:  # no database (tests, a local run without one): skip nothing
        logger.debug("image_sites unavailable: %s", type(exc).__name__)
    _loaded_at = time.monotonic()
    return _skipped


async def record(url: str, ok: bool) -> None:
    """The image proxy's outcome for an image at `url`."""
    host = site_of(url)
    if not host or (ok and host not in _failing):
        return  # nothing to reset: no database write for the usual success
    try:
        from database.models import ImageSite, utcnow

        async with _sessions() as session:
            if ok:
                stmt = insert(ImageSite).values(host=host, failures=0, skip_until=None).on_conflict_do_update(
                    index_elements=[ImageSite.host], set_={"failures": 0, "skip_until": None, "updated_at": utcnow()},
                )
                _failing.discard(host)
                _skipped.discard(host)
            else:
                failures = ImageSite.failures + 1
                stmt = insert(ImageSite).values(host=host, failures=1).on_conflict_do_update(
                    index_elements=[ImageSite.host], set_={"failures": failures, "updated_at": utcnow()},
                ).returning(ImageSite.failures)
            result = await session.execute(stmt)
            if not ok:
                count = result.scalar_one()
                _failing.add(host)
                if count >= FAILURES_TO_SKIP:
                    until = utcnow() + timedelta(days=SKIP_DAYS)
                    await session.execute(
                        ImageSite.__table__.update().where(ImageSite.host == host).values(skip_until=until, failures=0)
                    )
                    _skipped.add(host)
                    logger.info("Image site skipped for %d days after %d failures: %s", SKIP_DAYS, count, host)
            await session.commit()
    except Exception as exc:
        logger.debug("image_sites record failed: %s", type(exc).__name__)
