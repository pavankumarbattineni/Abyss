import { api } from "@/lib/axios";
import type {
  Schedule,
  ScheduleDeleteResponse,
  ScheduleRequest,
  ScheduleRun,
  ScheduleUpdateRequest,
} from "@/types";

class ScheduleService {
  async getSchedules(agentId: string): Promise<Schedule[]> {
    const { data } = await api.get<Schedule[]>(`/agents/${agentId}/schedules`);
    return data;
  }

  async createSchedule(agentId: string, payload: ScheduleRequest): Promise<Schedule> {
    const { data } = await api.post<Schedule>(`/agents/${agentId}/schedules`, payload);
    return data;
  }

  async updateSchedule(
    agentId: string,
    scheduleId: string,
    payload: ScheduleUpdateRequest,
  ): Promise<Schedule> {
    const { data } = await api.patch<Schedule>(
      `/agents/${agentId}/schedules/${scheduleId}`,
      payload,
    );
    return data;
  }

  async deleteSchedule(agentId: string, scheduleId: string): Promise<ScheduleDeleteResponse> {
    const { data } = await api.delete<ScheduleDeleteResponse>(
      `/agents/${agentId}/schedules/${scheduleId}`,
    );
    return data;
  }

  async getScheduleRuns(agentId: string, scheduleId: string): Promise<ScheduleRun[]> {
    const { data } = await api.get<ScheduleRun[]>(
      `/agents/${agentId}/schedules/${scheduleId}/runs`,
    );
    return data;
  }
}

export const scheduleService = new ScheduleService();
