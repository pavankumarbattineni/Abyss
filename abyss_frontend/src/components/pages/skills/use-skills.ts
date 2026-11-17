"use client";

import { useQuery } from "@tanstack/react-query";

import { SKILLS_QUERY_KEY } from "@/lib/skill-limits";
import { skillService } from "@/services";
import type { Skill } from "@/types";

/** The user's skills -- one cached query shared by the Skills page and the Agent Builder. */
export function useSkills() {
  return useQuery<Skill[]>({
    queryKey: SKILLS_QUERY_KEY,
    queryFn: () => skillService.getSkills(),
  });
}
