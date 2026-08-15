export interface ModelCatalogModel {
  id: string;
  model_name: string;
  display_name: string;
}

export interface ModelCatalogProvider {
  provider_id: string;
  provider: string;
  display_name: string;
  models: ModelCatalogModel[];
}

export interface LlmCredential {
  provider_id: string;
  provider: string;
  display_name: string;
  masked_key: string;
  created_at: string;
  updated_at: string;
}

export interface RemoveCredentialResponse {
  message: string;
}

export interface LlmCredentialProvider {
  id: string;
  name: string;
  display_name: string;
}
