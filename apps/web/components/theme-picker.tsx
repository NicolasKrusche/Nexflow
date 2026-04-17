"use client";

import { useTheme, type ThemeId } from "@/components/theme-provider";
import { cn } from "@/lib/utils";

const THEMES: { id: ThemeId; label: string; swatch: string; gradient?: boolean }[] = [
  { id: "dark",             label: "Dark",             swatch: "#f97316" },
  { id: "midnight-blue",    label: "Midnight Blue",    swatch: "#3b9eff" },
  { id: "graphite",         label: "Graphite",         swatch: "#818cf8" },
  { id: "emerald-terminal", label: "Emerald Terminal", swatch: "#34d399" },
  { id: "rose-gold",        label: "Rose Gold",        swatch: "#fb7185" },
  { id: "cyberpunk-neon",   label: "Cyberpunk",        swatch: "#22d3ee" },
  { id: "light",            label: "Light",            swatch: "#f5f0e8" },
  { id: "liquid-glass",     label: "Liquid Glass",     swatch: "linear-gradient(135deg,#38bdf8,#a78bfa)", gradient: true },
];

export function ThemePicker() {
  const { theme, setTheme } = useTheme();

  return (
    <div className="px-3 py-2">
      <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-widest mb-2">Theme</p>
      <div className="flex flex-wrap gap-1.5">
        {THEMES.map((t) => (
          <button
            key={t.id}
            title={t.label}
            onClick={() => setTheme(t.id)}
            className={cn(
              "w-5 h-5 rounded-full transition-all duration-150 shrink-0",
              "ring-offset-background ring-offset-1",
              theme === t.id
                ? "ring-2 ring-foreground/60 scale-110"
                : "hover:scale-110 ring-1 ring-border"
            )}
            style={
              t.gradient
                ? { background: t.swatch }
                : { backgroundColor: t.swatch }
            }
          />
        ))}
      </div>
    </div>
  );
}
