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

// The session lasts as long as its refresh token (30 days, see the backend's
// utils/jwt.py) -- used when a token carries no readable expiry.
const FALLBACK_SESSION_DAYS = 30;

/** When a JWT expires (its `exp` claim), or null if it can't be read. */
function tokenExpiry(token: string): Date | null {
  try {
    const payload = JSON.parse(atob(token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/")));
    return typeof payload.exp === "number" ? new Date(payload.exp * 1000) : null;
  } catch {
    return null;
  }
}

/**
 * Cookie options for both session cookies. They must carry an expiry: a
 * cookie without one is a "session cookie", which mobile Chrome deletes when
 * the app is closed -- signing the user out. Both live as long as the refresh
 * token, so the session survives closing the browser until it really expires
 * (or the user signs out). The access token inside `a_token` still expires
 * after minutes; a 401 renews it through /auth/refresh (below). `a_token`
 * must not expire earlier than the session: the route guard (src/proxy.ts)
 * and the server layout read its presence as "signed in".
 */
function sessionCookieOptions(refreshToken: string): Cookies.CookieAttributes {
  const expires = tokenExpiry(refreshToken) ?? new Date(Date.now() + FALLBACK_SESSION_DAYS * 86_400_000);
  return {
    path: "/", // must stay available outside /auth/*
    expires,
    sameSite: "lax",
    secure: typeof window !== "undefined" && window.location.protocol === "https:",
  };
}

type SessionTokens = Pick<LoginResponse, "access_token" | "refresh_token">;

export function setAuthTokens(tokens: SessionTokens): void {
  const options = sessionCookieOptions(tokens.refresh_token);
  Cookies.set("a_token", tokens.access_token, options);
  Cookies.set("r_token", tokens.refresh_token, options);
}

export function clearAuthTokens(): void {
  Cookies.remove("a_token", { path: "/" });
  Cookies.remove("r_token", { path: "/" });
}

/**
 * Sessions signed in before the cookies had an expiry hold session cookies,
 * which mobile Chrome drops on close: give them their expiry (on app load).
 */
export function persistAuthCookies(): void {
  const access = Cookies.get("a_token");
  const refresh = Cookies.get("r_token");
  if (access && refresh) setAuthTokens({ access_token: access, refresh_token: refresh });
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

    const requestUrl = originalRequest?.url ?? "";
    const isAuthExchange = requestUrl.includes("/auth/firebase");
    const isRefreshRequest = requestUrl.includes("/auth/refresh");

    if (
      error.response?.status === 401 &&
      originalRequest &&
      !originalRequest._retried &&
      !isAuthExchange &&
      !isRefreshRequest
    ) {
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
      // A full page load on purpose: it drops all cached client state of the
      // expired session (an interceptor has no router anyway).
      // eslint-disable-next-line @next/next/no-location-assign-relative-destination
      window.location.href = "/home";
    }

    return Promise.reject(error);
  },
);
