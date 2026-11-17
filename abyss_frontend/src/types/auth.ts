export interface LoginResponse {
  access_token: string;
  refresh_token: string;
  token_type: string;
}

export interface RefreshTokenRequest {
  refresh_token: string;
}

export interface User {
  id: string;
  username: string;
  email: string;
  thinking_enabled: boolean;
  /** The model all of this user's agents and chats use; null = Default. */
  llm_model_id: string | null;
  created_at: string;
}

/** Partial update: only the fields sent change. */
export interface UpdateSettingsRequest {
  thinking_enabled?: boolean;
  /** "default" or a provider_models id -- the model for all agents and chats. */
  llm_model_id?: string;
}
