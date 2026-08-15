import type { AgentLane, ReasoningStep, ReasoningTrace } from "@/types";

export const EMPTY_REASONING_TRACE: ReasoningTrace = { lanes: {}, order: [], synthesis: null };

export function ensureLane(trace: ReasoningTrace, agentName: string): ReasoningTrace {
  if (trace.lanes[agentName]) return trace;
  const lane: AgentLane = { agentName, status: "running", segments: [], isDelegated: false };
  return {
    ...trace,
    lanes: { ...trace.lanes, [agentName]: lane },
    order: [...trace.order, agentName],
  };
}

export function updateLane(
  trace: ReasoningTrace,
  agentName: string,
  update: (lane: AgentLane) => AgentLane,
): ReasoningTrace {
  const withLane = ensureLane(trace, agentName);
  const lane = withLane.lanes[agentName];
  return { ...withLane, lanes: { ...withLane.lanes, [agentName]: update(lane) } };
}

export function settleAllLanes(
  trace: ReasoningTrace,
  fallbackStatus: "succeeded" | "failed",
): ReasoningTrace {
  const lanes: Record<string, AgentLane> = {};
  for (const [name, lane] of Object.entries(trace.lanes)) {
    lanes[name] = {
      ...lane,
      status: lane.status === "running" ? fallbackStatus : lane.status,
      segments: lane.segments.map((segment) =>
        segment.kind === "tool_call" && segment.toolCall.status === "running"
          ? { ...segment, toolCall: { ...segment.toolCall, status: "succeeded" } }
          : segment,
      ),
    };
  }
  return { ...trace, lanes };
}

// A lane's timeline mixes thought bursts and tool calls in the order they actually happened
// (thought -> 3 tool calls -> more thought -> more tool calls -> ...). These push discrete,
// ordered segments instead of a flat reasoning string + a flat tool-call list, so the UI can
// render the real sequence rather than "all text, then all tool calls."

export function startThoughtSegment(trace: ReasoningTrace, agentName: string): ReasoningTrace {
  return updateLane(trace, agentName, (lane) => ({
    ...lane,
    segments: [
      ...lane.segments,
      { kind: "thought", id: `${agentName}:thought:${lane.segments.length}`, content: "" },
    ],
  }));
}

export function appendThoughtContent(
  trace: ReasoningTrace,
  agentName: string,
  content: string,
): ReasoningTrace {
  return updateLane(trace, agentName, (lane) => {
    const last = lane.segments[lane.segments.length - 1];
    if (last?.kind === "thought") {
      const segments = [...lane.segments];
      segments[segments.length - 1] = { ...last, content: last.content + content };
      return { ...lane, segments };
    }
    // Defensive: a reasoning_token arriving with no open thought segment (e.g. a missed
    // reasoning_start) still needs somewhere to land.
    return {
      ...lane,
      segments: [
        ...lane.segments,
        { kind: "thought", id: `${agentName}:thought:${lane.segments.length}`, content },
      ],
    };
  });
}

export function startToolCallSegment(
  trace: ReasoningTrace,
  agentName: string,
  toolName: string,
): ReasoningTrace {
  return updateLane(trace, agentName, (lane) => {
    const id = `${agentName}:${toolName}:${lane.segments.length}`;
    return {
      ...lane,
      segments: [
        ...lane.segments,
        { kind: "tool_call", id, toolCall: { id, toolName, status: "running" } },
      ],
    };
  });
}

export function endToolCallSegment(
  trace: ReasoningTrace,
  agentName: string,
  toolName: string,
  output: string | undefined,
): ReasoningTrace {
  return updateLane(trace, agentName, (lane) => {
    const index = lane.segments.findIndex(
      (segment) =>
        segment.kind === "tool_call" &&
        segment.toolCall.toolName === toolName &&
        segment.toolCall.status === "running",
    );
    const segment = index === -1 ? undefined : lane.segments[index];
    if (!segment || segment.kind !== "tool_call") return lane;

    const segments = [...lane.segments];
    segments[index] = { ...segment, toolCall: { ...segment.toolCall, status: "succeeded", output } };
    return { ...lane, segments };
  });
}

export function applyReasoningStep(trace: ReasoningTrace, step: ReasoningStep): ReasoningTrace {
  if (step.step === "thought") {
    return updateLane(trace, step.agent, (lane) => ({
      ...lane,
      segments: [
        ...lane.segments,
        { kind: "thought", id: `${step.agent}:thought:${lane.segments.length}`, content: step.content },
      ],
    }));
  }

  return updateLane(trace, step.agent, (lane) => {
    const id = `${step.agent}:${step.tool_name}:${lane.segments.length}`;
    return {
      ...lane,
      segments: [
        ...lane.segments,
        {
          kind: "tool_call",
          id,
          toolCall: { id, toolName: step.tool_name, status: "succeeded", output: step.output },
        },
      ],
    };
  });
}

// Replays a fully-formed reasoning step log (from a persisted Message or the resume-status
// endpoint) into the same trace shape the live SSE reducer builds incrementally. Left
// unsettled on purpose — a resumed in-progress stream's lanes should stay "running" until
// live agent_end/done events arrive; callers rendering a completed historical message should
// wrap the result in settleAllLanes themselves.
export function buildReasoningTrace(steps: ReasoningStep[]): ReasoningTrace {
  return steps.reduce(applyReasoningStep, EMPTY_REASONING_TRACE);
}
