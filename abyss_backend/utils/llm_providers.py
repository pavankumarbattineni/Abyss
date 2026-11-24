"""Provider integration registry for user-supplied ("bring your own") LLM credentials.

PROVIDERS holds only the code-level integration for each provider — how to
build a LangChain chat model for it, and how to validate a raw API key
before it is ever encrypted or stored. It intentionally does NOT list models
— the catalog of selectable models per provider is data, not code, and lives
in the `providers` / `provider_models` DB tables so new models can be added
with a plain INSERT instead of a deploy. Adding a new *provider* (as opposed
to a new model for an existing provider) still requires a code change here —
a build()/validate() pair and the underlying SDK are integration logic that
can't be expressed as a database row.
"""
import re
from dataclasses import dataclass
from typing import Callable

from langchain_anthropic import ChatAnthropic
from langchain_core.language_models import BaseChatModel
from langchain_google_genai import ChatGoogleGenerativeAI

from constants import GEMINI_MIN_THINKING_LEVEL, GEMINI_THINKING_BUDGET, MODEL_REQUEST_TIMEOUT_SECONDS
from langchain_openai import ChatOpenAI


@dataclass(frozen=True)
class ProviderSpec:
    display_name: str
    # build(model, api_key, native_reasoning): native_reasoning=True configures the
    # provider's own reasoning/thinking output so it arrives as `reasoning` content blocks.
    build: Callable[[str, str, bool], BaseChatModel]
    validate: Callable[[str], None]


def _validate_openai_key(api_key: str) -> None:
    from openai import AuthenticationError, OpenAI

    try:
        OpenAI(api_key=api_key).models.list()
    except AuthenticationError:
        raise ValueError("Invalid OpenAI API key.")
    except Exception as exc:
        raise ValueError(f"Could not validate OpenAI API key: {exc}")


def _validate_anthropic_key(api_key: str) -> None:
    from anthropic import Anthropic, AuthenticationError

    try:
        Anthropic(api_key=api_key).models.list()
    except AuthenticationError:
        raise ValueError("Invalid Anthropic API key.")
    except Exception as exc:
        raise ValueError(f"Could not validate Anthropic API key: {exc}")


def _validate_google_key(api_key: str) -> None:
    from google import genai
    from google.genai.errors import ClientError

    try:
        client = genai.Client(api_key=api_key)
        client.models.list()
    except ClientError as exc:
        if exc.code in (401, 403):
            raise ValueError("Invalid Google Gemini API key.")
        raise ValueError(f"Could not validate Google Gemini API key: {exc}")
    except Exception as exc:
        raise ValueError(f"Could not validate Google Gemini API key: {exc}")


# Anthropic requires max_tokens > the thinking budget. Without a max_tokens,
# ChatAnthropic uses the model's own output limit (its profile); this floor is
# only for a model it has no profile for.
_ANTHROPIC_THINKING_BUDGET = 4000
_ANTHROPIC_MIN_MAX_TOKENS = 16000


def _build_openai(model: str, api_key: str, native_reasoning: bool) -> BaseChatModel:
    if not native_reasoning:
        return ChatOpenAI(model=model, api_key=api_key, timeout=MODEL_REQUEST_TIMEOUT_SECONDS)
    # Reasoning summaries are only exposed through the Responses API.
    return ChatOpenAI(
        model=model, api_key=api_key, use_responses_api=True, timeout=MODEL_REQUEST_TIMEOUT_SECONDS,
        reasoning={"effort": "medium", "summary": "auto"},
    )


def _build_anthropic(model: str, api_key: str, native_reasoning: bool) -> BaseChatModel:
    # Room for long answers: the model's full output limit, not a small default.
    max_tokens = max(ChatAnthropic(model=model, api_key=api_key).max_tokens or 0, _ANTHROPIC_MIN_MAX_TOKENS)
    if not native_reasoning:
        return ChatAnthropic(
            model=model, api_key=api_key, max_tokens=max_tokens, default_request_timeout=MODEL_REQUEST_TIMEOUT_SECONDS,
        )
    return ChatAnthropic(
        model=model, api_key=api_key, max_tokens=max_tokens, default_request_timeout=MODEL_REQUEST_TIMEOUT_SECONDS,
        thinking={"type": "enabled", "budget_tokens": _ANTHROPIC_THINKING_BUDGET},
    )


def _gemini_thinking(llm: ChatGoogleGenerativeAI) -> dict:
    """Thinking settings that make this Gemini model return its thoughts, from
    the model's own profile (no model names here): a thinking level for models
    that have levels -- their default, at least GEMINI_MIN_THINKING_LEVEL --
    and a token budget for older ones."""
    profile = llm.profile or {}
    levels = list(profile.get("reasoning_effort_levels") or [])
    if not levels:
        return {"include_thoughts": True, "thinking_budget": GEMINI_THINKING_BUDGET}
    default = profile.get("reasoning_effort_default")
    floor = GEMINI_MIN_THINKING_LEVEL if GEMINI_MIN_THINKING_LEVEL in levels else levels[-1]
    level = max((lvl for lvl in (default, floor) if lvl in levels), key=levels.index)
    return {"include_thoughts": True, "thinking_level": level}


