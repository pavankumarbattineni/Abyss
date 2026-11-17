/**
 * Length limits for an agent's (and sub-agent's) text fields -- the same
 * max_length the backend enforces in abyss_backend/schemas/agent.py, so the
 * form stops an over-long value before the API would reject it.
 */
export const AGENT_TEXT_LIMITS = {
  name: 255,
  description: 2_000,
  instructions: 32_000,
} as const;
