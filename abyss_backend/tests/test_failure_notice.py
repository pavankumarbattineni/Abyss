"""A failed run: provider errors classified (even when wrapped) and turned into a friendly notice."""
import httpx
from google.genai.errors import ClientError, ServerError

from services.chat_service import _failure_notice
from utils.llm_providers import classify_llm_error


def _gemini_503() -> ServerError:
    return ServerError(503, {"error": {"code": 503, "message": "The model is overloaded", "status": "UNAVAILABLE"}})


def test_gemini_outage_is_recognised_directly_and_when_wrapped():
    assert classify_llm_error(_gemini_503())[0] == "provider_unavailable"
    try:
        try:
            raise _gemini_503()
        except ServerError as inner:
            raise RuntimeError("integration wrapper") from inner
    except RuntimeError as wrapped:
        assert classify_llm_error(wrapped)[0] == "provider_unavailable"


def test_outage_recognised_from_text_alone():
    code, _ = classify_llm_error(RuntimeError("Error calling model: 503 UNAVAILABLE (high demand)"))
    assert code == "provider_unavailable"


def test_network_and_model_errors():
    assert classify_llm_error(httpx.ConnectError("refused"))[0] == "provider_unreachable"
    assert classify_llm_error(httpx.ReadTimeout("slow"))[0] == "provider_timeout"
    not_found = ClientError(404, {"error": {"code": 404, "message": "no such model", "status": "NOT_FOUND"}})
    assert classify_llm_error(not_found)[0] == "model_not_found"


def test_unknown_errors_are_left_to_the_caller():
    assert classify_llm_error(ValueError("bug")) == (None, None)


def test_notice_is_friendly_and_never_shows_raw_errors():
    known = _failure_notice("provider_unavailable", "Google Gemini is temporarily unavailable.")
    assert known.startswith("**The model is busy right now.**") and "question is saved" in known
    unknown = _failure_notice("generation_failed", "KeyError('choices')")
    assert "KeyError" not in unknown and unknown.startswith("**Something went wrong.**")
