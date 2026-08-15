export interface LoginRequest {
  email: string;
  password: string;
}

export interface LoginResponse {
  access_token: string;
  refresh_token: string;
  token_type: string;
}

export interface RefreshTokenRequest {
  refresh_token: string;
}

export interface SignupRequest {
  username: string;
  email: string;
  password: string;
  confirm_password: string;
}

export interface SignupResponse {
  id: string;
  username: string;
  email: string;
  created_at: string;
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
