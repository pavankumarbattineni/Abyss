import asyncio
import json
import logging
import re
from collections import OrderedDict
from typing import Annotated, Any, TypedDict

logger = logging.getLogger(__name__)

import anyio
import httpx
from langchain_core.messages import AIMessage, HumanMessage, ToolMessage
from langchain_core.runnables import RunnableConfig
from langchain_core.tools import StructuredTool
from langgraph.graph import StateGraph, START, END
from langgraph.graph.message import add_messages
from langgraph.types import Send, interrupt
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from constants import (
    GRAPH_CACHE_MAX_SIZE,
    LLM_CALL_MAX_RETRIES,
    LLM_CALL_RETRY_BACKOFF_SECONDS,
    MAX_PARALLEL_TASKS,
    SUB_AGENT_RECURSION_LIMIT,
    SUB_AGENT_TIMEOUT_SECONDS,
)
from database.models import Agent
from utils.mcp_client import get_tool_permissions_for_agent, get_tools_for_agent
from utils.reasoning_splitter import sanitize_for_reasoning_tags
from utils.tool_output import extract_tool_output

# Transient network errors talking to the LLM provider (dropped connection,
# reset mid-stream). Not specific to request content, so a bare retry is safe
# wherever nothing with side effects has happened yet in that call.
_TRANSIENT_LLM_EXCEPTIONS = (
    anyio.BrokenResourceError,
    anyio.ClosedResourceError,
    httpx.RemoteProtocolError,
    httpx.ReadError,
    httpx.WriteError,
    httpx.ConnectError,
    ConnectionError,
)


async def _ainvoke_with_retry(runnable, *args, **kwargs):
    """Retry runnable.ainvoke(...) a few times on transient network errors.

    Safe to use only where nothing with side effects (tool execution) has run
    yet in the current call — e.g. a single LLM turn before its tool calls (if
    any) are executed. Do NOT use this around a multi-step agent loop that may
    have already executed non-idempotent tools before failing partway through.
    """
    last_exc: Exception | None = None
    for attempt in range(LLM_CALL_MAX_RETRIES + 1):
        try:
            return await runnable.ainvoke(*args, **kwargs)
        except _TRANSIENT_LLM_EXCEPTIONS as exc:
            last_exc = exc
            if attempt < LLM_CALL_MAX_RETRIES:
                logger.warning(
                    "Transient LLM connection error (attempt %d/%d): %r — retrying",
                    attempt + 1, LLM_CALL_MAX_RETRIES + 1, exc,
                )
                await asyncio.sleep(LLM_CALL_RETRY_BACKOFF_SECONDS * (attempt + 1))
    logger.error(
        "Transient LLM connection error persisted after %d attempts: %r",
        LLM_CALL_MAX_RETRIES + 1, last_exc,
    )
    raise last_exc

REASONING_INSTRUCTION = (
    "\n\n---\n\n"
    "## Thinking Before Acting\n\n"
    "Before every tool call (or batch of parallel tool calls) and before every final answer, "
    "you MUST emit a `<reasoning>` block as **text content** in your response.\n\n"
    "Hard rules:\n"
    "1. Every response must begin with text content starting with `<reasoning>` — no preamble, "
    "no greeting, no narration, no whitespace before it. "
    "**Never output a tool call without text content preceding it.** "
    "A response that contains only a tool call and no text is a violation, even if the tool call "
    "seems obvious. The `<reasoning>` block must appear as the text portion of your response "
    "before any tool call is issued.\n"
    "2. Inside the block, write a concise thinking trace (under 800 words) in the same language "
    "as the user's query. The trace must be **grounded in the actual current execution context** — "
    "not a generic plan. Specifically: (a) what the user is asking or what this sub-task requires, "
    "(b) what you actually observed from previous steps or tool results in this execution — "
    "reference real values, specific findings, or the exact error/field that was missing or null, "
    "not a generic 'data unavailable' label, (c) which tool or action you are choosing and the "
    "specific reason based on what you know right now (not a rehearsed justification), "
    "(d) what you concretely expect next given the evidence so far.\n"
    "3. One reasoning block may precede and justify multiple parallel tool calls in the same turn "
    "(e.g. fanning out an identical lookup across many tickers or items). You do not need a "
    "separate block per individual call within a batch — but each batch-level block must still "
    "name the specific items in the batch and any item-specific risks (e.g. ambiguous or short "
    "identifiers likely to collide with unrelated entities).\n"
    "4. Ambiguous or short identifiers: if an input name, ticker, or identifier is short, generic, "
    "or could plausibly match multiple entities, your reasoning must say so before the first call "
    "and prefer the fuller/more specific form of the query on that first attempt, rather than "
    "trying the short form and correcting after a mismatch.\n"
    "5. Repeated tool failure: if the same tool fails twice in a row with the same or a "
    "structurally identical error (same status code, same error type), you must NOT issue a third "
    "identical-style call. Your next reasoning block must explicitly acknowledge the repeated "
    "failure, state the specific error, and choose one of: (a) a genuinely different approach or "
    "tool, or (b) marking the remaining affected items as unavailable and moving on. Silently "
    "retrying the same failing call, or narrating the failure without changing strategy, is a "
    "violation.\n"
    "6. Final-answer reasoning: the reasoning block immediately preceding your final answer must "
    "additionally cover: what was successfully retrieved vs. what is being flagged unavailable "
    "and why, and any contradictions or inconsistencies across sub-agents or tool results that "
    "need to be surfaced rather than silently resolved.\n"
    "7. Close the block with `</reasoning>` immediately after the trace — no content, tool calls, "
    "or answers inside the tags themselves.\n"
    "8. Only AFTER the closing `</reasoning>` tag may you issue a tool call or write your final "
    "answer. When your next action is a tool call, emit NOTHING else after `</reasoning>` — no "
    "transition phrase, no 'Now I'll...', 'Let me...', 'Next, I will...', or any other text. "
    "Everything about what you're about to do and why belongs inside the reasoning block itself; "
    "the closing tag must be followed immediately by the tool call with zero characters in "
    "between. Text placed after `</reasoning>` is only permitted when you are writing your "
    "final answer to the user, not before a tool call.\n"
    "9. This applies to EVERY turn without exception — including short replies, clarifying "
    "questions, follow-up tool calls in a multi-step task, and error recovery after a failed "
    "tool call.\n"
    "10. Never place reasoning after an action, never split reasoning across multiple blocks for "
    "a single decision point, never skip the block because the task seems simple, and never "
    "produce boilerplate or copy-paste reasoning that could apply to any query. Every block must "
    "reflect the actual decisions and execution path of this specific request.\n\n"
    "Violation of rule 1 — including issuing a tool call with no preceding text content — "
    "is treated as a failed response. Violation of rule 5 — three or more identically-failing "
    "calls to the same tool without a strategy change — is also treated as a failed response."
)


