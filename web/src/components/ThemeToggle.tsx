import { useState } from "react";

// Key/values match index.html's own early inline script (which sets
// data-theme before React ever mounts, to avoid a flash of the wrong
// theme) — this component is the only other place that reads/writes it.
const THEME_KEY = "league-hub:v1:theme";
type Theme = "light" | "dark" | null; // null = follow system

function readTheme(): Theme {
  const v = localStorage.getItem(THEME_KEY);
  return v === "light" || v === "dark" ? v : null;
}

const NEXT: Record<string, Theme> = { system: "light", light: "dark", dark: null };
const ICON: Record<string, string> = { system: "🖥️", light: "☀️", dark: "🌙" };
const LABEL: Record<string, string> = { system: "Theme: matching your system", light: "Theme: light", dark: "Theme: dark" };

// A live SPA toggle would need every chart in HistoryCharts.tsx/
// TeamCharts.tsx recolored on the fly — they read CSS vars into plain JS
// string constants once at module load (lib/tokens.ts), since SVG can't
// reliably read CSS vars directly. Reloading on every change is a
// deliberately simple trade: guaranteed-correct repaint everywhere
// (charts included) over a faster but chart-stale live switch.
export default function ThemeToggle() {
  const [theme, setTheme] = useState<Theme>(readTheme);
  const key = theme ?? "system";

  const handleClick = () => {
    const next = NEXT[key];
    if (next === null) localStorage.removeItem(THEME_KEY);
    else localStorage.setItem(THEME_KEY, next);
    setTheme(next);
    window.location.reload();
  };

  return (
    <button
      type="button"
      className="refresh-btn"
      onClick={handleClick}
      aria-label={`${LABEL[key]} — click to change`}
      title={`${LABEL[key]} — click to change`}
    >
      <span className="refresh-icon">{ICON[key]}</span>
    </button>
  );
}
