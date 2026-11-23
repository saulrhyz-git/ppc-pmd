import { useEffect, useState } from "react";
import { NavLink, Outlet, useLocation } from "react-router-dom";
import { TABS, type TabKey } from "@pmd/shared";
import { useAuth } from "./auth";
import { useDashboard, useFilter } from "./state";

export const TAB_PATH: Record<TabKey, string> = {
  brief: "/", ov: "/overview", wos: "/work-orders", wo: "/concerns", as: "/breakdowns", bud: "/financial", pjm: "/projects",
  pm: "/preventive", per: "/permits", ct: "/contracts", sf: "/safety", data: "/data", set: "/settings",
};

const ICON: Partial<Record<TabKey, string>> = {
  brief: '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1.5"/>',
  ov: '<rect x="3" y="3" width="8" height="8" rx="1.5"/><rect x="13" y="3" width="8" height="8" rx="1.5"/><rect x="3" y="13" width="8" height="8" rx="1.5"/><rect x="13" y="13" width="8" height="8" rx="1.5"/>',
  wo: '<rect x="5" y="4" width="14" height="17" rx="2"/><rect x="9" y="2" width="6" height="4" rx="1"/><path d="M9 13l2 2 4-4"/>',
  wos: '<rect x="4" y="3" width="16" height="18" rx="2"/><path d="M8 8h8M8 12h8M8 16h5"/>',
  as: '<path d="M14.7 6.3a4 4 0 0 0-5.4 5.4L3 18l3 3 6.3-6.3a4 4 0 0 0 5.4-5.4l-2.5 2.5-2.4-.6-.6-2.4z"/>',
  bud: '<circle cx="12" cy="12" r="9"/><path d="M12 6.5v11M15 9.5c0-1.3-1.3-2-3-2s-3 .8-3 2 1.2 1.8 3 2.2 3 .8 3 2.2-1.3 2-3 2-3-.7-3-2"/>',
  pjm: '<path d="M4 20V9l4-3v14M10 20V4h5v16M17 20v-9h3v9"/><path d="M3 20h18"/>',
  pm: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4M9 16l2 2 4-4"/>',
  per: '<path d="M6 3h9l4 4v14H6z"/><path d="M15 3v4h4M9 13l2 2 4-4"/>',
  ct: '<path d="M6 3h9l4 4v14H6z"/><path d="M14 3v5h5M9 13h7M9 17h5"/>',
  sf: '<path d="M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z"/><path d="M9 12l2 2 4-4"/>',
  set: '<path d="M4 7h10M18 7h2M4 17h2M10 17h10"/><circle cx="16" cy="7" r="2"/><circle cx="8" cy="17" r="2"/>',
  data: '<ellipse cx="12" cy="6" rx="8" ry="3"/><path d="M4 6v12c0 1.7 3.6 3 8 3s8-1.3 8-3V6M4 12c0 1.7 3.6 3 8 3s8-1.3 8-3"/>',
};

export function useTheme() {
  const [theme, setTheme] = useState<string>(() => localStorage.getItem("pmd.theme") || "auto");
  useEffect(() => {
    if (theme === "auto") document.documentElement.removeAttribute("data-theme");
    else document.documentElement.setAttribute("data-theme", theme);
    localStorage.setItem("pmd.theme", theme);
  }, [theme]);
  const next = () => setTheme(theme === "auto" ? "dark" : theme === "dark" ? "light" : "auto");
  return { theme, next };
}

export function ThemeButton() {
  const { theme, next } = useTheme();
  return <button className="thm" onClick={next} title="Switch theme">{theme === "dark" ? "☾ Dark" : theme === "light" ? "☀ Light" : "◐ Auto"}</button>;
}

export function UserChip() {
  const { user, logout } = useAuth();
  if (!user) return null;
  const initials = user.name.split(/\s+/).map((w) => w[0]).slice(0, 2).join("").toUpperCase();
  return (
    <div className="chip">
      <div className="av">{initials}</div>
      <div className="tx"><b>{user.name}</b><small>{user.role}{user.section ? " · " + user.section : ""}</small></div>
      <button onClick={logout}>Sign out</button>
    </div>
  );
}

export function Header({ showFilter }: { showFilter: boolean }) {
  const { building, setBuilding } = useFilter();
  const dash = useDashboard();
  const [open, setOpen] = useState(false);
  const names = dash.data?.properties.map((p) => p.name).sort() ?? [];
  const asOf = dash.data ? new Date(dash.data.asOf + "T08:00").toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" }) : "";
  useEffect(() => {
    document.getElementById("nav")?.classList.toggle("open", open);
  }, [open]);
  return (
    <header>
      <div className="top">
        <div>
          <h1>PPC <b>Property Management</b> System</h1>
          <small>PMD{asOf ? ` · data as of ${asOf} · reporting month ${dash.data!.period.label}` : ""}</small>
        </div>
        {showFilter && <button className="mb" onClick={() => setOpen(!open)}>☰ Menu</button>}
        <div className="bar" style={{ margin: 0, alignItems: "center" }}>
          {showFilter && names.length > 1 && (
            <select aria-label="Building" value={building} onChange={(e) => setBuilding(e.target.value)}>
              <option value="All">All buildings</option>
              {names.map((n) => <option key={n}>{n}</option>)}
            </select>
          )}
          <ThemeButton />
        </div>
        <div id="who"><UserChip /></div>
      </div>
    </header>
  );
}

export default function Layout() {
  const { user } = useAuth();
  const loc = useLocation();
  useEffect(() => {
    document.getElementById("nav")?.classList.remove("open");
    window.scrollTo(0, 0);
  }, [loc.pathname]);
  if (!user) return null;
  const tabs = TABS.filter(([k]) => (user.tabs[k] ?? 0) >= 1);
  return (
    <>
      <Header showFilter />
      <div className="layout">
        <nav id="nav">
          <div className="nl">Screens</div>
          {tabs.map(([k, label]) => (
            <NavLink key={k} to={TAB_PATH[k]} end={k === "brief"} className={({ isActive }) => (isActive ? "on" : "")} style={{ textDecoration: "none" }}>
              {({ isActive }) => (
                <button className={isActive ? "on" : ""} tabIndex={-1}>
                  <svg className="ni" viewBox="0 0 24 24" dangerouslySetInnerHTML={{ __html: ICON[k] || "" }} />
                  {k === "ov" && (user.role === "General Manager" || user.role === "Department Head") ? "Overall Performance" : label}
                </button>
              )}
            </NavLink>
          ))}
        </nav>
        <main>
          <Outlet />
        </main>
      </div>
    </>
  );
}
