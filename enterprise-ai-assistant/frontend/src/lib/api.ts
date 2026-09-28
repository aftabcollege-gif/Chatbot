import axios, { type AxiosInstance } from "axios";

const TOKEN_KEY = "eai_access_token";
const REFRESH_KEY = "eai_refresh_token";

export function getToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}
export function getRefreshToken(): string | null {
  return localStorage.getItem(REFRESH_KEY);
}
export function setTokens(access: string, refresh?: string) {
  localStorage.setItem(TOKEN_KEY, access);
  if (refresh) localStorage.setItem(REFRESH_KEY, refresh);
}
export function clearTokens() {
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(REFRESH_KEY);
}

/**
 * When the UI is served by the embedded backend (browser, Electron, or the
 * portable mini launcher) a relative ``/api`` is correct.  Tauri loads the
 * bundle from the ``tauri://localhost`` custom protocol, where a relative
 * request would never reach the Python backend — there we must target the
 * loopback API explicitly.
 */
export const API_BASE = (() => {
  const envBase = (import.meta as any).env?.VITE_API_BASE as string | undefined;
  if (envBase) return envBase;
  const proto = typeof window !== "undefined" ? window.location.protocol : "http:";
  if (proto === "tauri:" || proto === "file:" || proto === "app:") {
    return "http://127.0.0.1:8741/api";
  }
  return "/api";
})();

export const api: AxiosInstance = axios.create({
  baseURL: API_BASE,
  timeout: 60000,
});

api.interceptors.request.use((config) => {
  const token = getToken();
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

let refreshing: Promise<string | null> | null = null;

async function doRefresh(): Promise<string | null> {
  const refresh = getRefreshToken();
  if (!refresh) return null;
  try {
    const res = await axios.post("/api/auth/refresh", { refresh_token: refresh });
    setTokens(res.data.access_token);
    return res.data.access_token;
  } catch {
    clearTokens();
    return null;
  }
}

api.interceptors.response.use(
  (res) => res,
  async (error) => {
    const original = error.config;
    if (error.response?.status === 401 && !original._retry && !original.url?.includes("/auth/")) {
      original._retry = true;
      if (!refreshing) refreshing = doRefresh();
      const newToken = await refreshing;
      refreshing = null;
      if (newToken) {
        original.headers.Authorization = `Bearer ${newToken}`;
        return api(original);
      }
      window.dispatchEvent(new CustomEvent("eai:unauthorized"));
    }
    return Promise.reject(error);
  },
);
