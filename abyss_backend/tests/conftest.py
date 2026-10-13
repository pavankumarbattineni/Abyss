import os

import pytest

# services.chat_service turns LangSmith tracing on from the app config at import time. Tests use
# scripted fake models and deliberately trigger failures, so they must never send traces to the
# real LangSmith project. Import first (so its setup has run), then force tracing off before any
# traced call is made.
import services.chat_service  # noqa: F401,E402

for _var in ("LANGCHAIN_TRACING_V2", "LANGSMITH_TRACING", "LANGCHAIN_TRACING"):
    os.environ[_var] = "false"


@pytest.fixture(autouse=True)
def _isolated_tool_registry():
    """Each test starts and ends with an empty in-memory MCP tool registry."""
    from utils import mcp_client

    mcp_client._agent_tool_registry.clear()
    mcp_client._agent_tool_permissions.clear()
    yield
    mcp_client._agent_tool_registry.clear()
    mcp_client._agent_tool_permissions.clear()
