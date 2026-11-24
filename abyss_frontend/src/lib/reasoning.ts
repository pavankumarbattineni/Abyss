import type { AgentRun, AnswerPart, ReasoningStep, ReasoningTrace, TimelineItem } from "@/types";

// A turn's reasoning as one chronological timeline across all agents (main
// agent thinks -> delegates -> the specialist thinks / calls tools -> main
// agent thinks again), plus each agent's status. Built the same way from live
// stream events and from a persisted step log, so a reloaded message looks
// exactly like it did while streaming.

export const EMPTY_REASONING_TRACE: ReasoningTrace = {
  agents: {},
  order: [],
  timeline: [],
  synthesis: null,
};

function ensureAgent(trace: ReasoningTrace, agentName: string): ReasoningTrace {
  if (trace.agents[agentName]) return trace;
  const run: AgentRun = { agentName, status: "running", isDelegated: false };
  return { ...trace, agents: { ...trace.agents, [agentName]: run }, order: [...trace.order, agentName] };
}

export function updateAgent(
  trace: ReasoningTrace,
  agentName: string,
  update: (run: AgentRun) => AgentRun,
): ReasoningTrace {
  const withAgent = ensureAgent(trace, agentName);
  return {
    ...withAgent,
    agents: { ...withAgent.agents, [agentName]: update(withAgent.agents[agentName]) },
  };
}

function push(trace: ReasoningTrace, agentName: string, item: TimelineItem): ReasoningTrace {
  const withAgent = ensureAgent(trace, agentName);
  return { ...withAgent, timeline: [...withAgent.timeline, item] };
}

const nextId = (trace: ReasoningTrace, kind: string) => `${kind}:${trace.timeline.length}`;

/** The turn is over: nothing can still be running. */
export function settleAllLanes(
  trace: ReasoningTrace,
  fallbackStatus: "succeeded" | "failed",
): ReasoningTrace {
  const agents: Record<string, AgentRun> = {};
  for (const [name, run] of Object.entries(trace.agents)) {
    agents[name] = { ...run, status: run.status === "running" ? fallbackStatus : run.status };
  }
  const timeline = trace.timeline.map((item) =>
    item.kind === "tool_call" && item.status === "running" ? { ...item, status: "succeeded" as const } : item,
  );
  return { ...trace, agents, timeline };
}

export function startThoughtSegment(trace: ReasoningTrace, agentName: string, at?: number): ReasoningTrace {
  return push(trace, agentName, { kind: "thought", id: nextId(trace, "thought"), agent: agentName, content: "", at });
}

/** Appends streamed text to this agent's latest thought (starting one if a
 * token arrives without a reasoning_start). */
export function appendThoughtContent(
  trace: ReasoningTrace,
  agentName: string,
  content: string,
): ReasoningTrace {
  const index = trace.timeline.findLastIndex((item) => item.kind === "thought" && item.agent === agentName);
  if (index === -1) return appendThoughtContent(startThoughtSegment(trace, agentName), agentName, content);
  const item = trace.timeline[index];
  if (item.kind !== "thought") return trace;
  const timeline = [...trace.timeline];
  timeline[index] = { ...item, content: item.content + content };
  return { ...trace, timeline };
}

export function addDelegation(
  trace: ReasoningTrace,
  agentName: string,
  target: string,
  task: string,
  at?: number,
): ReasoningTrace {
  return push(trace, agentName, { kind: "delegation", id: nextId(trace, "delegation"), agent: agentName, target, task, at });
}

export function startToolCallSegment(
  trace: ReasoningTrace,
  agentName: string,
  toolName: string,
  at?: number,
  input?: string,
  background?: string,
): ReasoningTrace {
  return push(trace, agentName, {
    kind: "tool_call",
    id: nextId(trace, "tool"),
    agent: agentName,
    toolName,
    status: "running",
    at,
    input: input || undefined,
    background: background || undefined,
  });
}

export function endToolCallSegment(
  trace: ReasoningTrace,
  agentName: string,
  toolName: string,
  output: string | undefined,
): ReasoningTrace {
  const index = trace.timeline.findIndex(
    (item) =>
      item.kind === "tool_call" && item.agent === agentName && item.toolName === toolName && item.status === "running",
  );
  if (index === -1) return trace;
  const item = trace.timeline[index];
  if (item.kind !== "tool_call") return trace;
  const timeline = [...trace.timeline];
  timeline[index] = { ...item, status: "succeeded", output };
  return { ...trace, timeline };
}

/** The main agent's label: the first agent that wasn't delegated to. */
export function mainAgentName(trace: ReasoningTrace): string {
  return trace.order.find((name) => !trace.agents[name]?.isDelegated) ?? "agent";
}

