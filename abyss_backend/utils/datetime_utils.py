from datetime import datetime, timedelta, timezone
from typing import Optional

# Mirrors database.models._IST — timestamps are stored timezone-naive,
# written in IST wall-clock time (see database.models.utcnow). Any tz-aware
# datetime coming from a client (e.g. a "Z"-suffixed UTC timestamp from a
# browser) must be converted to that same IST-naive representation before
# it's compared against or stored in a naive column — passing a tz-aware
# datetime straight to asyncpg against a naive column raises a DataError.
_IST = timezone(timedelta(hours=5, minutes=30))


def to_storage_naive(dt: Optional[datetime]) -> Optional[datetime]:
    if dt is not None and dt.tzinfo is not None:
        return dt.astimezone(_IST).replace(tzinfo=None)
    return dt
