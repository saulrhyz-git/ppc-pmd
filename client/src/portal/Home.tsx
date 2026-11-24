import { useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { TRADES, type PortalMeDTO, type PortalRequestDTO, type PortalUnitDTO } from "@pmd/shared";
import { fileUrl, papi } from "./api";
import { useMeters } from "./Meters";
import { Icon, STATUS_TEXT, Sheet, StatusPill, TRADE_EMOJI, TRADE_LABEL, Tracker, firstName, fmtDay, fmtWhen, greeting } from "./bits";

const OPEN = ["Sent", "Received", "In progress"];
const useRequests = () => useQuery({ queryKey: ["p-requests"], queryFn: () => papi.get<PortalRequestDTO[]>("/requests"), refetchInterval: 60_000 });

// ---------- report a problem ----------

function FilesInput({ files, onChange }: { files: File[]; onChange: (f: File[]) => void }) {
  const [err, setErr] = useState("");
  return (
    <div className="pp-f">
      <span>Photos (optional)</span>
      <label className="pp-drop">
        <span style={{ fontSize: 24 }}>📷</span>
        <span>{files.length ? <><b>{files.length} file{files.length === 1 ? "" : "s"}</b> attached · tap to change</> : <><b>Add photos</b> or a PDF · up to 5, 10 MB each</>}</span>
        <input type="file" multiple accept="image/jpeg,image/png,image/gif,image/webp,image/heic,application/pdf" onChange={(e) => {
          const list = [...(e.target.files ?? [])];
          const big = list.find((f) => f.size > 10 * 1024 * 1024);
          setErr(list.length > 5 ? "Choose at most 5 files" : big ? `${big.name} is larger than 10 MB` : "");
          onChange(list.slice(0, 5).filter((f) => f.size <= 10 * 1024 * 1024));
        }} />
      </label>
      {err && <p className="pp-err">{err}</p>}
    </div>
  );
}

function NewRequest({ units, unitId, onDone }: { units: PortalUnitDTO[]; unitId?: string; onDone: (r: PortalRequestDTO) => void }) {
  const qc = useQueryClient();
  const can = units.filter((u) => u.canRequest);
  const [unit, setUnit] = useState(unitId && can.some((u) => u.unitId === unitId) ? unitId : can[0]?.unitId ?? "");
  const [trade, setTrade] = useState<string>("");
  const [location, setLocation] = useState("");
  const [concern, setConcern] = useState("");
  const [urgency, setUrgency] = useState<"Normal" | "Urgent">("Normal");
  const [files, setFiles] = useState<File[]>([]);
  const [err, setErr] = useState("");
  const m = useMutation({
    mutationFn: () => {
      const f = new FormData();
      f.append("unitId", unit); f.append("trade", trade); f.append("location", location); f.append("concern", concern); f.append("urgency", urgency);
      files.forEach((x) => f.append("files", x));
      return papi.post<PortalRequestDTO>("/requests", f);
    },
    onSuccess: (r) => { qc.invalidateQueries({ queryKey: ["p-requests"] }); onDone(r); },
    onError: (e) => setErr((e as Error).message),
  });
  const submit = (e: FormEvent) => { e.preventDefault(); setErr(""); if (!trade) return setErr("Pick what the problem is about"); m.mutate(); };
  if (!can.length) return <p className="mu">Your access doesn’t include reporting problems. Please contact your property management office.</p>;
  return (
    <form onSubmit={submit}>
      {can.length > 1 && (
        <label className="pp-f"><span>Which unit?</span>
          <select value={unit} onChange={(e) => setUnit(e.target.value)}>{can.map((u) => <option key={u.unitId} value={u.unitId}>{u.building} · Unit {u.code}</option>)}</select>
        </label>
      )}
      <div className="pp-f">
        <span>What’s the problem about?</span>
        <div className="pp-cats">
          {TRADES.map((t) => <button type="button" key={t} className={"pp-cat" + (trade === t ? " on" : "")} onClick={() => setTrade(t)}><span className="em">{TRADE_EMOJI[t]}</span>{TRADE_LABEL[t] ?? t}</button>)}
        </div>
      </div>
      <label className="pp-f"><span>Tell us what’s happening</span>
        <textarea value={concern} onChange={(e) => setConcern(e.target.value)} required minLength={5} maxLength={4000} placeholder="For example: water is dripping from the bathroom ceiling since this morning." />
      </label>
      <label className="pp-f"><span>Where exactly? (optional)</span><input value={location} onChange={(e) => setLocation(e.target.value)} maxLength={200} placeholder="e.g. master bathroom, pantry, main door" /></label>
      <div className="pp-f">
        <span>How urgent is it?</span>
        <div className="pp-seg">
          <button type="button" className={urgency === "Normal" ? "on" : ""} onClick={() => setUrgency("Normal")}>Can wait a day or two</button>
          <button type="button" className={"urgent" + (urgency === "Urgent" ? " on" : "")} onClick={() => setUrgency("Urgent")}>Urgent</button>
        </div>
        {urgency === "Urgent" && <p className="pp-note">🚨 For emergencies like fire, smoke, flooding, someone trapped in an elevator or someone hurt, call building security or your emergency hotline now. Don’t wait for a reply here.</p>}
      </div>
      <FilesInput files={files} onChange={setFiles} />
      <button className="pp-btn full" disabled={m.isPending || !unit}>{m.isPending ? "Sending…" : "Send to property management"}</button>
      {err && <p className="pp-err">{err}</p>}
    </form>
  );
}

// ---------- one request ----------

function Attachments({ list }: { list: { id: string; filename: string; mime: string }[] }) {
  if (!list.length) return null;
  return (
    <div className="pp-thumbs">
      {list.map((a) => /^image\/(png|jpeg|gif|webp)$/.test(a.mime)
        ? <a key={a.id} href={fileUrl(a.id)} target="_blank" rel="noopener noreferrer"><img src={fileUrl(a.id)} alt={a.filename} /></a>
        : <a key={a.id} href={fileUrl(a.id)} rel="noopener noreferrer">📎 {a.filename}</a>)}
    </div>
  );
}

function RequestView({ id, onClose }: { id: string; onClose: () => void }) {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["p-request", id], queryFn: () => papi.get<PortalRequestDTO>(`/requests/${id}`), refetchInterval: 30_000 });
  const [msg, setMsg] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [err, setErr] = useState("");
  const m = useMutation({
    mutationFn: () => { const f = new FormData(); f.append("message", msg); files.forEach((x) => f.append("files", x)); return papi.post<PortalRequestDTO>(`/requests/${id}/followups`, f); },
    onSuccess: (r) => { setMsg(""); setFiles([]); qc.setQueryData(["p-request", id], r); qc.invalidateQueries({ queryKey: ["p-requests"] }); },
    onError: (e) => setErr((e as Error).message),
  });
  const r = q.data;
  return (
    <Sheet title={r ? <>{TRADE_EMOJI[r.trade] ?? "📝"} {TRADE_LABEL[r.trade] ?? r.trade}</> : "Request"} onClose={onClose}>
      {q.isError ? <p className="pp-err">{(q.error as Error).message}</p> : !r ? <p className="mu">Loading…</p> : (
        <>
          <div className="pp-card" style={{ marginBottom: 0 }}>
            <div className="pp-row"><StatusPill s={r.status} />{r.urgency === "Urgent" && <span className="pp-st r">Urgent</span>}<span className="mu">Ref. {r.controlNo}</span></div>
            <p style={{ margin: "10px 0 14px" }}><b>{STATUS_TEXT[r.status] ?? r.status}</b><br /><span className="mu">{r.building} · {r.location || `Unit ${r.unitCode}`}</span></p>
            <Tracker status={r.status} />
          </div>
          {r.workOrders.filter((w) => w.status !== "Cancelled").map((w) => (
            <div key={w.ticket} className="pp-wo">
              <span style={{ fontSize: 20 }}>🧰</span>
              <div style={{ flex: 1 }}><b>Repair scheduled</b><br /><span className="mu">{w.title} · target {fmtDay(w.targetDate)}{w.completedAt ? ` · done ${fmtDay(w.completedAt)}` : ""}</span></div>
              <StatusPill s={w.status} />
            </div>
          ))}
          <div className="pp-chat">
            <div className={"pp-bub " + (r.mine ? "me" : "them")}>
              <small>{r.filedBy} · {fmtWhen(r.createdAt)}</small>{r.concern}<Attachments list={r.attachments} />
            </div>
            {r.updates.map((u) => u.kind === "status"
              ? <div key={u.id} className="pp-bub sys">{u.message} · {fmtWhen(u.createdAt)}</div>
              : (
                <div key={u.id} className={"pp-bub " + (u.mine ? "me" : "them")}>
                  <small>{u.authorName} · {fmtWhen(u.createdAt)}</small>{u.message}<Attachments list={u.attachments} />
                </div>
              ))}
          </div>
          {r.status !== "Closed" ? (
            <>
              <label className="pp-f" style={{ marginBottom: 6 }}><span>Send a message</span>
                <textarea value={msg} onChange={(e) => setMsg(e.target.value)} maxLength={4000} placeholder="Add details, or tell us when you’re home" style={{ minHeight: 70 }} />
              </label>
              <FilesInput files={files} onChange={setFiles} />
              <button className="pp-btn full" disabled={!msg.trim() || m.isPending} onClick={() => { setErr(""); m.mutate(); }}>{m.isPending ? "Sending…" : "Send message"}</button>
              {err && <p className="pp-err">{err}</p>}
            </>
          ) : <p className="pp-info">This request is closed. If the problem comes back, please report it again.</p>}
        </>
      )}
    </Sheet>
  );
}

