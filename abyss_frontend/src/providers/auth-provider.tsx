"use client";

import { createContext, useCallback, useContext, useEffect, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import Cookies from "js-cookie";

import { authService } from "@/services";
import type { User } from "@/types";

interface AuthContextValue {
  isAuthenticated: boolean;
  user?: User;
  isUserLoading: boolean;
  refreshAuthState: () => void;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

interface AuthProviderProps {
  children: React.ReactNode;
  initialIsAuthenticated: boolean;
}

export function AuthProvider({ children, initialIsAuthenticated }: AuthProviderProps) {
  const router = useRouter();
  const pathname = usePathname();
  const queryClient = useQueryClient();
  const [isAuthenticated, setIsAuthenticated] = useState<boolean>(initialIsAuthenticated);

  const refreshAuthState = useCallback(() => {
    setIsAuthenticated(!!Cookies.get("a_token"));
  }, []);

  const { data: user, isLoading: isUserLoading } = useQuery<User>({
    queryKey: ["me"],
    queryFn: () => authService.getMe(),
    enabled: isAuthenticated,
  });

  useEffect(() => {
    if (!isAuthenticated) {
      queryClient.removeQueries({ queryKey: ["me"] });
    }
  }, [isAuthenticated, queryClient]);

  useEffect(() => {
    if (!isAuthenticated && pathname !== "/" && !pathname?.startsWith("/auth")) {
      router.replace("/auth/login");
    }
  }, [isAuthenticated, pathname, router]);

  return (
    <AuthContext.Provider value={{ isAuthenticated, user, isUserLoading, refreshAuthState }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error("useAuth must be used within an AuthProvider");
  }
  return context;
}
