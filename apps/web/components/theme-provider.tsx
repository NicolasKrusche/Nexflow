"use client";

import { createContext, useContext, useEffect, useState } from "react";

export type ThemeId =
  | "dark"
  | "midnight-blue"
  | "graphite"
  | "emerald-terminal"
  | "rose-gold"
  | "cyberpunk-neon"
  | "light"
  | "liquid-glass";

const ALL_THEMES: ThemeId[] = [
  "dark",
  "midnight-blue",
  "graphite",
  "emerald-terminal",
  "rose-gold",
  "cyberpunk-neon",
  "light",
  "liquid-glass",
];

interface ThemeContextValue {
  theme: ThemeId;
  setTheme: (t: ThemeId) => void;
}

const ThemeContext = createContext<ThemeContextValue>({
  theme: "dark",
  setTheme: () => {},
});

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [theme, setThemeState] = useState<ThemeId>("dark");

  // Read persisted theme after hydration to avoid SSR mismatch
  useEffect(() => {
    try {
      const stored = localStorage.getItem("nexflow-theme") as ThemeId | null;
      if (stored && ALL_THEMES.includes(stored)) {
        setThemeState(stored);
        applyTheme(stored);
      }
    } catch {}
  }, []);

  function setTheme(t: ThemeId) {
    setThemeState(t);
    applyTheme(t);
    try {
      localStorage.setItem("nexflow-theme", t);
    } catch {}
  }

  return (
    <ThemeContext.Provider value={{ theme, setTheme }}>
      {children}
    </ThemeContext.Provider>
  );
}

function applyTheme(t: ThemeId) {
  const el = document.documentElement;
  el.classList.remove(...ALL_THEMES);
  el.classList.add(t);
}

export function useTheme() {
  return useContext(ThemeContext);
}
