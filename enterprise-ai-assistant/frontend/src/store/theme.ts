import { create } from "zustand";

type Theme = "dark" | "light";

interface ThemeState {
  theme: Theme;
  toggle: () => void;
  setTheme: (t: Theme) => void;
}

function apply(theme: Theme) {
  const root = document.documentElement;
  if (theme === "dark") root.classList.add("dark");
  else root.classList.remove("dark");
  root.style.colorScheme = theme;
  localStorage.setItem("eai_theme", theme);
}

const initial: Theme =
  (localStorage.getItem("eai_theme") as Theme) ||
  (window.matchMedia?.("(prefers-color-scheme: dark)").matches ? "dark" : "light");
apply(initial);

export const useTheme = create<ThemeState>((set, get) => ({
  theme: initial,
  toggle() {
    const next = get().theme === "dark" ? "light" : "dark";
    apply(next);
    set({ theme: next });
  },
  setTheme(t) {
    apply(t);
    set({ theme: t });
  },
}));