# Helpers


def to_tool_name(name: str) -> str:
    """Derive a valid LangGraph node name from a human-readable agent name.

    This is the canonical implementation — agent_service imports it from here
    to guarantee both sites always use identical sanitization logic.

    Args:
        name: Human-readable sub-agent name, e.g. "Web Research Agent".

    Returns:
        Snake_case node identifier, e.g. "web_research_agent".
    """
    sanitized = re.sub(r"[^a-zA-Z0-9]+", "_", name.lower()).strip("_")
    return re.sub(r"_+", "_", sanitized)




class _LRUGraphCache:
    """Bounded LRU cache for compiled LangGraph instances.

    Wraps an OrderedDict so the most-recently-used entry stays at the tail.
    On every __setitem__ that would push size over GRAPH_CACHE_MAX_SIZE, the
    head (least-recently-used) entry is evicted and its asyncio build lock is
    also removed from _graph_build_locks so neither grows without bound.

    Exposes the same __contains__ / __getitem__ / __setitem__ / pop interface
    as a plain dict so all call sites in build_agent_graph and
    invalidate_graph_cache require zero changes.
    """

    def __init__(self, maxsize: int = GRAPH_CACHE_MAX_SIZE) -> None:
        self._maxsize = maxsize
        self._data: OrderedDict[str, Any] = OrderedDict()

    def __contains__(self, key: object) -> bool:
        return key in self._data

    def __getitem__(self, key: str) -> Any:
        self._data.move_to_end(key)
        return self._data[key]

    def __setitem__(self, key: str, value: Any) -> None:
        if key in self._data:
            self._data.move_to_end(key)
        self._data[key] = value
        if len(self._data) > self._maxsize:
            evicted_key, _ = self._data.popitem(last=False)
            # Co-evict the build lock so _graph_build_locks stays bounded too.
            _graph_build_locks.pop(evicted_key, None)
            logger.info(
                "Graph cache LRU eviction: agent %s evicted (%d/%d slots used)",
                evicted_key, len(self._data), self._maxsize,
            )

    def pop(self, key: Any, default: Any = None) -> Any:
        return self._data.pop(key, default)

    def keys(self):
        return list(self._data.keys())

    def __len__(self) -> int:
        return len(self._data)


# Graph cache — keyed by (agent_id, provider, model) so a change to an
# agent's LLM selection naturally busts the cache instead of a stale compiled
# graph (whose nodes close over one fixed llm instance) staying resident.
# Invalidated explicitly on agent update/delete and on credential rotation.
# Bounded LRU: the least-recently-used graph is evicted when the cap is reached.
_graph_cache: _LRUGraphCache = _LRUGraphCache()

# Per-cache-key locks to prevent concurrent redundant graph builds.
_graph_build_locks: dict[tuple[str, str], asyncio.Lock] = {}


def _graph_cache_key(agent_record: Agent) -> tuple[str, str]:
    return (agent_record.id, agent_record.llm_model_id or "default")


def invalidate_graph_cache(agent_id: str) -> None:
    """Remove every cached compiled graph and build lock for this agent_id.

    An agent may have been cached under more than one llm_model_id key over
    time (e.g. before/after a model switch), so this sweeps all of them
    rather than a single exact key.

    Args:
        agent_id: The Agent.id whose cached graph(s) should be evicted.
    """
    for key in _graph_cache.keys():
        if key[0] == agent_id:
            _graph_cache.pop(key, None)
    for key in list(_graph_build_locks.keys()):
        if key[0] == agent_id:
            _graph_build_locks.pop(key, None)


# State

class AgentState(TypedDict):
    messages: Annotated[list, add_messages]
    pending_tasks: list
    dispatch_decisions: list   # populated by agent node on dispatch; empty otherwise
    denied_tool_calls: list    # populated by tools_node on deny/skip; empty otherwise — see make_tools_node
    enable_thinking: bool      # set once from the initial invoke input; read-only downstream
    is_interactive: bool       # False for unattended runs (e.g. scheduled) — see make_tools_node


# dispatch_to_subagents tool schema — used only when sub-agents are configured.
# The tool is never actually executed; the agent node intercepts the call and
# converts it into Send-based fan-out before the tool body would run.

class _DispatchTarget(BaseModel):
    tool_name: str = Field(description="Exact name of the sub-agent to assign this task to")
    task: str = Field(description="Complete, self-contained task description with all needed context")
    context: str = Field(default="", description="Additional conversation context this sub-agent needs")
    reason: str = Field(description="Why you are delegating to this sub-agent and what result you expect from it")


class _DispatchInput(BaseModel):
    targets: list[_DispatchTarget] = Field(
        description=(
            f"Sub-agents to run in parallel. Maximum {MAX_PARALLEL_TASKS}. "
            "Each target must use an exact name from the available sub-agent list."
        )
    )


