import { create } from "zustand";
import { api, clearTokens, getToken, setTokens } from "@/lib/api";
import type { User, LoginResponse } from "@/types";

interface AuthState {
  user: User | null;
  loading: boolean;
  initialized: boolean;
  initialize: () => Promise<void>;
  login: (username: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  setUser: (u: User) => void;
  hasPermission: (code: string) => boolean;
}

export const useAuth = create<AuthState>((set, get) => ({
  user: null,
  loading: false,
  initialized: false,

  async initialize() {
    const token = getToken();
    if (!token) {
      set({ initialized: true });
      return;
    }
    try {
      const res = await api.get("/auth/me");
      set({ user: res.data.user, initialized: true });
    } catch {
      clearTokens();
      set({ user: null, initialized: true });
    }
  },

  async login(username, password) {
    set({ loading: true });
    try {
      const res = await api.post<LoginResponse>("/auth/login", { username, password });
      setTokens(res.data.access_token, res.data.refresh_token);
      set({ user: res.data.user });
    } finally {
      set({ loading: false });
    }
  },

  async logout() {
    try {
      const refresh = localStorage.getItem("eai_refresh_token");
      if (refresh) await api.post("/auth/logout", { refresh_token: refresh });
    } catch {
      /* ignore */
    }
    clearTokens();
    set({ user: null });
  },

  setUser(u) {
    set({ user: u });
  },

  hasPermission(code) {
    const u = get().user;
    if (!u) return false;
    if (u.is_superadmin) return true;
    return u.permissions.includes(code);
  },
}));
