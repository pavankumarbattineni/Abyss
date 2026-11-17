import { api } from "@/lib/axios";
import type { Skill, SkillUpsertRequest } from "@/types";

class SkillService {
  async getSkills(): Promise<Skill[]> {
    const { data } = await api.get<Skill[]>("/skills");
    return data;
  }

  /** Creates the skill, or updates it when `payload.id` is set. */
  async saveSkill(payload: SkillUpsertRequest): Promise<Skill> {
    const { data } = await api.post<Skill>("/skills", payload);
    return data;
  }

  async deleteSkill(id: string): Promise<void> {
    await api.delete(`/skills/${id}`);
  }
}

export const skillService = new SkillService();
