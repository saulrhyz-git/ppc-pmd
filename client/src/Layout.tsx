import { useEffect, useState } from "react";
import { NavLink, Outlet, useLocation, useNavigate } from "react-router-dom";
import { TABS, type TabKey } from "@pmd/shared";
import { useAuth } from "./auth";
import { useDashboard, useFilter } from "./state";
import { InstallBanner, InstallButton, usePhone } from "./pwa";

export const TAB_PATH: Record<TabKey, string> = {
  brief: "/", ov: "/overview", wos: "/work-orders", wo: "/concerns", as: "/breakdowns", bud: "/financial", pjm: "/projects",
  pm: "/preventive", per: "/permits", ct: "/contracts", sf: "/safety", data: "/configuration", set: "/settings",
  prt: "/portal-access",
  ast: "/configuration", mtr: "/meters",
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
  ast: '<path d="M3 21h18M5 21V7l7-4 7 4v14"/><path d="M9 10h2M13 10h2M9 14h2M13 14h2M10 21v-3h4v3"/>',
  mtr: '<circle cx="12" cy="13" r="8"/><path d="M12 13l4-4M8 5.5 7 4M16 5.5 17 4"/>',
  prt: '<rect x="4" y="10" width="16" height="11" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/><circle cx="12" cy="15.5" r="1.5"/>',
  data: '<circle cx="12" cy="12" r="3"/><path d="M12 2.5v3M12 18.5v3M2.5 12h3M18.5 12h3M5.3 5.3l2.1 2.1M16.6 16.6l2.1 2.1M5.3 18.7l2.1-2.1M16.6 7.4l2.1-2.1"/>',
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
  const phone = usePhone();
  return phone ? <PhoneLayout /> : <DesktopLayout />;
}

/** Screens the user can open, in menu order. */
function useScreens() {
  const { user } = useAuth();
  if (!user) return [];
  const has = (k: TabKey) => (user.tabs[k] ?? 0) >= 1;
  // Buildings, units, equipment and the meter list live on Configuration, so "ast" has no menu entry of its own.
  return TABS.filter(([k]) => k !== "ast" && (k === "data" ? has("data") || has("ast") : has(k)));
}

const screenLabel = (k: TabKey, label: string, role: string) =>
  k === "ov" && (role === "General Manager" || role === "Department Head") ? "Overall Performance" : label;

function DesktopLayout() {
  const { user } = useAuth();
  const loc = useLocation();
  useEffect(() => {
    document.getElementById("nav")?.classList.remove("open");
    window.scrollTo(0, 0);
  }, [loc.pathname]);
  const tabs = useScreens();
  if (!user) return null;
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
                  {screenLabel(k, label, user.role)}
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

// ---------------- phone layout: app bar, bottom tab bar and a "More" sheet ----------------

/** Which screens get a place on the bottom tab bar, most useful first. The rest are under "More". */
const TAB_BAR_ORDER: TabKey[] = ["wos", "brief", "wo", "mtr", "ov", "data", "as", "pm"];
const SHORT: Partial<Record<TabKey, string>> = {
  brief: "Focus", ov: "Overview", wos: "Work", wo: "Concerns", as: "Breakdowns", mtr: "Meters", data: "Setup",
  bud: "Financial", pjm: "Projects", pm: "PM", per: "Permits", ct: "Contracts", sf: "Safety", set: "Settings", prt: "Portal",
};

function NavIcon({ k }: { k: TabKey }) {
  return <svg className="ni" viewBox="0 0 24 24" dangerouslySetInnerHTML={{ __html: ICON[k] || "" }} />;
}

function PhoneLayout() {
  const { user, logout } = useAuth();
  const loc = useLocation();
  const nav = useNavigate();
  const screens = useScreens();
  const { building, setBuilding } = useFilter();
  const dash = useDashboard();
  const [more, setMore] = useState(false);
  useEffect(() => {
    setMore(false);
    window.scrollTo(0, 0);
  }, [loc.pathname]);
  useEffect(() => {
    document.body.classList.toggle("noscroll", more);
    return () => document.body.classList.remove("noscroll");
  }, [more]);
  if (!user) return null;
  const keys = screens.map(([k]) => k);
  const techOnlyAssets = user.role === "Technician" && (user.tabs.data ?? 0) < 1;
  const short = (k: TabKey) => (k === "data" && techOnlyAssets ? "Assets" : SHORT[k] ?? k);
  // Four screens on the bar, plus "More" (which also holds the account, theme and install options).
  const bar = TAB_BAR_ORDER.filter((k) => keys.includes(k)).slice(0, 4);
  const current = screens.find(([k]) => (k === "brief" ? loc.pathname === "/" : loc.pathname.startsWith(TAB_PATH[k])));
  const title = current ? screenLabel(current[0], current[1], user.role) : "PPC Property Management";
  const names = dash.data?.properties.map((p) => p.name).sort() ?? [];
  const initials = user.name.split(/\s+/).map((w) => w[0]).slice(0, 2).join("").toUpperCase();
  return (
    <div className="ph">
      <header className="ph-top">
        <div className="ph-title">
          <b>{title}</b>
          {names.length > 1 && <button className="ph-bld" onClick={() => setMore(true)}>{building === "All" ? "All buildings" : building} ▾</button>}
        </div>
        <button className="ph-av" onClick={() => setMore(true)} aria-label="Account and more">{initials}</button>
      </header>
      <main className="ph-main">
        <InstallBanner appName="PPC PMD" />
        <Outlet />
      </main>
      <nav className="ph-tabs" aria-label="Main">
        {bar.map((k) => (
          <NavLink key={k} to={TAB_PATH[k]} end={k === "brief"} className={({ isActive }) => (isActive && !more ? "on" : "")}>
            <NavIcon k={k} /><span>{short(k)}</span>
          </NavLink>
        ))}
        <button className={more || (current && !bar.includes(current[0])) ? "on" : ""} onClick={() => setMore(!more)}>
          <svg className="ni" viewBox="0 0 24 24"><circle cx="5" cy="12" r="1.6" /><circle cx="12" cy="12" r="1.6" /><circle cx="19" cy="12" r="1.6" /></svg>
          <span>More</span>
        </button>
      </nav>
      {more && (
        <div className="ph-more-ov" onClick={() => setMore(false)}>
          <div className="ph-more" role="dialog" aria-modal="true" aria-label="More" onClick={(e) => e.stopPropagation()}>
            <div className="ph-grab" />
            <div className="ph-me">
              <div className="av">{initials}</div>
              <div><b>{user.name}</b><small>{user.role}{user.section ? " · " + user.section : ""}</small></div>
            </div>
            {names.length > 1 && (
              <label className="ph-row">
                <span>Building</span>
                <select value={building} onChange={(e) => setBuilding(e.target.value)}>
                  <option value="All">All buildings</option>
                  {names.map((n) => <option key={n}>{n}</option>)}
                </select>
              </label>
            )}
            <div className="ph-grid">
              {screens.map(([k, label]) => (
                <button key={k} className={current?.[0] === k ? "on" : ""} onClick={() => { setMore(false); nav(TAB_PATH[k]); }}>
                  <NavIcon k={k} /><span>{k === "data" && techOnlyAssets ? "Buildings & equipment" : screenLabel(k, label, user.role)}</span>
                </button>
              ))}
            </div>
            <div className="ph-row"><span>Theme</span><ThemeButton /></div>
            <div className="ph-row ph-install"><InstallButton className="cta sec" /></div>
            <button className="ph-out" onClick={logout}>Sign out</button>
          </div>
        </div>
      )}
    </div>
  );
}