# Node factories


def _markdown_format_instruction() -> str:
    return (
        "---\n\n"
        "## Response Formatting\n\n"
        "Format all responses using GitHub-Flavored Markdown (GFM). "
        "Match structure to content — use the simplest form that fully conveys the answer. "
        "A conversational or short question deserves a direct answer, not a formatted report. "
        "Scale response length to the complexity of the request: a simple question gets a "
        "concise answer; a multi-part or analytical request gets thorough, structured coverage.\n\n"
        "Always place a **blank line between block elements** (headings, lists, tables, "
        "code blocks, paragraphs) to ensure correct rendering across all Markdown parsers.\n\n"
        "### Headings\n\n"
        "- Use `##` for major sections and `###` for subsections within a genuinely multi-section response.\n"
        "- Never use headings for single-topic or short answers.\n"
        "- Never skip heading levels — always step down one level at a time (`##` → `###` → `####`).\n\n"
        "### Lists\n\n"
        "- **Unordered (`-`):** For items with no inherent order — features, options, considerations.\n"
        "- **Ordered (`1.`):** For sequential steps, ranked items, or anything where order matters.\n"
        "- Use lists only when there are 3 or more items. For 1–2 items, use inline prose.\n"
        "- Limit nesting to two levels maximum. Deeper nesting is a sign to restructure.\n"
        "- Add a blank line before and after every list block.\n\n"
        "### Tables\n\n"
        "- Use for comparing 3 or more items across 2 or more attributes.\n"
        "- Never use for 1–2 items — use a list or prose instead.\n"
        "- A valid table has a header row, a separator row of dashes, and then data rows. "
        "Every column must appear in all three rows and be separated by pipe characters (`|`). "
        "Use alignment markers in the separator row when they aid readability: "
        "`:---` = left, `:---:` = center, `---:` = right.\n"
        "- Keep cells concise — a short phrase or value, not a full sentence. "
        "If a cell genuinely needs a full sentence, use a list instead.\n"
        "- If a cell value contains a literal pipe character, escape it as `\\|` — "
        "an unescaped `|` inside a cell breaks the entire table structure silently.\n"
        "- Add a blank line before and after every table.\n\n"
        "### Workflows and Process Flows\n\n"
        "- **Sequential processes:** Use a numbered list with one clear, discrete action per step.\n"
        "- **Branching logic or decision trees:** Use a Mermaid flowchart "
        "in a fenced code block with the `mermaid` language identifier.\n"
        "- **Before/after or input/output comparisons:** Use a two-column table.\n"
        "- **Parallel or concurrent steps:** Group them under a shared numbered step "
        "with an unordered sub-list.\n"
        "- Never describe a multi-step process in plain prose — a numbered list is always clearer.\n\n"
        "### Code\n\n"
        "- **Inline code** (single backticks): For variable names, function names, file paths, "
        "commands, and short technical strings within a sentence.\n"
        "- **Fenced code blocks** (triple backticks): For multi-line code, scripts, terminal "
        "output, and configuration files. Always include the language identifier: "
        "`python`, `bash`, `json`, `yaml`, `sql`, `typescript`, `mermaid`, etc.\n"
        "- Never use fenced code blocks for non-technical plain text.\n\n"
        "### Emphasis and Special Characters\n\n"
        "- **Bold** (`**text**`): For critical terms, key takeaways, or warnings — not decoration.\n"
        "- *Italic* (`*text*`): For introducing a term, light emphasis, or titles.\n"
        "- Avoid overusing bold or italic; overuse makes all emphasis lose meaning.\n"
        "- **`~` is a Markdown control character — never use it as an approximation symbol.** "
        "A lone `~` silently pairs with the next `~` in the paragraph to open/close strikethrough, "
        "corrupting all text between them. Use `≈` (U+2248) for approximate values "
        "(e.g. `≈₹2,400`, `≈24–27%`). Intentional strikethrough uses `~~double tildes~~`.\n"
        "- **Never start a line with `>`** unless writing a callout — a `>` at the start of a "
        "line is parsed as a block quote regardless of intent. Reword or indent the line instead.\n"
        "- **Avoid starting a line with a bare number followed by a period** (e.g. `1. `, `2. `) "
        "unless you intend an ordered list — parsers create a list item even mid-paragraph, "
        "breaking the surrounding prose. Write `1\\. ` to escape, or restructure the sentence.\n\n"
        "### Callouts\n\n"
        "Use blockquote callouts only when an aside genuinely warrants visual emphasis:\n"
        "- `> [!NOTE]` — supplementary context the user should be aware of\n"
        "- `> [!TIP]` — a helpful suggestion or best practice\n"
        "- `> [!WARNING]` — a risk, caveat, or potential issue\n"
        "- `> [!IMPORTANT]` — a critical requirement or action the user must not miss\n"
        "Use at most one or two callouts per response. Never wrap routine content in a callout.\n\n"
        "### Collapsible Sections\n\n"
        "Use `<details><summary>Label</summary>…</details>` for supplementary detail "
        "that is useful but would clutter the main response "
        "(e.g. full stack traces, long examples, reference tables).\n\n"
        "### General Rules\n\n"
        "- Never restate the same content in both prose and a list or table — choose one form.\n"
        "- Never add structure (headings, bullets, tables) just to appear thorough. "
        "If the answer is simple, keep it simple.\n"
        "- Avoid raw HTML except `<details><summary>` for collapsible sections.\n"
        "- **Never truncate a response.** Do not end with `...`, `[continues]`, `[truncated]`, "
        "or any variant. If the full answer is long, deliver it in full — completeness takes "
        "priority over brevity. Summarising or abbreviating mid-response loses information silently.\n"
    )


