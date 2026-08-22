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
  created_at: string;
}

export interface UpdateSettingsRequest {
  thinking_enabled: boolean;
}
