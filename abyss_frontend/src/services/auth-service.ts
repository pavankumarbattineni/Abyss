import Cookies from "js-cookie";

import { api } from "@/lib/axios";
import type {
  LoginRequest,
  LoginResponse,
  SignupRequest,
  SignupResponse,
  UpdateSettingsRequest,
  User,
} from "@/types";

class AuthService {
  async login(payload: LoginRequest): Promise<LoginResponse> {
    const { data } = await api.post<LoginResponse>("/auth/signin", payload);
    return data;
  }

  async signup(payload: SignupRequest): Promise<SignupResponse> {
    const { data } = await api.post<SignupResponse>("/auth/signup", payload);
    return data;
  }

  async getMe(): Promise<User> {
    const { data } = await api.get<User>("/auth/me");
    return data;
  }

  async updateSettings(payload: UpdateSettingsRequest): Promise<User> {
    const { data } = await api.patch<User>("/auth/settings", payload);
    return data;
  }

  isAuthenticated(): boolean {
    return !!Cookies.get("a_token");
  }

  logout(): void {
    Cookies.remove("a_token");
    Cookies.remove("r_token");
  }
}

export const authService = new AuthService();