def _tool_result_handling_instruction() -> str:
    """Shared guidance for interpreting tool results — used by both the
    parent agent's behavioral guidelines and the sub-agent prompt, so a tool
    failure or a permission denial is handled identically no matter which one
    executed the call.

    Deliberately generic: it describes the SHAPE of tool-result content (a
    technical error vs. a user's explicit denial vs. an unattended-run skip)
    rather than naming any tool or agent — the underlying denial/skip
    messages themselves are already generated generically, one shared
    template regardless of which tool or agent triggered them (see
    graph_builder.make_tools_node), so this instruction adapts to whatever
    actually appears in context at runtime instead of enumerating cases.
    """
    return (
        "---\n\n"
        "## Tool Result Handling\n\n"
        "- **Tool errors:** If a tool call fails, inform the user clearly, explain what could not "
        "be completed, and suggest an alternative approach or next step where possible.\n"
        "- **Tool permission denials:** Some tools require a human to approve each use. If a "
        "tool's result says permission was denied, or that it was skipped because no one was "
        "available to approve it (e.g. an unattended or scheduled run), treat this as an explicit "
        "decision — not a malfunction. Don't apologize as if something broke, and don't "
        "repeatedly re-request the same tool in this response. Acknowledge what you couldn't do "
        "because of it, and continue with the best alternative available: a different approach, "
        "your own knowledge, or clearly stating what remains unavailable and why.\n\n"
    )


def _agent_behavior_instruction() -> str:
    """Behavioral guidelines injected into every parent-agent prompt.

    Covers conversation continuity, tool-result handling, and ambiguity
    handling — concerns that apply regardless of whether sub-agents are
    configured.
    """
    return (
        "---\n\n"
        "## Behavioral Guidelines\n\n"
        "- **Conversation context:** Use the full conversation history to maintain continuity. "
        "Follow-up questions refer to what was already discussed — do not ask the user to repeat themselves.\n"
        "- **Data gaps:** If a tool returns empty, partial, or unexpected results, acknowledge the "
        "gap explicitly in your response. Never fill missing data with assumptions, estimates, or "
        "placeholder values — tell the user what could not be retrieved and why.\n"
        "- **Ambiguous requests:** When a request could be interpreted in more than one way, "
        "proceed with the most reasonable interpretation and briefly state the assumption you made. "
        "Do not refuse or ask clarifying questions for minor ambiguity.\n"
        "- **Scope:** Stay within the role and domain defined in your instructions above. "
        "If a request is outside your defined scope, acknowledge it politely and redirect.\n"
        "- **Completeness:** Always deliver the full response. Never truncate, summarise, or "
        "abbreviate mid-answer with `...`, `[continues]`, `[truncated]`, or similar. "
        "If the complete answer is long, that length is the correct answer.\n\n"
    ) + _tool_result_handling_instruction()


def _sub_agent_format_instruction() -> str:
    """Lightweight output guidelines for sub-agents producing intermediate results.

    Sub-agents feed the synthesizer, not the user directly. A shorter instruction
    reduces token cost and avoids over-formatting internal findings.
    """
    return (
        "---\n\n"
        "## Output Guidelines\n\n"
        "You are executing a delegated task. Your output will be reviewed and synthesized "
        "with other results before being presented to the user — so focus on completeness "
        "and accuracy, not presentation polish.\n\n"
        "**Write for the synthesizer, not the user.** Organize findings under clearly labeled "
        "section headings so distinct results can be located and integrated without ambiguity. "
        "Do not open with 'As requested' or address the user directly — your output is an "
        "intermediate result, not a final reply.\n\n"
        "- Always place a blank line between block elements (headings, lists, tables, "
        "code blocks, paragraphs) to ensure correct rendering\n"
        "- Use `##` section headings to separate distinct findings or data categories\n"
        "- Use numbered lists for sequential steps; bullet lists for unordered items (3 or more)\n"
        "- Use fenced code blocks with a language identifier for all code and commands\n"
        "- Use inline code for variable names, file paths, and short technical strings\n"
        "- Use tables only when comparing 3 or more items across multiple attributes; "
        "escape any literal `|` in cell values as `\\|`\n"
        "- **Never use `~` as an approximation symbol** — it is a Markdown control character "
        "that creates strikethrough. Use `≈` instead (e.g. `≈₹2,400`, `≈24–27%`). "
        "This applies in all output formats including JSON string values, prose, and tables\n"
        "- If a tool returned no data or an error, state that explicitly under the relevant "
        "section heading — do not omit the section or silently skip it\n"
        "- Be thorough — omit nothing relevant to the task; never truncate with `...` or `[continues]`\n"
        "- Be concise — avoid preamble, padding, or meta-commentary about the task itself\n"
    )


