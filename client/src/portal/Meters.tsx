import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import type { PortalMeDTO, PortalMeterDTO } from "@pmd/shared";
import { papi } from "./api";
import { Icon, fmtDay } from "./bits";

export const useMeters = () => useQuery({ queryKey: ["p-meters"], queryFn: () => papi.get<PortalMeterDTO[]>("/meters"), staleTime: 5 * 60_000 });

const num = (x: number) => x.toLocaleString("en-US", { maximumFractionDigits: 1 });
const monthName = (m: string, long = false) => new Date(m + "-01T00:00").toLocaleDateString("en-GB", { month: long ? "long" : "short" });

function Change({ m }: { m: PortalMeterDTO }) {
  if (m.changePct == null) return <span className="mu">No figure for last month yet</span>;
  const up = m.changePct > 0;
  const flat = Math.abs(m.changePct) < 1;
  return (
    <span className={"pp-chg " + (flat ? "" : up ? "up" : "down")}>
      {flat ? "About the same as" : `${up ? "▲" : "▼"} ${Math.abs(m.changePct)}% ${up ? "more than" : "less than"}`} the same days last month ({num(m.lastMonthSameDays)} {m.unitOfMeasure})
    </span>
  );
}

function Bars({ m }: { m: PortalMeterDTO }) {
  const max = Math.max(...m.months.map((x) => x.use ?? 0), 1);
  const cur = m.months[m.months.length - 1]?.month;
  return (
    <div className="pp-bars" role="img" aria-label={`Monthly use: ${m.months.map((x) => `${monthName(x.month, true)} ${x.use == null ? "no readings" : `${num(x.use)} ${m.unitOfMeasure}`}`).join(", ")}`}>
      {m.months.map((x) => (
        <div key={x.month} className={"pp-bar" + (x.month === cur ? " cur" : "")} title={`${monthName(x.month, true)}: ${x.use == null ? "no readings" : `${num(x.use)} ${m.unitOfMeasure}`}${x.estimatedDays ? ` (includes ${x.estimatedDays} estimated day${x.estimatedDays === 1 ? "" : "s"})` : ""}`}>
          <span className="v">{x.use == null ? "–" : num(x.use)}</span>
          {x.use != null && <i style={{ height: `${Math.max(2, (x.use / max) * 100)}%` }} />}
          <span className="l">{monthName(x.month)}{x.month === cur ? "*" : ""}</span>
        </div>
      ))}
    </div>
  );
}

function MeterCard({ m }: { m: PortalMeterDTO }) {
  const [all, setAll] = useState(false);
  const rows = all ? m.recent : m.recent.slice(0, 5);
  const curMonth = m.months[m.months.length - 1]?.month;
  return (
    <section className="pp-card pp-meter">
      <div className="pp-row">
        <div className="pp-mic">{m.utility === "Water" ? "💧" : "⚡"}</div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <span className="mu">{m.building} · Unit {m.unitCode}</span>
          <h2 style={{ margin: 0 }}>{m.utility} meter {m.code}</h2>
          {m.location && <span className="mu" style={{ fontSize: 13 }}>{m.location}</span>}
          {m.readingsFrom && <span className="mu" style={{ fontSize: 13, display: "block" }}>Showing readings from {fmtDay(m.readingsFrom)}</span>}
        </div>
      </div>
      <div className="pp-mstats">
        <div><span className="mu">{curMonth ? monthName(curMonth, true) : "This month"} so far</span><b>{num(m.monthToDate)} <small>{m.unitOfMeasure}</small></b><Change m={m} /></div>
        <div><span className="mu">Latest reading</span>{m.last ? <><b>{num(m.last.value)}</b><span className="mu">on {fmtDay(m.last.date)}</span></> : <b>–</b>}</div>
      </div>
      <h3 className="pp-h3">Monthly use ({m.unitOfMeasure})</h3>
      <Bars m={m} />
      <p className="mu" style={{ fontSize: 12, margin: "4px 0 0" }}>* This month so far. When a few days pass between readings, the use is spread evenly over those days.</p>
      <h3 className="pp-h3">Recent readings</h3>
      {!rows.length ? <p className="mu">No readings yet.</p> : (
        <table className="pp-tbl">
          <thead><tr><th>Date</th><th>Reading</th><th>Use</th></tr></thead>
          <tbody>{rows.map((r) => (
            <tr key={r.date}><td>{fmtDay(r.date)}</td><td>{num(r.value)}</td><td>{r.use == null ? "–" : `${num(r.use)} ${m.unitOfMeasure}${r.days && r.days > 1 ? ` over ${r.days} days` : ""}`}</td></tr>
          ))}</tbody>
        </table>
      )}
      {m.recent.length > 5 && <button className="pp-link" style={{ marginTop: 8 }} onClick={() => setAll(!all)}>{all ? "Show fewer" : `Show ${m.recent.length - 5} more`}</button>}
    </section>
  );
}

export default function MetersPage({ me }: { me: PortalMeDTO }) {
  const q = useMeters();
  const [unit, setUnit] = useState("");
  const list = (q.data ?? []).filter((m) => !unit || m.unitId === unit);
  const units = me.units.filter((u) => q.data?.some((m) => m.unitId === u.unitId));
  return (
    <>
      <div className="pp-sec" style={{ marginTop: 4 }}><h2 style={{ fontSize: 22 }}>Meter readings</h2></div>
      <p className="mu" style={{ marginTop: -4 }}>Readings taken by building staff for your {me.units.length === 1 ? "unit" : "units"}. Figures are for information; your bill or statement is the official amount.</p>
      {units.length > 1 && (
        <div className="pp-chips" style={{ margin: "10px 0" }}>
          <button className={"pp-chip" + (!unit ? " on" : "")} onClick={() => setUnit("")}>All units</button>
          {units.map((u) => <button key={u.unitId} className={"pp-chip" + (unit === u.unitId ? " on" : "")} onClick={() => setUnit(u.unitId)}>Unit {u.code}</button>)}
        </div>
      )}
      {q.isLoading ? <p className="mu">Loading…</p> : q.isError ? <p className="pp-err">{(q.error as Error).message}</p>
        : !list.length ? (
          <section className="pp-card" style={{ textAlign: "center" }}>
            <div className="pp-mic" style={{ margin: "0 auto 8px" }}><Icon name="meter" /></div>
            <b>No meters to show yet</b>
            <p className="mu">When building staff start reading a meter for your unit, its readings appear here.</p>
          </section>
        ) : list.map((m) => <MeterCard key={m.id} m={m} />)}
    </>
  );
}
