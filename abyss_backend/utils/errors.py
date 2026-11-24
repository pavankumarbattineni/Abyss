"""Errors the API maps to a specific HTTP status (middleware/error_handler.py).

A plain ValueError is a bad request (422). NotFoundError -- something that
doesn't exist or isn't the caller's -- is a 404, so a client can tell "this
was deleted" from "this request was wrong" without reading the message.
It is still a ValueError, so code that catches ValueError keeps working.
"""


class NotFoundError(ValueError):
    """The requested resource doesn't exist (or isn't the caller's): HTTP 404."""
