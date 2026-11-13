import { api } from "@/lib/axios";
import type { TraceDetail, TraceListQuery, TraceListResponse, TraceStats, TraceSyncResponse } from "@/types";

class TraceService {
  async list(query: TraceListQuery): Promise<TraceListResponse> {
    const { data } = await api.get<TraceListResponse>("/traces", { params: query });
    return data;
  }

  async stats(days: number): Promise<TraceStats> {
    const { data } = await api.get<TraceStats>("/traces/stats", { params: { days } });
    return data;
  }

  async get(traceId: string): Promise<TraceDetail> {
    const { data } = await api.get<TraceDetail>(`/traces/${traceId}`);
    return data;
  }

  /** Pull missing/incomplete traces from LangSmith. */
  async sync(): Promise<TraceSyncResponse> {
    const { data } = await api.post<TraceSyncResponse>("/traces/sync");
    return data;
  }
}

export const traceService = new TraceService();
