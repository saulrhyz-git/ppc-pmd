import { useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { TRADES, type ConcernDTO } from "@pmd/shared";
import { api } from "../api";
import { useAuth } from "../auth";
import { Card, Pill, Sheet, Table } from "../ui";
import { ThemeButton, UserChip } from "../Layout";
import { Thread, useConcerns } from "./ConcernsInbox";
import { fmtDate } from "./common";

const stLevel = (s: string) => (s === "Resolved" || s === "Closed" ? "g" : s === "Sent" ? "a" : "a");

function NewConcern({ onDone }: { onDone: () => void }) {
  const qc = useQueryClient();
  const buildings = useQuery({ queryKey: ["concern-buildings"], queryFn: () => api.get<string[]>("/concerns/buildings") });
  const [property, setProperty] = useState("");
  const [trade, setTrade] = useState<string>("Other");
  const [location, setLocation] = useState("");
  const [concern, setConcern] = useState("");
  const [files, setFiles] = useState<FileList | null>(null);
  const [err, setErr] = useState("");
  const b = property || buildings.data?.[0] || "";
  const m = useMutation({
    mutationFn: () => {
      const f = new FormData();
      f.append("property", b); f.append("trade", trade); f.append("location", location); f.append("concern", concern);
      if (files) [...files].slice(0, 5).forEach((x) => f.append("files", x));
      return api.post<ConcernDTO>("/concerns", f);
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["concerns"] }); onDone(); },
    onError: (e) => setErr((e as Error).message),
  });
  const submit = (e: FormEvent) => { e.preventDefault(); setErr(""); m.mutate(); };
  return (
    <form onSubmit={submit}>
      {(buildings.data?.length ?? 0) > 1 && (
        <label className="ff"><span className="mu">Building</span><select value={b} onChange={(e) => setProperty(e.target.value)}>{buildings.data!.map((x) => <option key={x}>{x}</option>)}</select></label>
      )}
      <label className="ff"><span className="mu">Kind of concern</span><select value={trade} onChange={(e) => setTrade(e.target.value)}>{TRADES.map((t) => <option key={t}>{t}</option>)}</select></label>
      <label className="ff"><span className="mu">Location (floor, unit, area)</span><input value={location} onChange={(e) => setLocation(e.target.value)} maxLength={200} /></label>
      <label className="ff"><span className="mu">What is the concern?</span><textarea className="in" rows={4} value={concern} onChange={(e) => setConcern(e.target.value)} required minLength={3} /></label>
      <label className="ff"><span className="mu">Photos or files (optional, up to 5, 20 MB each)</span><input type="file" multiple accept="image/*,application/pdf,text/plain" onChange={(e) => setFiles(e.target.files)} /></label>
      <button className="cta" disabled={m.isPending || !b}>{m.isPending ? "Sending…" : "Send concern"}</button>
      {!b && !buildings.isLoading && <p className="err">Your account is not linked to a building yet. Please contact property management.</p>}
      {err && <p className="err">{err}</p>}
    </form>
  );
}

function ConcernView({ c, onClose }: { c: ConcernDTO; onClose: () => void }) {
  const qc = useQueryClient();
  const cur = useConcerns().data?.find((x) => x.id === c.id) ?? c;
  const [msg, setMsg] = useState("");
  const [err, setErr] = useState("");
  const m = useMutation({
    mutationFn: () => { const f = new FormData(); f.append("message", msg); return api.post<ConcernDTO>(`/concerns/${c.id}/updates`, f); },
    onSuccess: () => { setMsg(""); qc.invalidateQueries({ queryKey: ["concerns"] }); },
    onError: (e) => setErr((e as Error).message),
  });
  return (
    <Sheet title={`${cur.controlNo} · ${cur.trade}`} onClose={onClose}>
      <p><Pill level={stLevel(cur.status)}>{cur.status}</Pill> <span className="mu">{cur.property}{cur.location ? " · " + cur.location : ""}</span></p>
      <Thread c={cur} />
      {cur.status !== "Closed" && (
        <>
          <h3>Send a follow-up</h3>
          <textarea className="in" rows={3} value={msg} onChange={(e) => setMsg(e.target.value)} />
          <button className="cta" disabled={!msg.trim() || m.isPending} onClick={() => m.mutate()}>{m.isPending ? "Sending…" : "Send follow-up"}</button>
          {err && <p className="err">{err}</p>}
        </>
      )}
    </Sheet>
  );
}

export default function Portal() {
  const { user } = useAuth();
  const q = useConcerns();
  const [adding, setAdding] = useState(false);
  const [sel, setSel] = useState<ConcernDTO | null>(null);
  return (
    <>
      <header>
        <div className="top">
          <div><h1>PPC <b>Tenant</b> Portal</h1><small>{user?.name}</small></div>
          <div className="bar" style={{ margin: 0 }}><ThemeButton /></div>
          <div id="who"><UserChip /></div>
        </div>
      </header>
      <main>
        <Card title="Raise a concern" right={!adding && <button className="cta sm" onClick={() => setAdding(true)}>+ New concern</button>}>
          {adding ? <NewConcern onDone={() => setAdding(false)} /> : <p className="mu">Tell property management about a problem in your unit or the building. You can follow its progress here.</p>}
        </Card>
        <Card title="My concerns">
          {q.isLoading ? <p className="mu">Loading…</p> : !q.data?.length ? <p className="mu">You have not raised any concerns yet.</p> : (
            <Table head={["Control no.", "Kind", "Concern", "Sent", "Status"]}>
              {q.data.map((c) => (
                <tr key={c.id} className="click" onClick={() => setSel(c)}>
                  <td>{c.controlNo}</td><td>{c.trade}</td><td className="wrap">{c.concern.slice(0, 120)}</td><td>{fmtDate(c.createdAt.slice(0, 10))}</td><td><Pill level={stLevel(c.status)}>{c.status}</Pill></td>
                </tr>
              ))}
            </Table>
          )}
        </Card>
        {sel && <ConcernView c={sel} onClose={() => setSel(null)} />}
      </main>
    </>
  );
}
