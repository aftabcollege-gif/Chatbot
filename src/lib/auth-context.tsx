"use client";

import React, { createContext, useContext, useState, useEffect, useCallback } from "react";

export interface UserPreferences {
  theme: "dark" | "light";
  language: "fa" | "en";
  calendar: "jalali" | "gregorian";
}

export interface User {
  id: string;
  name: string;
  email: string;
  username: string;
  role: string;
  department?: string;
  avatarUrl?: string | null;
  permissions: string[];
  preferences: UserPreferences;
}

interface AuthState {
  user: User | null;
  isAuthenticated: boolean;
  isLoading: boolean;
}

interface AuthContextType extends AuthState {
  login: (username: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  refreshUser: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<AuthState>({
    user: null,
    isAuthenticated: false,
    isLoading: true,
  });

  const refreshUser = useCallback(async () => {
    try {
      const res = await fetch("/api/auth/me", {
        credentials: "include",
      });
      if (res.ok) {
        const data = await res.json();
        setState({
          user: data.user,
          isAuthenticated: true,
          isLoading: false,
        });
      } else {
        setState({
          user: null,
          isAuthenticated: false,
          isLoading: false,
        });
      }
    } catch {
      setState({
        user: null,
        isAuthenticated: false,
        isLoading: false,
      });
    }
  }, []);

  useEffect(() => {
    refreshUser();
  }, [refreshUser]);

  const login = async (username: string, password: string) => {
    const res = await fetch("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ username, password }),
    });

    if (!res.ok) {
      const error = await res.json();
      throw new Error(error.error || "خطا در ورود به سیستم");
    }

    const data = await res.json();
    setState({
      user: data.user,
      isAuthenticated: true,
      isLoading: false,
    });
  };

  const logout = async () => {
    await fetch("/api/auth/logout", {
      method: "POST",
      credentials: "include",
    });
    setState({
      user: null,
      isAuthenticated: false,
      isLoading: false,
    });
  };

  return (
    <AuthContext.Provider value={{ ...state, login, logout, refreshUser }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error("useAuth must be used within an AuthProvider");
  }
  return context;
}
