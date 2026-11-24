// Configuration: every master data catalog in one place. Buildings, units and spaces, equipment and
// meters are linked records; the registers and logs behind the dashboards follow, with CSV import.
import { useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { DATASETS, DATASET_BY_KEY, type DatasetKey, type MeterDTO } from "@pmd/shared";
import { api } from "../api";
import { useAuth } from "../auth";
import { useFilter } from "../state";
import { ErrorBox, Table } from "../ui";
import { fmtDate } from "./common";
import { AssetSheet, Buildings, Equipment, UnitSheet, Units, useBuildings } from "./Assets";
import { MeterEditor, MeterSheet, useCanManage } from "./Meters";
import DataEntry from "./DataEntry";

type Section = "buildings" | "units" | "equipment" | "meters" | `reg-${DatasetKey}`;
const CATALOGS: [Section, string, string][] = [
  ["buildings", "Buildings", "Name, kind, section, address"],
  ["units", "Units & spaces", "Condo units, leased spaces, common areas"],
  ["equipment", "Equipment", "Tagged assets and their history"],
  ["meters", "Meters", "Power and water meters read daily"],
];
const isSection = (s: string | null): s is Section =>
  !!s && (CATALOGS.some(([k]) => k === s) || (s.startsWith("reg-") && s.slice(4) in DATASET_BY_KEY));

export default function Configuration() {
  const { user } = useAuth();
  const [params, setParams] = useSearchParams();
  const access = (k: "ast" | "mtr" | "data") => (user?.tabs[k] ?? 0) >= 1;
  const allowed = (s: Section) => (s.startsWith("reg-") ? access("data") : s === "meters" ? access("mtr") : access("ast"));
  const unitId = params.get("unit"), assetId = params.get("asset"), meterId = params.get("meter");
  const asked = params.get("s");
  const fallback: Section = unitId ? "units" : assetId ? "equipment" : meterId ? "meters" : ((sessionStorage.getItem("pmd.config") as Section) || "buildings");
  let section: Section = isSection(asked) ? asked : isSection(fallback) ? fallback : "buildings";
  if (!allowed(section)) section = ([...CATALOGS.map(([k]) => k), ...DATASETS.map((d) => `reg-${d.key}` as Section)]).find(allowed) ?? "buildings";
  const go = (s: Section) => { sessionStorage.setItem("pmd.config", s); setParams({ s }); };
  const keep = (extra: Record<string, string>) => setParams({ s: section, ...extra });
  const close = () => setParams({ s: section }, { replace: true });

  return (
    <div className="cfg">
      <aside className="cfgnav" aria-label="Catalogs">
        <h2>Configuration</h2>
        {(access("ast") || access("mtr")) && <div className="nl">Property structure</div>}
        {CATALOGS.filter(([k]) => allowed(k)).map(([k, label, hint]) => (
          <button key={k} className={section === k ? "on" : ""} onClick={() => go(k)}><b>{label}</b><small>{hint}</small></button>
        ))}
        {access("data") && <div className="nl">Registers &amp; logs</div>}
        {access("data") && DATASETS.map((d) => (
          <button key={d.key} className={"reg" + (section === `reg-${d.key}` ? " on" : "")} onClick={() => go(`reg-${d.key}`)}>{d.label}</button>
        ))}
      </aside>
      <section className="cfgbody">
        {section === "buildings" && <Buildings />}
        {section === "units" && <Units onOpen={(id) => keep({ unit: id })} />}
        {section === "equipment" && <Equipment onOpen={(id) => keep({ asset: id })} />}
        {section === "meters" && <MeterCatalog onOpen={(id) => keep({ meter: id })} />}
        {section.startsWith("reg-") && <DataEntry key={section} dsKey={section.slice(4) as DatasetKey} />}
      </section>
      {unitId && <UnitSheet id={unitId} onClose={close} onOpenAsset={(id) => keep({ asset: id })} />}
      {assetId && <AssetSheet id={assetId} onClose={close} onOpenAsset={(id) => keep({ asset: id })} />}
      {meterId && <MeterSheet id={meterId} onClose={close} />}
    </div>
  );
}

function MeterCatalog({ onOpen }: { onOpen: (id: string) => void }) {
  const { building } = useFilter();
  const buildings = useBuildings();
  const list = buildings.data ?? [];
  const canManage = useCanManage();
  const [search, setSearch] = useState("");
  const [cls, setCls] = useState("All");
  const [adding, setAdding] = useState(false);
  const current = list.find((b) => b.name === building);
  const [pid, setPid] = useState("");
  const addTo = list.find((b) => b.id === pid) ?? current ?? list[0];
  const qs = building === "All" ? "" : `?property=${encodeURIComponent(building)}`;
  // Keyed under "meter-board" so saving a meter anywhere refreshes this list too.
  const q = useQuery({ queryKey: ["meter-board", "catalog", qs], queryFn: () => api.get<MeterDTO[]>(`/meters${qs}`) });
  const today = new Date().toISOString().slice(0, 10);
  const rows = useMemo(() => {
    const s = search.trim().toLowerCase();
    return (q.data ?? []).filter((m) => (cls === "All" || m.meterClass === cls)
      && (!s || [m.code, m.unitCode ?? "", m.occupant, m.serial, m.location, m.property, m.brand].some((x) => x.toLowerCase().includes(s))));
  }, [q.data, search, cls]);
  if (q.error) return <ErrorBox error={q.error} />;
  const many = building === "All" && list.length > 1;
  return (
    <div className="card">
      <div className="row">
        <h2 style={{ margin: 0 }}>Meters</h2>
        <input className="in" style={{ flex: 1, minWidth: 180 }} value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search meter, unit, occupant, serial or location" />
        <select className="in" value={cls} onChange={(e) => setCls(e.target.value)}><option value="All">All classes</option><option>Tenant</option><option>Common Area</option><option>Utility Main</option></select>
        {canManage && list.length > 0 && (
          <>
            {!current && list.length > 1 && (
              <select className="in" value={addTo?.id ?? ""} onChange={(e) => setPid(e.target.value)} aria-label="Building for new meter">
                {list.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
              </select>
            )}
            <button className="cta sm" onClick={() => setAdding(true)}>+ Meter{!current && list.length > 1 ? " here" : ""}</button>
          </>
        )}
      </div>
      <p className="mu">The meters technicians read each day on Meter Readings. Click a meter for its readings, events and settings.</p>
      {q.isLoading ? <p className="mu">Loading…</p> : !rows.length ? <p className="mu">{q.data?.length ? "No meter matches." : "No meters yet."}</p> : (
        <Table head={[...(many ? ["Building"] : []), "Meter", "Class", "Unit / occupant", "Utility", "Location", "Serial", "CT / multiplier", "Active", "Read daily"]}>
          {rows.map((m) => {
            const active = m.activeFrom <= today && (!m.activeTo || m.activeTo >= today);
            return (
              <tr key={m.id} className="click" onClick={() => onOpen(m.id)} style={active ? undefined : { opacity: 0.55 }}>
                {many && <td>{m.property}</td>}
                <td><b>{m.code}</b></td><td>{m.meterClass}</td><td className="wrap">{m.unitCode ? `${m.unitCode}${m.occupant ? " · " + m.occupant : ""}` : "–"}</td>
                <td>{m.utility} ({m.unitOfMeasure})</td><td className="wrap">{m.location || "–"}</td><td>{m.serial || "–"}</td>
                <td>{[m.ctRatio, m.multiplier !== 1 ? `× ${m.multiplier}` : ""].filter(Boolean).join(" ") || "–"}</td>
                <td>{fmtDate(m.activeFrom)}{m.activeTo ? ` – ${fmtDate(m.activeTo)}` : ""}</td><td>{m.expectedDaily ? "Yes" : "No"}</td>
              </tr>
            );
          })}
        </Table>
      )}
      {!!rows.length && <p className="mu">{rows.length} meter{rows.length === 1 ? "" : "s"}.</p>}
      {adding && addTo && <MeterEditor propertyId={addTo.id} property={addTo.name} onClose={() => setAdding(false)} />}
    </div>
  );
}
