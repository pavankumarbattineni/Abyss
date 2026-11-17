export interface Skill {
  id: string;
  name: string;
  /** When to use the skill -- every agent sees this. */
  description: string;
  /** What to do -- loaded by an agent only when the skill fits the task. */
  instructions: string;
  created_at: string;
  updated_at: string;
}

/** Create (no id) or update (with id) -- the backend's POST /skills. */
export interface SkillUpsertRequest {
  id?: string;
  name: string;
  description: string;
  instructions: string;
}
