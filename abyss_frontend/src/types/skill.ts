export interface Skill {
  id: string;
  name: string;
  /** When to use the skill -- every agent sees this. */
  description: string;
  /** What to do -- loaded by an agent only when the skill fits the task. */
  instructions: string;
  created_at: string;
  updated_at: string;
  /** How many agents the skill is assigned to. */
  agent_count: number;
}

/**
 * Create (no id) or update (with id) -- the backend's POST /skills. With
 * agent_id (Agent Builder) the skill is also assigned to that agent only.
 */
export interface SkillUpsertRequest {
  id?: string;
  agent_id?: string;
  name: string;
  description: string;
  instructions: string;
}
