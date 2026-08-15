import { api } from "@/lib/axios";
import type { UsageRunsQuery, UsageRunsResponse, UsageSummary } from "@/types";

class UsageService {
  async getSummary(): Promise<UsageSummary> {
    const { data } = await api.get<UsageSummary>("/usage/summary");
    return data;
  }

  async getRuns(query: UsageRunsQuery): Promise<UsageRunsResponse> {
    const { data } = await api.get<UsageRunsResponse>("/usage/runs", { params: query });
    return data;
  }

  async downloadRuns(query: Omit<UsageRunsQuery, "page" | "page_size">): Promise<Blob> {
    const { data } = await api.get<Blob>("/usage/runs", {
      params: { ...query, is_download: true },
      responseType: "blob",
    });
    return data;
  }
}

export const usageService = new UsageService();
