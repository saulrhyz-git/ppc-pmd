import { useEffect, useState, type ReactNode } from "react";

export function ThemeToggle() {
  const [theme, setTheme] = useState<string>(() => localStorage.getItem("pmd.theme") || "auto");
  useEffect(() => {
    if (theme === "auto") document.documentElement.removeAttribute("data-theme");
    else document.documentElement.setAttribute("data-theme", theme);
    localStorage.setItem("pmd.theme", theme);
  }, [theme]);
  const next = () => setTheme(theme === "auto" ? "dark" : theme === "dark" ? "light" : "auto");
  return <button className="pp-thm" onClick={next} title={`Theme: ${theme}`} aria-label="Switch light or dark theme"><svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">{theme === "dark" ? <path d="M20 14.5A8 8 0 0 1 9.5 4 8 8 0 1 0 20 14.5z" /> : theme === "light" ? <><circle cx="12" cy="12" r="4" /><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" /></> : <><circle cx="12" cy="12" r="8" /><path d="M12 4a8 8 0 0 1 0 16z" fill="currentColor" /></>}</svg></button>;
}

const PATHS: Record<string, string> = {
  home: '<path d="M3 11l9-7 9 7"/><path d="M5 10v10h14V10"/><path d="M10 20v-6h4v6"/>',
  list: '<rect x="4" y="3" width="16" height="18" rx="2"/><path d="M8 8h8M8 12h8M8 16h5"/>',
  user: '<circle cx="12" cy="8" r="4"/><path d="M4 21c0-4 4-6 8-6s8 2 8 6"/>',
  wrench: '<path d="M14.7 6.3a4 4 0 0 0-5.4 5.4L3 18l3 3 6.3-6.3a4 4 0 0 0 5.4-5.4l-2.5 2.5-2.4-.6-.6-2.4z"/>',
  shield: '<path d="M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z"/><path d="M9 12l2 2 4-4"/>',
  building: '<rect x="5" y="3" width="14" height="18" rx="1.5"/><path d="M9 7h2M13 7h2M9 11h2M13 11h2M9 15h2M13 15h2M10 21v-3h4v3"/>',
  store: '<path d="M4 9l1.5-5h13L20 9"/><path d="M4 9h16v2a3 3 0 0 1-5.3 2 3 3 0 0 1-5.4 0A3 3 0 0 1 4 11z"/><path d="M5 13v8h14v-8"/><path d="M10 21v-4h4v4"/>',
  meter: '<path d="M4 15a8 8 0 1 1 16 0"/><path d="M12 15l4-5"/><circle cx="12" cy="15" r="1.5"/><path d="M4 19h16"/>',
  key: '<circle cx="8" cy="15" r="4"/><path d="M11 12l9-9M17 6l3 3"/>',
};
export function Icon({ name }: { name: keyof typeof PATHS | string }) {
  return <svg viewBox="0 0 24 24" aria-hidden="true" dangerouslySetInnerHTML={{ __html: PATHS[name] ?? PATHS.home }} />;
}

export const TRADE_EMOJI: Record<string, string> = {
  Elevator: "🛗", "Power / generator": "⚡", "Water / pumps": "💧", HVAC: "❄️", "Fire protection (FDAS / AFSS)": "🔥",
  Electrical: "🔌", Plumbing: "🚰", Security: "🔒", "Building / civil": "🧱", Other: "📝",
};
/** Friendlier names for the categories people pick from. */
export const TRADE_LABEL: Record<string, string> = {
  Elevator: "Elevator", "Power / generator": "Power outage", "Water / pumps": "Water supply", HVAC: "Aircon / ventilation",
  "Fire protection (FDAS / AFSS)": "Fire alarm / sprinkler", Electrical: "Electrical", Plumbing: "Plumbing / leak",
  Security: "Security / access", "Building / civil": "Walls, doors, ceiling", Other: "Something else",
};

export const fmtDay = (s: string) => new Date(s.length === 10 ? s + "T00:00" : s).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
export const fmtWhen = (s: string) => new Date(s).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

export const statusLevel = (s: string): "g" | "a" | "r" | "n" => (s === "Resolved" || s === "Closed" || s === "Completed" ? "g" : s === "Cancelled" ? "n" : "a");
/** What each status means for the person who filed the request. */
export const STATUS_TEXT: Record<string, string> = {
  Sent: "Waiting to be picked up", Received: "Received by property management", "In progress": "Being worked on", Resolved: "Fixed", Closed: "Closed",
};
export function StatusPill({ s }: { s: string }) {
  return <span className={"pp-st " + statusLevel(s)}>{s === "Sent" ? "Submitted" : s === "Resolved" ? "Fixed" : s}</span>;
}

const STEPS = ["Submitted", "Received", "In progress", "Fixed"];
const stepOf = (s: string) => (s === "Sent" ? 0 : s === "Received" ? 1 : s === "In progress" ? 2 : 3);
export function Tracker({ status }: { status: string }) {
  const cur = stepOf(status);
  return (
    <div className="pp-track" aria-label={`Progress: ${STEPS[cur]}`}>
      {STEPS.map((label, i) => <div key={label} className={"s" + (i <= cur ? " on" : "") + (i === cur ? " cur" : "")}><div className="d" />{label}</div>)}
    </div>
  );
}

export function Sheet({ title, onClose, children }: { title: ReactNode; onClose: () => void; children: ReactNode }) {
  useEffect(() => {
    const k = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", k);
    document.body.style.overflow = "hidden";
    return () => { window.removeEventListener("keydown", k); document.body.style.overflow = ""; };
  }, [onClose]);
  return (
    <div className="pp-ov" onClick={onClose}>
      <div className="pp-sheet" role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
        <div className="pp-sheet-h"><h2>{title}</h2><button className="pp-x" onClick={onClose} aria-label="Close">✕</button></div>
        <div className="pp-sheet-b">{children}</div>
      </div>
    </div>
  );
}

export const initials = (name: string) => name.split(/\s+/).filter(Boolean).map((w) => w[0]).slice(0, 2).join("").toUpperCase();
export const firstName = (name: string) => name.trim().split(/\s+/)[0] || name;
export function greeting() {
  const h = new Date().getHours();
  return h < 12 ? "Good morning" : h < 18 ? "Good afternoon" : "Good evening";
}