def _build_google(model: str, api_key: str, native_reasoning: bool) -> BaseChatModel:
    plain = ChatGoogleGenerativeAI(model=model, google_api_key=api_key, timeout=MODEL_REQUEST_TIMEOUT_SECONDS)
    if not native_reasoning:
        return plain
    return ChatGoogleGenerativeAI(
        model=model, google_api_key=api_key, timeout=MODEL_REQUEST_TIMEOUT_SECONDS, **_gemini_thinking(plain),
    )


PROVIDERS: dict[str, ProviderSpec] = {
    "openai": ProviderSpec(
        display_name="OpenAI",
        build=_build_openai,
        validate=_validate_openai_key,
    ),
    "anthropic": ProviderSpec(
        display_name="Anthropic",
        build=_build_anthropic,
        validate=_validate_anthropic_key,
    ),
    "google": ProviderSpec(
        display_name="Google Gemini",
        build=_build_google,
        validate=_validate_google_key,
    ),
}


def get_provider_spec(provider: str) -> ProviderSpec:
    """Look up a provider's spec, raising a clear error for unknown providers."""
    spec = PROVIDERS.get(provider)
    if not spec:
        raise ValueError(
            f"Unknown provider '{provider}'. Supported providers: {', '.join(PROVIDERS)}"
        )
    return spec


def _classify_one(exc: BaseException) -> tuple[str, str] | tuple[None, None]:
    """Classify a single exception (no cause chain); see classify_llm_error."""
    import anthropic
    import httpx
    import openai
    from google.genai.errors import ClientError, ServerError

    for sdk, name in ((openai, "OpenAI"), (anthropic, "Anthropic")):
        if isinstance(exc, sdk.AuthenticationError):
            return "invalid_api_key", f"Your {name} API key was rejected. Check it in Settings."
        if isinstance(exc, sdk.PermissionDeniedError):
            return "permission_denied", f"Your {name} API key doesn't have access to this model."
        if isinstance(exc, sdk.RateLimitError):
            return "rate_limited", f"{name} rate limit or quota exceeded. Wait a moment and try again, or check your plan/billing."
        if isinstance(exc, sdk.NotFoundError):
            return "model_not_found", f"{name} doesn't recognise this agent's model. Pick another model for the agent."
        if isinstance(exc, sdk.APITimeoutError):
            return "provider_timeout", f"{name} took too long to respond. Please try again."
        if isinstance(exc, sdk.APIConnectionError):
            return "provider_unreachable", f"Abyss couldn't reach {name}. Please try again shortly."
        if isinstance(exc, sdk.InternalServerError):
            return "provider_unavailable", f"{name} is temporarily unavailable. Please try again shortly."
    if isinstance(exc, anthropic.OverloadedError):
        return "provider_unavailable", "Anthropic is overloaded right now. Please try again shortly."
    if isinstance(exc, anthropic.RequestTooLargeError):
        return "request_too_large", "This conversation is too long for the model. Start a new thread to continue."

    if isinstance(exc, ClientError):
        if exc.code in (401, 403):
            return "invalid_api_key", "Your Google Gemini API key was rejected or lacks access to this model."
        if exc.code == 429:
            return "rate_limited", "Google Gemini rate limit or quota exceeded. Wait a moment and try again, or check your plan/billing."
        if exc.code == 404:
            return "model_not_found", "Google Gemini doesn't recognise this agent's model. Pick another model for the agent."
    if isinstance(exc, ServerError):
        return "provider_unavailable", "Google Gemini is temporarily unavailable. Please try again shortly."

    if isinstance(exc, (httpx.TimeoutException,)):
        return "provider_timeout", "The model provider took too long to respond. Please try again."
    if isinstance(exc, (httpx.ConnectError, httpx.RemoteProtocolError, httpx.ReadError, ConnectionError)):
        return "provider_unreachable", "Abyss couldn't reach the model provider. Please try again shortly."
    return None, None


# Provider outages as they read when an SDK error has been wrapped or re-raised
# as text (e.g. by a LangChain integration): "503 UNAVAILABLE", "overloaded"...
_UNAVAILABLE_TEXT = re.compile(
    r"\b(503|529)\b|\bUNAVAILABLE\b|overloaded|high demand|service unavailable|try again later",
    re.IGNORECASE,
)


def classify_llm_error(exc: BaseException) -> tuple[str, str] | tuple[None, None]:
    """Map a raised provider-SDK exception to a stable error_code + clean message.

    Chat-time errors (a call mid-conversation) are distinct from save-time key
    validation: the SDK exceptions here are the same shape, but at chat time we
    have no ValueError-catching caller to phrase a message -- this is what
    chat_service surfaces directly to the user instead of a raw exception dump.

    Follows the cause chain (integrations often wrap the SDK error), then falls
    back to recognising an outage from the error text. Returns (None, None) for
    anything unrecognized so the caller can fall back to its own handling.
    """
    seen: set[int] = set()
    current: BaseException | None = exc
    while current is not None and id(current) not in seen and len(seen) < 6:
        seen.add(id(current))
        code, message = _classify_one(current)
        if code:
            return code, message
        current = current.__cause__ or current.__context__
    if _UNAVAILABLE_TEXT.search(str(exc)):
        return "provider_unavailable", "The model provider is temporarily unavailable. Please try again shortly."
    return None, None
