import { api } from "@/lib/axios";
import type { ApiKey, ApiKeyCreateRequest, ApiKeyCreateResult, ApiKeyRequest } from "@/types";

class ApiKeyService {
  async getApiKeys(): Promise<ApiKey[]> {
    const { data } = await api.get<ApiKey[]>("/api-keys");
    return data;
  }

  async createApiKey(payload: ApiKeyCreateRequest): Promise<ApiKeyCreateResult> {
    const { data } = await api.post<ApiKeyCreateResult>("/api-keys", payload);
    return data;
  }

  async updateApiKey(id: string, payload: ApiKeyRequest): Promise<ApiKey> {
    const { data } = await api.patch<ApiKey>(`/api-keys/${id}`, payload);
    return data;
  }

  async deleteApiKey(id: string): Promise<void> {
    await api.delete(`/api-keys/${id}`);
  }
}

export const apiKeyService = new ApiKeyService();
