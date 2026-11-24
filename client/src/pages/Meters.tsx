// Meter readings: the technicians' daily round sheet, exceptions, monthly use and energy balance,
// and each meter's history. The meter list itself is a catalog on the Configuration screen. Checks run on the server with the shared engine.
import { useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  METER_CLASSES, METER_CLASS_NOTES, METER_EVENT_TYPES, METER_UTILITIES, REGISTER_EVENTS, UTILITY_UNIT, isMeterManager,
  type BalanceResult, type Interval, type MeterDTO, type MeterEventDTO, type MeterException, type MeterReadingDTO, type MeterThresholds,
} from "@pmd/shared";
import { api } from "../api";
import { useAuth } from "../auth";
import { useFilter } from "../state";
import { Card, ErrorBox, Sheet, Table } from "../ui";
import { fmtDate } from "./common";
import { useBuildings } from "./Assets";
import { NewWorkOrderSheet, WorkOrderSheet, type WoPrefill } from "./WorkOrders";

interface BoardMeter extends MeterDTO {
  active: boolean;
  reading: { id: string; date: string; value: number } | null;
  previous: { date: string; value: number } | null;
  baselinePerDay: number | null;
  monthToDate: number;
  estimatedDays: number;
  prevMonth: number;
  momPct: number | null;
  completeness: { expected: number; have: number; pct: number } | null;
  missingStreak: number;
}
interface Board {
  property: { id: string; name: string };
  date: string;
  month: string;
  prevMonth: string;
  meters: BoardMeter[];
  exceptions: MeterException[];
  balance: BalanceResult | null;
  prevBalance: BalanceResult | null;
  kpis: { expected: number; read: number; critical: number; high: number; warning: number };
  thresholds: MeterThresholds;
}
interface MeterHistory { meter: MeterDTO; readings: MeterReadingDTO[]; events: MeterEventDTO[]; intervals: Interval[]; exceptions: MeterException[]; baselinePerDay: number | null }

const localToday = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; };
const n = (x: number | null | undefined, d = 1) => (x == null || !isFinite(x) ? "–" : x.toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: d }));
const monthLabel = (k: string) => new Date(k + "-01T00:00").toLocaleDateString("en-GB", { month: "short", year: "numeric" });
const SEV_CLASS: Record<string, string> = { Critical: "r", High: "r", Warning: "a" };
const VIEWS = [["round", "Daily readings"], ["exceptions", "Exceptions"], ["monthly", "Monthly use"]] as const;
type View = (typeof VIEWS)[number][0];

export function useCanManage() {
  const { user } = useAuth();
  return !!user && (user.tabs.mtr ?? 0) >= 2 && isMeterManager(user.role);
}

