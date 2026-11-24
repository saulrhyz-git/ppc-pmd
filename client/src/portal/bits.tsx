import { useEffect, useState } from "react";

export function ThemeToggle() {
  const [theme, setTheme] = useState<string>(() => localStorage.getItem("pmd.theme") || "auto");
  useEffect(() => {
    if (theme === "auto") document.documentElement.removeAttribute("data-theme");
    else document.documentElement.setAttribute("data-theme", theme);
    localStorage.setItem("pmd.theme", theme);
  }, [theme]);
  const next = () => setTheme(theme === "auto" ? "dark" : theme === "dark" ? "light" : "auto");
  return <button className="thm" onClick={next} title="Switch theme">{theme === "dark" ? "☾ Dark" : theme === "light" ? "☀ Light" : "◐ Auto"}</button>;
}

export const fmtDay = (s: string) => new Date(s.length === 10 ? s + "T00:00" : s).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
export const fmtWhen = (s: string) => new Date(s).toLocaleString("en-GB", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });

export const statusLevel = (s: string): "g" | "a" | "r" | "n" => (s === "Resolved" || s === "Closed" || s === "Completed" ? "g" : s === "Cancelled" ? "n" : "a");

export function StatusPill({ s }: { s: string }) {
  return <span className={"pill " + statusLevel(s)}>{s}</span>;
}
