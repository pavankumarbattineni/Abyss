"""Thread-title prompt and validation (pure, no LLM calls).

The model sometimes *answers* the opening message instead of titling it
("I'm sorry, but I can't help with that."), so every candidate is checked
before it's used; the caller retries once, then falls back to a title built
from the message's own key words. A reply is never saved as a title.
"""

import re

MAX_TITLE_WORDS = 6
MAX_TITLE_CHARS = 60

TITLE_SYSTEM_PROMPT = (
    "You label chat conversations. Given the user's first message, write a "
    f"specific title of 2 to {MAX_TITLE_WORDS} words, in title case, naming "
    "what the user wants -- lead with the subject or action, no filler words "
    "('Help', 'Question', 'Chat'). Never answer, refuse or comment on the "
    "message; only label it. Reply with the title alone: no quotes, markdown "
    "or trailing punctuation.\n\n"
    "Examples:\n"
    "Message: why does my payment webhook time out after 30s? -> Debug "
    "Payment Webhook Timeout\n"
    "Message: Can you help me? -> Request for Assistance\n"
    "Message: (something you can't help with) -> name its topic anyway, e.g. "
    "Medical Dosage Question"
)
RETRY_REMINDER = (
    "Your previous reply was not a title. Reply with ONLY a title of at most "
    f"{MAX_TITLE_WORDS} words naming the topic -- do not answer or refuse."
)


def title_request(message: str, *, retry: bool = False, max_chars: int = 2000) -> str:
    """The user turn for the title model: the message quoted as data to label."""
    text = f'Message: """{message[:max_chars]}"""\nTitle:'
    return f"{RETRY_REMINDER}\n\n{text}" if retry else text


# Signs the model replied to the message rather than labelling it.
_REPLY_PATTERN = re.compile(
    r"\b(i|i'm|im|i am|i'll|i can|i cannot|i can't|my|me|you|your|sorry|"
    r"unfortunately|sure|certainly|happy to|glad to|here's|here is|cannot|"
    r"can't|unable)\b",
    re.IGNORECASE,
)
_SMALL_WORDS = {
    "a", "an", "and", "as", "at", "by", "for", "from", "in", "of", "on", "or",
    "the", "to", "vs", "via", "with",
}  # fmt: skip
_STOPWORDS = _SMALL_WORDS | {
    "i", "im", "i'm", "me", "my", "we", "our", "you", "your", "it", "its", "is",
    "are", "was", "be", "been", "am", "do", "does", "did", "can", "could",
    "would", "should", "will", "please", "want", "need", "like", "really",
    "just", "how", "what", "why", "when", "where", "which", "who", "this",
    "that", "these", "those", "about", "help", "tell", "explain", "give",
    "show", "some", "any", "so", "if", "into", "now", "hi", "hello", "hey",
    "thanks", "there", "have", "has", "get", "know", "understand", "trying",
    "try", "make", "let", "lets", "let's",
}  # fmt: skip


def _title_case(words: list[str]) -> str:
    out = []
    for i, word in enumerate(words):
        lower = word.lower()
        if i > 0 and lower in _SMALL_WORDS:
            out.append(lower)
        elif word.isupper() or any(c.isupper() for c in word[1:]):
            out.append(word)  # acronyms and mixed case: API, MCP, iPhone
        else:
            out.append(word[:1].upper() + word[1:])
    return " ".join(out)


def clean_title(raw: str | None) -> str | None:
    """A normalised title, or None if the candidate isn't usable (empty, too
    long, a question, or a reply rather than a label)."""
    if not raw:
        return None
    text = raw.replace("’", "'").replace("‘", "'").strip()
    line = text.splitlines()[0] if text else ""
    line = re.sub(r"^title\s*:\s*", "", line, flags=re.IGNORECASE)
    line = line.strip().strip("\"'`*#_ ").strip()
    if not line or line.endswith("?"):
        return None
    line = line.rstrip(".!:;,").strip()
    words = line.split()
    if not words or len(words) > MAX_TITLE_WORDS or _REPLY_PATTERN.search(line):
        return None
    title = _title_case(words)
    return title if len(title) <= MAX_TITLE_CHARS else None


def fallback_title(message: str) -> str:
    """A title from the message's own key words, when the model won't give one."""
    words = re.findall(r"[A-Za-z0-9][A-Za-z0-9'+.-]*", message)
    keep = [w.strip(".'") for w in words if w.lower().strip(".'") not in _STOPWORDS]
    keep = [w for w in keep if w][:4]
    return _title_case(keep) if keep else "Request for Assistance"