def _build_agent_prompt(
    system_prompt: str, sub_agent_options: list[dict], include_reasoning: bool = True
) -> str:
    """Compose the full system prompt for the unified agent node.

    When no sub-agents are configured the prompt is the base system prompt
    plus formatting guidance — the agent acts as a pure ReAct loop with its
    own tools. When sub-agents exist, routing instructions and the
    dispatch_to_subagents tool description are added.

    Args:
        system_prompt: The agent's base system prompt from the DB.
        sub_agent_options: List of dicts with 'tool_name' and 'tool_description'.
        include_reasoning: Whether to append REASONING_INSTRUCTION. Two variants
            of the prompt are precomputed once at graph-build time (see
            make_agent_node) so the per-invocation thinking-mode toggle never
            needs a graph rebuild or a second cache entry.

    Returns:
        A complete system prompt string ready to be sent to the LLM.
    """
    reasoning_block = REASONING_INSTRUCTION if include_reasoning else ""
    if not sub_agent_options:
        return (
            f"{system_prompt}\n\n"
            + _agent_behavior_instruction()
            + _markdown_format_instruction()
            + reasoning_block
        )

    options_text = "\n".join(
        f"  - **{opt['tool_name']}**: {opt['tool_description']}"
        for opt in sub_agent_options
    )
    return (
        f"{system_prompt}\n\n"
        "---\n\n"
        "## Available Specialists\n\n"
        "You can delegate work to the following specialists. "
        "Each specialist handles a distinct capability — choose based on what the request actually requires:\n\n"
        f"{options_text}\n\n"
        "## Decision: Respond Directly or Delegate?\n\n"
        "Before acting, ask: **Is this request best served by responding directly, "
        "or would a specialist produce a meaningfully better result?**\n\n"
        "**Respond directly** when:\n"
        "- The request is conversational, clarifying, or a follow-up on something already answered\n"
        "- You can answer fully and accurately using your own knowledge or tools\n"
        "- No specialist's stated capability matches what the request actually needs\n\n"
        "**Delegate to a specialist** when:\n"
        "- The request falls clearly within a specialist's stated capability\n"
        "- Specialist execution would produce a richer, more accurate, or more complete result\n"
        "- The task requires actions or data sources only that specialist can access\n\n"
        "**Rules when delegating:**\n"
        f"- Dispatch at most {MAX_PARALLEL_TASKS} specialists per turn\n"
        "- Call `dispatch_to_subagents` as your **only** tool call — never combine with other calls\n"
        "- Use exact specialist names from the list above — never invent or abbreviate a name\n"
        "- Write each task as a complete, self-contained instruction with all context the specialist needs\n"
        "- Multiple specialists can be dispatched simultaneously when their tasks are independent\n"
        "- **Write no visible reply in this turn.** When you call `dispatch_to_subagents`, that tool "
        "call is your entire action — do not also write a summary, preamble, draft answer, or any "
        "other text outside a `<reasoning>` block. A specialist hasn't run yet, so you have nothing "
        "to report; the synthesizer produces the actual answer once they finish. Any text you write "
        "outside `<reasoning>` in a dispatching turn is shown to the user immediately, before any "
        "specialist has returned a result — never do this.\n\n"
        "Default to responding directly. Delegate only when it clearly adds value.\n\n"
        + _agent_behavior_instruction()
        + _markdown_format_instruction()
        + reasoning_block
    )


def make_tools_node(tools: list, permissions: dict[str, bool], agent_id: str):
    """Create the tool-execution node shared by the parent agent and every sub-agent.

    Executes the tool_calls on the last AIMessage in state["messages"]. Any
    call whose tool is flagged in `permissions` pauses the whole batch on a
    single interrupt() carrying every gated call at once — one combined
    approval prompt per turn, not one per tool call. Nothing in this node
    performs a side effect before that interrupt() resolves, so a resume
    replay of this node is always safe: the approval pass is deterministic
    and produces no side effects, and the execution pass only runs once the
    interrupt has actually returned a decision.

    Args:
        tools: List of LangChain tool objects available for execution.
        permissions: Mapping of tool name -> whether it requires approval.
            A name absent from the map is treated as not requiring approval.
        agent_id: The Agent.id (parent or sub-agent) that owns these tools —
            stamped onto the interrupt payload so the tool-approvals endpoint
            can resolve which AgentTool row to flip on "Always Allow" without
            trusting a client-supplied identifier.

    Returns:
        An async node function compatible with LangGraph's StateGraph.
    """
    tool_map = {t.name: t for t in tools}

    async def tools_node(state: AgentState) -> dict:
        last = state["messages"][-1]
        tool_calls = [tc for tc in (last.tool_calls or []) if tc["name"] != "dispatch_to_subagents"]
        reason = last.content or ""

        gated = [tc for tc in tool_calls if permissions.get(tc["name"], False)]
        is_interactive = state.get("is_interactive", True)
        decisions: dict[str, str] = {}
        if gated and not is_interactive:
            # No one is present to approve — never silently run a gated tool
            # unattended. Auto-deny the whole batch and let the agent adapt,
            # same as a live Deny, instead of pausing a run nobody can resume.
            decisions = {tc["id"]: "deny" for tc in gated}
        elif gated:
            decisions = interrupt({
                "reason": reason,
                "agent_id": agent_id,
                "tool_calls": [
                    {
                        "tool_call_id": tc["id"],
                        "tool_name": tc["name"],
                        "tool_id": (tool_map.get(tc["name"]).metadata or {}).get("tool_id")
                            if tool_map.get(tc["name"]) else None,
                        "args": tc["args"],
                    }
                    for tc in gated
                ],
            })

        tool_messages = []
        denied_tool_calls = []
        for tc in tool_calls:
            if decisions.get(tc["id"]) == "deny":
                if is_interactive:
                    content = (
                        "The user declined to approve this tool call. This was a user "
                        "decision, not a technical error. Do not retry the tool call or "
                        "speculate about the reason. Simply acknowledge the user's choice "
                        "and continue accordingly."
                    )
                else:
                    content = (
                        f"Skipped {tc['name']}: it requires approval and this agent ran "
                        "unattended (e.g. on a schedule), so no one was available to approve it."
                    )
                # on_tool_start/on_tool_end never fire for a denied/skipped call — the
                # tool itself never runs — so chat_service can't record a reasoning
                # step for it the same way as an executed call. Surface it explicitly
                # here instead, read back via this node's own on_chain_end output.
                denied_tool_calls.append({
                    "tool_name": tc["name"],
                    "input": json.dumps(tc["args"]),
                    "reason": content,
                })
            else:
                tool = tool_map.get(tc["name"])
                if tool:
                    try:
                        result = await tool.ainvoke(tc["args"])
                        content = sanitize_for_reasoning_tags(extract_tool_output(result) or "")
                    except Exception as exc:
                        content = sanitize_for_reasoning_tags(f"Tool error: {exc}")
                else:
                    content = f"Unknown tool: {tc['name']}"
            tool_messages.append(ToolMessage(content=content, tool_call_id=tc["id"]))

        return {
            "messages": tool_messages,
            "pending_tasks": [],
            "dispatch_decisions": [],
            "denied_tool_calls": denied_tool_calls,
        }

    return tools_node


