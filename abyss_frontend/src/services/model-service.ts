import { api } from "@/lib/axios";
import type {
  LlmCredential,
  LlmCredentialProvider,
  ModelCatalogProvider,
  RemoveCredentialResponse,
} from "@/types";

class ModelService {
  async getCatalog(): Promise<ModelCatalogProvider[]> {
    const { data } = await api.get<ModelCatalogProvider[]>("/llm-credentials/catalog");
    return data;
  }

  async getProviders(): Promise<LlmCredentialProvider[]> {
    const { data } = await api.get<LlmCredentialProvider[]>("/llm-credentials/providers");
    return data;
  }

  async getCredentials(): Promise<LlmCredential[]> {
    const { data } = await api.get<LlmCredential[]>("/llm-credentials");
    return data;
  }

  async setCredential(providerId: string, apiKey: string): Promise<LlmCredential> {
    const { data } = await api.put<LlmCredential>(`/llm-credentials/${providerId}`, {
      api_key: apiKey,
    });
    return data;
  }

  async removeCredential(providerId: string): Promise<RemoveCredentialResponse> {
    const { data } = await api.delete<RemoveCredentialResponse>(
      `/llm-credentials/${providerId}`,
    );
    return data;
  }
}

export const modelService = new ModelService();
