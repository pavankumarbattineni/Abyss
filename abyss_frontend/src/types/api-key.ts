export interface ApiKey {
  id: string;
  name: string;
  key_prefix: string;
  is_active: boolean;
  expires_at: string | null;
  is_expired: boolean;
  created_at: string;
}

export interface ApiKeyCreateResult {
  id: string;
  name: string;
  key: string;
  key_prefix: string;
  created_at: string;
}

export interface ApiKeyRequest {
  name: string;
}

export type ApiKeyExpiry = "7d" | "1m" | "3m" | "6m" | "custom" | "none";

export interface ApiKeyCreateRequest {
  name: string;
  expiry: ApiKeyExpiry;
  custom_expires_at?: string;
}
