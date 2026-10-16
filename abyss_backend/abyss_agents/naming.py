import re


def to_tool_name(name: str) -> str:
    """Derive a valid tool/agent identifier from a human-readable agent name.

    Canonical implementation — agent_service uses it for collision checks and
    the agent factory uses it as both the sub-agent's tool name and its
    `lc_agent_name` label in the event stream.

    Args:
        name: Human-readable sub-agent name, e.g. "Web Research Agent".

    Returns:
        Snake_case identifier, e.g. "web_research_agent".
    """
    sanitized = re.sub(r"[^a-zA-Z0-9]+", "_", name.lower()).strip("_")
    return re.sub(r"_+", "_", sanitized)
