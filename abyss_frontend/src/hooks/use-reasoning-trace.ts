"use client";

import { useReducer } from "react";

import {
  appendThoughtContent,
  buildReasoningTrace,
  EMPTY_REASONING_TRACE,
  endToolCallSegment,
  settleAllLanes,
  startThoughtSegment,
  startToolCallSegment,
  updateLane,
} from "@/lib/reasoning";
import type { ReasoningStep, ReasoningTrace, StreamEvent } from "@/types";

type ResetAction = { type: "reset" };
type HydrateAction = { type: "hydrate"; steps: ReasoningStep[] };
type ReasoningAction = StreamEvent | ResetAction | HydrateAction;

function reasoningReducer(trace: ReasoningTrace, action: ReasoningAction): ReasoningTrace {
  switch (action.type) {
    case "reset":
      return EMPTY_REASONING_TRACE;

    // Replays the resume-status endpoint's ordered step log the same way the live
    // reasoning_token/tool_start/tool_end events would have built the trace. Left unsettled —
    // this only runs for a stream still RUNNING at resume time (see use-chat-stream.ts), so
    // lanes should stay "running" until live agent_end/done events settle them.
    case "hydrate":
      return buildReasoningTrace(action.steps);

    case "agent_start":
      return updateLane(trace, action.data.agent_name, (lane) => ({
        ...lane,
        isDelegated: true,
      }));

    case "agent_end":
      return updateLane(trace, action.data.agent_name, (lane) => ({
        ...lane,
        status: "succeeded",
      }));

    // A delegated sub-agent can run through several reasoning_start/…_token/…_end segments
    // interleaved with tool calls before its agent_end (see the market_screening_price_analyst
    // example: reason, call a tool, reason again, call another tool) — its own reasoning_end
    // must NOT settle status early, only its real agent_end should. But the top-level
    // orchestrator only ever gets reasoning_start/…_end with no agent_start/agent_end wrapper
    // around it at all, so for it, reasoning_end IS the completion signal — otherwise its lane
    // would spin forever (until the turn-ending done/error fallback) even once delegation,
    // synthesis, and the final answer have already streamed past it.
    case "reasoning_start":
      return startThoughtSegment(trace, action.data.agent);

    case "reasoning_token":
      return appendThoughtContent(trace, action.data.agent, action.data.content);

    case "reasoning_end":
      return updateLane(trace, action.data.agent, (lane) =>
        lane.isDelegated ? lane : { ...lane, status: "succeeded" },
      );

    case "tool_start":
      return startToolCallSegment(trace, action.data.agent_name, action.data.tool_name);

    case "tool_end":
      return endToolCallSegment(
        trace,
        action.data.agent_name,
        action.data.tool_name,
        action.data.output,
      );

    case "synthesis_start":
      return { ...trace, synthesis: { agentsCompleted: action.data.agents_completed } };

    // The turn is over — no lane or tool call can still legitimately be "running" at this
    // point. Force-settle anything left open rather than trusting every agent to have sent
    // its own agent_end (a dropped/missing one would otherwise spin its lane's loader forever).
    case "done":
    case "error":
      return settleAllLanes(trace, action.type === "error" ? "failed" : "succeeded");

    default:
      return trace;
  }
}

interface UseReasoningTraceResult {
  trace: ReasoningTrace;
  dispatch: (event: StreamEvent) => void;
  hydrate: (steps: ReasoningStep[]) => void;
  reset: () => void;
}

export function useReasoningTrace(): UseReasoningTraceResult {
  const [trace, dispatchAction] = useReducer(reasoningReducer, EMPTY_REASONING_TRACE);

  return {
    trace,
    dispatch: (event: StreamEvent) => dispatchAction(event),
    hydrate: (steps: ReasoningStep[]) => dispatchAction({ type: "hydrate", steps }),
    reset: () => dispatchAction({ type: "reset" }),
  };
}