export default function Meters() {
  const { user } = useAuth();
  const { building } = useFilter();
  const buildings = useBuildings();
  const [params, setParams] = useSearchParams();
  const [view, setView] = useState<View>(() => { const v = sessionStorage.getItem("pmd.meterView"); return VIEWS.some(([k]) => k === v) ? (v as View) : "round"; });
  const [date, setDate] = useState(localToday);
  const list = buildings.data ?? [];
  const [pid, setPid] = useState("");
  useEffect(() => {
    const fromFilter = list.find((b) => b.name === building);
    if (fromFilter) setPid(fromFilter.id);
    else if (!pid && list.length) setPid((list.find((b) => b.meterCount > 0) ?? list[0]).id);
  }, [building, list, pid]);
  const board = useQuery({
    queryKey: ["meter-board", pid, date],
    queryFn: () => api.get<Board>(`/meters/board?property=${encodeURIComponent(pid)}&date=${date}`),
    enabled: !!pid,
    refetchInterval: 120_000,
  });
  const pick = (v: View) => { sessionStorage.setItem("pmd.meterView", v); setView(v); };
  const meterId = params.get("meter");
  const canWrite = (user?.tabs.mtr ?? 0) >= 2;
  const canManage = useCanManage();

  return (
    <>
      <Card
        title="Meter readings"
        sub={user?.role === "Technician" ? "Read each meter once a day and enter the register value. The system works out the use and flags anything that looks wrong so you can re-read on the spot." : "Daily meter readings for each building: completeness, exceptions, monthly use per unit and the energy balance against the utility main meter."}
      >
        <div className="row toolbar">
          <div className="tabs" style={{ margin: 0 }}>{VIEWS.map(([k, l]) => <button key={k} className={view === k ? "on" : ""} onClick={() => pick(k)}>{l}</button>)}</div>
          <span className="spacer" />
          {list.length > 1 && (
            <select className="in" style={{ width: "auto" }} value={pid} onChange={(e) => setPid(e.target.value)} aria-label="Building">
              {list.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
            </select>
          )}
          <input className="in" type="date" value={date} max={localToday()} onChange={(e) => e.target.value && setDate(e.target.value)} aria-label="Reading date" />
          {date !== localToday() && <button className="lnk" onClick={() => setDate(localToday())}>Today</button>}
          {canManage && <Link to="/configuration?s=meters" className="mu">Meter list in Configuration →</Link>}
        </div>
      </Card>
      {buildings.error ? <ErrorBox error={buildings.error} /> : !list.length ? <div className="card"><p className="mu">You have no buildings assigned.</p></div>
        : board.error ? <ErrorBox error={board.error} /> : !board.data ? <div className="card"><p className="mu">Loading…</p></div> : (
          <>
            <Kpis b={board.data} />
            {view === "round" && <RoundSheet b={board.data} canWrite={canWrite} onOpen={(id) => setParams({ meter: id })} />}
            {view === "exceptions" && <Exceptions b={board.data} onOpen={(id) => setParams({ meter: id })} />}
            {view === "monthly" && <Monthly b={board.data} onOpen={(id) => setParams({ meter: id })} />}
          </>
        )}
      {meterId && <MeterSheet id={meterId} onClose={() => setParams({}, { replace: true })} />}
    </>
  );
}

function Kpis({ b }: { b: Board }) {
  const k = b.kpis, pct = k.expected ? Math.round((k.read / k.expected) * 100) : 100;
  // Today's round is still open, so an unfinished count is amber, not red.
  const lvl = (x: number, a: number) => (x >= 100 ? "g" : x >= a || b.date === localToday() ? "a" : "r");
  const bal = b.balance;
  return (
    <div className="grid" style={{ marginBottom: 12 }}>
      <div className={"kpi " + lvl(pct, b.thresholds.completenessAmber)}><span>Read on {fmtDate(b.date)}</span><b>{k.read} / {k.expected}</b><span>{pct}% of meters</span></div>
      <div className={"kpi " + (k.critical ? "r" : "g")}><span>Critical this month</span><b>{k.critical}</b><span>Reading lower than previous</span></div>
      <div className={"kpi " + (k.high ? "r" : "g")}><span>High this month</span><b>{k.high}</b><span>Big swings, zero use, gaps</span></div>
      <div className={"kpi " + (k.warning ? "a" : "g")}><span>Warnings this month</span><b>{k.warning}</b><span>To review</span></div>
      {bal && bal.othersPct != null && (
        <div className={"kpi " + (bal.level === "green" ? "g" : bal.level === "amber" ? "a" : "r")} title="Utility main meter minus tenant and common-area meters, month to date">
          <span>Energy balance</span><b>{n(bal.othersPct)}%</b><span>Unaccounted, {monthLabel(b.month)} to date</span>
        </div>
      )}
    </div>
  );
}

// ---------------- round sheet ----------------
type Entry = { value: string; note: string; confirm?: string; err?: string; ok?: string };

function RoundSheet({ b, canWrite, onOpen }: { b: Board; canWrite: boolean; onOpen: (id: string) => void }) {
  const qc = useQueryClient();
  const [entries, setEntries] = useState<Record<string, Entry>>({});
  const [filter, setFilter] = useState<"todo" | "all">("todo");
  const [busy, setBusy] = useState(false);
  useEffect(() => setEntries({}), [b.property.id, b.date]);
  const meters = b.meters.filter((m) => m.active && (filter === "all" || !m.reading));
  const set = (id: string, e: Partial<Entry>) => setEntries((x) => ({ ...x, [id]: { ...{ value: "", note: "" }, ...x[id], ...e } }));

  /** Checks a value before saving. Returns a question for the technician, or null when it looks fine. */
  const precheck = (m: BoardMeter, v: number) => {
    if (m.previous && v < m.previous.value) return `This is lower than the previous reading (${n(m.previous.value, 2)} on ${fmtDate(m.previous.date)}). Re-read the meter. Save anyway?`;
    if (m.previous && m.baselinePerDay) {
      const days = Math.max(1, Math.round((Date.parse(b.date) - Date.parse(m.previous.date)) / 864e5));
      const per = ((v - m.previous.value) * m.multiplier) / days;
      const r = per / m.baselinePerDay;
      if (r > 3) return `That is ${n(r)}× the usual use (${n(per)} vs about ${n(m.baselinePerDay)} ${m.unitOfMeasure} a day). Re-read the meter. Save anyway?`;
    }
    return null;
  };
  const save = async (m: BoardMeter, replace = false) => {
    const e = entries[m.id];
    const v = Number((e?.value ?? "").replace(/,/g, ""));
    if (!e?.value.trim() || !isFinite(v) || v < 0) { set(m.id, { err: "Enter the number on the meter display" }); return false; }
    if (!e.confirm) {
      const q = precheck(m, v);
      if (q) { set(m.id, { confirm: q, err: undefined }); return false; }
    }
    try {
      const r = await api.post<{ warning: string | null }>("/meters/readings", { meterId: m.id, date: b.date, value: v, note: e.note, replace });
      set(m.id, { ok: r.warning ?? "Saved", err: undefined, confirm: undefined, value: "" });
      return true;
    } catch (x) {
      set(m.id, { err: (x as Error).message, confirm: undefined });
      return false;
    }
  };
  const saveAll = async () => {
    setBusy(true);
    for (const m of meters) if (entries[m.id]?.value?.trim() && !entries[m.id]?.confirm) await save(m);
    setBusy(false);
    qc.invalidateQueries({ queryKey: ["meter-board"] });
  };
  const after = async (m: BoardMeter, replace = false) => { if (await save(m, replace)) qc.invalidateQueries({ queryKey: ["meter-board"] }); };
  const pending = meters.filter((m) => entries[m.id]?.value?.trim()).length;
  const unit = (m: BoardMeter) => m.unitCode ? `${m.unitCode}${m.occupant ? " · " + m.occupant : ""}` : m.meterClass;

  return (
    <div className="card">
      <div className="row">
        <div className="tabs" style={{ margin: 0 }}>
          <button className={filter === "todo" ? "on" : ""} onClick={() => setFilter("todo")}>Still to read ({b.meters.filter((m) => m.active && !m.reading).length})</button>
          <button className={filter === "all" ? "on" : ""} onClick={() => setFilter("all")}>All meters</button>
        </div>
        <span className="spacer" />
        {canWrite && pending > 1 && <button className="cta sm" disabled={busy} onClick={saveAll}>{busy ? "Saving…" : `Save ${pending} readings`}</button>}
      </div>
      {!b.meters.length ? <p className="mu">No meters in this building yet. A supervisor or engineer adds them under Configuration, Meters.</p>
        : !meters.length ? <p className="okmsg">Every meter has a reading for {fmtDate(b.date)}.</p> : (
          <div className="ergrid">
            {meters.map((m) => {
              const e = entries[m.id];
              return (
                <div key={m.id} className="er" style={{ cursor: "default" }}>
                  <div className="row" style={{ flexWrap: "wrap" }}>
                    <button className="lnk" onClick={() => onOpen(m.id)}><b>{m.code}</b></button>
                    <span className="mu">{unit(m)}{m.location ? " · " + m.location : ""}</span>
                    {m.missingStreak >= 2 && <span className="pill r">Missing {m.missingStreak} days</span>}
                    <span className="spacer" />
                    <small className="mu">Previous: {m.previous ? `${n(m.previous.value, 2)} (${fmtDate(m.previous.date)})` : "none"}</small>
                  </div>
                  {m.reading ? (
                    <div className="row"><span className="pill">Read: {n(m.reading.value, 2)}</span>
                      {m.previous && <span className="mu">Use {n((m.reading.value - m.previous.value) * m.multiplier)} {m.unitOfMeasure}</span>}
                      {canWrite && <button className="lnk" onClick={() => set(m.id, { value: String(m.reading!.value) })}>Replace</button>}
                    </div>
                  ) : null}
                  {canWrite && (!m.reading || e) && (
                    <div className="row" style={{ flexWrap: "wrap", marginTop: 6 }}>
                      <input className="in" inputMode="decimal" style={{ width: 150, fontSize: 16 }} placeholder="Register reading" value={e?.value ?? ""}
                        onChange={(x) => set(m.id, { value: x.target.value, confirm: undefined, err: undefined, ok: undefined })}
                        onKeyDown={(x) => x.key === "Enter" && after(m, !!m.reading)} />
                      <input className="in" style={{ flex: 1, minWidth: 140 }} placeholder="Note (optional)" value={e?.note ?? ""} onChange={(x) => set(m.id, { note: x.target.value })} />
                      <button className="cta sm" onClick={() => after(m, !!m.reading)}>{m.reading ? "Replace" : "Save"}</button>
                    </div>
                  )}
                  {e?.confirm && (
                    <div className="row" style={{ marginTop: 6, flexWrap: "wrap" }}>
                      <span className="err" style={{ flex: 1 }}>{e.confirm}</span>
                      <button className="lnk" onClick={() => set(m.id, { confirm: undefined })}>Re-read</button>
                      <button className="cta sm sec" onClick={() => after(m, !!m.reading)}>Save anyway</button>
                    </div>
                  )}
                  {e?.err && <p className="err">{e.err}</p>}
                  {e?.ok && <p className={e.ok === "Saved" ? "okmsg" : "err"}>{e.ok}</p>}
                </div>
              );
            })}
          </div>
        )}
    </div>
  );
}

// ---------------- exceptions ----------------
function Exceptions({ b, onOpen }: { b: Board; onOpen: (id: string) => void }) {
  const [scope, setScope] = useState<"day" | "month">("month");
  const [sev, setSev] = useState("All");
  const [wo, setWo] = useState<WoPrefill | null>(null);
  const [openWo, setOpenWo] = useState<string | null>(null);
  const { user } = useAuth();
  const byId = useMemo(() => new Map(b.meters.map((m) => [m.id, m])), [b.meters]);
  const list = b.exceptions.filter((x) => (scope === "month" || x.date === b.date) && (sev === "All" || x.severity === sev));
  return (
    <div className="card">
      <div className="row" style={{ flexWrap: "wrap" }}>
        <div className="tabs" style={{ margin: 0 }}>
          <button className={scope === "day" ? "on" : ""} onClick={() => setScope("day")}>{fmtDate(b.date)}</button>
          <button className={scope === "month" ? "on" : ""} onClick={() => setScope("month")}>{monthLabel(b.month)} to date</button>
        </div>
        <select className="in" style={{ width: "auto" }} value={sev} onChange={(e) => setSev(e.target.value)}><option>All</option><option>Critical</option><option>High</option><option>Warning</option></select>
      </div>
      {!list.length ? <p className="okmsg">No exceptions{scope === "day" ? ` on ${fmtDate(b.date)}` : " this month"}.</p> : list.map((x) => {
        const m = byId.get(x.meterId);
        return (
          <div key={x.id} className={"er" + (x.severity === "Critical" ? " bad" : "")} style={{ cursor: "default" }}>
            <div className="row" style={{ flexWrap: "wrap" }}>
              <span className={"pill " + SEV_CLASS[x.severity]}>{x.severity}</span><b>{x.label}</b>
              <button className="lnk" onClick={() => onOpen(x.meterId)}>{m?.code}</button>
              <span className="mu">{m?.unitCode ? `${m.unitCode}${m.occupant ? " · " + m.occupant : ""}` : m?.meterClass}</span>
              <span className="spacer" /><small className="mu">{fmtDate(x.date)}</small>
            </div>
            <p style={{ margin: "4px 0" }}>{x.what}</p>
            <p className="mu" style={{ margin: 0 }}><b>Check:</b> {x.check}</p>
            {(user?.tabs.wos ?? 0) >= 2 && m && x.code !== "MISSING" && (
              <button className="lnk" onClick={() => setWo({ property: b.property.name, unitId: m.unitId ?? undefined, assetId: m.assetId ?? undefined, title: `Meter ${m.code}: ${x.label.toLowerCase()}`, description: `${x.what}\n\n${x.check}`, trade: "Electrical", location: m.location, priority: x.severity === "Critical" ? "High" : "Medium" })}>Raise a work order</button>
            )}
          </div>
        );
      })}
      {wo && <NewWorkOrderSheet buildings={[b.property.name]} prefill={wo} onClose={() => setWo(null)} onCreated={(w) => { setWo(null); setOpenWo(w.id); }} />}
      {openWo && <WorkOrderSheet id={openWo} onClose={() => setOpenWo(null)} />}
    </div>
  );
}

// ---------------- monthly ----------------
function Monthly({ b, onOpen }: { b: Board; onOpen: (id: string) => void }) {
  const [cls, setCls] = useState("Tenant");
  const rows = b.meters.filter((m) => cls === "All" || m.meterClass === cls).sort((x, y) => y.monthToDate - x.monthToDate);
  const total = rows.reduce((s, m) => s + m.monthToDate, 0);
  const bal = b.balance, pb = b.prevBalance;
  return (
    <>
      {bal && bal.main > 0 && (
        <div className="card">
          <h2>Energy balance</h2>
          <p className="mu">The utility main meter against the sum of tenant and common-area meters. "Others" is unaccounted use plus losses. Green up to {b.thresholds.lossGreen}%, amber up to {b.thresholds.lossAmber}%.</p>
          <Table head={["Period", "Utility main", "Tenant meters", "Common area", "Others", "Others %"]}>
            {[[`${monthLabel(b.month)} to date`, bal], [monthLabel(b.prevMonth), pb]].filter(([, x]) => x && (x as BalanceResult).main > 0).map(([l, x]) => {
              const r = x as BalanceResult;
              return <tr key={l as string}><td>{l as string}</td><td>{n(r.main)}</td><td>{n(r.tenant)}</td><td>{n(r.commonArea)}</td><td>{n(r.others)}</td><td><span className={"pill " + (r.level === "green" ? "g" : r.level === "amber" ? "a" : "r")}>{n(r.othersPct)}%</span></td></tr>;
            })}
          </Table>
        </div>
      )}
      <div className="card">
        <div className="row">
          <h2 style={{ margin: 0 }}>Use by meter</h2><span className="spacer" />
          <select className="in" style={{ width: "auto" }} value={cls} onChange={(e) => setCls(e.target.value)}>{METER_CLASSES.map((c) => <option key={c}>{c}</option>)}<option>All</option></select>
        </div>
        <p className="mu">{monthLabel(b.month)} up to {fmtDate(b.date)}. Change compares with the same days of {monthLabel(b.prevMonth)}. Days without a reading are filled from the next reading and counted as estimated.</p>
        <Table head={["Meter", "Unit / occupant", `${monthLabel(b.month)} to date`, "Share", "vs last month", monthLabel(b.prevMonth), "Usual per day", "Readings"]}>
          {rows.map((m) => (
            <tr key={m.id} className="click" onClick={() => onOpen(m.id)}>
              <td><b>{m.code}</b></td>
              <td className="wrap">{m.unitCode ? `${m.unitCode}${m.occupant ? " · " + m.occupant : ""}` : m.meterClass}</td>
              <td>{n(m.monthToDate)} {m.unitOfMeasure}{m.estimatedDays ? <small className="mu"> ({m.estimatedDays}d est.)</small> : null}</td>
              <td>{total > 0 ? n((m.monthToDate / total) * 100) + "%" : "–"}</td>
              <td>{m.momPct == null ? "–" : <span className={Math.abs(m.momPct) > 25 ? "pill r" : Math.abs(m.momPct) > 10 ? "pill a" : "mu"}>{m.momPct > 0 ? "+" : ""}{n(m.momPct)}%</span>}</td>
              <td>{n(m.prevMonth)}</td>
              <td>{n(m.baselinePerDay)}</td>
              <td>{m.completeness ? <span className={m.completeness.pct < b.thresholds.completenessAmber ? "pill a" : "mu"}>{m.completeness.have}/{m.completeness.expected}</span> : "–"}</td>
            </tr>
          ))}
        </Table>
        <p className="mu">Total: {n(total)}</p>
      </div>
    </>
  );
}

// ---------------- meter editor (used from Configuration) ----------------
export function MeterEditor({ meter, propertyId, property, onClose }: { meter?: MeterDTO; propertyId: string; property: string; onClose: () => void }) {
  const qc = useQueryClient();
  const lookup = useQuery({ queryKey: ["asset-lookup", property], queryFn: () => api.get<{ units: { id: string; code: string; tenantName: string; ownerName: string }[]; assets: { id: string; tag: string; name: string }[] }>(`/assets/lookup?property=${encodeURIComponent(property)}`) });
  const [f, setF] = useState(() => ({
    code: meter?.code ?? "", meterClass: meter?.meterClass ?? "Tenant", utility: meter?.utility ?? "Power", unitOfMeasure: meter?.unitOfMeasure ?? "kWh",
    unitId: meter?.unitId ?? "", assetId: meter?.assetId ?? "", serial: meter?.serial ?? "", brand: meter?.brand ?? "", location: meter?.location ?? "",
    ctRatio: meter?.ctRatio ?? "", multiplier: String(meter?.multiplier ?? 1), rolloverAt: meter?.rolloverAt == null ? "" : String(meter.rolloverAt),
    expectedDaily: meter?.expectedDaily ?? true, activeFrom: meter?.activeFrom ?? localToday(), activeTo: meter?.activeTo ?? "", notes: meter?.notes ?? "",
  }));
  const [err, setErr] = useState("");
  const set = (k: keyof typeof f, v: string | boolean) => setF((x) => ({ ...x, [k]: v }));
  const save = useMutation({
    mutationFn: () => {
      const body = { ...f, unitId: f.unitId || null, assetId: f.assetId || null, multiplier: Number(f.multiplier) || 1, rolloverAt: f.rolloverAt === "" ? null : Number(f.rolloverAt), activeTo: f.activeTo || null };
      return meter ? api.patch<MeterDTO>(`/meters/${meter.id}`, body) : api.post<MeterDTO>("/meters", { ...body, propertyId });
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["meter-board"] }); qc.invalidateQueries({ queryKey: ["meter"] }); qc.invalidateQueries({ queryKey: ["buildings"] }); onClose(); },
    onError: (e) => setErr((e as Error).message),
  });
  return (
    <Sheet title={meter ? `Edit ${meter.code}` : "New meter"} onClose={onClose}>
      <div className="fgrid">
        <div className="ff"><span className="mu">Meter ID *</span><input value={f.code} onChange={(e) => set("code", e.target.value)} placeholder="e.g. M-I3-01" /></div>
        <div className="ff"><span className="mu">Class</span><select value={f.meterClass} onChange={(e) => set("meterClass", e.target.value)}>{METER_CLASSES.map((c) => <option key={c}>{c}</option>)}</select></div>
        <div className="ff"><span className="mu">Utility</span><select value={f.utility} onChange={(e) => setF((x) => ({ ...x, utility: e.target.value as MeterDTO["utility"], unitOfMeasure: UTILITY_UNIT[e.target.value as MeterDTO["utility"]] }))}>{METER_UTILITIES.map((c) => <option key={c}>{c}</option>)}</select></div>
        <div className="ff"><span className="mu">Unit / space</span><select value={f.unitId} onChange={(e) => set("unitId", e.target.value)}><option value="">– None (building) –</option>{(lookup.data?.units ?? []).map((u) => <option key={u.id} value={u.id}>{u.code}{u.tenantName || u.ownerName ? " · " + (u.tenantName || u.ownerName) : ""}</option>)}</select></div>
        <div className="ff"><span className="mu">Serial no.</span><input value={f.serial} onChange={(e) => set("serial", e.target.value)} /></div>
        <div className="ff"><span className="mu">Brand / type</span><input value={f.brand} onChange={(e) => set("brand", e.target.value)} /></div>
        <div className="ff"><span className="mu">Location</span><input value={f.location} onChange={(e) => set("location", e.target.value)} placeholder="e.g. Electrical room, 3F" /></div>
        <div className="ff"><span className="mu">CT ratio (for reference)</span><input value={f.ctRatio} onChange={(e) => set("ctRatio", e.target.value)} placeholder="e.g. 200:5" /></div>
        <div className="ff"><span className="mu">Multiplier</span><input type="number" min={0} step="any" value={f.multiplier} onChange={(e) => set("multiplier", e.target.value)} /></div>
        <div className="ff"><span className="mu">Register rolls over after</span><input type="number" min={0} step="any" value={f.rolloverAt} onChange={(e) => set("rolloverAt", e.target.value)} placeholder="e.g. 999999.9" /></div>
        <div className="ff"><span className="mu">Active from *</span><input type="date" value={f.activeFrom} onChange={(e) => set("activeFrom", e.target.value)} /></div>
        <div className="ff"><span className="mu">Active to</span><input type="date" value={f.activeTo} onChange={(e) => set("activeTo", e.target.value)} /></div>
        <label className="row" style={{ marginTop: 22 }}><input type="checkbox" checked={f.expectedDaily} onChange={(e) => set("expectedDaily", e.target.checked)} /> Read every day</label>
      </div>
      <p className="mu">{METER_CLASS_NOTES[f.meterClass as keyof typeof METER_CLASS_NOTES]} Multiplier: register × multiplier = use. Leave it at 1 for meters that show kWh directly; utility main meters read through CT/PT usually need one.</p>
      <div className="ff"><span className="mu">Notes</span><textarea className="in" rows={2} value={f.notes} onChange={(e) => set("notes", e.target.value)} /></div>
      {err && <p className="err">{err}</p>}
      <div className="row"><span className="spacer" /><button className="cta" disabled={save.isPending || !f.code.trim() || !f.activeFrom} onClick={() => save.mutate()}>{save.isPending ? "Saving…" : "Save"}</button></div>
    </Sheet>
  );
}