export function applyReasoningStep(trace: ReasoningTrace, step: ReasoningStep): ReasoningTrace {
  switch (step.step) {
    case "thought":
      return push(trace, step.agent, {
        kind: "thought",
        id: nextId(trace, "thought"),
        agent: step.agent,
        content: step.content,
        durationMs: step.duration_ms || undefined,
        at: step.at,
      });
    case "dispatch_decision":
      return updateAgent(addDelegation(trace, step.agent, step.target, step.reason, step.at), step.target, (run) => ({
        ...run,
        isDelegated: true,
      }));
    case "tool_call":
      return push(trace, step.agent, {
        kind: "tool_call",
        id: nextId(trace, "tool"),
        agent: step.agent,
        toolName: step.tool_name,
        status: "succeeded",
        input: step.input,
        output: step.output,
        durationMs: step.duration_ms || undefined,
        at: step.at,
        background: step.background || undefined,
      });
    default:
      return trace;
  }
}

/** Replays a persisted step log (a saved message, or the resume-status
 * endpoint) into the same shape the live stream builds. Left unsettled: a
 * resumed in-progress stream keeps running until live events end it; callers
 * showing a finished message wrap the result in settleAllLanes. */
export function buildReasoningTrace(steps: ReasoningStep[]): ReasoningTrace {
  return steps.reduce(applyReasoningStep, EMPTY_REASONING_TRACE);
}

/**
 * An answer as it happened, in order: text the agent wrote, and between the
 * pieces of text the steps it took at that point (thinking, tool calls,
 * specialists' work). Each step's `at` is where in the text it began; steps
 * at the same point form one activity group. A step without `at` (messages
 * saved before steps recorded it, or a specialist's step) stays with the one
 * before it -- so an old message shows its steps before its text, as it did.
 * Text that is only whitespace (the blank line joining two parts) doesn't
 * split a group.
 */
export function answerParts(content: string, timeline: TimelineItem[]): AnswerPart[] {
  const parts: AnswerPart[] = [];
  let cursor = 0;
  let lastAt = 0;
  for (const item of timeline) {
    const at = outsideCodeBlock(content, Math.min(Math.max(item.at ?? lastAt, lastAt), content.length));
    lastAt = at;
    if (at > cursor) {
      const text = content.slice(cursor, at);
      cursor = at;
      if (text.trim()) parts.push({ kind: "text", text });
    }
    const last = parts.at(-1);
    if (last?.kind === "activity") last.items.push(item);
    else parts.push({ kind: "activity", items: [item] });
  }
  const rest = content.slice(cursor);
  if (rest.trim()) parts.push({ kind: "text", text: rest });
  return parts;
}

/** A split point never falls inside a ``` code block (a diagram, a visual, a
 * page): one that would is moved to just after the block closes, so the block
 * stays whole. (Older answers saved a continuation's thought mid-block.) */
function outsideCodeBlock(content: string, at: number): number {
  const fence = /^[ \t]*```.*$/gm;
  let inside = false;
  for (let match = fence.exec(content); match; match = fence.exec(content)) {
    if (match.index >= at) return inside ? Math.min(content.length, match.index + match[0].length + 1) : at;
    inside = !inside;
  }
  return inside ? content.length : at;
}

/**
 * Steps the agent takes only to prepare what the answer shows (a visual's
 * format, images, places for a map): tools declare that themselves on the
 * backend (abyss_agents/tool_display.py), and their calls carry `background`,
 * the status to show while they run. They run as always and stay in the saved
 * reasoning (Tracing shows them), but the chat leaves them out of its steps --
 * the reader sees the visual or images themselves.
 */
export function isBackgroundStep(item: TimelineItem): boolean {
  return item.kind === "tool_call" && !!item.background;
}

/** The steps the chat shows: everything but background steps. */
export function visibleSteps(timeline: TimelineItem[]): TimelineItem[] {
  return timeline.filter((item) => !isBackgroundStep(item));
}

/** What a running background step is doing ("Finding images…"), or null when none runs. */
export function backgroundActivity(timeline: TimelineItem[]): string | null {
  const running = timeline.findLast((item) => isBackgroundStep(item) && item.kind === "tool_call" && item.status === "running");
  return running?.kind === "tool_call" ? (running.background ?? null) : null;
}

// --- Presentation helpers ------------------------------------------------------

/** "web_research_agent" -> "Web research agent"; used when no real name is known. */
export function humanizeIdentifier(name: string): string {
  const words = name.replace(/[_-]+/g, " ").trim();
  return words ? words.charAt(0).toUpperCase() + words.slice(1) : name;
}

/** Mirrors the backend's abyss_agents/naming.py to_tool_name(), so a
 * specialist's stream label can be mapped back to its real name. */
export function toToolName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}
