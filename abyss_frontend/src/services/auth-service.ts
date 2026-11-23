import Cookies from "js-cookie";

import { api, clearAuthTokens, setAuthTokens } from "@/lib/axios";
import { firebaseAuth } from "@/lib/firebase";
import { signOut } from "firebase/auth";
import type { LoginResponse, UpdateSettingsRequest, User } from "@/types";

class AuthService {
  async loginWithFirebase(idToken: string): Promise<LoginResponse> {
    const { data } = await api.post<LoginResponse>("/auth/firebase", { id_token: idToken });
    // With an expiry, so the session survives closing the browser (see lib/axios.ts).
    setAuthTokens(data);
    return data;
  }

  async getMe(): Promise<User> {
    const { data } = await api.get<User>("/auth/me");
    return data;
  }

  async updateSettings(payload: UpdateSettingsRequest): Promise<User> {
    const { data } = await api.patch<User>("/auth/setting", payload);
    return data;
  }

  isAuthenticated(): boolean {
    return !!Cookies.get("a_token");
  }

  async logout(): Promise<void> {
    await signOut(firebaseAuth);
    clearAuthTokens();
  }
}

export const authService = new AuthService();