def make_agent_node(llm, system_prompt: str, tools: list, sub_agent_options: list[dict]):
    """Create the unified agent node.

    The node makes a single LLM call and returns:
    - Always has the parent agent's own MCP tools available for the LLM to call.
    - When sub_agent_options is non-empty, also exposes a dispatch_to_subagents
      tool schema so the LLM can signal fan-out. The tool call is intercepted
      before execution and converted into pending_tasks for the routing edge.
    - Responds directly (no tools) when no delegation or tool use is needed.
    - Any other tool_calls are left on the returned AIMessage for the
      conditional edge to route to the "tools" node — this node never
      executes a tool itself, so it never needs to worry about interrupt()
      replay re-running an LLM call that already happened.

    dispatch_to_subagents pre-empts all other tool calls in the same response.
    Other tool calls in the same turn as dispatch are silently dropped.

    Args:
        llm: The LLM instance to use.
        system_prompt: The agent's base system prompt.
        tools: List of LangChain MCP tool objects for this agent.
        sub_agent_options: List of dicts with 'tool_name' and 'tool_description'.
            Empty list means no sub-agents — dispatch tool is not added.

    Returns:
        An async node function compatible with LangGraph's StateGraph.
    """
    # Precompute both prompt variants once at build time. The compiled graph
    # (and this closure) is cached per agent_id; the per-request thinking-mode
    # toggle only decides which already-built string to use — never triggers
    # a rebuild or a second cache entry.
    agent_prompt_with_reasoning = _build_agent_prompt(system_prompt, sub_agent_options, include_reasoning=True)
    agent_prompt_without_reasoning = _build_agent_prompt(system_prompt, sub_agent_options, include_reasoning=False)
    valid_sub_agent_names = {opt["tool_name"] for opt in sub_agent_options}

    all_tools = list(tools)
    if sub_agent_options:
        dispatch_tool = StructuredTool.from_function(
            func=lambda targets: None,
            name="dispatch_to_subagents",
            description=(
                "Delegate tasks to one or more specialized sub-agents running in parallel. "
                f"Maximum {MAX_PARALLEL_TASKS} sub-agents per turn. "
                "Call this as your ONLY tool in a turn — never combine with other tool calls. "
                "Only use when specialized execution is genuinely needed; otherwise respond directly."
            ),
            args_schema=_DispatchInput,
        )
        all_tools.append(dispatch_tool)

    llm_with_tools = llm.bind_tools(all_tools) if all_tools else llm

    async def agent_node(state: AgentState) -> dict:
        # Sanitize persisted history before sending to the LLM.
        # dispatch_to_subagents is intercepted and never produces a ToolMessage,
        # so any AIMessage with tool_calls that has no corresponding ToolMessage
        # in state must have its tool_calls stripped. This handles both already-
        # corrupted threads (loaded from the checkpointer) and provides a safety
        # net going forward.
        responded_ids: set[str] = {
            msg.tool_call_id
            for msg in state["messages"]
            if isinstance(msg, ToolMessage) and msg.tool_call_id
        }
        clean_history: list = []
        for msg in state["messages"]:
            if isinstance(msg, AIMessage) and msg.tool_calls:
                unpaired = {tc["id"] for tc in msg.tool_calls} - responded_ids
                if unpaired:
                    clean_history.append(AIMessage(content=msg.content or "", name=msg.name))
                else:
                    clean_history.append(msg)
            else:
                clean_history.append(msg)

        agent_prompt = (
            agent_prompt_with_reasoning if state.get("enable_thinking", True)
            else agent_prompt_without_reasoning
        )
        messages = [{"role": "system", "content": agent_prompt}] + clean_history

        response = await _ainvoke_with_retry(llm_with_tools, messages)

        if not response.tool_calls:
            return {"messages": [response], "pending_tasks": [], "dispatch_decisions": []}

        # dispatch_to_subagents pre-empts everything else in this response.
        dispatch_calls = [tc for tc in response.tool_calls if tc["name"] == "dispatch_to_subagents"]
        if dispatch_calls:
            raw_targets = dispatch_calls[0]["args"].get("targets", [])
            enable_thinking = state.get("enable_thinking", True)
            is_interactive = state.get("is_interactive", True)
            pending_tasks = [
                {
                    "tool_name": t.get("tool_name", ""),
                    "task": t.get("task", ""),
                    "context": t.get("context", ""),
                    "enable_thinking": enable_thinking,
                    "is_interactive": is_interactive,
                }
                for t in raw_targets
                if isinstance(t, dict) and t.get("tool_name", "") in valid_sub_agent_names
            ][:MAX_PARALLEL_TASKS]
            dispatch_decisions = [
                {
                    "tool_name": t.get("tool_name", ""),
                    "task": t.get("task", ""),
                    "reason": t.get("reason", ""),
                }
                for t in raw_targets
                if isinstance(t, dict) and t.get("tool_name", "") in valid_sub_agent_names
            ][:MAX_PARALLEL_TASKS]
            # Store a clean AIMessage without tool_calls. dispatch_to_subagents
            # is intercepted and never produces a ToolMessage; persisting the raw
            # response (which has tool_calls) would corrupt the checkpointed history
            # and cause OpenAI 400 errors on every subsequent turn in the thread.
            clean_dispatch_msg = AIMessage(content=response.content or "")
            return {
                "messages": [clean_dispatch_msg],
                "pending_tasks": pending_tasks,
                "dispatch_decisions": dispatch_decisions,
            }

        # Any other tool_calls are left on the message for route_from_agent to
        # send to the "tools" node — this node never executes tools itself.
        return {"messages": [response], "pending_tasks": [], "dispatch_decisions": []}

    return agent_node


