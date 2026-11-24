"""A missing resource is a 404 (clients tell "deleted" from "bad request"); other ValueErrors stay 422."""
from fastapi import FastAPI
from fastapi.testclient import TestClient

from middleware.error_handler import GlobalErrorHandlerMiddleware
from utils.errors import NotFoundError


def _client():
    app = FastAPI()
    app.add_middleware(GlobalErrorHandlerMiddleware)

    @app.get("/gone")
    async def gone():
        raise NotFoundError("Thread not found")

    @app.get("/bad")
    async def bad():
        raise ValueError("message cannot be empty")

    return TestClient(app)


def test_not_found_is_a_404_and_other_value_errors_stay_422():
    client = _client()
    gone = client.get("/gone")
    assert gone.status_code == 404 and gone.json() == {"status_code": 404, "status": "NotFound", "message": "Thread not found"}
    assert client.get("/bad").status_code == 422
    assert issubclass(NotFoundError, ValueError)  # existing `except ValueError` keeps catching it
