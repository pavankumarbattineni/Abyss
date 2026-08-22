import Cookies from "js-cookie";

import { api } from "@/lib/axios";
import { firebaseAuth } from "@/lib/firebase";
import { signOut } from "firebase/auth";
import type { LoginResponse, UpdateSettingsRequest, User } from "@/types";

class AuthService {
  async loginWithFirebase(idToken: string): Promise<LoginResponse> {
    const { data } = await api.post<LoginResponse>("/auth/firebase", { id_token: idToken });
    Cookies.set("a_token", data.access_token, { path: "/" });
    Cookies.set("r_token", data.refresh_token, { path: "/" });
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
    Cookies.remove("a_token", { path: "/" });
    Cookies.remove("r_token", { path: "/" });
  }
}

export const authService = new AuthService();