def make_sub_agent_node(
    llm, system_prompt: str, tools: list, tool_name: str, agent_id: str,
    permissions: dict[str, bool], checkpointer,
):
    """Create a sub-agent node that runs a ReAct loop for a delegated task.

    Builds its own tiny "react"/"tools" StateGraph — the same alternating
    two-node shape as the parent agent, reusing make_tools_node so gated
    tools pause on the same interrupt()-based approval flow regardless of
    whether the call came from the parent agent or a dispatched sub-agent.
    Compiled once at graph-build time. Execution is wrapped in a 300-second
    timeout to guard against hanging external tools.

    Args:
        llm: The LLM instance for the sub-agent's ReAct loop.
        system_prompt: The sub-agent's system prompt.
        tools: List of LangChain tools available to this sub-agent.
        tool_name: The node name used to tag this sub-agent's result.
        agent_id: The sub-agent's real Agent.id (distinct from tool_name, which
            is the sanitized node name) — stamped onto the interrupt payload
            for AgentTool resolution on "Always Allow".
        permissions: Mapping of tool name -> whether it requires approval.
        checkpointer: The same checkpointer used by the parent graph, so a
            gated tool call here checkpoints/resumes against the same
            conversation thread when the wrapper below invokes this
            subgraph directly rather than as a structural parent node.

    Returns:
        An async node function that accepts a Send payload and appends an
        AIMessage with the sub-agent's result to state.
    """
    # Precompute both variants once at build time, same rationale as the
    # parent agent's two prompt strings — the toggle only picks between two
    # already-built prompts, never rebuilds or duplicates the graph cache.
    prompt_with_reasoning = (
        f"{system_prompt}\n\n{_sub_agent_format_instruction()}"
        f"{_tool_result_handling_instruction()}{REASONING_INSTRUCTION}"
    )
    prompt_without_reasoning = (
        f"{system_prompt}\n\n{_sub_agent_format_instruction()}{_tool_result_handling_instruction()}"
    )
    llm_with_tools = llm.bind_tools(tools) if tools else llm

    async def react_node(state: AgentState) -> dict:
        prompt = prompt_with_reasoning if state.get("enable_thinking", True) else prompt_without_reasoning
        messages = [{"role": "system", "content": prompt}] + state["messages"]
        response = await _ainvoke_with_retry(llm_with_tools, messages)
        return {"messages": [response], "pending_tasks": [], "dispatch_decisions": []}

    def route_react(state: AgentState):
        last = state["messages"][-1]
        if isinstance(last, AIMessage) and last.tool_calls:
            return "tools"
        return END

    sub_workflow = StateGraph(AgentState)
    sub_workflow.add_node("react", react_node)
    sub_workflow.add_node("tools", make_tools_node(tools, permissions, agent_id))
    sub_workflow.add_edge(START, "react")
    sub_workflow.add_conditional_edges("react", route_react, ["tools", END])
    sub_workflow.add_edge("tools", "react")
    compiled_sub_graph = sub_workflow.compile(checkpointer=checkpointer)

    async def sub_agent_node(payload: dict, config: RunnableConfig | None = None) -> dict:
        task = payload["task"]
        context = payload.get("context", "")
        full_prompt = f"{task}\n\nContext: {context}" if context else task
        enable_thinking = payload.get("enable_thinking", True)
        is_interactive = payload.get("is_interactive", True)
        sub_config = {**(config or {}), "recursion_limit": SUB_AGENT_RECURSION_LIMIT}
        try:
            result = await asyncio.wait_for(
                compiled_sub_graph.ainvoke(
                    {
                        "messages": [HumanMessage(content=full_prompt)],
                        "enable_thinking": enable_thinking,
                        "is_interactive": is_interactive,
                        "pending_tasks": [],
                        "dispatch_decisions": [],
                    },
                    config=sub_config,
                ),
                timeout=SUB_AGENT_TIMEOUT_SECONDS,
            )
            messages = result.get("messages", [])
            final_content = messages[-1].content if messages else ""
        except _TRANSIENT_LLM_EXCEPTIONS as exc:
            # Deliberately NOT retried: the sub-agent's internal ReAct loop may have
            # already executed one or more tools before this failure, and some MCP
            # tools are non-idempotent (push_prompt, create_dataset, run_experiment,
            # sandbox_control/run, ...). Blindly re-running the whole loop risks
            # duplicating those side effects. Surface a graceful per-task failure
            # instead — the top-level agent sees this in its tool result and can
            # decide whether to dispatch the task again itself.
            logger.warning("Sub-agent %s hit a transient connection error: %r", tool_name, exc)
            final_content = (
                f"[{tool_name} encountered a temporary connection error and could not "
                "complete this task. Retry it if the result is still needed.]"
            )
        return {"messages": [AIMessage(content=sanitize_for_reasoning_tags(final_content), name=tool_name)]}

    return sub_agent_node


