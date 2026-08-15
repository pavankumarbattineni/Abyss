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
from dataclasses import dataclass
from typing import Callable

from langchain_anthropic import ChatAnthropic
from langchain_core.language_models import BaseChatModel
from langchain_google_genai import ChatGoogleGenerativeAI
from langchain_openai import ChatOpenAI


@dataclass(frozen=True)
class ProviderSpec:
    display_name: str
    build: Callable[[str, str], BaseChatModel]
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


PROVIDERS: dict[str, ProviderSpec] = {
    "openai": ProviderSpec(
        display_name="OpenAI",
        build=lambda model, api_key: ChatOpenAI(model=model, api_key=api_key),
        validate=_validate_openai_key,
    ),
    "anthropic": ProviderSpec(
        display_name="Anthropic",
        build=lambda model, api_key: ChatAnthropic(model=model, api_key=api_key),
        validate=_validate_anthropic_key,
    ),
    "google": ProviderSpec(
        display_name="Google Gemini",
        build=lambda model, api_key: ChatGoogleGenerativeAI(model=model, google_api_key=api_key),
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


def classify_llm_error(exc: Exception) -> tuple[str, str] | tuple[None, None]:
    """Map a raised provider-SDK exception to a stable error_code + clean message.

    Chat-time errors (a call mid-conversation) are distinct from save-time key
    validation: the SDK exceptions here are the same shape, but at chat time we
    have no ValueError-catching caller to phrase a message — this is what
    chat_service surfaces directly to the user instead of a raw exception dump.
    Returns (None, None) for anything unrecognized so the caller can fall back
    to its own generic handling.
    """
    import anthropic
    import openai
    from google.genai.errors import ClientError, ServerError

    if isinstance(exc, openai.AuthenticationError):
        return "invalid_api_key", "Your OpenAI API key was rejected. Check it in Settings."
    if isinstance(exc, openai.PermissionDeniedError):
        return "permission_denied", "Your OpenAI API key doesn't have access to this model."
    if isinstance(exc, openai.RateLimitError):
        return "rate_limited", "OpenAI rate limit or quota exceeded. Wait a moment and try again, or check your plan/billing."

    if isinstance(exc, anthropic.AuthenticationError):
        return "invalid_api_key", "Your Anthropic API key was rejected. Check it in Settings."
    if isinstance(exc, anthropic.PermissionDeniedError):
        return "permission_denied", "Your Anthropic API key doesn't have access to this model."
    if isinstance(exc, anthropic.RateLimitError):
        return "rate_limited", "Anthropic rate limit or quota exceeded. Wait a moment and try again, or check your plan/billing."

    if isinstance(exc, ClientError):
        if exc.code in (401, 403):
            return "invalid_api_key", "Your Google Gemini API key was rejected or lacks access to this model."
        if exc.code == 429:
            return "rate_limited", "Google Gemini rate limit or quota exceeded. Wait a moment and try again, or check your plan/billing."
    if isinstance(exc, ServerError):
        return "provider_unavailable", "Google Gemini is temporarily unavailable. Please try again shortly."

    return None, None
