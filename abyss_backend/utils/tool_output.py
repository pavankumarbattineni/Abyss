import json


def extract_tool_output(raw_out) -> str | None:
    """Extract clean text from a LangChain tool result.

    astream_events' on_tool_end output is a ToolMessage (or similar object
    with a .content attribute). Calling str() on those produces verbose
    Python repr like "content=[{'type': 'text', 'text': '...'}] name='...'
    tool_call_id='...'". This helper extracts just the meaningful text content.

    Shared by the tools-execution node (graph_builder.py's make_tools_node,
    which builds ToolMessages directly from raw MCP tool results for both the
    parent agent and every sub-agent) and chat_service's SSE event processing
    (which extracts from astream_events on_tool_end output) so both paths
    produce identically formatted tool output.
    """
    if raw_out is None:
        return None
    if isinstance(raw_out, str):
        return raw_out
    # LangChain ToolMessage or any object with a .content attribute
    content = getattr(raw_out, "content", None)
    if content is not None:
        if isinstance(content, str):
            return content
        if isinstance(content, list):
            parts = []
            for block in content:
                if isinstance(block, dict):
                    text = block.get("text", "")
                    if text:
                        parts.append(text)
                elif isinstance(block, str):
                    parts.append(block)
            return "\n".join(parts) if parts else None
    if isinstance(raw_out, list):
        parts = []
        for block in raw_out:
            if isinstance(block, dict):
                text = block.get("text", "")
                if text:
                    parts.append(text)
            elif isinstance(block, str):
                parts.append(block)
        return "\n".join(parts) if parts else None
    try:
        return json.dumps(raw_out)
    except Exception:
        return str(raw_out)
