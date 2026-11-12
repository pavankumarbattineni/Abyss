"""Thread titles: a reply or refusal is never used as a title."""

import pytest

from utils.thread_title import clean_title, fallback_title, title_request


@pytest.mark.parametrize(
    "raw",
    [
        "I’m sorry, but I can’t help with that.",
        "I'm happy to help you analyze your loan, but I'll need some details.",
        "Sure! Here's a title",
        "What would you like to know?",
        "A title that is far too long to be a title here",
        "",
    ],
)
def test_replies_and_long_text_are_not_titles(raw):
    assert clean_title(raw) is None


@pytest.mark.parametrize(
    ("raw", "expected"),
    [
        ('"debug payment webhook timeout."', "Debug Payment Webhook Timeout"),
        ("Title: MCP vs API comparison", "MCP vs API Comparison"),
        ("**Request for assistance**", "Request for Assistance"),
    ],
)
def test_titles_are_cleaned_and_title_cased(raw, expected):
    assert clean_title(raw) == expected


def test_fallback_title_uses_the_messages_key_words():
    title = fallback_title("I want to build an agent that summarises my GitHub issues")
    assert title == "Build Agent Summarises GitHub"
    assert fallback_title("Can you help me?") == "Request for Assistance"


def test_the_message_is_quoted_as_data_and_capped():
    request = title_request("x" * 5000, max_chars=100)
    assert request.startswith('Message: """') and request.endswith('"""\nTitle:')
    assert request.count("x") == 100
    assert title_request("hi", retry=True).startswith("Your previous reply was not a title.")