function RequestCard({ r, onOpen }: { r: PortalRequestDTO; onOpen: () => void }) {
  const lastReply = [...r.updates].reverse().find((u) => u.kind === "response");
  return (
    <button className="pp-req" onClick={onOpen}>
      <div className="top">
        <span className="em">{TRADE_EMOJI[r.trade] ?? "📝"}</span>
        <h3 style={{ flex: 1, minWidth: 0 }}>{TRADE_LABEL[r.trade] ?? r.trade}</h3>
        {r.urgency === "Urgent" && <span className="pp-st r">Urgent</span>}
        <StatusPill s={r.status} />
      </div>
      <span className="mu" style={{ fontSize: 12, display: "block", marginTop: 4 }}>Unit {r.unitCode} · sent {fmtDay(r.createdAt)} · Ref. {r.controlNo}</span>
      <div className="txt">{r.concern}</div>
      {lastReply && <div className="pp-info" style={{ marginBottom: 12 }}>💬 <b>Property management:</b> {lastReply.message.slice(0, 120)}{lastReply.message.length > 120 ? "…" : ""}</div>}
      <Tracker status={r.status} />
    </button>
  );
}

function RequestList({ list, onOpen, empty }: { list: PortalRequestDTO[]; onOpen: (id: string) => void; empty: string }) {
  if (!list.length) return <div className="pp-card pp-empty"><div className="big">✨</div><p>{empty}</p></div>;
  return <>{list.map((r) => <RequestCard key={r.id} r={r} onOpen={() => onOpen(r.id)} />)}</>;
}