// ---------------- one meter ----------------
function UseChart({ intervals, baseline }: { intervals: Interval[]; baseline: number | null }) {
  const pts = intervals.filter((i) => i.counted).slice(-60);
  if (pts.length < 2) return null;
  const max = Math.max(...pts.map((p) => p.perDay), baseline ?? 0) || 1;
  const W = 600, H = 120, bw = W / pts.length;
  return (
    <svg viewBox={`0 0 ${W} ${H + 14}`} style={{ width: "100%", height: 140 }} role="img" aria-label="Daily use">
      {pts.map((p, i) => {
        const h = (p.perDay / max) * H;
        const hot = baseline && (p.perDay > baseline * 1.3 || p.perDay < baseline * 0.7);
        return <rect key={p.date} x={i * bw + 1} y={H - h} width={Math.max(1, bw - 2)} height={h} fill={hot ? "var(--a)" : "var(--navy, #1f3566)"} opacity={p.days > 1 ? 0.5 : 1}><title>{`${p.date}: ${p.perDay} per day${p.days > 1 ? ` (over ${p.days} days)` : ""}`}</title></rect>;
      })}
      {baseline != null && <line x1={0} x2={W} y1={H - (baseline / max) * H} y2={H - (baseline / max) * H} stroke="var(--or)" strokeDasharray="4 3" />}
      <text x={0} y={H + 12} fontSize={10} fill="currentColor">{pts[0].date}</text>
      <text x={W} y={H + 12} fontSize={10} fill="currentColor" textAnchor="end">{pts[pts.length - 1].date}</text>
    </svg>
  );
}