def make_synthesizer_node(llm, system_prompt: str):
    """Create the synthesizer node that aggregates sub-agent results into a final response.

    Args:
        llm: The LLM instance used for synthesis.
        system_prompt: The agent's base system prompt used as synthesis context.

    Returns:
        An async node function that reads all messages and produces a single
        coherent final AIMessage.
    """
    synth_prompt = (
        f"{system_prompt}\n\n"
        "---\n\n"
        "## Final Response Instruction\n\n"
        "All delegated work has been completed. "
        "Review the full conversation — including the user's original request and all "
        "intermediate results — then produce a single, coherent, and complete response.\n\n"
        "- Address the user's original request directly and completely\n"
        "- Integrate and deduplicate information across all intermediate results\n"
        "- Resolve conflicts between intermediate results using your own judgment; "
        "prefer the more specific or more recent finding\n"
        "- If any intermediate result is missing, incomplete, or contains an error, "
        "note this briefly and complete that part of the answer using your own knowledge "
        "where possible, or clearly state what could not be determined\n"
        "- Present the answer as if you handled the request end-to-end — do not mention "
        "other agents, specialists, tools used, research steps, delegated tasks, or how the "
        "work was divided. Phrases like 'the research shows', 'based on gathered data', "
        "'the analysis team found', or 'as retrieved by' all leak internal structure and must "
        "be avoided. Write as though you know the answer directly.\n"
        "- Stay strictly within the persona, scope, and rules defined in your instructions above\n\n"
        + _markdown_format_instruction()
    )

    async def synthesizer_node(state: AgentState) -> dict:
        # Strip tool_calls from AIMessages and remove ToolMessages entirely.
        # The dispatch_to_subagents AIMessage has tool_calls but is never followed
        # by a ToolMessage (the call is intercepted and converted to Send fan-out),
        # which causes OpenAI to reject the request with HTTP 400. The synthesizer
        # only needs text content, so removing all tool-call metadata is safe.
        sanitized = []
        for msg in state["messages"]:
            if isinstance(msg, ToolMessage):
                continue
            if isinstance(msg, AIMessage) and msg.tool_calls:
                sanitized.append(AIMessage(content=msg.content or "", name=msg.name))
            else:
                sanitized.append(msg)
        messages = [{"role": "system", "content": synth_prompt}] + sanitized
        response = await _ainvoke_with_retry(llm, messages)
        return {"messages": [AIMessage(content=response.content)]}

    return synthesizer_node


# Routing function


def route_from_agent(state: AgentState):
    """Conditional edge after the agent node.

    Fans out to sub-agent nodes in parallel via Send when tasks were queued,
    routes to "tools" when the agent left tool_calls on its last message,
    or ends directly when the agent answered without either (no extra
    synthesizer call for simple responses).

    Args:
        state: Current graph state with pending_tasks set by the agent node.

    Returns:
        A list of Send objects, "tools", or END.
    """
    tasks = state.get("pending_tasks") or []
    if tasks:
        return [Send(t["tool_name"], t) for t in tasks]
    last = state["messages"][-1]
    if isinstance(last, AIMessage) and last.tool_calls:
        return "tools"
    return END


# Graph builder


async def build_agent_graph(
    session: AsyncSession,
    agent_record: Agent,
    llm,
    checkpointer,
):
    """Build and compile a LangGraph StateGraph for an agent.

    Always compiles as a StateGraph regardless of sub-agent count, giving
    permanent node names (agent, synthesizer) that survive sub-agent config
    changes without breaking existing thread checkpoints.

    Graph shape:
        START → agent ⇄ tools (ReAct loop; tools may pause on interrupt() for
                              gated calls) → synthesizer → END
                      ↘ [sub-agent nodes in parallel via Send] → synthesizer → END
                      ↘ END directly (when agent answered without dispatching or tool_calls)

    agent, tools, and synthesizer are always present. Sub-agent nodes are the
    only variable component — added/removed when sub-agent config changes.
    Each sub-agent node wraps its own internal react/tools loop (built in
    make_sub_agent_node), so gated tools pause the same way there too.

    Uses a double-check lock per agent_id to prevent concurrent redundant builds.

    Args:
        session: Active async database session.
        agent_record: The parent Agent ORM instance.
        llm: Configured LLM instance.
        checkpointer: LangGraph checkpointer for conversation persistence.

    Returns:
        A compiled LangGraph runnable.
    """
    cache_key = _graph_cache_key(agent_record)
    if cache_key in _graph_cache:
        return _graph_cache[cache_key]

    lock = _graph_build_locks.setdefault(cache_key, asyncio.Lock())
    async with lock:
        if cache_key in _graph_cache:
            return _graph_cache[cache_key]

        result = await session.execute(
            select(Agent).where(
                Agent.parent_id == agent_record.id,
                Agent.is_active == True,
            )
        )
        sub_agents = result.scalars().all()

        sub_agent_options = [
            {
                "sub_id": sub.id,
                "tool_name": to_tool_name(sub.name),
                "tool_description": sub.description or sub.name,
                "system_prompt": sub.system_prompt,
            }
            for sub in sub_agents
        ]

        parent_tools = get_tools_for_agent(str(agent_record.id))
        parent_permissions = get_tool_permissions_for_agent(str(agent_record.id))

        workflow = StateGraph(AgentState)

        workflow.add_node(
            "agent",
            make_agent_node(llm, agent_record.system_prompt, parent_tools, sub_agent_options),
        )
        workflow.add_node("tools", make_tools_node(parent_tools, parent_permissions, str(agent_record.id)))
        workflow.add_node(
            "synthesizer",
            make_synthesizer_node(llm, agent_record.system_prompt),
        )

        sub_agent_names = []
        for opt in sub_agent_options:
            child_tools = get_tools_for_agent(opt["sub_id"])
            child_permissions = get_tool_permissions_for_agent(opt["sub_id"])
            if not child_tools:
                logger.warning(
                    "Sub-agent '%s' (id=%s) has no tools registered — "
                    "it will run without MCP tools",
                    opt["tool_name"], opt["sub_id"],
                )
            workflow.add_node(
                opt["tool_name"],
                make_sub_agent_node(
                    llm, opt["system_prompt"], child_tools, opt["tool_name"], opt["sub_id"],
                    child_permissions, checkpointer,
                ),
            )
            sub_agent_names.append(opt["tool_name"])

        workflow.add_edge(START, "agent")
        workflow.add_conditional_edges(
            "agent", route_from_agent, sub_agent_names + ["tools", END]
        )
        workflow.add_edge("tools", "agent")
        for name in sub_agent_names:
            workflow.add_edge(name, "synthesizer")
        workflow.add_edge("synthesizer", END)

        compiled = workflow.compile(checkpointer=checkpointer)
        _graph_cache[cache_key] = compiled
        return compiled
