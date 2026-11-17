/**
 * Skill limits -- the same values the backend enforces (abyss_backend/constants.py
 * SKILL_* and schemas/skill.py), so the form catches a problem before the API does.
 */
export const SKILL_LIMITS = {
  name: 64,
  description: 1_024,
  instructionsMin: 1_024,
  instructions: 32_000,
  perUser: 20,
} as const;

/** Letters, digits, spaces, hyphens and underscores, starting with a letter or digit. */
export const SKILL_NAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9 _-]*$/;

export const SKILLS_QUERY_KEY = ["skills"] as const;