export function MeterSheet({ id, onClose }: { id: string; onClose: () => void }) {
  const q = useQuery({ queryKey: ["meter", id], queryFn: () => api.get<MeterHistory>(`/meters/${id}?days=120`) });
  const qc = useQueryClient();
  const { user } = useAuth();
  const canManage = useCanManage();
  const [editing, setEditing] = useState(false);
  const [voiding, setVoiding] = useState<MeterReadingDTO | null>(null);
  const [logging, setLogging] = useState(false);
  const [showVoided, setShowVoided] = useState(false);
  const refresh = () => { q.refetch(); qc.invalidateQueries({ queryKey: ["meter-board"] }); };
  const d = q.data;
  if (editing && d) return <MeterEditor meter={d.meter} propertyId={d.meter.propertyId} property={d.meter.property} onClose={() => { setEditing(false); refresh(); }} />;
  if (voiding) return <VoidSheet r={voiding} onClose={() => { setVoiding(null); refresh(); }} />;
  if (logging && d) return <EventSheet m={d.meter} onClose={() => { setLogging(false); refresh(); }} />;
  const ivByReading = new Map((d?.intervals ?? []).map((i) => [i.readingId, i]));
  const flagged = new Set((d?.exceptions ?? []).filter((x) => x.readingId).map((x) => x.readingId!));
  const readings = (d?.readings ?? []).filter((r) => showVoided || !r.voided);
  return (
    <Sheet title={d ? `Meter ${d.meter.code}` : "Meter"} onClose={onClose}>
      {q.error ? <p className="err">{(q.error as Error).message}</p> : !d ? <p className="mu">Loading…</p> : (
        <>
          <dl className="kv">
            <dt>Building</dt><dd>{d.meter.property}{d.meter.location ? " · " + d.meter.location : ""}</dd>
            <dt>Class</dt><dd>{d.meter.meterClass} · {d.meter.utility} ({d.meter.unitOfMeasure})</dd>
            {d.meter.unitCode && <><dt>Unit / space</dt><dd><Link to={`/configuration?unit=${d.meter.unitId}`}>{d.meter.unitCode}</Link>{d.meter.occupant ? " · " + d.meter.occupant : ""}</dd></>}
            {(d.meter.serial || d.meter.brand) && <><dt>Serial / brand</dt><dd>{[d.meter.serial, d.meter.brand].filter(Boolean).join(" · ")}</dd></>}
            {(d.meter.ctRatio || d.meter.multiplier !== 1) && <><dt>CT / multiplier</dt><dd>{[d.meter.ctRatio, `× ${d.meter.multiplier}`].filter(Boolean).join(" · ")}</dd></>}
            <dt>Active</dt><dd>{fmtDate(d.meter.activeFrom)}{d.meter.activeTo ? ` to ${fmtDate(d.meter.activeTo)}` : ""}{d.meter.expectedDaily ? " · read daily" : ""}</dd>
            <dt>Usual use</dt><dd>{d.baselinePerDay == null ? "Not enough readings yet" : `${n(d.baselinePerDay)} ${d.meter.unitOfMeasure} per day (median, last 30 days)`}</dd>
            {d.meter.notes && <><dt>Notes</dt><dd>{d.meter.notes}</dd></>}
          </dl>
          <div className="row" style={{ marginTop: 8 }}>
            {canManage && <button className="lnk" onClick={() => setEditing(true)}>Edit meter</button>}
            {canManage && <button className="lnk" onClick={() => setLogging(true)}>Log replacement / rollover / maintenance</button>}
          </div>
          <h3>Daily use, last 60 readings</h3>
          <UseChart intervals={d.intervals} baseline={d.baselinePerDay} />
          {!!d.events.length && <>
            <h3>Meter events</h3>
            {d.events.map((e) => (
              <div key={e.id} className="row"><b>{e.type}</b><span className="mu">{fmtDate(e.date)}</span>
                {e.prevReading != null && <span className="mu">old register ended {n(e.prevReading, 2)}, new starts {n(e.newReading, 2)}</span>}
                {e.notes && <span className="mu">· {e.notes}</span>}
                <span className="spacer" />{canManage && <DeleteEvent id={e.id} onDone={refresh} />}
              </div>
            ))}
          </>}
          <div className="row"><h3>Readings</h3><span className="spacer" /><label className="row chk"><input type="checkbox" checked={showVoided} onChange={(e) => setShowVoided(e.target.checked)} /> Show voided</label></div>
          <Table head={["Date", "Reading", "Use", "By", ""]}>
            {readings.map((r) => {
              const iv = ivByReading.get(r.id);
              const mine = r.takenBy === user?.name && Date.now() - Date.parse(r.createdAt) < 864e5;
              return (
                <tr key={r.id} style={r.voided ? { opacity: 0.5, textDecoration: "line-through" } : undefined}>
                  <td>{fmtDate(r.date)}</td>
                  <td>{n(r.value, 2)}{flagged.has(r.id) && !r.voided ? <span className="pill r" style={{ marginLeft: 6 }}>Check</span> : null}</td>
                  <td>{iv ? <>{n(iv.use)}{iv.days > 1 ? <small className="mu"> /{iv.days}d</small> : null}{iv.events.length ? <small className="mu"> ({iv.events.join(", ")})</small> : null}</> : "–"}</td>
                  <td className="wrap">{r.takenBy ?? "–"}{r.note ? <><br /><small className="mu">{r.note}</small></> : null}{r.voided ? <><br /><small className="mu">Voided by {r.voidedBy}: {r.voidReason}</small></> : null}</td>
                  <td>{!r.voided && (canManage || mine) && <button className="lnk" onClick={() => setVoiding(r)}>Void</button>}</td>
                </tr>
              );
            })}
          </Table>
        </>
      )}
    </Sheet>
  );
}