// ---------- pages ----------

function NoUnits() {
  return (
    <div className="pp-card pp-empty">
      <div className="big">🏢</div>
      <h2>No units linked yet</h2>
      <p>Your account isn’t linked to a unit or space right now. If you think this is a mistake, please contact your property management office.</p>
    </div>
  );
}

export function HomePage({ me }: { me: PortalMeDTO }) {
  const q = useRequests();
  const meters = useMeters().data ?? [];
  const [reporting, setReporting] = useState<string | null>(null);
  const [sel, setSel] = useState<string | null>(null);
  const all = q.data ?? [];
  const open = all.filter((r) => OPEN.includes(r.status));
  const openFor = (unitId: string) => (q.data ? open.filter((r) => r.unitId === unitId).length : me.units.find((u) => u.unitId === unitId)?.openRequests ?? 0);
  const canReport = me.units.some((u) => u.canRequest);
  return (
    <>
      <section className="pp-hero">
        <h1>{greeting()}, {firstName(me.name)}</h1>
        <p>{!me.units.length ? "Welcome to My Portal." : open.length ? `You have ${open.length} open request${open.length === 1 ? "" : "s"}. We’ll keep you posted here.` : "Everything looks good. If something needs fixing, let us know."}</p>
        {canReport && <button className="pp-btn" onClick={() => setReporting("")}>＋ Report a problem</button>}
      </section>

      {!me.units.length ? <NoUnits /> : (
        <>
          <div className="pp-quick">
            {canReport && <button className="pp-q" onClick={() => setReporting("")}><div className="ic"><Icon name="wrench" /></div><b>Report a problem</b><span>Leak, aircon, power, doors and more</span></button>}
            <Link className="pp-q" to="/requests"><div className="ic"><Icon name="list" /></div><b>My requests</b><span>{open.length} open · {all.length} in total</span></Link>
            <Link className="pp-q" to="/account"><div className="ic"><Icon name="shield" /></div><b>Account & security</b><span>{me.mfaEnabled ? "Two-step sign-in is on" : "Turn on two-step sign-in"}</span></Link>
          </div>

          <div className="pp-sec"><h2>My {me.units.length === 1 ? "unit" : "units"}</h2></div>
          <div className="pp-units">
            {me.units.map((u) => (
              <div key={u.unitId} className="pp-unit">
                <div className="ic"><Icon name={/commercial|space|office|retail/i.test(u.kind) ? "store" : "building"} /></div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <span className="mu">{u.building}</span>
                  <h3>Unit {u.code}</h3>
                  <span className="mu">{u.kind}{u.floor ? ` · Floor ${u.floor}` : ""}</span>
                  <div className="tags">
                    <span className="pp-tag">{u.relation}</span>
                    {openFor(u.unitId) > 0 && <span className="pp-tag or">{openFor(u.unitId)} open</span>}
                    {u.endsOn && <span className="pp-tag">Access until {fmtDay(u.endsOn)}</span>}
                  </div>
                  {meters.filter((m) => m.unitId === u.unitId).map((m) => (
                    <Link key={m.id} to="/meters" className="pp-mline">{m.utility === "Water" ? "💧" : "⚡"} <b>{m.monthToDate.toLocaleString("en-US", { maximumFractionDigits: 1 })} {m.unitOfMeasure}</b> this month{m.changePct != null && Math.abs(m.changePct) >= 1 ? <span className={m.changePct > 0 ? "up" : "down"}> {m.changePct > 0 ? "▲" : "▼"}{Math.abs(m.changePct)}%</span> : null}</Link>
                  ))}
                  {u.canRequest && <button className="pp-link" style={{ marginTop: 10 }} onClick={() => setReporting(u.unitId)}>Report a problem here →</button>}
                </div>
              </div>
            ))}
          </div>

          <div className="pp-sec"><h2>Recent requests</h2><span className="pp-sp" />{all.length > 3 && <Link to="/requests" className="pp-link" style={{ textDecoration: "none" }}>See all</Link>}</div>
          {q.isLoading ? <p className="mu">Loading…</p> : q.isError ? <p className="pp-err">{(q.error as Error).message}</p>
            : <RequestList list={all.slice(0, 3)} onOpen={setSel} empty="No requests yet. When something needs fixing, tap “Report a problem”." />}
        </>
      )}
      <p className="pp-foot">For emergencies, call building security or your emergency hotline right away.</p>

      {reporting !== null && <Sheet title="Report a problem" onClose={() => setReporting(null)}><NewRequest units={me.units} unitId={reporting || undefined} onDone={(r) => { setReporting(null); setSel(r.id); }} /></Sheet>}
      {sel && <RequestView id={sel} onClose={() => setSel(null)} />}
    </>
  );
}

