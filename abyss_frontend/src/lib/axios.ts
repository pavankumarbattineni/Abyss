import axios, {
  AxiosError,
  AxiosResponse,
  InternalAxiosRequestConfig,
} from "axios";
import Cookies from "js-cookie";

import type { LoginResponse, RefreshTokenRequest } from "@/types";

export interface ApiError {
  message: string;
  detail?: string | { msg: string; type: string }[];
  status: number;
}

export const API_BASE_URL = `${process.env.NEXT_PUBLIC_API_URL}/api/v1`;

export const api = axios.create({
  baseURL: API_BASE_URL,
  headers: {
    "Content-Type": "application/json",
  },
});

export function getAuthToken(): string | undefined {
  return Cookies.get("a_token");
}

function setAuthTokens(tokens: LoginResponse): void {
  Cookies.set("a_token", tokens.access_token);
  Cookies.set("r_token", tokens.refresh_token);
}

function clearAuthTokens(): void {
  Cookies.remove("a_token");
  Cookies.remove("r_token");
}

let refreshPromise: Promise<string | null> | null = null;

async function refreshAccessToken(): Promise<string | null> {
  const refreshToken = Cookies.get("r_token");
  if (!refreshToken) return null;

  try {
    const payload: RefreshTokenRequest = { refresh_token: refreshToken };
    const { data } = await axios.post<LoginResponse>(
      `${API_BASE_URL}/auth/refresh`,
      payload,
    );
    setAuthTokens(data);
    return data.access_token;
  } catch {
    return null;
  }
}

api.interceptors.request.use((config: InternalAxiosRequestConfig) => {
  const token = getAuthToken();
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

api.interceptors.response.use(
  (response: AxiosResponse) => response,
  async (error: AxiosError<ApiError>) => {
    const originalRequest = error.config as
      | (InternalAxiosRequestConfig & { _retried?: boolean })
      | undefined;

    if (error.response?.status === 401 && originalRequest && !originalRequest._retried) {
      originalRequest._retried = true;

      refreshPromise ??= refreshAccessToken().finally(() => {
        refreshPromise = null;
      });
      const newAccessToken = await refreshPromise;

      if (newAccessToken) {
        originalRequest.headers.Authorization = `Bearer ${newAccessToken}`;
        return api(originalRequest);
      }

      clearAuthTokens();
      window.location.href = "/auth/login";
    }

    return Promise.reject(error);
  },
);