function DeleteEvent({ id, onDone }: { id: string; onDone: () => void }) {
  const [sure, setSure] = useState(false);
  const del = useMutation({ mutationFn: () => api.del(`/meters/events/${id}`), onSuccess: onDone });
  return sure ? <button className="lnk err" onClick={() => del.mutate()}>Confirm remove</button> : <button className="lnk" onClick={() => setSure(true)}>Remove</button>;
}

function VoidSheet({ r, onClose }: { r: MeterReadingDTO; onClose: () => void }) {
  const [reason, setReason] = useState("");
  const [err, setErr] = useState("");
  const save = useMutation({ mutationFn: () => api.post(`/meters/readings/${r.id}/void`, { reason }), onSuccess: onClose, onError: (e) => setErr((e as Error).message) });
  return (
    <Sheet title={`Void reading of ${fmtDate(r.date)}`} onClose={onClose}>
      <p>Reading {n(r.value, 2)} by {r.takenBy ?? "unknown"}. A voided reading stays in the history but is not used. Enter the right value afterwards on the Daily readings screen.</p>
      <div className="ff"><span className="mu">Why is it wrong?</span><input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Misread 7 as 1; re-read shows 45,712.3" /></div>
      {err && <p className="err">{err}</p>}
      <div className="row"><span className="spacer" /><button className="cta" disabled={reason.trim().length < 3 || save.isPending} onClick={() => save.mutate()}>Void reading</button></div>
    </Sheet>
  );
}

