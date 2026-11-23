import { useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import type { Kpi, PropertyResult } from "@pmd/shared";
import { KpiGrid, Pill, Sheet } from "../ui";
import { useDashboard } from "../state";
import { useAuth } from "../auth";

/** Which screen explains each KPI. */
export const KPI_SCREEN: Record<string, [string, string]> = {
  m1: ["/concerns", "Concerns & Work Orders"], cr: ["/concerns", "Concerns & Work Orders"], cx: ["/concerns", "Concerns & Work Orders"], rw: ["/concerns", "Concerns & Work Orders"], m5: ["/concerns", "Concerns & Work Orders"],
  up: ["/breakdowns", "Breakdowns & Assets"], m4: ["/breakdowns", "Breakdowns & Assets"], mt: ["/breakdowns", "Breakdowns & Assets"],
  m6: ["/preventive", "Preventive Maintenance"], m7: ["/permits", "Permits Compliance"], m11: ["/financial", "Financial Performance"],
  pj: ["/projects", "Project Monitoring"], ct: ["/contracts", "Contract Management"], s1: ["/safety", "Safety & Security"],
};

export function KpiSheet({ p, k, onClose }: { p: PropertyResult; k: Kpi; onClose: () => void }) {
  const s = KPI_SCREEN[k.key];
  return (
    <Sheet title={`${p.name} · ${k.label}`} onClose={onClose}>
      <p><Pill level={k.level} /> <b style={{ fontSize: 20, marginLeft: 6 }}>{k.value}</b> <span className="mu">{k.target}</span></p>
      <p>{k.info}</p>
      {s && <p><Link to={s[0]} onClick={onClose}>Open {s[1]} →</Link></p>}
    </Sheet>
  );
}

export function PropertySheet({ p, onClose }: { p: PropertyResult; onClose: () => void }) {
  const [k, setK] = useState<Kpi | null>(null);
  return (
    <Sheet title={`${p.name} KPIs`} onClose={onClose}>
      <p className="mu">{p.section} section · {p.red} Red · attention score {p.score}</p>
      <KpiGrid kpis={p.kpis} onPick={setK} />
      {k && <KpiSheet p={p} k={k} onClose={() => setK(null)} />}
    </Sheet>
  );
}

/** Wraps a screen: loading/error states and the filtered building list. */
export function Screen({ children }: { children: (props: PropertyResult[], all: PropertyResult[]) => ReactNode }) {
  const d = useDashboard();
  if (d.isLoading) return <div className="card"><p className="mu">Loading…</p></div>;
  if (d.error) return <div className="card"><p className="err">{(d.error as Error).message}</p></div>;
  if (!d.data?.properties.length) return <div className="card"><h2>No buildings yet</h2><p className="mu">No buildings are assigned to your account. The Department Head can add buildings and assign them in Settings.</p></div>;
  return <>{children(d.visible, d.data.properties)}</>;
}

export function EditDataHint({ datasets }: { datasets: [string, string][] }) {
  const { user } = useAuth();
  if (!user || (user.tabs.data ?? 0) < 1) return null;
  return (
    <div className="card">
      <b>✎ Update data</b> <span className="mu">Edit the logs behind this screen. Saved changes update every dashboard automatically.</span>
      <div className="row" style={{ marginTop: 8 }}>
        {datasets.map(([k, l]) => <Link key={k} to={`/data?ds=${k}`} className="pill" style={{ background: "var(--navy)", textDecoration: "none" }}>{l}</Link>)}
      </div>
    </div>
  );
}

export const fmtDate = (s: string) => (s ? new Date(s.length === 10 ? s + "T00:00" : s.replace(" ", "T")).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" }) : "–");
