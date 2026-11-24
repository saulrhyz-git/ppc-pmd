import { useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { PORTAL_URGENCY, TRADES, type PortalMeDTO, type PortalRequestDTO, type PortalUnitDTO } from "@pmd/shared";
import { Card, Sheet, Table } from "../ui";
import { fileUrl, papi } from "./api";
import { StatusPill, fmtDay, fmtWhen } from "./bits";

const useRequests = () => useQuery({ queryKey: ["p-requests"], queryFn: () => papi.get<PortalRequestDTO[]>("/requests"), refetchInterval: 60_000 });

function FilesInput({ onChange }: { onChange: (f: File[]) => void }) {
  const [err, setErr] = useState("");
  return (
    <label className="ff">
      <span className="mu">Photos or PDF (optional, up to 5 files, 10 MB each)</span>
      <input type="file" multiple accept="image/jpeg,image/png,image/gif,image/webp,image/heic,application/pdf" onChange={(e) => {
        const list = [...(e.target.files ?? [])];
        const big = list.find((f) => f.size > 10 * 1024 * 1024);
        setErr(list.length > 5 ? "Choose at most 5 files" : big ? `${big.name} is larger than 10 MB` : "");
        onChange(list.slice(0, 5).filter((f) => f.size <= 10 * 1024 * 1024));
      }} />
      {err && <span className="err">{err}</span>}
    </label>
  );
}

function NewRequest({ units, unitId, onDone }: { units: PortalUnitDTO[]; unitId: string; onDone: (r: PortalRequestDTO) => void }) {
  const qc = useQueryClient();
  const [unit, setUnit] = useState(unitId);
  const [trade, setTrade] = useState<string>("Other");
  const [location, setLocation] = useState("");
  const [concern, setConcern] = useState("");
  const [urgency, setUrgency] = useState<string>("Normal");
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
  const submit = (e: FormEvent) => { e.preventDefault(); setErr(""); m.mutate(); };
  const can = units.filter((u) => u.canRequest);
  return (
    <form onSubmit={submit}>
      <label className="ff"><span className="mu">Unit or space</span>
        <select value={unit} onChange={(e) => setUnit(e.target.value)}>{can.map((u) => <option key={u.unitId} value={u.unitId}>{u.building} · {u.code}</option>)}</select>
      </label>
      <label className="ff"><span className="mu">What kind of problem?</span>
        <select value={trade} onChange={(e) => setTrade(e.target.value)}>{TRADES.map((t) => <option key={t}>{t}</option>)}</select>
      </label>
      <label className="ff"><span className="mu">Where exactly? (room, area; optional)</span><input value={location} onChange={(e) => setLocation(e.target.value)} maxLength={200} /></label>
      <label className="ff"><span className="mu">Describe the problem</span><textarea className="in" rows={4} value={concern} onChange={(e) => setConcern(e.target.value)} required minLength={5} maxLength={4000} /></label>
      <label className="ff"><span className="mu">How urgent is it?</span>
        <select value={urgency} onChange={(e) => setUrgency(e.target.value)}>{PORTAL_URGENCY.map((u) => <option key={u}>{u}</option>)}</select>
      </label>
      {urgency === "Urgent" && <p className="mu">For emergencies such as fire, flooding or someone hurt, call building security or the emergency hotline right away. Do not wait for a reply here.</p>}
      <FilesInput onChange={setFiles} />
      <button className="cta" disabled={m.isPending || !unit}>{m.isPending ? "Sending…" : "Send request"}</button>
      {err && <p className="err">{err}</p>}
    </form>
  );
}

function Attachments({ list }: { list: { id: string; filename: string; mime: string }[] }) {
  if (!list.length) return null;
  return (
    <div className="thumbs">
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
  const [formKey, setFormKey] = useState(0);
  const m = useMutation({
    mutationFn: () => { const f = new FormData(); f.append("message", msg); files.forEach((x) => f.append("files", x)); return papi.post<PortalRequestDTO>(`/requests/${id}/followups`, f); },
    onSuccess: (r) => { setMsg(""); setFiles([]); setFormKey((k) => k + 1); qc.setQueryData(["p-request", id], r); qc.invalidateQueries({ queryKey: ["p-requests"] }); },
    onError: (e) => setErr((e as Error).message),
  });
  const r = q.data;
  return (
    <Sheet title={r ? `${r.controlNo} · ${r.trade}` : "Request"} onClose={onClose}>
      {q.isError ? <p className="err">{(q.error as Error).message}</p> : !r ? <p className="mu">Loading…</p> : (
        <>
          <p><StatusPill s={r.status} /> {r.urgency === "Urgent" && <span className="pill r">Urgent</span>} <span className="mu">{r.building} · Unit {r.unitCode}{r.location ? " · " + r.location : ""}</span></p>
          <div className="msg tenant">
            <small>{r.filedBy} · {fmtWhen(r.createdAt)}</small>
            <div style={{ whiteSpace: "pre-wrap" }}>{r.concern}</div>
            <Attachments list={r.attachments} />
          </div>
          {r.updates.map((u) => (
            <div key={u.id} className={"msg " + (u.kind === "followup" ? "tenant" : "staff")}>
              <small>{u.kind === "status" ? "Update" : u.authorName} · {fmtWhen(u.createdAt)}</small>
              <div style={{ whiteSpace: "pre-wrap" }}>{u.message}</div>
              <Attachments list={u.attachments} />
            </div>
          ))}
          {r.workOrders.length > 0 && (
            <>
              <h3>Work orders</h3>
              <Table head={["Ticket", "Work", "Status", "Target date"]}>
                {r.workOrders.map((w) => <tr key={w.ticket}><td>{w.ticket}</td><td className="wrap">{w.title}</td><td><StatusPill s={w.status} /></td><td>{fmtDay(w.targetDate)}</td></tr>)}
              </Table>
            </>
          )}
          {r.status !== "Closed" && (
            <>
              <h3>Send a message</h3>
              <textarea className="in" rows={3} value={msg} onChange={(e) => setMsg(e.target.value)} maxLength={4000} />
              <FilesInput key={formKey} onChange={setFiles} />
              <button className="cta" disabled={!msg.trim() || m.isPending} onClick={() => { setErr(""); m.mutate(); }}>{m.isPending ? "Sending…" : "Send"}</button>
              {err && <p className="err">{err}</p>}
            </>
          )}
        </>
      )}
    </Sheet>
  );
}

export default function Home({ me }: { me: PortalMeDTO }) {
  const q = useRequests();
  const [newFor, setNewFor] = useState<string | null>(null);
  const [sel, setSel] = useState<string | null>(null);
  const [unitFilter, setUnitFilter] = useState("");
  const list = (q.data ?? []).filter((r) => !unitFilter || r.unitId === unitFilter);
  // Count open requests from the live list, so the number updates as soon as a request is filed.
  const openFor = (unitId: string) => q.data ? q.data.filter((r) => r.unitId === unitId && ["Sent", "Received", "In progress"].includes(r.status)).length : me.units.find((u) => u.unitId === unitId)?.openRequests ?? 0;
  if (!me.units.length) {
    return <Card title="No units yet"><p className="mu">Your account is not linked to any unit or space at the moment. If you think this is a mistake, please contact property management.</p></Card>;
  }
  return (
    <>
      <Card title="My units and spaces">
        <div className="pu">
          {me.units.map((u) => (
            <div key={u.unitId} className="unit">
              <span className="mu">{u.building}</span>
              <b>Unit {u.code}</b>
              <span className="mu">{u.kind}{u.floor ? ` · Floor ${u.floor}` : ""} · {u.relation}</span>
              {u.endsOn && <span className="mu" style={{ display: "block" }}>Access until {fmtDay(u.endsOn)}</span>}
              <div className="row">
                <button className="lnk" onClick={() => setUnitFilter(unitFilter === u.unitId ? "" : u.unitId)}>{openFor(u.unitId)} open request{openFor(u.unitId) === 1 ? "" : "s"}</button>
                <span className="spacer" />
                {u.canRequest && <button className="cta sm" onClick={() => setNewFor(u.unitId)}>+ New request</button>}
              </div>
            </div>
          ))}
        </div>
      </Card>
      <Card title="Requests" right={unitFilter && <button className="lnk" onClick={() => setUnitFilter("")}>Show all units</button>}
        sub={me.units.some((u) => !u.seeAllRequests) ? "You see the requests you filed. Owners also see requests filed by others for their unit." : undefined}>
        {q.isLoading ? <p className="mu">Loading…</p> : q.isError ? <p className="err">{(q.error as Error).message}</p> : !list.length ? <p className="mu">No requests yet. Use “+ New request” on a unit to report a problem.</p> : (
          list.map((r) => (
            <div key={r.id} className="er" role="button" tabIndex={0} onClick={() => setSel(r.id)} onKeyDown={(e) => e.key === "Enter" && setSel(r.id)}>
              <div className="row"><b style={{ display: "inline" }}>{r.controlNo}</b><span className="mu">{r.building} · Unit {r.unitCode}</span><span className="spacer" />{r.urgency === "Urgent" && <span className="pill r">Urgent</span>}<StatusPill s={r.status} /></div>
              <div style={{ marginTop: 4 }}>{r.trade}: {r.concern.slice(0, 140)}{r.concern.length > 140 ? "…" : ""}</div>
              <span className="mu">Filed {fmtDay(r.createdAt)} by {r.filedBy}{r.updates.some((u) => u.kind === "response") ? " · has a reply" : ""}</span>
            </div>
          ))
        )}
      </Card>
      {newFor && (
        <Sheet title="New request" onClose={() => setNewFor(null)}>
          <NewRequest units={me.units} unitId={newFor} onDone={(r) => { setNewFor(null); setSel(r.id); }} />
        </Sheet>
      )}
      {sel && <RequestView id={sel} onClose={() => setSel(null)} />}
    </>
  );
}