function EventSheet({ m, onClose }: { m: MeterDTO; onClose: () => void }) {
  const [f, setF] = useState({ date: localToday(), type: "Replacement", prevReading: "", newReading: "0", notes: "" });
  const [err, setErr] = useState("");
  const reg = (REGISTER_EVENTS as readonly string[]).includes(f.type);
  const save = useMutation({
    mutationFn: () => api.post(`/meters/${m.id}/events`, { ...f, prevReading: reg ? Number(f.prevReading) : null, newReading: reg ? Number(f.newReading) : null }),
    onSuccess: onClose,
    onError: (e) => setErr((e as Error).message),
  });
  return (
    <Sheet title={`Meter event · ${m.code}`} onClose={onClose}>
      <div className="fgrid">
        <div className="ff"><span className="mu">Type</span><select value={f.type} onChange={(e) => setF({ ...f, type: e.target.value })}>{METER_EVENT_TYPES.map((t) => <option key={t}>{t}</option>)}</select></div>
        <div className="ff"><span className="mu">Date</span><input type="date" value={f.date} max={localToday()} onChange={(e) => setF({ ...f, date: e.target.value })} /></div>
        {reg && <div className="ff"><span className="mu">Old register's final reading *</span><input type="number" step="any" value={f.prevReading} onChange={(e) => setF({ ...f, prevReading: e.target.value })} /></div>}
        {reg && <div className="ff"><span className="mu">New register's starting reading *</span><input type="number" step="any" value={f.newReading} onChange={(e) => setF({ ...f, newReading: e.target.value })} /></div>}
      </div>
      {reg && <p className="mu">Use between the last reading and the next one is counted on the old register up to its final reading, then on the new register from its start. This removes the "lower than previous" exception.</p>}
      <div className="ff"><span className="mu">Notes</span><textarea className="in" rows={2} value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} /></div>
      {err && <p className="err">{err}</p>}
      <div className="row"><span className="spacer" /><button className="cta" disabled={save.isPending || (reg && (f.prevReading === "" || f.newReading === ""))} onClick={() => save.mutate()}>Save event</button></div>
    </Sheet>
  );
}