export function RequestsPage({ me }: { me: PortalMeDTO }) {
  const q = useRequests();
  const [show, setShow] = useState<"open" | "done" | "all">("open");
  const [unit, setUnit] = useState("");
  const [reporting, setReporting] = useState(false);
  const [sel, setSel] = useState<string | null>(null);
  const list = (q.data ?? []).filter((r) => (!unit || r.unitId === unit) && (show === "all" || (show === "open") === OPEN.includes(r.status)));
  const canReport = me.units.some((u) => u.canRequest);
  if (!me.units.length) return <NoUnits />;
  return (
    <>
      <div className="pp-sec" style={{ marginTop: 4 }}><h2 style={{ fontSize: 22 }}>My requests</h2><span className="pp-sp" />{canReport && <button className="pp-btn sm" onClick={() => setReporting(true)}>＋ Report a problem</button>}</div>
      {me.units.some((u) => !u.seeAllRequests) && <p className="mu">You see the requests you sent. Unit owners also see requests others sent for their unit.</p>}
      <div className="pp-chips">
        {([["open", "Open"], ["done", "Finished"], ["all", "All"]] as const).map(([k, label]) => <button key={k} className={"pp-chip" + (show === k ? " on" : "")} onClick={() => setShow(k)}>{label}</button>)}
        {me.units.length > 1 && (
          <>
            <span style={{ width: 8 }} />
            <button className={"pp-chip" + (!unit ? " on" : "")} onClick={() => setUnit("")}>All units</button>
            {me.units.map((u) => <button key={u.unitId} className={"pp-chip" + (unit === u.unitId ? " on" : "")} onClick={() => setUnit(u.unitId)}>{u.code}</button>)}
          </>
        )}
      </div>
      {q.isLoading ? <p className="mu">Loading…</p> : q.isError ? <p className="pp-err">{(q.error as Error).message}</p>
        : <RequestList list={list} onOpen={setSel} empty={show === "open" ? "Nothing open right now." : "No requests here yet."} />}
      {reporting && <Sheet title="Report a problem" onClose={() => setReporting(false)}><NewRequest units={me.units} unitId={unit || undefined} onDone={(r) => { setReporting(false); setSel(r.id); }} /></Sheet>}
      {sel && <RequestView id={sel} onClose={() => setSel(null)} />}
    </>
  );
}
