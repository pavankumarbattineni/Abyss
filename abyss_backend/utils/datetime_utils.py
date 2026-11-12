from datetime import UTC, datetime
from typing import Optional

# Timestamps are stored timezone-naive in UTC (see database.models.utcnow).
# A tz-aware datetime from a client (e.g. a "Z"-suffixed browser timestamp)
# must be converted to that same naive-UTC form before it's compared against
# or stored in a naive column -- passing a tz-aware datetime straight to
# asyncpg against a naive column raises a DataError.


def to_storage_naive(dt: Optional[datetime]) -> Optional[datetime]:
    if dt is not None and dt.tzinfo is not None:
        return dt.astimezone(UTC).replace(tzinfo=None)
    return dt
